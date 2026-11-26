import { prisma } from '@/lib/prisma';
import { getPublisher } from '@/lib/redis';
import { apiError, handle, json } from '@/lib/api-helpers';
import { timingSafeEqual } from '@/lib/permissions';
import { indexDocument } from '@/lib/rag/index.js';

/**
 * POST /api/internal/rag/reindex — freshness hook + backfill (PLAN §6.5).
 *
 * Called by the sync service after a snapshot is persisted, and by
 * `npm run rag:reindex`. It has no session: it is authenticated by a shared
 * secret compared in constant time, and it only ever accepts document ids —
 * never text — so a compromised caller cannot inject content into the index.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request) {
  const expected = process.env.RAG_REINDEX_SECRET;
  if (!expected) return false; // fail closed when the deployment is not configured
  const provided = request.headers.get('x-inkwell-secret');
  if (!provided) return false;
  return timingSafeEqual(expected, provided);
}

/** Per-document debounce: Redis SET NX EX 60 (PLAN §6.5). */
async function debounced(documentId) {
  const redis = getPublisher();
  if (!redis) return true;
  const result = await redis.set(`rag:reindex-debounce:${documentId}`, '1', 'EX', 60, 'NX').catch(() => 'unavailable');
  return result !== null;
}

export async function POST(request) {
  return handle(async () => {
    if (!authorized(request)) return apiError(401, 'Invalid reindex secret');

    const body = await request.json().catch(() => ({}));

    if (typeof body?.documentId === 'string' && body.documentId) {
      if (!(await debounced(body.documentId))) return json({ status: 'debounced' });
      const result = await indexDocument(body.documentId, { force: Boolean(body.force) });
      return json(result);
    }

    if (body?.all !== true) return apiError(400, 'documentId or all:true is required');

    // Backfill: the same query the cron uses, in one batch.
    const stale = await prisma.$queryRaw`
      SELECT d."id"
        FROM "Document" d
        LEFT JOIN "DocumentIndexState" s ON s."documentId" = d."id"
       WHERE d."deletedAt" IS NULL
         AND (s."indexedAt" IS NULL OR d."updatedAt" > s."indexedAt" OR s."status" = 'error')
       ORDER BY d."updatedAt" DESC
       LIMIT 25
    `;

    const results = [];
    for (const row of stale) {
      try {
        results.push(await indexDocument(row.id, { force: Boolean(body.force) }));
      } catch (err) {
        results.push({ documentId: row.id, status: 'error', error: String(err?.message ?? err).slice(0, 200) });
      }
    }
    return json({ processed: results.length, results });
  });
}
