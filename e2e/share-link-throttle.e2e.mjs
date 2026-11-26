import { test, expect } from '@playwright/test';

import { RATE_LIMITS } from '../shared/rate-limit.js';

/**
 * The share-link throttle, exercised over real HTTP.
 *
 * A share token is a bearer credential, so unlimited attempts are unlimited
 * guesses. The unit test proves the counter works; this proves the route
 * actually consults it, returns a 429 with a usable Retry-After, and buckets
 * per document — the last one matters because a per-IP bucket alone would
 * either lock out whole offices or let one attacker rotate documents freely.
 *
 * Attempts are fired in concurrent batches rather than one at a time: that
 * keeps the suite fast whatever the configured limit is, and it is the shape a
 * real sweep takes. Each request still increments the counter exactly once, so
 * "the first N are served" stays deterministic.
 *
 * The limit is read from the shared config so this suite cannot pass against a
 * server configured with a different value.
 */
const { limit } = RATE_LIMITS.SHARE_LINK_DOC;
const BATCH = 25;

const uniqueId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Run `count` requests with at most BATCH in flight, returning their statuses. */
async function burst(request, url, count) {
  const statuses = [];
  for (let sent = 0; sent < count; sent += BATCH) {
    const size = Math.min(BATCH, count - sent);
    const batch = await Promise.all(
      Array.from({ length: size }, (_, i) => request.get(`${url}&n=${sent + i}`))
    );
    for (const response of batch) statuses.push(response.status());
  }
  return statuses;
}

test.describe('share-link throttle', () => {
  test.slow(); // deliberately spends a document's whole budget

  test('stops accepting token guesses once a document is out of budget', async ({ request }) => {
    const documentId = uniqueId('e2e-throttle');

    const served = await burst(request, `/api/documents/${documentId}?share=guess`, limit);
    expect(served).toHaveLength(limit);
    expect(served.filter((status) => status === 429)).toEqual([]);

    const denied = await request.get(`/api/documents/${documentId}?share=over-limit`);
    expect(denied.status()).toBe(429);
    expect(Number(denied.headers()['retry-after'])).toBeGreaterThan(0);
    const body = await denied.json();
    expect(body.error).toMatch(/too many share-link attempts/i);
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('one exhausted document does not lock anyone out of another', async ({ request }) => {
    const stressed = uniqueId('e2e-stressed');
    await burst(request, `/api/documents/${stressed}?share=x`, limit + 1);
    expect((await request.get(`/api/documents/${stressed}?share=x`)).status()).toBe(429);

    const fresh = uniqueId('e2e-fresh');
    expect((await request.get(`/api/documents/${fresh}?share=x`)).status()).not.toBe(429);
  });
});
