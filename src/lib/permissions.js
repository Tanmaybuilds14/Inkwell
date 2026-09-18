import { prisma } from '@/lib/prisma';
import { ROLES } from '../../shared/roles.js';
import { timingSafeEqual } from '../../shared/timing-safe.js';

// The role hierarchy and the token comparison are shared verbatim with the
// sync service's WebSocket handshake so the two can never disagree about who
// may edit. Re-exported here because this is the module the API layer and the
// tests have always imported them from.
export {
  ROLES,
  ROLE_RANK,
  hasRole,
  canEdit,
  canView,
  canManage,
  canComment,
} from '../../shared/roles.js';
export { timingSafeEqual } from '../../shared/timing-safe.js';

/**
 * Resolve a user's effective role for a document.
 *
 * Fail-closed: any uncertainty denies access. Order of precedence:
 *   1. OWNER row in permissions table (or document.ownerId)
 *   2. explicit permission row for this user
 *   3. active share link grants its role to anyone holding the token
 *   4. no access
 */
export async function resolveDocumentRole(documentId, userId, { shareToken = null, allowTrashed = false } = {}) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      ownerId: true,
      deletedAt: true,
      shareEnabled: true,
      shareRole: true,
      shareToken: true,
      permissions: {
        where: userId ? { userId } : { id: '__none__' },
        select: { role: true },
        take: 1,
      },
    },
  });
  if (!doc) return { role: null, document: null };

  // Fail-closed: a trashed document is inaccessible unless the caller
  // explicitly opts in (e.g. the restore endpoint).
  if (doc.deletedAt && !allowTrashed) {
    return { role: null, document: doc };
  }

  if (userId && doc.ownerId === userId) return { role: ROLES.OWNER, document: doc };
  if (userId && doc.permissions.length > 0) {
    return { role: doc.permissions[0].role, document: doc };
  }
  if (
    shareToken &&
    doc.shareEnabled &&
    timingSafeEqual(doc.shareToken, shareToken)
  ) {
    return { role: doc.shareRole, document: doc };
  }
  return { role: null, document: doc };
}
