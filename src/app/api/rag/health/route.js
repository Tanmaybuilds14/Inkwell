import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';
import { ragConfig } from '@/lib/rag/config.js';
import { embedQuery } from '@/lib/rag/embeddings.js';
import { postJson } from '@/lib/rag/provider.js';

/**
 * GET /api/rag/health — pings the three providers separately.
 *
 * The point is to tell "the model was retired" apart from "you have no
 * documents" (PLAN §12). Model ids are returned; keys never are.
 * Requires a signed-in user because every check spends provider quota.
 */

async function checkEmbedding(config) {
  try {
    const vector = await embedQuery('inkwell health check', { config });
    return { ok: true, model: config.embedding.model, dimensions: vector.length };
  } catch (err) {
    return { ok: false, model: config.embedding.model, error: err?.code ?? 'error' };
  }
}

async function checkLlm(config) {
  try {
    const data = await postJson(`${config.llm.baseUrl}/models/${encodeURIComponent(config.llm.model)}:generateContent`, {
      headers: { 'x-goog-api-key': config.llm.apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        generationConfig: { maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } },
      },
      timeoutMs: 15_000,
      retries: 0,
    });
    return { ok: true, model: data?.modelVersion ?? config.llm.model };
  } catch (err) {
    return { ok: false, model: config.llm.model, error: err?.code ?? 'error' };
  }
}

async function checkRerank(config) {
  if (!config.rerank.enabled) return { skipped: true, model: config.rerank.model };
  try {
    await postJson(`${config.rerank.baseUrl}/rerank`, {
      headers: { Authorization: `Bearer ${config.rerank.apiKey}` },
      body: { model: config.rerank.model, query: 'health', documents: ['inkwell health check'], top_n: 1 },
      timeoutMs: config.rerank.timeoutMs,
      retries: 0,
    });
    return { ok: true, model: config.rerank.model };
  } catch (err) {
    return { ok: false, model: config.rerank.model, error: err?.code ?? 'error' };
  }
}

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const config = ragConfig();
    const [embedding, llm, rerank] = await Promise.all([
      checkEmbedding(config),
      checkLlm(config),
      checkRerank(config),
    ]);

    const healthy = embedding.ok && llm.ok && (rerank.ok || rerank.skipped);
    return json(
      { healthy, embedding, llm, rerank },
      { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  });
}
