import { prisma } from '@/lib/prisma';

/**
 * The only way a RAG route learns which documents it may search (PLAN §8.3).
 *
 * Identity always comes from the session (`getCurrentUser`), and a client's
 * requested scope can only NARROW that set: unknown or foreign ids are dropped
 * by the `ownerId` filter, and an empty intersection means "no sources" rather
 * than "everything".
 */

const MAX_SCOPED_DOCUMENTS = 5000;

/** Normalise a client-supplied scope object into a known shape. */
export function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object') return { type: 'all' };
  const type = scope.type;

  if (type === 'document' && typeof scope.documentId === 'string' && scope.documentId) {
    return { type: 'document', documentId: scope.documentId };
  }
  if (type === 'folder' && typeof scope.folderId === 'string' && scope.folderId) {
    return { type: 'folder', folderId: scope.folderId };
  }
  if (type === 'ids' && Array.isArray(scope.ids)) {
    return { type: 'ids', ids: scope.ids.filter((id) => typeof id === 'string' && id).slice(0, 500) };
  }
  return { type: 'all' };
}

/** Owned, non-trashed document ids for `userId`, narrowed by `scope`. */
export async function ownedDocumentIds(userId, scope) {
  const normalized = normalizeScope(scope);
  const where = { ownerId: userId, deletedAt: null };

  if (normalized.type === 'document') where.id = normalized.documentId;
  else if (normalized.type === 'folder') where.folderId = normalized.folderId;
  else if (normalized.type === 'ids') {
    if (normalized.ids.length === 0) return [];
    where.id = { in: normalized.ids };
  }

  const rows = await prisma.document.findMany({
    where,
    select: { id: true },
    take: MAX_SCOPED_DOCUMENTS,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((row) => row.id);
}
