import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scope is the client's only influence over what retrieval may search. These
 * are regression tests for PLAN §8.3 rule 3: identity comes from the session,
 * a requested scope can only narrow, and the owner filter is always applied.
 */

const state = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { document: { findMany: state.findMany } },
}));

const { normalizeScope, ownedDocumentIds } = await import('@/lib/rag/owner-docs.js');

describe('normalizeScope', () => {
  it('defaults anything unrecognised to "all"', () => {
    expect(normalizeScope(undefined)).toEqual({ type: 'all' });
    expect(normalizeScope(null)).toEqual({ type: 'all' });
    expect(normalizeScope('document')).toEqual({ type: 'all' });
    expect(normalizeScope({ type: 'everything' })).toEqual({ type: 'all' });
  });

  it('rejects a document/folder scope with no id', () => {
    expect(normalizeScope({ type: 'document' })).toEqual({ type: 'all' });
    expect(normalizeScope({ type: 'document', documentId: '' })).toEqual({ type: 'all' });
    expect(normalizeScope({ type: 'folder', folderId: 42 })).toEqual({ type: 'all' });
  });

  it('drops non-string ids and caps the list', () => {
    const normalized = normalizeScope({ type: 'ids', ids: ['a', 42, null, '', 'b'] });
    expect(normalized).toEqual({ type: 'ids', ids: ['a', 'b'] });

    const many = normalizeScope({ type: 'ids', ids: Array.from({ length: 900 }, (_, i) => `id-${i}`) });
    expect(many.ids).toHaveLength(500);
  });
});

describe('ownedDocumentIds', () => {
  beforeEach(() => {
    state.findMany.mockReset();
    state.findMany.mockResolvedValue([{ id: 'doc-1' }]);
  });

  it('always filters by owner and excludes trashed documents', async () => {
    await ownedDocumentIds('user-a', { type: 'all' });

    const { where } = state.findMany.mock.calls[0][0];
    expect(where).toEqual({ ownerId: 'user-a', deletedAt: null });
  });

  it('narrows to a requested document without dropping the owner filter', async () => {
    await ownedDocumentIds('user-a', { type: 'document', documentId: 'someone-elses-doc' });

    const { where } = state.findMany.mock.calls[0][0];
    expect(where.ownerId).toBe('user-a');
    expect(where.id).toBe('someone-elses-doc');
  });

  it('narrows to a folder without dropping the owner filter', async () => {
    await ownedDocumentIds('user-a', { type: 'folder', folderId: 'folder-9' });

    const { where } = state.findMany.mock.calls[0][0];
    expect(where).toEqual({ ownerId: 'user-a', deletedAt: null, folderId: 'folder-9' });
  });

  it('short-circuits an empty id list instead of querying', async () => {
    const ids = await ownedDocumentIds('user-a', { type: 'ids', ids: [] });
    expect(ids).toEqual([]);
    expect(state.findMany).not.toHaveBeenCalled();
  });

  it('passes an explicit id list as a filtered `in` query', async () => {
    await ownedDocumentIds('user-a', { type: 'ids', ids: ['doc-1', 'doc-2'] });

    const { where } = state.findMany.mock.calls[0][0];
    expect(where).toEqual({ ownerId: 'user-a', deletedAt: null, id: { in: ['doc-1', 'doc-2'] } });
  });

  it('returns only the ids of rows the database confirmed', async () => {
    state.findMany.mockResolvedValue([{ id: 'mine-1' }, { id: 'mine-2' }]);
    await expect(ownedDocumentIds('user-a', { type: 'all' })).resolves.toEqual(['mine-1', 'mine-2']);
  });
});
