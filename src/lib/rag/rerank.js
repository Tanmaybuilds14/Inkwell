import { ragConfig } from './config.js';
import { postJson } from './provider.js';

/**
 * Nemotron rerank via OpenRouter (PLAN §7.4).
 *
 * Fail-open by design: a reranker that is slow or down must never turn a
 * working answer into an error, and it must never be trusted to widen the
 * candidate set — the input list is already owner-filtered, and on failure we
 * return exactly that list in its RRF order.
 */
export async function rerank(query, candidates, { config = ragConfig(), limit } = {}) {
  const topN = Math.min(limit ?? config.rerank.topN, candidates.length);
  if (!config.rerank.enabled || candidates.length === 0) {
    return candidates.slice(0, topN);
  }

  const documents = candidates.map((candidate) =>
    candidate.headingPath ? `${candidate.headingPath}\n${candidate.content}` : candidate.content
  );

  try {
    const data = await postJson(`${config.rerank.baseUrl}/rerank`, {
      headers: { Authorization: `Bearer ${config.rerank.apiKey}` },
      body: {
        model: config.rerank.model,
        query,
        documents,
        top_n: topN,
      },
      timeoutMs: config.rerank.timeoutMs,
      retries: 0,
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    const ranked = [];
    const seen = new Set();
    for (const result of results) {
      const index = result?.index;
      if (!Number.isInteger(index) || index < 0 || index >= candidates.length || seen.has(index)) continue;
      seen.add(index);
      ranked.push({
        ...candidates[index],
        score: typeof result.relevance_score === 'number' ? result.relevance_score : candidates[index].score,
      });
    }

    // Providers occasionally return fewer rows than asked for. Top up from the
    // RRF list so the prompt budget is not silently halved.
    if (ranked.length < topN) {
      for (let i = 0; i < candidates.length && ranked.length < topN; i += 1) {
        if (!seen.has(i)) ranked.push(candidates[i]);
      }
    }

    return ranked.slice(0, topN);
  } catch {
    // Timeout, 429, retired model — all degrade to the RRF order (PLAN §7.7).
    return candidates.slice(0, topN);
  }
}
