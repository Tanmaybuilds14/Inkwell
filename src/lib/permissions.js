import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';

/**
 * Timing-safe string comparison to prevent timing attacks on bearer tokens
 * (share tokens). Falls back to false on length mismatch without throwing.
 * Cross-reference: sync-service/src/auth.js has the equivalent function.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

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

  if (userId && doc.ownerId === userId) return { role: 'OWNER', document: doc };
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
