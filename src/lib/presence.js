/**
 * Presence identity — what a remote caret pill, the avatar stack and the
 * `Editors` rail call you.
 *
 * The label a peer renders comes from the awareness state *that peer* received:
 * y-tiptap falls back to `User: <clientId>` when the broadcast `user` object
 * carries no `name`, so a name is not cosmetic — without one every collaborator
 * is a number.
 *
 * Sourcing the name from Clerk's client-side profile is what caused that: an
 * email/password sign-up has no `fullName` and no `username` (Clerk usernames
 * are opt-in), and Clerk's client hydrates *after* the sync socket connects.
 * The Inkwell display name — set at onboarding, editable on /profile, shown by
 * the header avatar and the activity log — is the identity the rest of the app
 * uses, so it is what presence reaches for first.
 */

/** Eight-colour presence palette; the header stack and caret pills share it. */
export const PRESENCE_COLORS = [
  "#0ea5e9", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#ef4444", "#6366f1", "#14b8a6",
];

/**
 * Stable colour for a seed (user id, falling back to the document id for
 * share-link guests). Same seed, same colour, for the life of the account.
 */
export function colorFor(seed) {
  const source = typeof seed === "string" ? seed : "";
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

/**
 * Never the whole address: peers get the handle a caret pill can show, not a
 * mailbox. This is the last resort before an identity is called "Anonymous".
 */
function emailHandle(email) {
  if (typeof email !== "string") return null;
  const handle = email.split("@")[0]?.trim();
  return handle || null;
}

/**
 * Resolve the name broadcast to collaborators. Returns null only while nothing
 * is known yet — the caller then sends a colour-only state, and re-broadcasts
 * as soon as a name resolves.
 *
 * Order: Inkwell display name → Clerk name → guest → email handle.
 */
export function resolvePresenceName({ profileName, clerkUser, isSignedIn, isLoaded = true } = {}) {
  const inkwellName = typeof profileName === "string" ? profileName.trim() : "";
  if (inkwellName) return inkwellName;

  const clerkName =
    clerkUser?.fullName?.trim() ||
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser?.username?.trim();
  if (clerkName) return clerkName;

  // Signed out with Clerk's verdict in: this is a share-link guest. Before the
  // client reports in, `isSignedIn` is undefined — stay nameless for that
  // moment rather than calling a signed-in user "Guest".
  if (isLoaded && isSignedIn === false) return "Guest";

  return (
    emailHandle(
      clerkUser?.primaryEmailAddress?.emailAddress ??
        clerkUser?.emailAddresses?.[0]?.emailAddress
    ) ?? null
  );
}

/**
 * The `user` field written into awareness. Kept as one object so the writer and
 * the caret extension agree on its shape: `name` is present whenever we know
 * one, and its absence is the only reason a peer would render `User: <id>`.
 */
export function buildPresenceUser({ name, color }) {
  return name ? { name, color } : { color };
}
