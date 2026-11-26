import { prisma } from '@/lib/prisma';
import { inngest } from '@/lib/inngest';
import { track, EVENTS } from '@/lib/telemetry';

const TRASH_RETENTION_DAYS = 30;

/** Permanently deletes documents whose trash retention window has elapsed. */
export const purgeExpiredTrash = inngest.createFunction(
  {
    id: 'purge-expired-trash',
    name: 'Purge expired trash',
    triggers: [{ cron: 'TZ=UTC 0 * * * *' }], // hourly
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    return step.run('purge-documents', async () => {
      // Idempotent batched delete — safe to retry.
      const expired = await prisma.document.findMany({
        where: { deletedAt: { lte: cutoff } },
        select: { id: true, title: true },
        take: 500,
      });
      for (const doc of expired) {
        await prisma.document.delete({ where: { id: doc.id } });
        track(EVENTS.DOC_PURGED, { document_id: doc.id });
      }
      return { purged: expired.length };
    });
  }
);

const SNAPSHOT_RETENTION_DAYS = 30;

/** Deletes version snapshots older than the retention policy. */
export const pruneOldSnapshots = inngest.createFunction(
  {
    id: 'prune-old-snapshots',
    name: 'Prune old version snapshots',
    triggers: [{ cron: 'TZ=UTC 30 0 * * *' }], // daily
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    return step.run('prune-snapshots', async () => {
      const result = await prisma.versionSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return { pruned: result.count };
    });
  }
);
