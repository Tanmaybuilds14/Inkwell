/**
 * Regression test for Issue 4: cycle detection when re-parenting folders.
 *
 * Before the fix, PATCH only rejected body.parentId === id (immediate
 * self-parenting). Moving folder A under its own descendant B was allowed,
 * creating a cycle (A → B → … → A).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    folder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

import { prisma } from '@/lib/prisma';
import { PATCH } from '../src/app/api/folders/[id]/route.js';

function makeRequest(body) {
  return new Request('http://localhost/api/folders/folder-a', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Issue 4 — folder cycle detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: requireOwnFolder succeeds for folder-a
    prisma.folder.findFirst.mockResolvedValue({ id: 'folder-a', name: 'A', parentId: null });
  });

  it('rejects direct cycle: move A under B when B is already under A', async () => {
    // folder-a has parentId=null, moving it under folder-b
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-a', name: 'A', parentId: null }); // requireOwnFolder
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-b', name: 'B', parentId: 'folder-a' }); // parent lookup

    // wouldCreateCycle walks: folder-b → folder-a (matches folderId!) → true
    prisma.folder.findUnique.mockResolvedValue({ parentId: 'folder-a' });

    const res = await PATCH(makeRequest({ parentId: 'folder-b' }), { params: Promise.resolve({ id: 'folder-a' }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('subfolder');
  });

  it('rejects 3-level cycle: A→B→C, try moving A under C', async () => {
    // folder-a has parentId=folder-b (A is under B)
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-a', name: 'A', parentId: 'folder-b' }); // requireOwnFolder
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-c', name: 'C', parentId: 'folder-b' }); // parent lookup

    // wouldCreateCycle walks: folder-c → folder-b → folder-a (matches!) → true
    prisma.folder.findUnique
      .mockResolvedValueOnce({ parentId: 'folder-b' })  // C's parent
      .mockResolvedValueOnce({ parentId: 'folder-a' }); // B's parent

    const res = await PATCH(makeRequest({ parentId: 'folder-c' }), { params: Promise.resolve({ id: 'folder-a' }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('subfolder');
  });

  it('allows valid re-parenting (non-cyclic)', async () => {
    // folder-a has no parent, moving under folder-d which is a root folder
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-a', name: 'A', parentId: null }); // requireOwnFolder
    prisma.folder.findFirst.mockResolvedValueOnce({ id: 'folder-d', name: 'D', parentId: null }); // parent lookup

    // wouldCreateCycle walks: folder-d → null (not a cycle)
    prisma.folder.findUnique.mockResolvedValue({ parentId: null });

    prisma.folder.update.mockResolvedValue({ id: 'folder-a', name: 'A', parentId: 'folder-d' });

    const res = await PATCH(makeRequest({ parentId: 'folder-d' }), { params: Promise.resolve({ id: 'folder-a' }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.folder.parentId).toBe('folder-d');
  });

  it('still rejects immediate self-parenting', async () => {
    const res = await PATCH(makeRequest({ parentId: 'folder-a' }), { params: Promise.resolve({ id: 'folder-a' }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('cannot contain itself');
  });
});
