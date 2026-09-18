import Redis from 'ioredis';
import {
  RATE_LIMITS,
  fixedWindow,
  createMemoryCounter,
  rateLimitKey,
} from '../../shared/rate-limit.js';
import { warnRateLimited } from './log.js';

/**
 * Per-IP throttle for the WebSocket handshake.
 *
 * The handshake is the most expensive thing an unauthenticated caller can make
 * this service do (a Clerk verification plus at least one database query), and
 * the cheapest to flood, so it gets its own budget. Authorization is unaffected
 * — a throttled caller is only told to wait, and those under the limit still
 * pass through the normal auth checks.
 *
 * Needs its own Redis connection: the clients in broadcast.js are in
 * subscriber mode, and a subscribed ioredis client (RESP2) rejects ordinary
 * commands, so INCR there would fail rather than count.
 */
let client = null;

function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    client.on('error', (err) =>
      warnRateLimited('rate-limit-redis', '[rate-limit] redis error:', err.message)
    );
  }
  return client;
}

const memory = createMemoryCounter();

/**
 * True when the caller may proceed. Fails open (with a rate-limited warning)
 * if the counter cannot be reached: this is an abuse guard, not a gate on
 * access, and a Redis blip must not lock every collaborator out of every
 * document. The in-process fallback still bounds a single instance.
 */
export async function handshakeAllowed(ip) {
  const key = rateLimitKey('ws-handshake', ip);
  const redis = getClient();
  if (!redis) return memory.consume(key, RATE_LIMITS.WS_HANDSHAKE).allowed;
  try {
    return (await fixedWindow(redis, key, RATE_LIMITS.WS_HANDSHAKE)).allowed;
  } catch (err) {
    warnRateLimited(
      'ws-handshake-limit',
      '[rate-limit] counter unavailable, falling back to in-process:',
      err.message
    );
    return memory.consume(key, RATE_LIMITS.WS_HANDSHAKE).allowed;
  }
}
