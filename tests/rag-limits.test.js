import { describe, expect, it, vi } from 'vitest';

/**
 * PLAN §8.2: the RAG limits must NOT honour PERF_TEST=1. The rest of the app
 * scales its buckets 10,000× under that switch so a load generator can run;
 * chat limits protect provider quota and would be meaningless if they did the
 * same. These tests set the switch and expect the real limit.
 */

process.env.PERF_TEST = '1';

const state = vi.hoisted(() => ({ redis: null }));
vi.mock('@/lib/redis', () => ({ getPublisher: () => state.redis }));

const { consumeChatBudget, spentTokensToday, addSpentTokens } = await import('@/lib/rag/limits.js');

const uniqueUser = () => `user-${Math.random().toString(36).slice(2)}`;

describe('consumeChatBudget', () => {
  it('enforces the configured limit even with PERF_TEST=1', async () => {
    const userId = uniqueUser();
    const spec = { limit: 2, windowSeconds: 60 };

    expect((await consumeChatBudget(userId, spec)).allowed).toBe(true);
    expect((await consumeChatBudget(userId, spec)).allowed).toBe(true);
    const denied = await consumeChatBudget(userId, spec);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each user separately', async () => {
    const spec = { limit: 1, windowSeconds: 60 };
    const first = uniqueUser();
    expect((await consumeChatBudget(first, spec)).allowed).toBe(true);
    expect((await consumeChatBudget(first, spec)).allowed).toBe(false);

    const second = uniqueUser();
    expect((await consumeChatBudget(second, spec)).allowed).toBe(true);
  });
});

describe('token budget', () => {
  it('reports no usage when Redis is unavailable, without throwing', async () => {
    expect(await spentTokensToday('user-x')).toBeNull();
    await expect(addSpentTokens('user-x', 100)).resolves.toBeUndefined();
  });

  it('ignores nonsense usage values', async () => {
    await expect(addSpentTokens('user-x', NaN)).resolves.toBeUndefined();
    await expect(addSpentTokens('user-x', -5)).resolves.toBeUndefined();
  });
});
