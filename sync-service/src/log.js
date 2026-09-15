/**
 * Rate-limited console warning helper.
 *
 * When Redis is down, ioredis emits an error per command attempt — which
 * during a reconnect storm means hundreds of identical lines per minute.
 * This caps each key to one line per minute while never dropping the
 * first (most actionable) occurrence.
 */
const lastWarnAt = new Map();
const WARN_INTERVAL_MS = 60_000;

export function warnRateLimited(key, ...args) {
  const now = Date.now();
  if (now - (lastWarnAt.get(key) ?? 0) < WARN_INTERVAL_MS) return;
  lastWarnAt.set(key, now);
  console.error(...args);
}
