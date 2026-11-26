import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportError } from '@/lib/import/errors';

/**
 * Route-level contract for POST /api/documents/import.
 *
 * Conversion is covered in import.test.js; this file mocks it so the test
 * focuses on the parts that can only be wrong at the HTTP boundary: auth,
 * throttling, folder ownership, batch validation, and per-file failure
 * reporting.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  throttleWrite: vi.fn(),
  folderFindFirst: vi.fn(),
  documentCreate: vi.fn(),
  buildImportedDocument: vi.fn(),
  logActivity: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/rate-limit', () => ({
  throttleWrite: mocks.throttleWrite,
  RATE_LIMITS: { DOC_IMPORT: { limit: 60, windowSeconds: 3600 } },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    folder: { findFirst: mocks.folderFindFirst },
    document: { create: mocks.documentCreate },
  },
}));
vi.mock('@/lib/telemetry', () => ({
  track: mocks.track,
  EVENTS: { DOC_CREATED: 'doc_created' },
}));
vi.mock('@/lib/activity', () => ({
  logActivity: mocks.logActivity,
  ACTIVITY_TYPES: { DOC_CREATED: 'doc_created' },
}));
vi.mock('@/lib/import/document.js', () => ({
  buildImportedDocument: mocks.buildImportedDocument,
}));

const { POST } = await import('@/app/api/documents/import/route');

function request(files = [], { folderId } = {}) {
  const form = new FormData();
  if (folderId) form.append('folderId', folderId);
  for (const file of files) {
    form.append('files', new File([file.content ?? 'hello'], file.name, { type: file.type }));
  }
  return new Request('http://localhost/api/documents/import', {
    method: 'POST',
    body: form,
  });
}

const converted = (title) => ({
  title,
  format: 'text',
  snapshot: Buffer.from('snapshot'),
  stateVector: Buffer.from('state-vector'),
  charCount: 5,
  warnings: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' });
  mocks.throttleWrite.mockResolvedValue(null);
  mocks.folderFindFirst.mockResolvedValue({ id: 'folder-1' });
  mocks.documentCreate.mockImplementation(async ({ data }) => ({
    id: `doc-${data.title}`,
    title: data.title,
  }));
});

describe('POST /api/documents/import', () => {
  it('requires a signed-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(request([{ name: 'a.txt' }]));
    expect(response.status).toBe(401);
    expect(mocks.documentCreate).not.toHaveBeenCalled();
  });

  it('returns the throttle response without doing any work', async () => {
    mocks.throttleWrite.mockResolvedValue(
      Response.json({ error: 'Too many requests' }, { status: 429 })
    );
    const response = await POST(request([{ name: 'a.txt' }]));
    expect(response.status).toBe(429);
    expect(mocks.buildImportedDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const response = await POST(request([]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least one file/i);
  });

  it('caps the batch size', async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt` }));
    const response = await POST(request(files));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at most 10/i);
  });

  it('refuses a folder owned by someone else', async () => {
    mocks.folderFindFirst.mockResolvedValue(null);
    const response = await POST(request([{ name: 'a.txt' }], { folderId: 'other-folder' }));
    expect(response.status).toBe(404);
    expect(mocks.documentCreate).not.toHaveBeenCalled();
  });

  it('imports the good files and reports the bad ones individually', async () => {
    mocks.buildImportedDocument.mockImplementation(async ({ filename }) => {
      if (filename === 'bad.pdf') throw new ImportError('This PDF is password-protected.', 422);
      return converted(filename.replace(/\.[^.]+$/, ''));
    });

    const response = await POST(
      request(
        [
          { name: 'notes.txt', content: 'hello' },
          { name: 'bad.pdf', content: '%PDF-1.7' },
        ],
        { folderId: 'folder-1' }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imported).toEqual([
      { id: 'doc-notes', title: 'notes', format: 'text', charCount: 5 },
    ]);
    expect(body.failed).toEqual([
      { name: 'bad.pdf', error: 'This PDF is password-protected.' },
    ]);

    expect(mocks.documentCreate).toHaveBeenCalledTimes(1);
    const createArgs = mocks.documentCreate.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      title: 'notes',
      ownerId: 'user-1',
      folderId: 'folder-1',
      originalFolderId: 'folder-1',
    });
    expect(Buffer.isBuffer(createArgs.data.snapshot)).toBe(true);
    expect(Buffer.isBuffer(createArgs.data.stateVector)).toBe(true);
  });

  it('returns 200 with an empty imported list when every file fails', async () => {
    mocks.buildImportedDocument.mockRejectedValue(new ImportError('Unreadable.', 422));
    const response = await POST(request([{ name: 'a.txt' }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: [],
      failed: [{ name: 'a.txt', error: 'Unreadable.' }],
    });
  });
});
