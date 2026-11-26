/**
 * Regression tests for the broken invite/share-link flow.
 *
 * Symptoms reported: opening an invite link showed "Can't open this document".
 * Root causes covered here:
 *  - shareToken used to be regenerated on every share-dialog toggle/role
 *    change, instantly invalidating every link already copied or emailed;
 *  - a guest holding a VALID link must be able to open the document via
 *    REST (?share=…) without any session;
 *  - a signed-in user without a permission row must still get the link's
 *    role (the REST layer already did this — pinned by these tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { doc: null, user: null };

vi.mock('@/lib/prisma', () => ({
  prisma: { document: { findUnique: vi.fn(async () => state.doc) } },
}));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => state.user),
}));
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn(),
  ACTIVITY_TYPES: { DOC_OPENED: 'doc_opened' },
}));

import { GET as getDocument } from '../src/app/api/documents/[id]/route.js';

const TOKEN = 'tok_abc123';

function doc(overrides = {}) {
  return {
    id: 'doc1',
    title: 'Shared doc',
    ownerId: 'owner1',
    folderId: null,
    deletedAt: null,
    shareEnabled: true,
    shareRole: 'EDITOR',
    shareToken: TOKEN,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    owner: { name: 'Owner', email: 'owner@example.dev' },
    permissions: [],
    ...overrides,
  };
}

function req(share) {
  const url = new URL('http://localhost:3000/api/documents/doc1');
  if (share) url.searchParams.set('share', share);
  return new Request(url);
}

const ctx = { params: Promise.resolve({ id: 'doc1' }) };

describe('invite link access (GET /api/documents/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
  });

  it('guest with a valid share link opens the document', async () => {
    state.doc = doc();
    const res = await getDocument(req(TOKEN), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.role).toBe('EDITOR');
  });

  it('guest without the share token gets 404 (fail-closed, not 500)', async () => {
    state.doc = doc();
    const res = await getDocument(req(null), ctx);
    expect(res.status).toBe(404);
  });

  it('stale token from a rotated link gets 404', async () => {
    state.doc = doc({ shareToken: 'new-token-after-rotation' });
    const res = await getDocument(req('old-leaked-token'), ctx);
    expect(res.status).toBe(404);
  });

  it('disabled share link gets 404 even with a valid token', async () => {
    state.doc = doc({ shareEnabled: false });
    const res = await getDocument(req(TOKEN), ctx);
    expect(res.status).toBe(404);
  });

  it('signed-in user without a permission row inherits the link role', async () => {
    state.doc = doc();
    state.user = { id: 'invitee1', name: 'Invitee' };
    const res = await getDocument(req(TOKEN), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.role).toBe('EDITOR');
  });

  it('explicit permission row outranks the share-link role', async () => {
    state.doc = doc({ permissions: [{ role: 'VIEWER' }] });
    state.user = { id: 'invitee1', name: 'Invitee' };
    const res = await getDocument(req(TOKEN), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.role).toBe('VIEWER');
  });
});
