/**
 * What the editor should show when it cannot open a document.
 *
 * This is a three-way decision that is easy to get subtly wrong and, until now,
 * lived inline in a client component where only a signed-in browser could
 * exercise it. Extracting it makes the security-relevant parts assertable:
 *
 *  - The API is fail-closed and answers 404 for BOTH "no such document" and
 *    "not shared with you", so a 404 must never be surfaced as an access error
 *    (that would leak which documents exist) and must not be reported as an
 *    application fault.
 *  - Signed-out visitors on an invite link get 404 too; they need a sign-in
 *    prompt, not a 404 page, or the invite flow dead-ends.
 *  - A network failure has no status at all and must NOT be mistaken for a 404.
 */

export const OPEN_FAILURE = {
  /** Offer sign-in: the caller may simply not be authenticated yet. */
  SIGN_IN: 'sign-in',
  /** The document is gone or not shared with this user: render the 404 page. */
  NOT_FOUND: 'not-found',
  /** A genuine fault: render the error page and report it. */
  ERROR: 'error',
};

/**
 * @param {{ isSignedIn: boolean, status?: number|null }} input
 *   `status` is the HTTP status from the API, or undefined for a transport
 *   failure (fetch rejects before a response exists).
 */
export function classifyOpenFailure({ isSignedIn, status }) {
  // Auth state first: an invite link must not dead-end, whatever the API said.
  if (!isSignedIn) return OPEN_FAILURE.SIGN_IN;
  if (status === 404) return OPEN_FAILURE.NOT_FOUND;
  // Everything else — 403, 500, and errors with no status at all — is a real
  // failure. Fail towards the error page: a fault must never masquerade as a
  // 404, which would tell the user their document is gone when it is not.
  return OPEN_FAILURE.ERROR;
}
