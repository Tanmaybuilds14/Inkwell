import { prisma } from '@/lib/prisma';
import { ragConfig } from './config.js';
import { embedQuery, toVectorLiteral } from './embeddings.js';
import { rerank } from './rerank.js';

/**
 * Owner-scoped hybrid retrieval (PLAN §7.2–7.4).
 *
 * The ownership filter (`d."ownerId" = $userId`, `d."deletedAt" IS NULL`) is
 * inside the ranking statement, not applied afterwards — that is the whole
 * isolation mechanism (§8.3 rule 2). Chunks carry no owner of their own, so a
 * document transfer changes visibility immediately with no re-index.
 */

const SNIPPET_CHARS = 300;

const snippetOf = (content) =>
  content.length <= SNIPPET_CHARS ? content : `${content.slice(0, SNIPPET_CHARS).trimEnd()}…`;

/**
 * Dense candidates. HNSW walks the index before applying WHERE, so a filtered
 * search can return fewer than k rows; over-fetching is the version-safe fix
 * (the alternative, `hnsw.iterative_scan`, needs pgvector ≥ 0.8).
 */
async function denseCandidates({ userId, documentIds, queryVector, config }) {
  const limit = Math.min(200, Math.max(config.retrieval.topKDense * 4, config.retrieval.topKDense));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT c."id", c."documentId", c."content", c."headingPath", d."title",
            (1 - (c."embedding" <=> $1::vector))::float8 AS score
       FROM "DocumentChunk" c
       JOIN "Document" d ON d."id" = c."documentId"
      WHERE d."ownerId" = $2
        AND d."deletedAt" IS NULL
        AND c."embedding" IS NOT NULL
        AND c."embeddingModel" = $3
        AND c."embeddingDimensions" = $4
        AND c."documentId" = ANY($5::text[])
      ORDER BY c."embedding" <=> $1::vector
      LIMIT $6`,
    toVectorLiteral(queryVector),
    userId,
    config.embedding.model,
    config.embedding.dimensions,
    documentIds,
    limit
  );
  return rows.slice(0, config.retrieval.topKDense);
}

/** Lexical candidates. `simple` config: language-agnostic, no stemming. */
async function lexicalCandidates({ userId, documentIds, query, config }) {
  try {
    return await prisma.$queryRawUnsafe(
      `SELECT c."id", c."documentId", c."content", c."headingPath", d."title",
              ts_rank_cd(to_tsvector('simple', c."content"), websearch_to_tsquery('simple', $1))::float8 AS score
         FROM "DocumentChunk" c
         JOIN "Document" d ON d."id" = c."documentId"
        WHERE d."ownerId" = $2
          AND d."deletedAt" IS NULL
          AND c."embeddingModel" = $3
          AND c."embeddingDimensions" = $4
          AND c."documentId" = ANY($5::text[])
          AND to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', $1)
        ORDER BY score DESC
        LIMIT $6`,
      query,
      userId,
      config.embedding.model,
      config.embedding.dimensions,
      documentIds,
      config.retrieval.topKLexical
    );
  } catch {
    // A malformed tsquery (or an FTS index that is still building) must not
    // fail the answer — dense retrieval alone still works.
    return [];
  }
}

/** Reciprocal Rank Fusion over both candidate lists (PLAN §7.4). */
export function fuse(rankedLists, { rrfK = 60, limit = 30 } = {}) {
  const merged = new Map();

  for (const rows of rankedLists) {
    rows.forEach((row, index) => {
      const entry = merged.get(row.id) ?? { ...row, score: 0 };
      entry.score += 1 / (rrfK + index + 1);
      merged.set(row.id, entry);
    });
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Full retrieval for one question.
 *
 * Returns `{ sources, candidateCount }`; a provider failure embedding the
 * query throws (the route maps it to `provider_unavailable`), while a rerank
 * failure silently degrades to RRF order.
 */
export async function retrieve({ userId, documentIds, query, config = ragConfig() }) {
  if (!documentIds || documentIds.length === 0) {
    return { sources: [], candidateCount: 0 };
  }

  const queryVector = await embedQuery(query, { config });

  const [dense, lexical] = await Promise.all([
    denseCandidates({ userId, documentIds, queryVector, config }),
    lexicalCandidates({ userId, documentIds, query, config }),
  ]);

  const fused = fuse([dense, lexical], {
    rrfK: config.retrieval.rrfK,
    limit: Math.max(config.retrieval.topKDense, config.retrieval.contextTopN * 2),
  });

  const ranked = await rerank(query, fused, { config });

  return {
    candidateCount: fused.length,
    sources: ranked.map((row, index) => ({
      index: index + 1,
      chunkId: row.id,
      documentId: row.documentId,
      title: row.title ?? 'Untitled',
      headingPath: row.headingPath ?? null,
      content: row.content,
      snippet: snippetOf(row.content),
      score: row.score,
    })),
  };
}
