/**
 * Regression test for Issue 2: soft-deleted documents stay accessible via REST.
 *
 * Before the fix, resolveDocumentRole() never checked deletedAt — a trashed
 * document was fully readable/editable/shareable for the entire 30-day
 * retention window. After the fix, deletedAt blocks access unless the caller
 * explicitly passes allowTrashed: true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the module under test
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { resolveDocumentRole } from '../src/lib/permissions.js';

describe('Issue 2 — trashed document access control', () => {
  const docId = 'doc-1';
  const ownerId = 'user-owner';
  const editorId = 'user-editor';

  const baseDocFields = {
    id: docId,
    ownerId,
    deletedAt: null,
    shareEnabled: false,
    shareRole: 'VIEWER',
    shareToken: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows owner access to a non-trashed document', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: null,
      permissions: [],
    });

    const result = await resolveDocumentRole(docId, ownerId);
    expect(result.role).toBe('OWNER');
  });

  it('denies owner access to a trashed document when allowTrashed is false', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: new Date('2025-01-01'),
      permissions: [],
    });

    const result = await resolveDocumentRole(docId, ownerId, { allowTrashed: false });
    expect(result.role).toBeNull();
    // Document still returned so the API can show "not found" without leaking existence
    expect(result.document).toBeTruthy();
  });

  it('allows owner access to a trashed document when allowTrashed is true', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: new Date('2025-01-01'),
      permissions: [],
    });

    const result = await resolveDocumentRole(docId, ownerId, { allowTrashed: true });
    expect(result.role).toBe('OWNER');
  });

  it('denies editor access to a trashed document', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: new Date('2025-01-01'),
      permissions: [{ role: 'EDITOR' }],
    });

    const result = await resolveDocumentRole(docId, editorId, { allowTrashed: false });
    expect(result.role).toBeNull();
  });

  it('denies share-token access to a trashed document', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: new Date('2025-01-01'),
      shareEnabled: true,
      shareRole: 'VIEWER',
      shareToken: 'valid-token',
      permissions: [],
    });

    const result = await resolveDocumentRole(docId, null, {
      shareToken: 'valid-token',
      allowTrashed: false,
    });
    expect(result.role).toBeNull();
  });

  it('allows share-token access to a trashed document when allowTrashed is true', async () => {
    prisma.document.findUnique.mockResolvedValue({
      ...baseDocFields,
      deletedAt: new Date('2025-01-01'),
      shareEnabled: true,
      shareRole: 'VIEWER',
      shareToken: 'valid-token',
      permissions: [],
    });

    const result = await resolveDocumentRole(docId, null, {
      shareToken: 'valid-token',
      allowTrashed: true,
    });
    expect(result.role).toBe('VIEWER');
  });
});
