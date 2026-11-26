/**
 * Guard rails for the load-test switches (shared/perf-test.js).
 *
 * The switches exist so a load generator can drive the *real* product. Two
 * properties have to stay true, and this file is what keeps them honest:
 *
 *   1. With no env var set, every limit and the handshake throttle behave
 *      exactly as in production (so the switches can never silently weaken a
 *      deployment);
 *   2. With PERF_TEST=1, the handshake throttle is bypassed and the shared
 *      limits are multiplied — otherwise the harnesses measure the limiter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ROLES } from '../shared/roles.js';

const KEYS = ['PERF_TEST', 'PERF_TEST_STUB_CLERK', 'PERF_TEST_RATE_MULTIPLIER', 'REDIS_URL'];

/** Fresh module registry with exactly `env` applied (Redis forced off). */
async function load(env = {}) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return {
    flags: await import('../shared/perf-test.js'),
    limits: await import('../shared/rate-limit.js'),
  };
}

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.resetModules();
  vi.doUnmock('../sync-service/src/db.js');
});

describe('perf-test switches — off by default', () => {
  it('leaves every production limit untouched', async () => {
    const { flags, limits } = await load();

    expect(flags.PERF_TEST).toBe(false);
    expect(flags.PERF_TEST_STUB_CLERK).toBe(false);
    expect(flags.RATE_LIMIT_MULTIPLIER).toBe(1);

    // The exact production numbers, not just "something small".
    expect(limits.RATE_LIMITS.WS_HANDSHAKE).toEqual({ limit: 30, windowSeconds: 60 });
    expect(limits.RATE_LIMITS.SHARE_LINK_DOC).toEqual({ limit: 240, windowSeconds: 60 });
    expect(limits.RATE_LIMITS.WRITE).toEqual({ limit: 120, windowSeconds: 60 });
    expect(limits.RATE_LIMITS.DOC_CREATE).toEqual({ limit: 30, windowSeconds: 3600 });
  });

  it('scaledLimit is the identity when disabled', async () => {
    const { flags, limits } = await load();
    const spec = limits.RATE_LIMITS.WS_HANDSHAKE;
    expect(flags.scaledLimit(spec)).toBe(spec);
  });

  it('ignores the Clerk stub unless PERF_TEST is on too', async () => {
    const { flags } = await load({ PERF_TEST_STUB_CLERK: '1' });
    expect(flags.PERF_TEST_STUB_CLERK).toBe(false);
  });
});

describe('perf-test switches — enabled', () => {
  it('scales every bucket by the default multiplier, keeping windows', async () => {
    const { limits } = await load({ PERF_TEST: '1' });

    expect(limits.RATE_LIMITS.WS_HANDSHAKE.limit).toBe(300_000);
    expect(limits.RATE_LIMITS.WS_HANDSHAKE.windowSeconds).toBe(60);
    expect(limits.RATE_LIMITS.DOC_CREATE.limit).toBe(300_000);
    expect(limits.RATE_LIMITS.DOC_CREATE.windowSeconds).toBe(3600);
  });

  it('honours PERF_TEST_RATE_MULTIPLIER', async () => {
    const { limits } = await load({ PERF_TEST: '1', PERF_TEST_RATE_MULTIPLIER: '4' });
    expect(limits.RATE_LIMITS.WS_HANDSHAKE.limit).toBe(120);
  });

  it('falls back to 1x for a nonsense multiplier', async () => {
    const { limits } = await load({ PERF_TEST: '1', PERF_TEST_RATE_MULTIPLIER: 'nonsense' });
    expect(limits.RATE_LIMITS.WS_HANDSHAKE.limit).toBe(30);
  });

  it('bypasses the WS handshake throttle entirely', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.PERF_TEST = '1';
    vi.resetModules();
    const { handshakeAllowed } = await import('../sync-service/src/rate-limit.js');

    // 200 connects from ONE address in one window: 30 would be the production
    // ceiling, so this fails loudly if the bypass regresses.
    for (let i = 0; i < 200; i++) {
      await expect(handshakeAllowed('203.0.113.9')).resolves.toBe(true);
    }
  });

  it('disables the web API limiter without touching the code path', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.PERF_TEST = '1';
    vi.resetModules();
    vi.doMock('@/lib/redis', () => ({ getPublisher: () => null }));
    const { consume } = await import('../src/lib/rate-limit.js');
    const spec = { limit: 1, windowSeconds: 60 };

    // A 1-per-minute bucket, consumed repeatedly: all allowed under PERF_TEST.
    for (let i = 0; i < 5; i++) {
      const result = await consume('write', 'perf-user', spec);
      expect(result.allowed).toBe(true);
    }
  });
});

describe('perf-test switches — production throttle still works', () => {
  it('permits exactly 30 handshakes then denies the 31st for one IP', async () => {
    for (const k of KEYS) delete process.env[k];
    vi.resetModules();
    const { handshakeAllowed } = await import('../sync-service/src/rate-limit.js');

    let allowed = 0;
    for (let i = 0; i < 35; i++) {
      if (await handshakeAllowed('198.51.100.7')) allowed += 1;
    }
    expect(allowed).toBe(30);
  });
});

describe('perf-test switches — auth stub', () => {
  const doc = {
    id: 'doc-1',
    deletedAt: null,
    ownerId: 'user-1',
    shareEnabled: false,
    shareRole: 'VIEWER',
    shareToken: null,
  };

  it('treats any token as the document owner, deterministically', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.PERF_TEST = '1';
    process.env.PERF_TEST_STUB_CLERK = '1';
    vi.resetModules();
    vi.doMock('../sync-service/src/db.js', () => ({
      getDocumentForAuth: vi.fn().mockResolvedValue(doc),
      getUserByClerkId: vi.fn(),
      getUserRoleForDocument: vi.fn(),
    }));

    const { authenticateHandshake } = await import('../sync-service/src/auth.js');
    const first = await authenticateHandshake({ docId: 'doc-1', token: 'load-generator-7' });
    const second = await authenticateHandshake({ docId: 'doc-1', token: 'load-generator-7' });

    expect(first.ok).toBe(true);
    expect(first.role).toBe(ROLES.OWNER);
    expect(first.identity.guest).toBe(false);
    expect(first.identity.userId).toMatch(/^perf_/);
    expect(second.identity.userId).toBe(first.identity.userId);
  });

  it('still rejects unknown documents before any token check', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.PERF_TEST = '1';
    process.env.PERF_TEST_STUB_CLERK = '1';
    vi.resetModules();
    vi.doMock('../sync-service/src/db.js', () => ({
      getDocumentForAuth: vi.fn().mockResolvedValue(null),
      getUserByClerkId: vi.fn(),
      getUserRoleForDocument: vi.fn(),
    }));

    const { authenticateHandshake } = await import('../sync-service/src/auth.js');
    const verdict = await authenticateHandshake({ docId: 'missing', token: 'anything' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(4004);
  });

  it('does not stub Clerk when PERF_TEST is off', async () => {
    for (const k of KEYS) delete process.env[k];
    vi.resetModules();
    vi.doMock('../sync-service/src/db.js', () => ({
      getDocumentForAuth: vi.fn().mockResolvedValue(doc),
      getUserByClerkId: vi.fn(),
      getUserRoleForDocument: vi.fn(),
    }));

    const { authenticateHandshake } = await import('../sync-service/src/auth.js');
    const verdict = await authenticateHandshake({ docId: 'doc-1', token: 'not-a-real-jwt' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(4001);
  });
});
