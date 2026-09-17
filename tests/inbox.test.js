/**
 * Tests for the user inbox (collab invites + shared-link receipts):
 *  - lib/inbox: recordInvite, recordLinkShared, claimSharedLink, listInbox
 *  - GET /api/inbox + PATCH /api/inbox: auth + response contract
 *
 * Prisma is mocked with a minimal in-memory stand-in (same pattern as
 * activity-audit.test.js). Inbox writes are best-effort by design, so the
 * failure-swallowing paths are asserted too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaState = {
  items: [],
};

let idCounter = 0;

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    inboxItem: {
      create: vi.fn(async ({ data }) => {
        const row = {
          id: `inbox_${++idCounter}`,
          // Mirrors cuid lexicographic ordering for the id tie-break in
          // listInbox's orderBy when rows share a createdAt millisecond.
          seq: idCounter + 1,
          readAt: null,
          claimedAt: null,
          createdAt: new Date(),
          inviter: null,
          ...data,
        };
        prismaState.items.push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }) => {
        for (const d of data) {
          prismaState.items.push({
            id: `inbox_${++idCounter}`,
            seq: idCounter + 1,
            readAt: null,
            claimedAt: null,
            createdAt: new Date(),
            inviter: null,
            ...d,
          });
        }
        return { count: data.length };
      }),
      findFirst: vi.fn(async ({ where }) =>
        prismaState.items.find(
          (r) =>
            r.userId === where.userId &&
            r.documentId === where.documentId &&
            r.type === where.type
        ) ?? null
      ),
      update: vi.fn(async ({ where, data }) => {
        const row = prismaState.items.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
      findMany: vi.fn(async (args = {}) => {
        let rows = prismaState.items
          .filter((r) => (args.where?.userId ? r.userId === args.where.userId : true))
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              (b.seq ?? 0) - (a.seq ?? 0)
          );
        const take = args.take ?? rows.length;
        return rows.slice(0, take);
      }),
      count: vi.fn(async (args = {}) => {
        return prismaState.items.filter(
          (r) =>
            r.userId === args.where.userId &&
            (args.where.readAt === null ? r.readAt === null : true)
        ).length;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of prismaState.items) {
          if (row.userId !== where.userId) continue;
          if (where.readAt === null && row.readAt !== null) continue;
          if (where.id?.in && !where.id.in.includes(row.id)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const before = prismaState.items.length;
        prismaState.items = prismaState.items.filter(
          (r) => !(r.userId === where.userId && where.id.in.includes(r.id))
        );
        return { count: before - prismaState.items.length };
      }),
    },
    // Used by claimSharedLink / acceptInboxItem to save the document on the
    // receiver's side (Permission row). Default: no existing row, document
    // exists and is not owned by the caller.
    permission: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: `perm_${++idCounter}`, ...data })),
      findMany: vi.fn(async () => []),
    },
    document: {
      findFirst: vi.fn(async ({ where }) =>
        where?.ownerId?.not ? { id: where.id, ownerId: where.ownerId.not === 'u9' ? 'u1' : 'u9' } : { id: where?.id, ownerId: 'u9' }
      ),
    },
  },
}));

import { prisma } from '../src/lib/prisma';
import {
  recordInvite,
  recordLinkShared,
  claimSharedLink,
  listInbox,
  markInboxRead,
  deleteInboxItems,
  INBOX_TYPES,
} from '../src/lib/inbox';
import { GET as inboxGET, PATCH as inboxPATCH, DELETE as inboxDELETE } from '../src/app/api/inbox/route';

vi.mock('../src/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

vi.mock('../src/lib/telemetry', () => ({
  track: vi.fn(),
  EVENTS: {},
}));

let currentUser = null;
import { getCurrentUser } from '../src/lib/auth';

beforeEach(() => {
  prismaState.items = [];
  currentUser = null;
  vi.clearAllMocks();
  // Tests that stub prisma.permission (recordLinkShared) replace it
  // wholesale with partial stubs — restore the full default stand-in used
  // by claimSharedLink and acceptInboxItem: no existing row, document
  // exists, not owned by the caller.
  prisma.permission = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }) => ({ id: `perm_${++idCounter}`, ...data })),
    findMany: vi.fn(async () => []),
  };
  prisma.document.findFirst = vi.fn(async () => ({ id: 'd1', ownerId: 'u9' }));
});

describe('recordInvite', () => {
  it('creates an invite inbox item for the invitee', async () => {
    await recordInvite({
      userId: 'u1',
      documentId: 'd1',
      docTitle: 'Spec',
      inviterId: 'u2',
      inviterName: 'Alex',
      role: 'EDITOR',
    });

    expect(prismaState.items).toHaveLength(1);
    const item = prismaState.items[0];
    expect(item.userId).toBe('u1');
    expect(item.type).toBe(INBOX_TYPES.INVITE);
    expect(item.documentId).toBe('d1');
    expect(item.docTitle).toBe('Spec');
    expect(item.meta).toEqual({ role: 'EDITOR', inviterName: 'Alex' });
    expect(item.readAt).toBeNull();
  });

  it('updates the existing item instead of duplicating on re-invite', async () => {
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'Spec', role: 'VIEWER' });
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'Spec', role: 'EDITOR' });

    expect(prismaState.items).toHaveLength(1);
    expect(prismaState.items[0].meta.role).toBe('EDITOR');
  });

  it('is a no-op without a userId', async () => {
    await recordInvite({ userId: null, documentId: 'd1', role: 'VIEWER' });
    expect(prismaState.items).toHaveLength(0);
  });

  it('never throws on write failure (best-effort by contract)', async () => {
    prisma.inboxItem.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordInvite({ userId: 'u1', documentId: 'd1', role: 'VIEWER' })
    ).resolves.toBeUndefined();
  });
});

describe('recordLinkShared', () => {
  it('notifies collaborators with permission rows, excluding the actor', async () => {
    // Stub the permission lookup used inside recordLinkShared.
    prisma.permission = {
      findMany: vi.fn(async () => [{ userId: 'u1' }, { userId: 'u3' }]),
    };

    await recordLinkShared({ documentId: 'd1', docTitle: 'Spec', actorId: 'u2' });

    expect(prismaState.items).toHaveLength(2);
    expect(prismaState.items.every((i) => i.type === INBOX_TYPES.LINK_SHARED)).toBe(true);
    expect(prismaState.items.map((i) => i.userId).sort()).toEqual(['u1', 'u3']);
  });

  it('does nothing when the document has no other collaborators', async () => {
    prisma.permission = { findMany: vi.fn(async () => []) };
    await recordLinkShared({ documentId: 'd1', docTitle: 'Spec', actorId: 'u2' });
    expect(prismaState.items).toHaveLength(0);
  });
});

describe('claimSharedLink', () => {
  it('creates a claimed link_opened receipt for a signed-in opener', async () => {
    await claimSharedLink({ userId: 'u1', documentId: 'd1', docTitle: 'Spec', ownerId: 'u2' });

    expect(prismaState.items).toHaveLength(1);
    const item = prismaState.items[0];
    expect(item.type).toBe(INBOX_TYPES.LINK_OPENED);
    expect(item.claimedAt).not.toBeNull();
    expect(item.inviterId).toBe('u2');
  });

  it('does not duplicate on repeated opens and does not reset claimedAt', async () => {
    await claimSharedLink({ userId: 'u1', documentId: 'd1', docTitle: 'Spec', ownerId: 'u2' });
    const first = prismaState.items[0].claimedAt;

    await claimSharedLink({ userId: 'u1', documentId: 'd1', docTitle: 'Spec', ownerId: 'u2' });

    expect(prismaState.items).toHaveLength(1);
    expect(prismaState.items[0].claimedAt).toBe(first);
  });

  it('skips the document owner', async () => {
    await claimSharedLink({ userId: 'u2', documentId: 'd1', docTitle: 'Spec', ownerId: 'u2' });
    expect(prismaState.items).toHaveLength(0);
  });

  it('skips anonymous openers (no user row to attach to)', async () => {
    await claimSharedLink({ userId: null, documentId: 'd1', docTitle: 'Spec', ownerId: 'u2' });
    expect(prismaState.items).toHaveLength(0);
  });
});

describe('listInbox + markInboxRead + deleteInboxItems', () => {
  beforeEach(async () => {
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'A', role: 'EDITOR' });
    await claimSharedLink({ userId: 'u1', documentId: 'd2', docTitle: 'B', ownerId: 'u9' });
    await claimSharedLink({ userId: 'u2', documentId: 'd3', docTitle: 'C', ownerId: 'u9' });
  });

  it('lists newest-first with unread count, scoped to the user', async () => {
    const { items, unread, nextCursor } = await listInbox('u1');
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.userId === 'u1')).toBe(true);
    expect(items[0].docTitle).toBe('B'); // newest first
    expect(unread).toBe(2);
    expect(nextCursor).toBeNull();
  });

  it('marks all unread items read and reports the count', async () => {
    const updated = await markInboxRead('u1', null);
    expect(updated).toBe(2);
    const { unread } = await listInbox('u1');
    expect(unread).toBe(0);
  });

  it('marks a subset read without touching other users', async () => {
    const { items } = await listInbox('u1');
    const updated = await markInboxRead('u1', [items[0].id]);
    expect(updated).toBe(1);
    const { unread } = await listInbox('u1');
    expect(unread).toBe(1);
    const { unread: other } = await listInbox('u2');
    expect(other).toBe(1); // untouched
  });

  it('deletes only the requesting user’s items', async () => {
    const { items } = await listInbox('u1');
    const deleted = await deleteInboxItems('u1', [items[0].id]);
    expect(deleted).toBe(1);
    const { items: after } = await listInbox('u1');
    expect(after).toHaveLength(1);
    expect(await listInbox('u2')).toHaveProperty('items');
    expect((await listInbox('u2')).items).toHaveLength(1);
  });
});

function request(body, method = 'POST') {
  return new Request('http://localhost/api/inbox', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('GET/PATCH/DELETE /api/inbox', () => {
  it('requires sign-in', async () => {
    const res = await inboxGET(new Request('http://localhost/api/inbox'));
    expect(res.status).toBe(401);
  });

  it('returns items + unread for the signed-in user', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'A', role: 'EDITOR' });

    const res = await inboxGET(new Request('http://localhost/api/inbox'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].docTitle).toBe('A');
    expect(body.unread).toBe(1);
    expect(body.nextCursor).toBeNull();
  });

  it('PATCH marks everything read with { all: true }', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'A', role: 'VIEWER' });

    const res = await inboxPATCH(request({ all: true }, 'PATCH'));
    const body = await res.json();
    expect(body.updated).toBe(1);
  });

  it('PATCH rejects empty payloads', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    const res = await inboxPATCH(request({}, 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('DELETE requires ids', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    const res = await inboxDELETE(request({}, 'DELETE'));
    expect(res.status).toBe(400);
  });

  it('DELETE removes the given items', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    await recordInvite({ userId: 'u1', documentId: 'd1', docTitle: 'A', role: 'VIEWER' });
    const { items } = await listInbox('u1');

    const res = await inboxDELETE(request({ ids: [items[0].id] }, 'DELETE'));
    const body = await res.json();
    expect(body.deleted).toBe(1);
  });
});
