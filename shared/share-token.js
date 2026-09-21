/**
 * Share-token shape, in one place.
 *
 * Lives outside src/ for the same reason protocol.js and roles.js do: the app,
 * the proxy and the tests must agree, and the proxy must be able to import this
 * without dragging the database layer into its bundle. Nothing here touches
 * Prisma, `pg`, or anything else with a runtime assumption.
 */

/**
 * Share tokens are 24 random bytes as base64url (see the share route), i.e. 32
 * characters of [A-Za-z0-9_-].
 *
 * This is a *filter*, never authorization: it keeps junk out of the database
 * and out of the rendering path, while the token lookup itself remains the
 * thing that decides who may read what.
 */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isShareTokenShape(token) {
  return typeof token === 'string' && SHARE_TOKEN_PATTERN.test(token);
}

/**
 * The token in a `/share/<token>` path, or null when the path is anything else.
 *
 * The segment is matched as it appears in the URL rather than decoded: every
 * character a real token can contain is URL-safe and never percent-encoded, so
 * a segment containing "%" (or a slash, or an empty value) is by definition not
 * a token and needs no decoding to reject.
 */
export function shareTokenFromPath(pathname) {
  const match = /^\/share\/([^/]+)\/?$/.exec(pathname ?? '');
  return match ? match[1] : null;
}
