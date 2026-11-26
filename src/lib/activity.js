import { prisma } from '@/lib/prisma';
import { track, EVENTS } from '@/lib/telemetry';

/**
 * User-facing activity audit.
 *
 * Writes one ActivityEvent row per interaction (documents created, edited,
 * shared, restored, …) so the profile page can show real per-user history.
 * Persistence is intentionally best-effort: a failed write logs the telemetry
 * event but never breaks the user-facing operation that triggered it.
 */

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export const ACTIVITY_TYPES = {
  DOC_CREATED: 'doc_created',
  DOC_EDITED: 'doc_edited',
  DOC_RENAMED: 'doc_renamed',
  DOC_MOVED: 'doc_moved',
  DOC_SHARED: 'doc_shared',
  DOC_SHARED_LINK: 'doc_shared_link',
  ACCESS_GRANTED: 'access_granted',
  DOC_OPENED: 'doc_opened',
  DOC_MOVED_TO_TRASH: 'doc_moved_to_trash',
  DOC_RESTORED: 'doc_restored',
  DOC_PURGED: 'doc_purged',
  VERSION_CREATED: 'version_created',
  VERSION_RESTORED: 'version_restored',
  PROFILE_UPDATED: 'profile_updated',
};

export async function logActivity(type, { userId, documentId = null, docTitle = null, meta = null }) {
  if (!userId) return;
  try {
    await prisma.activityEvent.create({
      data: {
        userId,
        type,
        documentId,
        docTitle,
        ...(meta !== null ? { meta } : {}),
      },
    });
  } catch (err) {
    console.error('[activity] write failed:', err.message);
  }
  // Keep the existing stdout telemetry stream in sync with the audit trail.
  track(type, { user_id: userId, document_id: documentId, ...meta });
}

export async function listActivity(userId, { cursor = null, limit = DEFAULT_PAGE_SIZE }) {
  const take = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const events = await prisma.activityEvent.findMany({
    where: { userId },
    // id tie-breaks rows created within the same millisecond (cuid ids are
    // lexicographically increasing) so pagination is deterministic.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1, // fetch one extra to detect the next page
    select: {
      id: true,
      type: true,
      documentId: true,
      docTitle: true,
      meta: true,
      createdAt: true,
    },
  });
  const hasMore = events.length > take;
  return {
    events: hasMore ? events.slice(0, take) : events,
    nextCursor: hasMore ? events[take - 1].id : null,
  };
}

/**
 * Aggregate counts for the profile page's stat tiles. `edited` counts edit
 * *sessions* (distinct documents-days) rather than raw keystroke batches.
 */
export async function activityStats(userId) {
  const [created, editedRows, shared, opened, restored, versions] = await Promise.all([
    prisma.activityEvent.count({ where: { userId, type: ACTIVITY_TYPES.DOC_CREATED } }),
    prisma
      .$queryRaw`SELECT COUNT(DISTINCT ("documentId", date_trunc('day', "createdAt"))) AS n
                   FROM "ActivityEvent"
                  WHERE "userId" = ${userId} AND "type" = 'doc_edited'`
      .catch(() => [{ n: 0n }]),
    prisma.activityEvent.count({ where: { userId, type: { in: [ACTIVITY_TYPES.DOC_SHARED, ACTIVITY_TYPES.DOC_SHARED_LINK] } } }),
    prisma.activityEvent.count({ where: { userId, type: ACTIVITY_TYPES.DOC_OPENED } }),
    prisma.activityEvent.count({ where: { userId, type: ACTIVITY_TYPES.DOC_RESTORED } }),
    prisma.activityEvent.count({ where: { userId, type: ACTIVITY_TYPES.VERSION_CREATED } }),
  ]);
  return {
    created,
    edited: Number(editedRows[0]?.n ?? 0),
    shared,
    opened,
    restored,
    versions,
  };
}
