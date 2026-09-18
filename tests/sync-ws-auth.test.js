/**
 * Regression tests for the sync-service WebSocket handshake auth.
 *
 * Before the fix, a signed-in user who held a valid share link but had no
 * explicit permission row was rejected on EVERY WebSocket connection — the
 * editor page loaded (REST accepts ?share=…) and then the live session
 * immediately died with a terminal 4403 close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { doc: null, dbUser: null, roleFromDb: null };

// The sync service has its own @clerk/backend dependency, so this repo can
// hold two physical copies of the package. vitest.config.mjs pins the
// specifier to a single copy, which is what makes this bare-specifier mock
// actually intercept the import inside auth.js. Mocking the nested
// node_modules path instead silently misses and the real verifyToken runs —
// it then rejects the fake 'jwt' below and every signed-in case fails with
// 4001. (Verified: that was the exact cause of this suite failing.)
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => ({ sub: 'clerk_1' })),
}));
vi.mock('../sync-service/src/db.js', () => ({
  getDocumentForAuth: vi.fn(async () => state.doc),
  getUserByClerkId: vi.fn(async () => state.dbUser),
  getUserRoleForDocument: vi.fn(async () => state.roleFromDb),
}));

import { authenticateHandshake } from '../sync-service/src/auth.js';

const TOKEN = 'share-token-1';
const doc = (overrides = {}) => ({
  ownerId: 'owner1',
  deletedAt: null,
  shareEnabled: true,
  shareRole: 'EDITOR',
  shareToken: TOKEN,
  ...overrides,
});
const dbUser = { id: 'u1', email: 'a@example.dev', name: 'A', imageUrl: null };

describe('sync service WS auth — share-link flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.roleFromDb = null;
    state.dbUser = null;
  });

  it('guest with a valid share token gets the link role', async () => {
    state.doc = doc();
    const res = await authenticateHandshake({ docId: 'd1', token: null, shareToken: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.role).toBe('EDITOR');
    expect(res.identity.guest).toBe(true);
  });

  it('signed-in user without a permission row but with the share token gets the link role', async () => {
    state.doc = doc();
    state.dbUser = dbUser;
    const res = await authenticateHandshake({ docId: 'd1', token: 'jwt', shareToken: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.role).toBe('EDITOR');
    expect(res.identity.guest).toBe(false);
  });

  it('signed-in user with an explicit row keeps the row role even with the token', async () => {
    state.doc = doc();
    state.dbUser = dbUser;
    state.roleFromDb = 'COMMENTER';
    const res = await authenticateHandshake({ docId: 'd1', token: 'jwt', shareToken: TOKEN });
    expect(res.ok).toBe(true);
    expect(res.role).toBe('COMMENTER');
  });

  it('signed-in user without a row or valid token is denied', async () => {
    state.doc = doc();
    state.dbUser = dbUser;
    const res = await authenticateHandshake({ docId: 'd1', token: 'jwt', shareToken: 'wrong-token' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(4003);
  });
});
