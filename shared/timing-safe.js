import crypto from 'node:crypto';

/**
 * Timing-safe string comparison, used to check share tokens without leaking
 * their contents through response timing. Both runtimes verify the same tokens
 * (the REST layer and the WebSocket handshake), so the implementation lives
 * here rather than being duplicated — a subtly weaker comparison on one side
 * would silently undermine the other.
 *
 * Returns false (never throws) on a length mismatch or non-string input: the
 * length check itself is a fast path, but token length is fixed by generation
 * (24 random bytes, base64url) so it reveals nothing an attacker cannot
 * already see in their own guess.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}
