/**
 * Rate limiter tests.
 *
 * Two properties matter beyond "it counts": the Redis path must always leave a
 * TTL on the key it creates (a counter with no expiry locks a caller out
 * forever), and a denial must carry a usable retry hint, because both callers
 * surface it to the client (HTTP Retry-After / a retryable close code).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  RATE_LIMITS,
  fixedWindow,
  createMemoryCounter,
  rateLimitKey,
} from '../shared/rate-limit.js';

/** Minimal ioredis stand-in supporting only what the limiter uses. */
function fakeRedis() {
  const store = new Map();
  const commands = [];
  let ttlReads = 0;

  const tx = {
    ops: [],
    set(key, value, ...args) {
      tx.ops.push({ op: 'set', key, value, args });
      return tx;
    },
    incr(key) {
      tx.ops.push({ op: 'incr', key });
      return tx;
    },
    async exec() {
      return tx.ops.map((op) => {
        commands.push(op);
        if (op.op === 'set') {
          if (op.args.includes('NX') && store.has(op.key)) return [null, null];
          const exAt = op.args.indexOf('EX');
          const seconds = exAt >= 0 ? Number(op.args[exAt + 1]) : null;
          store.set(op.key, {
            count: Number(op.value),
            expiresAt: seconds === null ? Infinity : Date.now() + seconds * 1000,
          });
          return [null, 'OK'];
        }
        const entry = store.get(op.key) ?? { count: 0, expiresAt: Infinity };
        entry.count += 1;
        store.set(op.key, entry);
        return [null, entry.count];
      });
    },
  };

  return {
    commands,
    get ttlReads() {
      return ttlReads;
    },
    ttl(key) {
      ttlReads += 1;
      const entry = store.get(key);
      return Promise.resolve(entry ? Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)) : -2);
    },
    multi() {
      tx.ops = [];
      return tx;
    },
  };
}

const spec = { limit: 3, windowSeconds: 60 };

describe('shared/rate-limit — Redis fixed window', () => {
  it('allows exactly `limit` requests, then denies', async () => {
    const redis = fakeRedis();
    const key = rateLimitKey('test', 'a');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await fixedWindow(redis, key, spec));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[2].remaining).toBe(0);
  });

  it('always writes a TTL with the counter (a key without one never expires)', async () => {
    const redis = fakeRedis();
    await fixedWindow(redis, rateLimitKey('test', 'b'), spec);
    const set = redis.commands.find((c) => c.op === 'set');
    expect(set.args).toContain('NX');
    expect(set.args).toContain('EX');
    expect(set.args[set.args.indexOf('EX') + 1]).toBe(60);
  });

  it('reports the real remaining TTL on denial, and does not ask for one when allowed', async () => {
    const redis = fakeRedis();
    const key = rateLimitKey('test', 'c');
    await fixedWindow(redis, key, spec);
    expect(redis.ttlReads).toBe(0); // happy path costs one round trip only

    let denied;
    for (let i = 0; i < 3; i++) denied = await fixedWindow(redis, key, spec);
    expect(denied.allowed).toBe(false);
    expect(redis.ttlReads).toBe(1);
    expect(denied.retryAfterSeconds).toBe(60);
  });

  it('counts each key independently', async () => {
    const redis = fakeRedis();
    await fixedWindow(redis, rateLimitKey('test', 'x'), spec);
    const other = await fixedWindow(redis, rateLimitKey('test', 'y'), spec);
    expect(other.count).toBe(1);
  });

  it('surfaces transport failures instead of pretending the request was counted', async () => {
    const tx = {
      set: () => tx,
      incr: () => tx,
      // ioredis resolves MULTI with per-command errors instead of rejecting.
      exec: async () => [[null, null], [new Error('redis down'), null]],
    };
    const broken = { multi: () => tx };
    await expect(fixedWindow(broken, 'k', spec)).rejects.toThrow('redis down');
  });
});

describe('shared/rate-limit — in-process fallback', () => {
  it('denies past the limit and names a retry delay', () => {
    const counter = createMemoryCounter();
    const window = { limit: 2, windowSeconds: 60 };
    expect(counter.consume('k', window).allowed).toBe(true);
    expect(counter.consume('k', window).allowed).toBe(true);
    const denied = counter.consume('k', window);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets once the window has elapsed', async () => {
    const counter = createMemoryCounter();
    const window = { limit: 1, windowSeconds: 0.05 };
    expect(counter.consume('k', window).allowed).toBe(true);
    expect(counter.consume('k', window).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(counter.consume('k', window).allowed).toBe(true);
  });

  it('keeps keys independent and stays bounded', () => {
    const counter = createMemoryCounter();
    for (let i = 0; i < 500; i++) counter.consume(`key-${i}`, { limit: 5, windowSeconds: 60 });
    expect(counter.size).toBe(500);
    counter.reset();
    expect(counter.size).toBe(0);
  });
});

// --- callers -----------------------------------------------------------------

const state = { redis: null };

vi.mock('@/lib/redis', () => ({
  getPublisher: () => state.redis,
}));

const { clientIp, throttleShareLinkAttempt, throttleWrite } = await import('../src/lib/rate-limit.js');
const { handshakeAllowed } = await import('../sync-service/src/rate-limit.js');

const fakeRequest = (headers = {}) => ({
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

describe('Next.js API throttle', () => {
  beforeEach(() => {
    state.redis = null; // exercise the in-process path
    delete process.env.TRUST_PROXY;
  });

  it('429s a share-token brute force with a Retry-After header', async () => {
    const id = `doc-${Math.random()}`;
    let response = null;
    for (let i = 0; i < RATE_LIMITS.SHARE_LINK_DOC.limit + 1; i++) {
      response = await throttleShareLinkAttempt(fakeRequest(), id);
    }
    expect(response).not.toBeNull();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await response.json();
    expect(body.error).toMatch(/too many/i);
  });

  it('leaves a normal share-link visit untouched', async () => {
    expect(await throttleShareLinkAttempt(fakeRequest(), `doc-${Math.random()}`)).toBeNull();
  });

  it('throttles per user, not globally', async () => {
    const spec = { limit: 1, windowSeconds: 60 };
    expect(await throttleWrite(`user-${Math.random()}`, spec)).toBeNull();
    const again = await throttleWrite(`user-deny-${Math.random()}`, spec);
    expect(again).toBeNull();
    // Same user twice → denied.
    const userId = `user-dup-${Math.random()}`;
    await throttleWrite(userId, spec);
    expect((await throttleWrite(userId, spec)).status).toBe(429);
  });

  it('does not trust x-forwarded-for unless a proxy is declared', () => {
    expect(clientIp(fakeRequest({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull();
    process.env.TRUST_PROXY = '1';
    expect(clientIp(fakeRequest({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(fakeRequest({ 'x-real-ip': '203.0.113.10' }))).toBe('203.0.113.10');
    expect(clientIp(fakeRequest())).toBeNull();
    delete process.env.TRUST_PROXY;
  });
});

describe('sync service handshake throttle', () => {
  it('throttles one IP without touching another', async () => {
    delete process.env.REDIS_URL; // in-process path
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}-${Math.random()}`;
    const { limit } = RATE_LIMITS.WS_HANDSHAKE;
    for (let i = 0; i < limit; i++) {
      expect(await handshakeAllowed(ip)).toBe(true);
    }
    expect(await handshakeAllowed(ip)).toBe(false);
    expect(await handshakeAllowed(`${ip}-other`)).toBe(true);
  });
});
