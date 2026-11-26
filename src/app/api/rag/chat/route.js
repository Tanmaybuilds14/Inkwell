import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ragConfig } from '@/lib/rag/config.js';
import { retrieve } from '@/lib/rag/retrieve.js';
import { buildPrompt, citationsFrom } from '@/lib/rag/prompt.js';
import { sseEvent, sseResponse, streamAnswer } from '@/lib/rag/stream.js';
import { ownedDocumentIds, normalizeScope } from '@/lib/rag/owner-docs.js';
import { consumeChatBudget, addSpentTokens, spentTokensToday } from '@/lib/rag/limits.js';
import { RAGProviderError } from '@/lib/rag/provider.js';

/**
 * POST /api/rag/chat — streaming, owner-scoped cross-document Q&A.
 *
 * Order matters (PLAN §7.1): authenticate → narrow scope to owned documents →
 * persist the question → retrieve → stream → persist the answer. Every read
 * path takes the user id from the session; the body can only narrow the
 * document set, never widen it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SNIPPET_LIMIT = 4000;

async function resolveThread(userId, threadId, scope) {
  if (!threadId) {
    return prisma.chatThread.create({ data: { userId, scope } });
  }
  // A foreign thread is indistinguishable from a missing one — 404, no leak.
  const thread = await prisma.chatThread.findFirst({ where: { id: threadId, userId }, select: { id: true, title: true } });
  return thread;
}

function errorStream(code, message, extra = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseEvent('error', { code, message, ...extra })));
      controller.close();
    },
  });
  return sseResponse(stream);
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: 'Sign in required' }, { status: 401 });
  }

  const config = ragConfig();

  const budget = await consumeChatBudget(user.id, { limit: config.limits.chatPerMinute });
  if (!budget.allowed) {
    return Response.json(
      { error: 'Too many questions — slow down and try again shortly.', retryAfterSeconds: budget.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds), 'Cache-Control': 'no-store' } }
    );
  }

  const spent = await spentTokensToday(user.id);
  if (spent !== null && spent >= config.limits.dailyTokenBudget) {
    return errorStream('budget_exhausted', "You've reached today's Inkwell answer budget. It resets at midnight UTC.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return Response.json({ error: 'message is required' }, { status: 400 });
  if (message.length > SNIPPET_LIMIT) {
    return Response.json({ error: 'message is too long' }, { status: 400 });
  }

  const scope = normalizeScope(body?.scope);
  const thread = await resolveThread(user.id, body?.threadId, scope);
  if (!thread) return Response.json({ error: 'Thread not found' }, { status: 404 });

  const documentIds = await ownedDocumentIds(user.id, scope);

  // Persist the question first: a failed answer must still leave the user's
  // question in the thread so they can retry it.
  await prisma.chatMessage.create({
    data: { threadId: thread.id, role: 'user', content: message, citations: undefined },
  });
  await prisma.chatThread.update({
    where: { id: thread.id },
    data: {
      updatedAt: new Date(),
      ...(thread.title ? {} : { title: message.slice(0, 80) }),
      scope,
    },
  });

  if (documentIds.length === 0) {
    return errorStream('no_sources', 'No indexed documents match this scope yet.', {
      hint: 'Documents become searchable a minute or two after they are edited.',
      threadId: thread.id,
    });
  }

  const history = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    select: { role: true, content: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  history.reverse();
  history.pop(); // the question just persisted, it is passed separately

  let sources = [];
  try {
    const retrieved = await retrieve({ userId: user.id, documentIds, query: message, config });
    sources = retrieved.sources;
  } catch (err) {
    const code = err instanceof RAGProviderError ? err.code : 'provider_unavailable';
    return errorStream(code, 'Search is unavailable right now. Please try again shortly.', { threadId: thread.id });
  }

  if (sources.length === 0) {
    return errorStream('no_sources', "I couldn't find anything in your documents for that.", {
      hint: 'Try a broader scope, or check that the documents are indexed.',
      threadId: thread.id,
    });
  }

  const { system, contents, includedSources } = buildPrompt({ question: message, history, sources, config });
  const requestSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(sseEvent(event, data)));
      let answer = '';

      send('sources', {
        threadId: thread.id,
        sources: includedSources.map((source) => ({
          index: source.index,
          chunkId: source.chunkId,
          documentId: source.documentId,
          title: source.title,
          headingPath: source.headingPath,
          snippet: source.snippet,
          score: source.score,
        })),
      });

      try {
        const result = await streamAnswer({
          system,
          contents,
          config,
          signal: requestSignal,
          onDelta: (delta) => {
            answer += delta;
            send('delta', { text: delta });
          },
        });

        const saved = await prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: 'assistant',
            content: result.text,
            citations: citationsFrom(includedSources),
            model: result.model,
          },
        });

        await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        await addSpentTokens(user.id, result.usage.promptTokens + result.usage.outputTokens);

        send('done', { messageId: saved.id, usage: result.usage, model: result.model });
      } catch (err) {
        // A client abort is not an error worth reporting: persist what was
        // streamed and close quietly (PLAN §7.6).
        if (requestSignal?.aborted || err?.name === 'AbortError') {
          if (answer) {
            await prisma.chatMessage
              .create({
                data: { threadId: thread.id, role: 'assistant', content: answer, citations: citationsFrom(includedSources) },
              })
              .catch(() => {});
          }
          controller.close();
          return;
        }

        const code = err instanceof RAGProviderError ? err.code : 'provider_unavailable';
        console.error('[rag] answer stream failed:', err?.message ?? err);
        send('error', {
          code,
          message:
            code === 'model_unavailable'
              ? `The configured answer model (${config.llm.model}) is unavailable.`
              : 'The answer model is unavailable right now. Please try again shortly.',
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by an abort.
        }
      }
    },
  });

  return sseResponse(stream);
}
