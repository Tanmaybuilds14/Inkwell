import { test, expect } from '@playwright/test';

import {
  closeDatabase,
  createDocumentFixture,
  databaseReady,
  inboxCount,
} from './support/fixtures.mjs';

/**
 * Mentions, over real HTTP.
 *
 * What this suite covers, and what it deliberately does not:
 *
 * The mention *interaction* (typing "@", picking a person) needs a signed-in
 * browser session, and this suite has none by construction — Clerk's browser
 * SDK is blocked and the CI keys are placeholders. So the picker is pinned by
 * unit tests and the editor's own behaviour is left to a human or a signed-in
 * harness. What a session-less browser *can* prove is the part that matters
 * most: the server refuses to notify anyone on the word of an anonymous caller,
 * the refusal is indistinguishable from "no such document", and a refused
 * request writes nothing.
 *
 * The rendering half runs against a real stored document, because a mention is
 * only useful if it survives the trip out of Yjs: written by the editor,
 * snapshotted to Postgres, rendered by a completely different code path on the
 * public share page.
 *
 * Every spec here is a plain HTTP request, so this file never opens a browser.
 */

const NO_DB = 'needs a migrated database (set DATABASE_URL — see support/fixtures.mjs)';

let dbReady = false;

test.beforeAll(async () => {
  dbReady = await databaseReady();
});

test.afterAll(async () => {
  await closeDatabase();
});

test.describe('the anonymous caller’s contract', () => {
  test('a document that does not exist is 404, never 403 — the roster included', async ({ request }) => {
    const roster = await request.get('/api/documents/does-not-exist/mentions');
    expect(roster.status()).toBe(404);
    expect(await roster.json()).toEqual({ error: 'Document not found' });
  });

  test('notifying without a session is refused, and reveals nothing', async ({ request }) => {
    const response = await request.post('/api/documents/does-not-exist/mentions', {
      data: { userIds: ['whoever'] },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: 'Document not found' });
  });
});

test.describe('with a document that exists', () => {
  test('a guest holding an edit link still cannot mention anyone', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const fixture = await createDocumentFixture({
      title: 'Editable by link',
      shareRole: 'EDITOR', // the link grants writing...
      shareEnabled: true,
    });
    try {
      const response = await request.post(
        `/api/documents/${fixture.id}/mentions?share=${fixture.shareToken}`,
        { data: { userIds: [fixture.ownerId] } }
      );

      // ...but a mention is a notification, and an anonymous writer has no
      // identity to attribute it to and no inbox to be notified in.
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: 'Sign in to mention collaborators' });

      // The refusal is a refusal: nothing was written for anyone.
      expect(await inboxCount(fixture.ownerId)).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('reading the roster needs a session even when the link grants reading', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const fixture = await createDocumentFixture({ shareRole: 'VIEWER', shareEnabled: true });
    try {
      const response = await request.get(
        `/api/documents/${fixture.id}/mentions?share=${fixture.shareToken}`
      );
      expect(response.status()).toBe(401);
      // Collaborators are people, not a public directory.
      expect(await response.text()).not.toContain('E2E Owner');
    } finally {
      await fixture.cleanup();
    }
  });

  test('a mention written into the document renders on the public page', async ({ request }) => {
    test.skip(!dbReady, NO_DB);

    const fixture = await createDocumentFixture({
      title: 'Standup notes',
      blocks: [
        { type: 'paragraph', text: 'Ping' },
        { type: 'mention', id: 'user_ada', label: 'Ada Lovelace' },
      ],
    });
    try {
      const html = await (await request.get(`/share/${fixture.shareToken}`)).text();

      // The node survived the editor's schema, the Yjs snapshot, Postgres and
      // the server-side renderer — and kept its id, which is what a future
      // "mentioned you" deep link would need.
      expect(html).toContain('data-mention-id="user_ada"');
      expect(html).toContain('@Ada Lovelace');
      expect(html).toContain('inkwell-mention'); // styled, not raw text
    } finally {
      await fixture.cleanup();
    }
  });
});
