import { getPublisher } from '@/lib/redis';
import { fixedWindow, createMemoryCounter } from '../../../shared/rate-limit.js';

/**
 * Chat rate limits and the daily token budget.
 *
 * Deliberately separate from `src/lib/rate-limit.js`: that module honours
 * PERF_TEST=1 by multiplying every bucket by ~10,000×, and PLAN §8.2 requires
 * the RAG limiter to ignore that switch. These limits protect provider quota,
 * so a load test must not be able to spend it.
 */

const memory = createMemoryCounter();

export function ragRateLimited(result, message = 'Too many questions — try again in a moment.') {
  return {
    error: message,
    retryAfterSeconds: result.retryAfterSeconds,
  };
}

/** Count one question against `userId`'s per-minute budget. */
export async function consumeChatBudget(userId, { limit, windowSeconds = 60 }) {
  const key = `rag:chat-rate:${userId}`;
  const spec = { limit, windowSeconds };
  const client = getPublisher();
  if (!client) return memory.consume(key, spec);
  try {
    return await fixedWindow(client, key, spec);
  } catch {
    return memory.consume(key, spec);
  }
}

function budgetKey(userId) {
  // Day-scoped: the budget resets at UTC midnight and old keys expire, so no
  // cleanup job is needed.
  const day = new Date().toISOString().slice(0, 10);
  return `rag:${userId}:tokens:${day}`;
}

/** Tokens already spent today by `userId`, or null when Redis is unavailable. */
export async function spentTokensToday(userId) {
  const client = getPublisher();
  if (!client) return null;
  try {
    const value = await client.get(budgetKey(userId));
    return Number.parseInt(value ?? '0', 10) || 0;
  } catch {
    return null;
  }
}

/** Record token usage. Failure is non-fatal: the limit is a guard, not auth. */
export async function addSpentTokens(userId, tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const client = getPublisher();
  if (!client) return;
  const key = budgetKey(userId);
  try {
    await client.multi().incrby(key, Math.round(tokens)).expire(key, 60 * 60 * 36).exec();
  } catch {
    // Ignored — see above.
  }
}
