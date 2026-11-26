import { test, expect } from '@playwright/test';

import { blockExternalAuth } from './support/hermetic.mjs';
import {
  closeDatabase,
  createDocumentFixture,
  databaseReady,
} from './support/fixtures.mjs';

/**
 * The public share page, over real HTTP.
 *
 * This is the surface where the response *is* the feature: a link recipient who
 * cannot run JavaScript — a crawler, a chat unfurler, `curl` — has to receive
 * the document, and an unusable link has to be a real 404 rather than a 200
 * with an error page inside it. Unit tests can pin the access rules and the
 * renderer; only this suite can show that the status line, the metadata and the
 * body agree with each other.
 *
 * The database-dependent specs skip when no migrated database is configured
 * (see support/fixtures.mjs) so the suite still runs on a laptop without
 * Postgres. The token-shape spec below needs no database at all, because a
 * malformed token is refused before any query.
 */

const NO_DB = 'needs a migrated database (set DATABASE_URL — see support/fixtures.mjs)';

const BLOCKS = [
  { type: 'heading', level: 1, text: 'Quarterly plan' },
  { type: 'paragraph', text: 'Ship the collaborative editor.' },
  { type: 'taskList', items: ['write the spec', 'ship it'] },
  { type: 'codeBlock', text: 'const ship = true;', language: 'javascript' },
];

let dbReady = false;
let shared = null;

// No file-level `page` fixture on purpose: almost every spec here is a plain
// HTTP request, and declaring `page` in beforeEach would launch a browser for
// all of them. The one browser test blocks Clerk itself.

test.beforeAll(async () => {
  dbReady = await databaseReady();
  if (!dbReady) return;
  shared = await createDocumentFixture({ title: 'Quarterly plan', blocks: BLOCKS });
});

test.afterAll(async () => {
  await shared?.cleanup();
  await closeDatabase();
});

test.describe('a token that cannot be a token', () => {
  test('is a real 404, and the 404 page is not the shared-document shell', async ({ request }) => {
    // Both are refused by shape alone: too short, and containing characters the
    // share route never generates. That guard exists to keep junk out of the
    // database, so these requests must not depend on one existing.
    for (const token of ['short', 'not-a-token!']) {
      const response = await request.get(`/share/${encodeURIComponent(token)}`);
      expect(response.status()).toBe(404);

      const html = await response.text();
      expect(html).toContain('This page has no ink');
      expect(html).not.toContain('Open in Inkwell');
    }
  });
});

test.describe('a link that works', () => {
  test('serves the document body in the HTML, with no JavaScript involved', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const response = await request.get(`/share/${shared.shareToken}`);
    expect(response.status()).toBe(200);

    const html = await response.text();
    // The reason this page exists rather than just reusing the ?share= editor
    // link: the editor's server response is a loading shell.
    expect(html).toContain('Ship the collaborative editor.');
    expect(html).toContain('write the spec'); // task list item
    expect(html).toContain('const ship = true;'); // code block
    expect(html).toContain('Shared by E2E Owner');
  });

  test('is kept out of search indexes', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    // Content is readable by any fetcher (that is the point), but the token is
    // a bearer credential, so the page must not become findable by search.
    const html = await (await request.get(`/share/${shared.shareToken}`)).text();
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });

  test('renders as a readable page with no editor mounted', async ({ page }) => {
    test.skip(!dbReady, NO_DB);
    await blockExternalAuth(page);

    await page.goto(`/share/${shared.shareToken}`);

    await expect(page).toHaveTitle(/Quarterly plan/);
    await expect(page.getByRole('heading', { level: 1, name: 'Quarterly plan' })).toBeVisible();
    await expect(page.getByText('Ship the collaborative editor.')).toBeVisible();

    // Read-only: there is no editing surface on this page at all.
    await expect(page.locator('[contenteditable]')).toHaveCount(0);

    // ...and the way into collaboration is one click, carrying the same token.
    await expect(page.getByRole('link', { name: /open in inkwell/i })).toHaveAttribute(
      'href',
      `/documents/${shared.id}?share=${shared.shareToken}`
    );
  });

  test('reports the document as empty rather than broken', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const empty = await createDocumentFixture({ title: 'Nothing yet', blocks: [] });
    try {
      const html = await (await request.get(`/share/${empty.shareToken}`)).text();
      expect(html).toContain('This document is empty.');
    } finally {
      await empty.cleanup();
    }
  });
});

test.describe('a link that no longer works', () => {
  test('an unknown token is 404, not a broken page', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    // Correctly shaped, so it reaches the database and simply resolves to
    // nothing — the same answer a revoked link gives.
    const response = await request.get('/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('This page has no ink');
  });

  test('revoking the link 404s the URL the token still contains', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const fixture = await createDocumentFixture({
      title: 'Revoked',
      blocks: [{ type: 'paragraph', text: 'Secret plans' }],
      shareEnabled: false, // link turned off, token left in place
    });
    try {
      const response = await request.get(`/share/${fixture.shareToken}`);
      expect(response.status()).toBe(404);
      // And the body must not leak the content it used to serve.
      expect(await response.text()).not.toContain('Secret plans');
    } finally {
      await fixture.cleanup();
    }
  });

  test('a trashed document is gone even though its link is still enabled', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const fixture = await createDocumentFixture({
      title: 'Trashed',
      blocks: [{ type: 'paragraph', text: 'Deleted content' }],
      deletedAt: new Date(),
    });
    try {
      const response = await request.get(`/share/${fixture.shareToken}`);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain('Deleted content');
    } finally {
      await fixture.cleanup();
    }
  });
});
