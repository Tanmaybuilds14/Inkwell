import { test, expect } from '@playwright/test';
import { blockExternalAuth } from './support/hermetic.mjs';

test.beforeEach(async ({ page }) => {
  await blockExternalAuth(page);
});

/**
 * The parts of the app an anonymous visitor sees. These are cheap smoke tests,
 * but they are also the only tests that would catch a broken root layout,
 * a font/theme regression, or a Clerk provider misconfiguration — none of
 * which any unit test loads.
 */
test.describe('public pages', () => {
  test('landing page renders the pitch', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Inkwell/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      /write together, in real time/i
    );
  });

  test('landing page offers a way into the app', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /^sign in$/i }).first()).toBeVisible();
  });

  test('an unknown route is a real 404, not the app shell', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
  });
});
