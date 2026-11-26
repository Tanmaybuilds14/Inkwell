/**
 * Permission roles and hierarchy, shared verbatim by the Next.js API layer and
 * the sync service's WebSocket handshake (which must agree: a user allowed to
 * PATCH a document must also be allowed to open its live session).
 *
 * These values must match `enum Role` in prisma/schema.prisma exactly —
 * tests/schema-drift.test.js parses the schema and fails if they diverge.
 */

export const ROLES = {
  OWNER: 'OWNER',
  EDITOR: 'EDITOR',
  COMMENTER: 'COMMENTER',
  VIEWER: 'VIEWER',
};

/** Higher rank satisfies every lower requirement. */
export const ROLE_RANK = {
  OWNER: 4,
  EDITOR: 3,
  COMMENTER: 2,
  VIEWER: 1,
};

/**
 * Role hierarchy check. A role satisfies `required` when its rank is >= the
 * required rank. Unknown roles fail closed (false).
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
  return hasRole(role, ROLES.EDITOR);
}

/** Roles that may read document content/metadata. */
export function canView(role) {
  return hasRole(role, ROLES.VIEWER);
}

/** Only owners manage sharing, deletion and permissions. */
export function canManage(role) {
  return role === ROLES.OWNER;
}

/** Commenter+ roles may add comments (v2 surface, enforced server-side already). */
export function canComment(role) {
  return hasRole(role, ROLES.COMMENTER);
}
