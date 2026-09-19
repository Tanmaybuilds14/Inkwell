import { ROLES } from '../../shared/roles.js';

/**
 * Collaborator list for the share dialog.
 *
 * `pending` means "invited by email but has no account yet". The share route
 * pre-provisions a User row with a `pending_<uuid>` clerkId so the permission
 * exists before the invitee's first sign-in; ensureUser() swaps that id for
 * the real Clerk id when they eventually sign in (accepting an invite
 * requires signing in, so an accepted invite is never pending).
 *
 * Why this lives here instead of inline in the route: the predicate reads
 * `user.clerkId`, and the route's `select` is the only thing that decides
 * whether that field exists. When the two drifted, `clerkId` was never
 * fetched, `!undefined` was true, and EVERY collaborator — including people
 * who had already accepted — rendered as "pending" with no way to clear it.
 * Pairing the select with the predicate makes that class of bug impossible.
 */
export const PENDING_CLERK_PREFIX = 'pending_';

/**
 * True while the row is still the pre-provisioned placeholder.
 *
 * A missing clerkId counts as pending: the badge is a "not verified yet"
 * claim, so the safe direction is to keep showing it rather than to assert
 * someone has a real account when we cannot tell. COLLABORATOR_SELECT always
 * fetches the field, so this fallback should be unreachable.
 */
export function isPendingUser(user) {
  const clerkId = user?.clerkId;
  return typeof clerkId !== 'string' || !clerkId || clerkId.startsWith(PENDING_CLERK_PREFIX);
}

/** The owner is never pending and never re-roleable in the dialog. */
function toOwnerEntry(owner) {
  return {
    permissionId: null,
    userId: owner.id,
    name: owner.name ?? owner.email,
    email: owner.email,
    role: ROLES.OWNER,
    pending: false,
  };
}

function toCollaboratorEntry(permission) {
  return {
    permissionId: permission.id,
    userId: permission.user.id,
    name: permission.user.name ?? permission.user.email,
    email: permission.user.email,
    role: permission.role,
    pending: isPendingUser(permission.user),
  };
}

/**
 * Owner first, then everyone holding a Permission row.
 *
 * Both callers (the route and its tests) must use COLLABORATOR_SELECT for
 * this to have the fields it reads.
 */
export function buildCollaborators({ owner, permissions = [] }) {
  return [toOwnerEntry(owner), ...permissions.map(toCollaboratorEntry)];
}

/**
 * Prisma select for `document.permissions` feeding buildCollaborators.
 * `clerkId` is load-bearing — see the note at the top of this file.
 */
export const COLLABORATOR_SELECT = {
  id: true,
  role: true,
  invitedEmail: true,
  user: { select: { id: true, name: true, email: true, clerkId: true } },
};
