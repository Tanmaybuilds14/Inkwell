import { prisma } from '@/lib/prisma';
import { inngest } from '@/lib/inngest';
import { indexDocument } from '@/lib/rag/index.js';

/**
 * Background indexing (PLAN §6.5, phase 1).
 *
 * The cron reads stale document IDS only. Each document is its own step so a
 * single bad document fails and retries on its own instead of blocking the
 * batch, and Inngest never receives document text — only ids (§8.3 rule 7).
 */
export const ragReindexStale = inngest.createFunction(
  {
    id: 'rag-reindex-stale',
    name: 'Re-index stale documents',
    triggers: [{ cron: 'TZ=UTC */2 * * * *' }], // every 2 minutes
  },
  async ({ step }) => {
    const stale = await step.run('find-stale', async () =>
      prisma.$queryRaw`
        SELECT d."id"
          FROM "Document" d
          LEFT JOIN "DocumentIndexState" s ON s."documentId" = d."id"
         WHERE d."deletedAt" IS NULL
           AND (s."indexedAt" IS NULL OR d."updatedAt" > s."indexedAt" OR s."status" = 'error')
         ORDER BY d."updatedAt" DESC
         LIMIT 25
      `
    );

    let indexed = 0;
    let failed = 0;
    for (const row of stale) {
      try {
        await step.run(`index-${row.id}`, () => indexDocument(row.id));
        indexed += 1;
      } catch {
        failed += 1;
      }
    }

    // Chunks of soft-deleted documents would otherwise linger until the hard
    // delete 30 days later (PLAN §6.6).
    const purged = await step.run('purge-trashed', async () => {
      const trashed = await prisma.document.findMany({
        where: { deletedAt: { not: null } },
        select: { id: true },
        take: 50,
        orderBy: { deletedAt: 'desc' },
      });
      if (trashed.length === 0) return 0;
      const result = await prisma.documentChunk.deleteMany({
        where: { documentId: { in: trashed.map((doc) => doc.id) } },
      });
      return result.count;
    });

    return { considered: stale.length, indexed, failed, purgedChunks: purged };
  }
);
