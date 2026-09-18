/**
 * Fixed-window rate limiting, shared by both runtimes.
 *
 * The Redis client is injected rather than imported so this module stays
 * dependency-free (it runs in the Next server, the sync service, and — for
 * the pure counter — in tests). Both deployables need the same semantics:
 * a request that is denied must say how long to wait, because the callers
 * turn that into HTTP `Retry-After` / a WebSocket close code.
 *
 * Every limit here is defence-in-depth against abuse, never authorization.
 * A limiter that fails open (Redis unreachable, misconfigured) must therefore
 * still leave the caller's auth checks intact — see the callers' comments for
 * why they choose to fail open rather than closed.
 */

/** Bucket sizes, named by what they protect rather than where they run. */
export const RATE_LIMITS = {
  /**
   * Share-token attempts, keyed per document.
   *
   * Tokens are 24 random bytes (192 bits), so guessing is not made feasible or
   * infeasible by this number — the bucket exists to bound database work (every
   * attempt is a failed lookup) and to make automated scraping visible.
   *
   * It is deliberately loose, because the key is the DOCUMENT and a deployment
   * behind a proxy cannot name the client (see clientIp): every guest of one
   * document shares this budget. A guest's session costs one or two requests,
   * so this leaves room for a busy shared link while still ending a sweep
   * within seconds.
   */
  SHARE_LINK_DOC: { limit: 240, windowSeconds: 60 },
  /** Same attempts, keyed per client IP when the deployment can identify one. */
  SHARE_LINK_IP: { limit: 120, windowSeconds: 60 },
  /** Mutating API calls, keyed per signed-in user. */
  WRITE: { limit: 120, windowSeconds: 60 },
  /** Document creation, keyed per signed-in user (resource abuse). */
  DOC_CREATE: { limit: 30, windowSeconds: 3600 },
  /** WebSocket handshakes, keyed per client IP. Reconnects are rare. */
  WS_HANDSHAKE: { limit: 30, windowSeconds: 60 },
};

export const RATE_LIMIT_PREFIX = 'inkwell:rl:';

export const rateLimitKey = (bucket, id) => `${RATE_LIMIT_PREFIX}${bucket}:${id}`;

/** The decisions a limiter can return, normalised across both implementations. */
const decision = ({ allowed, count, limit, retryAfterSeconds }) => ({
  allowed,
  count,
  limit,
  remaining: Math.max(0, limit - count),
  retryAfterSeconds: allowed ? 0 : Math.max(1, Math.round(retryAfterSeconds)),
});

/**
 * Increment the counter for `key` and report whether the caller is over its
 * limit. Fixed window: the counter resets `windowSeconds` after the first
 * request in the window.
 *
 * Uses a single MULTI: INCR without an accompanying TTL would leave a key that
 * never expires if the process died between the two commands, which would lock
 * a user out permanently.
 *
 * Throws on transport failure — deliberately. The caller decides whether that
 * means "allow" or "deny"; swallowing it here would hide a Redis outage from
 * whoever needs to know about it.
 */
export async function fixedWindow(redis, key, { limit, windowSeconds }) {
  const results = await redis.multi().set(key, '0', 'EX', windowSeconds, 'NX').incr(key).exec();
  // ioredis resolves MULTI as [[err, value], ...] instead of rejecting.
  const incrError = results?.[1]?.[0];
  if (incrError) throw incrError instanceof Error ? incrError : new Error(String(incrError));
  const count = results?.[1]?.[1];
  if (typeof count !== 'number') throw new Error('rate limiter: INCR did not return a number');

  if (count <= limit) return decision({ allowed: true, count, limit, retryAfterSeconds: 0 });

  // Only on the deny path: report the real remaining TTL so the caller's
  // Retry-After is accurate rather than a full window.
  let retryAfterSeconds = windowSeconds;
  try {
    const ttl = await redis.ttl(key);
    if (typeof ttl === 'number' && ttl > 0) retryAfterSeconds = ttl;
  } catch {
    // Fall back to the full window — an over-estimate is safe.
  }
  return decision({ allowed: false, count, limit, retryAfterSeconds });
}

/** Entries kept in the in-process fallback before the oldest are evicted. */
const MEMORY_MAX_KEYS = 10_000;

/**
 * In-process fixed-window counter for deployments with no Redis (local dev,
 * single-instance demos) and for unit tests.
 *
 * SCOPE: per process only. With N server instances the effective limit is N×
 * the configured one, which is acceptable for an abuse guard and unacceptable
 * for anything security-critical — authorization is enforced separately.
 */
export function createMemoryCounter() {
  const buckets = new Map();

  function evict(now) {
    for (const [key, entry] of buckets) {
      if (entry.expiresAt <= now) buckets.delete(key);
      else break; // Map iterates in insertion order: the rest are newer.
    }
    // Every key is still live: drop the oldest rather than grow without bound.
    if (buckets.size >= MEMORY_MAX_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }

  return {
    consume(key, { limit, windowSeconds }) {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const entry = buckets.get(key);

      if (!entry || entry.expiresAt <= now) {
        if (buckets.size >= MEMORY_MAX_KEYS) evict(now);
        buckets.set(key, { count: 1, expiresAt: now + windowMs });
        return decision({ allowed: true, count: 1, limit, retryAfterSeconds: 0 });
      }

      entry.count += 1;
      return decision({
        allowed: entry.count <= limit,
        count: entry.count,
        limit,
        retryAfterSeconds: (entry.expiresAt - now) / 1000,
      });
    },
    /** Test hook — drops all state. */
    reset() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    },
  };
}
