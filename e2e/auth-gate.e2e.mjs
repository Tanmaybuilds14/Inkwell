import { test, expect } from '@playwright/test';
import { blockExternalAuth } from './support/hermetic.mjs';

test.beforeEach(async ({ page }) => {
  await blockExternalAuth(page);
});

/**
 * What an anonymous caller actually receives.
 *
 * The API is fail-closed by design: no session means 401 for endpoints that
 * need an identity, and 404 — never 403 — for document-scoped routes, so the
 * response cannot be used to probe which documents exist. Those two rules are
 * easy to state and easy to break, and no unit test sees the real HTTP stack.
 */
test.describe('auth gate', () => {
  test('listing documents requires a session', async ({ request }) => {
    const response = await request.get('/api/documents');
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in required' });
  });

  test('creating a document requires a session', async ({ request }) => {
    const response = await request.post('/api/documents', { data: {} });
    expect(response.status()).toBe(401);
  });

  test('document routes answer 404, never 403, to a stranger', async ({ request }) => {
    const read = await request.get('/api/documents/does-not-exist');
    expect(read.status()).toBe(404);

    const patched = await request.patch('/api/documents/does-not-exist', { data: { title: 'x' } });
    expect(patched.status()).toBe(404);

    const removed = await request.delete('/api/documents/does-not-exist');
    expect(removed.status()).toBe(404);
  });

  test('a share-token guess cannot distinguish "no document" from "no access"', async ({ request }) => {
    const response = await request.get('/api/documents/does-not-exist?share=guessing');
    // Same answer as without the token: an attacker learns nothing about
    // whether the id exists.
    expect(response.status()).toBe(404);
  });

  test('the editor page offers sign-in instead of a dead end', async ({ page }) => {
    await page.goto('/documents/does-not-exist');
    await expect(page.getByText("Can't open this document")).toBeVisible();
    await expect(page.getByText('Sign in to open this document.')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in to continue/i })).toBeVisible();
  });
});
