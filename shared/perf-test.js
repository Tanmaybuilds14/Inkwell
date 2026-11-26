/**
 * Load/perf-test switches, shared by BOTH runtimes (Next.js app and sync
 * service) so their behaviour cannot drift during a test run.
 *
 * Design rules:
 *  - Every switch is OFF unless PERF_TEST=1 is set. Production behaviour is
 *    byte-for-byte identical when the flag is absent — the codebase's default
 *    posture stays fail-closed.
 *  - These switches RELAX ABUSE GUARDS ONLY (rate limits, handshake auth
 *    cost). They never touch authorization: role checks, edit gating and
 *    permission rows behave exactly as in production. A performance test must
 *    not silently test a different product.
 *  - Never set these in a deployment that is reachable from the internet.
 */

/** Master switch: true only when PERF_TEST=1. */
export const PERF_TEST = process.env.PERF_TEST === '1';

/**
 * Skip Clerk JWT verification on the WebSocket handshake. Each verification
 * is a network round-trip to Clerk's API plus a DB lookup; the load generator
 * cannot do Clerk's OAuth dance, so PERF_TEST_STUB_CLERK=1 lets it connect
 * with any non-empty `token` (or no token at all) and be treated as the
 * document OWNER of an auto-provisioned test user.
 *
 * Requires PERF_TEST=1 — silently ignored otherwise.
 */
export const PERF_TEST_STUB_CLERK = PERF_TEST && process.env.PERF_TEST_STUB_CLERK === '1';

/**
 * Multiplier applied to every entry in RATE_LIMITS at module load. With
 * PERF_TEST=1 the defaults (30 handshakes / 60s per IP, etc.) would throttle
 * the load generator within seconds. Default when enabled: 10,000x, which
 * for practical purposes disables the limiter while keeping the code path
 * (and its test coverage) intact. Override with PERF_TEST_RATE_MULTIPLIER.
 */
export const RATE_LIMIT_MULTIPLIER = PERF_TEST
  ? Math.max(1, Number(process.env.PERF_TEST_RATE_MULTIPLIER ?? 10_000) || 1)
  : 1;

/**
 * Scale a limit spec by the perf-test multiplier. Used at every RATE_LIMITS
 * read site so a changed multiplier takes effect without touching callers.
 */
export function scaledLimit(spec) {
  if (RATE_LIMIT_MULTIPLIER === 1) return spec;
  return { limit: spec.limit * RATE_LIMIT_MULTIPLIER, windowSeconds: spec.windowSeconds };
}
