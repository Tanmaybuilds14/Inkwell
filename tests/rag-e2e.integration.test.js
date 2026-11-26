import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';

/**
 * Live end-to-end check for Ask Inkwell — NOT part of `npm test`.
 *
 * It runs the real route handler against the real database, the real embedding
 * provider and the real answer model; only the session boundary
 * (`@/lib/auth`, i.e. Clerk) and Redis are stubbed. Use it after applying the
 * migration and running `npm run rag:reindex`:
 *
 *   RAG_E2E=1 npx vitest run tests/rag-e2e.integration.test.js
 */

const state = vi.hoisted(() => ({ user: null }));

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => state.user }));
vi.mock('@/lib/redis', () => ({ getPublisher: () => null }));

const { prisma } = await import('@/lib/prisma');
const { POST } = await import('@/app/api/rag/chat/route.js');

const run = process.env.RAG_E2E === '1';

describe.skipIf(!run)('rag chat (live)', () => {
  it(
    'indexes, retrieves two documents and streams a cited answer',
    async () => {
      const user = await prisma.user.findUnique({ where: { clerkId: 'demo-local-user' } });
      expect(user).toBeTruthy();
      state.user = user;

      const chunks = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS count, MIN("embeddingModel") AS model FROM "DocumentChunk"
      `;
      console.log('[e2e] indexed chunks:', JSON.stringify(chunks));
      expect(chunks[0].count).toBeGreaterThan(0);

      const question =
        'Who is allowed to invite people to a document, and how often is the search index refreshed?';

      const response = await POST(
        new Request('http://127.0.0.1:3000/api/rag/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question }),
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/event-stream');

      const body = await response.text();
      const sourcesAt = body.indexOf('event: sources');
      const firstDeltaAt = body.indexOf('event: delta');
      const doneAt = body.indexOf('event: done');
      const errorAt = body.indexOf('event: error');

      console.log('[e2e] error frame:', errorAt === -1 ? 'none' : body.slice(errorAt, errorAt + 400));
      expect(errorAt).toBe(-1);
      expect(sourcesAt).toBeGreaterThanOrEqual(0);
      expect(firstDeltaAt).toBeGreaterThan(sourcesAt);
      expect(doneAt).toBeGreaterThan(firstDeltaAt);

      // Reassemble the streamed answer the way the client does.
      const answer = [...body.matchAll(/event: delta\ndata: (.*)\n\n/g)]
        .map((match) => JSON.parse(match[1]).text)
        .join('');
      const sources = JSON.parse(body.match(/event: sources\ndata: (.*)\n/)[1]).sources;
      const done = JSON.parse(body.match(/event: done\ndata: (.*)\n/)[1]);

      console.log('[e2e] sources:', sources.map((s) => `${s.index}: ${s.title} — ${s.snippet.slice(0, 80)}`));
      console.log('[e2e] answer:', answer);
      console.log('[e2e] usage/model:', JSON.stringify({ usage: done.usage, model: done.model }));

      expect(sources.length).toBeGreaterThan(0);
      expect(answer.trim().length).toBeGreaterThan(20);
      // The answer must reflect BOTH documents, which is the cross-document claim.
      expect(sources.some((s) => /Sharing and Permissions/i.test(s.title))).toBe(true);
      expect(sources.some((s) => /How Ask Inkwell Works/i.test(s.title))).toBe(true);
      expect(answer).toMatch(/owner/i);
      expect(answer).toMatch(/two minutes|cron/i);

      const stored = await prisma.chatMessage.findMany({
        where: { threadId: JSON.parse(body.match(/event: sources\ndata: (.*)\n/)[1]).threadId },
        orderBy: { createdAt: 'asc' },
      });
      expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(stored[1].citations?.length).toBeGreaterThan(0);
      expect(stored[1].content).toBe(answer);
    },
    180_000
  );
});
