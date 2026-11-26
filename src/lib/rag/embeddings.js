import { ragConfig } from './config.js';
import { RAGProviderError, postJson } from './provider.js';

/**
 * Embedding adapter (OpenAI-compatible: OpenRouter by default, or any other
 * `/embeddings` endpoint through the same env vars).
 *
 * Two invariants matter more than the HTTP details:
 *   - `input_type` distinguishes stored documents from queries. Nemotron is
 *     instruction-aware, and mixing the two silently costs retrieval quality.
 *   - the result order comes from `data[].index`, never the array order. The
 *     provider is not required to preserve the request order, and an off-by-
 *     one mix-up would attach the wrong vector to every chunk.
 */

function assertEmbedding(row, dimensions) {
  if (!row || !Array.isArray(row.embedding)) {
    throw new RAGProviderError('Embedding response is missing a vector', { code: 'provider_error' });
  }
  if (row.embedding.length !== dimensions) {
    throw new RAGProviderError(
      `Embedding has ${row.embedding.length} dimensions, expected ${dimensions}. ` +
        'Changing RAG_EMBEDDING_MODEL/DIMENSIONS requires a full re-index.',
      { code: 'dimension_mismatch' }
    );
  }
  return row.embedding;
}

async function embedBatch(texts, inputType, config) {
  const payload = {
    model: config.embedding.model,
    input: texts,
    dimensions: config.embedding.dimensions,
  };
  if (inputType) payload.input_type = inputType;

  const data = await postJson(`${config.embedding.baseUrl}/embeddings`, {
    headers: { Authorization: `Bearer ${config.embedding.apiKey}` },
    body: payload,
    timeoutMs: 60_000,
  });

  const rows = Array.isArray(data?.data) ? [...data.data] : [];
  if (rows.length !== texts.length) {
    throw new RAGProviderError(
      `Embedding response returned ${rows.length} vectors for ${texts.length} inputs`,
      { code: 'provider_error' }
    );
  }
  rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return rows.map((row) => assertEmbedding(row, config.embedding.dimensions));
}

/**
 * Embed many texts in provider-safe batches (default 32) with limited
 * concurrency, preserving input order in the result.
 */
export async function embedTexts(texts, { inputType = 'search_document', config = ragConfig() } = {}) {
  if (!texts || texts.length === 0) return [];

  const batchSize = Math.max(1, config.embedding.batch);
  const batches = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    batches.push(texts.slice(start, start + batchSize));
  }

  const results = new Array(batches.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, config.embedding.concurrency), batches.length);

  async function worker() {
    while (next < batches.length) {
      const index = next;
      next += 1;
      results[index] = await embedBatch(batches[index], inputType, config);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.flat();
}

/** Embed a single search query with the matching instruction. */
export async function embedQuery(text, { config = ragConfig() } = {}) {
  const [vector] = await embedTexts([text], { inputType: 'search_query', config });
  return vector;
}

/** pgvector accepts a string literal; JSON is a valid vector input format. */
export function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}
