import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getPublisher } from '@/lib/redis';
import { track } from '@/lib/telemetry';
import { ragConfig } from './config.js';
import { embedTexts, toVectorLiteral } from './embeddings.js';
import { extractBlocks } from './extract.js';
import { chunkBlocks, embeddedTextFor } from './chunk.js';

/**
 * Index one document (PLAN §6.4).
 *
 * Idempotent and delta-based: a chunk whose hash — `sha256(model:dims:embeddedText)` —
 * is unchanged keeps its existing vector, so a typo fix re-embeds one chunk
 * instead of the whole document. `indexedAt` is set to the `updatedAt` that was
 * actually indexed, never `now()`, so a save that lands mid-run is still seen
 * as stale by the next cron pass.
 */

const LOCK_KEY = (documentId) => `rag:index-lock:${documentId}`;
const LOCK_SECONDS = 300;

/** Overall document hash, used only as a change marker in the state row. */
function overallHash(chunks) {
  return createHash('sha256').update(chunks.map((chunk) => chunk.contentHash).join(':')).digest('hex');
}

/** Delete every chunk and the index state for a document. */
export async function purgeDocumentIndex(documentId) {
  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId } }),
    prisma.documentIndexState.deleteMany({ where: { documentId } }),
  ]);
}

export async function indexDocument(documentId, { force = false } = {}) {
  const config = ragConfig();
  const redis = getPublisher();
  let lockToken = null;

  if (redis) {
    lockToken = await redis.set(LOCK_KEY(documentId), '1', 'EX', LOCK_SECONDS, 'NX').catch(() => 'unavailable');
    if (lockToken === null) {
      return { documentId, status: 'skipped', reason: 'locked' };
    }
  }

  try {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, snapshot: true, updatedAt: true, deletedAt: true },
    });
    if (!doc) return { documentId, status: 'skipped', reason: 'missing' };

    // Soft-deleted documents must disappear from retrieval immediately, and
    // their vectors should not sit in the database waiting for a hard delete.
    if (doc.deletedAt) {
      await purgeDocumentIndex(documentId);
      return { documentId, status: 'purged' };
    }

    const state = await prisma.documentIndexState.findUnique({ where: { documentId } });
    const modelMatches =
      state?.embeddingModel === config.embedding.model &&
      state?.embeddingDimensions === config.embedding.dimensions;

    if (
      !force &&
      state?.status === 'ready' &&
      modelMatches &&
      state.indexedAt &&
      state.indexedAt.getTime() >= doc.updatedAt.getTime()
    ) {
      return { documentId, status: 'skipped', reason: 'fresh' };
    }

    const blocks = await extractBlocks(doc.snapshot);
    const { chunks, truncated } = chunkBlocks(blocks, {
      targetTokens: config.chunking.targetTokens,
      maxTokens: config.chunking.maxTokens,
      overlap: config.chunking.overlap,
      maxChunks: config.chunking.maxChunksPerDocument,
    });

    const prepared = chunks.map((chunk) => {
      const embedded = embeddedTextFor({
        title: doc.title,
        headingPath: chunk.headingPath,
        content: chunk.content,
      });
      return {
        ...chunk,
        embedded,
        contentHash: createHash('sha256')
          .update(`${config.embedding.model}:${config.embedding.dimensions}:${embedded}`)
          .digest('hex'),
      };
    });

    const existing = await prisma.documentChunk.findMany({
      where: { documentId },
      select: { chunkIndex: true, contentHash: true, embeddingModel: true, embeddingDimensions: true },
    });
    const existingByIndex = new Map(existing.map((row) => [row.chunkIndex, row]));

    // A model/dimension change invalidates every vector, not just the changed
    // text — the hash includes both, so `force` is only needed to re-embed the
    // same model deliberately (e.g. a provider-side fix).
    const toEmbed = prepared.filter((chunk) => {
      const previous = existingByIndex.get(chunk.chunkIndex);
      return (
        force ||
        !previous ||
        previous.contentHash !== chunk.contentHash ||
        previous.embeddingModel !== config.embedding.model ||
        previous.embeddingDimensions !== config.embedding.dimensions
      );
    });

    await prisma.documentIndexState.upsert({
      where: { documentId },
      create: { documentId, status: 'indexing', embeddingModel: config.embedding.model, embeddingDimensions: config.embedding.dimensions },
      update: { status: 'indexing', lastError: null },
    });

    const vectors = toEmbed.length
      ? await embedTexts(toEmbed.map((chunk) => chunk.embedded), { inputType: 'search_document', config })
      : [];
    const vectorByIndex = new Map(toEmbed.map((chunk, i) => [chunk.chunkIndex, vectors[i]]));

    await prisma.$transaction(
      async (tx) => {
        // Remove chunks past the new end (a document that got shorter).
        await tx.$executeRawUnsafe(
          `DELETE FROM "DocumentChunk" WHERE "documentId" = $1 AND "chunkIndex" >= $2`,
          documentId,
          prepared.length
        );

        for (const chunk of prepared) {
          const vector = vectorByIndex.get(chunk.chunkIndex);
          if (!vector) continue; // unchanged — existing row and vector stay

          await tx.$executeRawUnsafe(
            `INSERT INTO "DocumentChunk"
               ("id","documentId","chunkIndex","content","headingPath","charStart","charEnd",
                "tokenCount","contentHash","embedding","embeddingModel","embeddingDimensions","createdAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11,$12,NOW())
             ON CONFLICT ("documentId","chunkIndex") DO UPDATE SET
               "content" = EXCLUDED."content",
               "headingPath" = EXCLUDED."headingPath",
               "charStart" = EXCLUDED."charStart",
               "charEnd" = EXCLUDED."charEnd",
               "tokenCount" = EXCLUDED."tokenCount",
               "contentHash" = EXCLUDED."contentHash",
               "embedding" = EXCLUDED."embedding",
               "embeddingModel" = EXCLUDED."embeddingModel",
               "embeddingDimensions" = EXCLUDED."embeddingDimensions"`,
            randomUUID(),
            documentId,
            chunk.chunkIndex,
            chunk.content,
            chunk.headingPath,
            chunk.charStart,
            chunk.charEnd,
            chunk.tokenCount,
            chunk.contentHash,
            toVectorLiteral(vector),
            config.embedding.model,
            config.embedding.dimensions
          );
        }

        const hash = overallHash(prepared);
        await tx.documentIndexState.upsert({
          where: { documentId },
          create: {
            documentId,
            status: 'ready',
            contentHash: hash,
            embeddingModel: config.embedding.model,
            embeddingDimensions: config.embedding.dimensions,
            chunkCount: prepared.length,
            indexedAt: doc.updatedAt,
          },
          update: {
            status: 'ready',
            contentHash: hash,
            embeddingModel: config.embedding.model,
            embeddingDimensions: config.embedding.dimensions,
            chunkCount: prepared.length,
            indexedAt: doc.updatedAt,
            lastError: null,
          },
        });
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    // Content-free telemetry: ids, counts, models — never text (PLAN §8.3).
    track('rag_document_indexed', {
      document_id: documentId,
      chunk_count: prepared.length,
      embedded_count: toEmbed.length,
      model: config.embedding.model,
      truncated,
    });

    return {
      documentId,
      status: 'ready',
      chunkCount: prepared.length,
      embedded: toEmbed.length,
      truncated,
    };
  } catch (err) {
    await prisma.documentIndexState
      .upsert({
        where: { documentId },
        create: { documentId, status: 'error', lastError: String(err?.message ?? err).slice(0, 500) },
        update: { status: 'error', lastError: String(err?.message ?? err).slice(0, 500) },
      })
      .catch(() => {});
    throw err;
  } finally {
    if (redis && lockToken === 'OK') {
      await redis.del(LOCK_KEY(documentId)).catch(() => {});
    }
  }
}
