/**
 * Tests for the public share page's data layer (/share/[token]).
 *
 * The contract worth pinning is the refusals: an unknown token, a revoked
 * link, and a trashed document must all be indistinguishable from each other
 * (null → a real 404), and a malformed token must not reach the database at
 * all. The mock honours the `where` clause for exactly that reason — a mock
 * that ignored it would pass with the filters deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { doc: null, queries: [] };

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findFirst: vi.fn(async (args) => {
        state.queries.push(args);
        const doc = state.doc;
        if (!doc) return null;
        const where = args?.where ?? {};
        for (const [key, expected] of Object.entries(where)) {
          if (expected === undefined) continue;
          if (expected === null && doc[key] !== null) return null;
          if (expected !== null && doc[key] !== expected) return null;
        }
        if (!args?.select || !args.select.snapshot) {
          const { snapshot, ...rest } = doc;
          return rest;
        }
        return doc;
      }),
    },
  },
}));

import { prisma } from '../src/lib/prisma';
import {
  getSharedDocument,
  isShareTokenShape,
  ownerDisplayName,
  sharePageUrl,
} from '../src/lib/share-page';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

function doc(overrides = {}) {
  return {
    id: 'doc1',
    title: 'Quarterly plan',
    shareToken: TOKEN,
    shareEnabled: true,
    deletedAt: null,
    shareRole: 'VIEWER',
    updatedAt: new Date('2026-03-01T10:00:00Z'),
    snapshot: Buffer.from([1, 2, 3]),
    owner: { name: 'Ada Lovelace', email: 'ada@example.dev' },
    ...overrides,
  };
}

beforeEach(() => {
  state.doc = doc();
  state.queries = [];
  vi.clearAllMocks();
});

describe('isShareTokenShape', () => {
  it('accepts the tokens the share route mints', () => {
    expect(isShareTokenShape(TOKEN)).toBe(true);
    expect(isShareTokenShape('a-b_c-d_e-f0123456789')).toBe(true);
  });

  it('rejects junk that would otherwise cost a database round trip', () => {
    expect(isShareTokenShape('short')).toBe(false);
    expect(isShareTokenShape('../../etc/passwd')).toBe(false);
    expect(isShareTokenShape('has spaces in it 123456')).toBe(false);
    expect(isShareTokenShape('')).toBe(false);
    expect(isShareTokenShape(null)).toBe(false);
  });
});

describe('getSharedDocument', () => {
  it('returns the document a valid link points at', async () => {
    const found = await getSharedDocument(TOKEN, { withContent: true });
    expect(found.id).toBe('doc1');
    expect(found.snapshot).toEqual(Buffer.from([1, 2, 3]));
  });

  it('leaves the snapshot in the database unless it is asked for', async () => {
    const found = await getSharedDocument(TOKEN);
    expect(found.snapshot).toBeUndefined();
  });

  it('returns null for an unknown token', async () => {
    state.doc = null;
    expect(await getSharedDocument(TOKEN)).toBeNull();
  });

  it('returns null for an unknown token without touching the database', async () => {
    await getSharedDocument('nope');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
  });

  it('returns null once the link is revoked, even with the right token', async () => {
    state.doc = doc({ shareEnabled: false });
    expect(await getSharedDocument(TOKEN)).toBeNull();
  });

  it('returns null for a trashed document (a deleted doc is gone, link or not)', async () => {
    state.doc = doc({ deletedAt: new Date() });
    expect(await getSharedDocument(TOKEN)).toBeNull();
  });

  it('refuses a token that is merely a prefix or a case variant', async () => {
    expect(await getSharedDocument(TOKEN.slice(0, 30))).toBeNull();
    expect(await getSharedDocument(TOKEN.toUpperCase())).toBeNull();
  });
});

describe('sharePageUrl', () => {
  it('builds the public URL, tolerating a trailing slash on the app URL', () => {
    expect(sharePageUrl(TOKEN, 'https://inkwell.test')).toBe(`https://inkwell.test/share/${TOKEN}`);
    expect(sharePageUrl(TOKEN, 'https://inkwell.test/')).toBe(`https://inkwell.test/share/${TOKEN}`);
  });

  it('is null when there is no token to share', () => {
    expect(sharePageUrl(null, 'https://inkwell.test')).toBeNull();
  });
});

describe('ownerDisplayName', () => {
  it('prefers the display name', () => {
    expect(ownerDisplayName({ name: 'Ada Lovelace', email: 'ada@example.dev' })).toBe('Ada Lovelace');
  });

  it('uses the email local part rather than publishing an address', () => {
    expect(ownerDisplayName({ name: null, email: 'ada@example.dev' })).toBe('ada');
  });

  it('is null when there is nobody to name', () => {
    expect(ownerDisplayName(null)).toBeNull();
    expect(ownerDisplayName({})).toBeNull();
  });
});
