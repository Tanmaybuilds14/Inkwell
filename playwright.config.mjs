import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite for the surfaces that can be exercised without a database
 * or a Clerk session: the public pages plus the API's fail-closed auth contract
 * and the share-link throttle. Those are exactly the paths a unit test can only
 * assert in isolation, because their real behaviour is "what a request from an
 * anonymous browser actually gets".
 *
 * Runs on its own port so it never fights a dev server someone already has open.
 * Use `E2E_SERVER_CMD` to point it at a built server (`npx next start`) — that
 * is what CI does, since `next dev` compiles per route on first hit.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
// `localhost`, not 127.0.0.1: `next dev` only serves its dev chunks (and so
// only hydrates) for origins it recognises, and a raw IP is treated as a
// cross-origin request — the page then renders server HTML that never becomes
// interactive, which looks exactly like an app bug.
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.mjs',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SERVER_CMD ?? `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Force the in-process rate limiter: the throttle assertions must count
    // this server's requests, not depend on a Redis instance being up.
    env: { REDIS_URL: '' },
  },
});
