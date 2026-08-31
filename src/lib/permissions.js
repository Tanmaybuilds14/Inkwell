import { prisma } from '@/lib/prisma';

export const ROLES = {
  OWNER: 'OWNER',
  EDITOR: 'EDITOR',
  COMMENTER: 'COMMENTER',
  VIEWER: 'VIEWER',
};

const ROLE_RANK = {
  OWNER: 4,
  EDITOR: 3,
  COMMENTER: 2,
  VIEWER: 1,
};

/**
 * Role hierarchy check. OWNER > EDITOR > COMMENTER > VIEWER.
 * A role satisfies `required` when its rank is >= the required rank.
 */
export function hasRole(actualRole, requiredRole) {
  if (!actualRole || !requiredRole) return false;
  const actual = ROLE_RANK[actualRole];
  const required = ROLE_RANK[requiredRole];
  if (!actual || !required) return false;
  return actual >= required;
}

/** Roles that may modify document content. */
export function canEdit(role) {
  return hasRole(role, 'EDITOR');
}

/** Roles that may read document content/metadata. */
export function canView(role) {
  return hasRole(role, 'VIEWER');
}

/** Only owners manage sharing, deletion and permissions. */
export function canManage(role) {
  return role === 'OWNER';
}

/** Commenter+ roles may add comments (v2 surface, enforced server-side already). */
export function canComment(role) {
  return hasRole(role, 'COMMENTER');
}

/**
 * Resolve a user's effective role for a document.
 *
 * Fail-closed: any uncertainty denies access. Order of precedence:
 *   1. OWNER row in permissions table (or document.ownerId)
 *   2. explicit permission row for this user
 *   3. active share link grants its role to anyone holding the token
 *   4. no access
 */
export async function resolveDocumentRole(documentId, userId, { shareToken = null } = {}) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      ownerId: true,
      deletedAt: true,
      shareEnabled: true,
      shareRole: true,
      permissions: {
        where: userId ? { userId } : { id: '__none__' },
        select: { role: true },
        take: 1,
      },
    },
  });
  if (!doc) return { role: null, document: null };

  if (userId && doc.ownerId === userId) return { role: 'OWNER', document: doc };
  if (userId && doc.permissions.length > 0) {
    return { role: doc.permissions[0].role, document: doc };
  }
  if (
    shareToken &&
    doc.shareEnabled &&
    doc.shareToken === shareToken
  ) {
    return { role: doc.shareRole, document: doc };
  }
  return { role: null, document: doc };
}
