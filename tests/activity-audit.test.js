/**
 * Tests for the user activity audit (profile feature):
 *  - lib/activity: logActivity, listActivity pagination, activityStats
 *  - GET /api/activity: auth + response contract
 *
 * Prisma is mocked with a minimal in-memory stand-in; the mock returns an
 * object with BOTH the real model API shape and the raw $queryRaw/
 * $executeRawUnsafe surfaces used by lib/activity and lib/migrations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaState = {
  events: [], // in-memory ActivityEvent rows
  executed: [], // raw SQL executed via $executeRawUnsafe
};

vi.mock('../src/lib/prisma', () => {
  let idCounter = 0;

  function makeModel() {
    // Stable sort key mirroring lib/activity's orderBy:
    // createdAt desc, then id desc (id tie-break for same-millisecond rows).
    const byNewest = (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

    return {
      create: vi.fn(async ({ data }) => {
        const row = { id: `evt_${++idCounter}`, createdAt: new Date(), ...data };
        prismaState.events.push(row);
        return row;
      }),
      findMany: vi.fn(async (args = {}) => {
        let rows = [...prismaState.events].sort(byNewest);
        if (args.where?.userId) rows = rows.filter((r) => r.userId === args.where.userId);
        if (args.where?.type) {
          const t = args.where.type;
          rows = t.in ? rows.filter((r) => t.in.includes(r.type)) : rows.filter((r) => r.type === t);
        }
        // Cursor semantics (enough fidelity for the pagination contract):
        // start *after* the row with args.cursor.id.
        let start = 0;
        if (args.cursor?.id) {
          const idx = rows.findIndex((r) => r.id === args.cursor.id);
          start = idx === -1 ? 0 : idx + (args.skip ?? 0);
        } else if (args.skip) {
          start = args.skip;
        }
        const take = args.take ?? rows.length - start;
        return rows.slice(start, start + take);
      }),
      count: vi.fn(async (args = {}) => {
        const rows = await makeModel().findMany(args);
        return rows.length;
      }),
    };
  }

  return {
    prisma: {
      activityEvent: makeModel(),
      user: makeModel(),
      $queryRaw: vi.fn(async () => [{ n: 3n }]),
      $executeRawUnsafe: vi.fn(async (sql) => {
        prismaState.executed.push(sql);
        return 0;
      }),
    },
  };
});

import { prisma } from '../src/lib/prisma';
import {
  logActivity,
  listActivity,
  activityStats,
  ACTIVITY_TYPES,
} from '../src/lib/activity';
import { GET as activityGET } from '../src/app/api/activity/route';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Mock auth: signed-out unless a user id is set.
let currentUser = null;
vi.mock('../src/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));
vi.mock('../src/lib/telemetry', () => ({
  track: vi.fn(),
  EVENTS: {},
}));

import { getCurrentUser } from '../src/lib/auth';

beforeEach(() => {
  prismaState.events = [];
  prismaState.executed = [];
  prisma.$queryRaw.mockClear();
  prisma.$executeRawUnsafe.mockClear();
  prisma.activityEvent.create.mockClear();
  currentUser = null;
});

describe('logActivity', () => {
  it('writes an ActivityEvent row with type, document and meta', async () => {
    await logActivity(ACTIVITY_TYPES.DOC_CREATED, {
      userId: 'u1',
      documentId: 'd1',
      docTitle: 'Spec',
      meta: { source: 'test' },
    });

    expect(prisma.activityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        type: 'doc_created',
        documentId: 'd1',
        docTitle: 'Spec',
      }),
    });
    expect(prismaState.events).toHaveLength(1);
  });

  it('is a no-op without a userId (guests never get audit rows)', async () => {
    await logActivity(ACTIVITY_TYPES.DOC_EDITED, { userId: null });
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
    expect(prismaState.events).toHaveLength(0);
  });

  it('swallows write failures so user-facing operations never break', async () => {
    prisma.activityEvent.create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      logActivity(ACTIVITY_TYPES.DOC_EDITED, { userId: 'u1' })
    ).resolves.toBeUndefined();
  });
});

describe('listActivity', () => {
  beforeEach(async () => {
    // Seed 5 events in chronological order.
    for (let i = 0; i < 5; i++) {
      await logActivity(ACTIVITY_TYPES.DOC_EDITED, {
        userId: 'u1',
        documentId: `d${i}`,
        docTitle: `Doc ${i}`,
      });
    }
    await logActivity(ACTIVITY_TYPES.DOC_CREATED, { userId: 'u2', documentId: 'other' });
  });

  it('returns newest-first events for the requesting user only', async () => {
    const { events } = await listActivity('u1', { limit: 10 });
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.userId === 'u1')).toBe(true);
    expect(events[0].docTitle).toBe('Doc 4'); // newest first
    expect(events[4].docTitle).toBe('Doc 0');
  });

  it('paginates with a cursor and reports nextCursor', async () => {
    const page1 = await listActivity('u1', { limit: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.events[1].id);

    const page2 = await listActivity('u1', { cursor: page1.nextCursor, limit: 2 });
    expect(page2.events).toHaveLength(2);
    // No overlap between pages.
    const ids1 = page1.events.map((e) => e.id);
    for (const e of page2.events) expect(ids1).not.toContain(e.id);
  });

  it('returns null nextCursor on the last page', async () => {
    const { events, nextCursor } = await listActivity('u1', { limit: 10 });
    expect(events).toHaveLength(5);
    expect(nextCursor).toBeNull();
  });
});

describe('activityStats', () => {
  it('counts created and aggregates distinct edit sessions via raw SQL', async () => {
    await logActivity(ACTIVITY_TYPES.DOC_CREATED, { userId: 'u1' });
    await logActivity(ACTIVITY_TYPES.DOC_SHARED, { userId: 'u1' });

    const stats = await activityStats('u1');
    expect(stats.created).toBe(1);
    expect(stats.shared).toBe(1);
    expect(stats.edited).toBe(3); // from the mocked $queryRaw result
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

describe('GET /api/activity', () => {
  it('requires sign-in', async () => {
    const res = await activityGET(new Request('http://localhost/api/activity'));
    expect(res.status).toBe(401);
  });

  it('returns events + stats for the signed-in user', async () => {
    currentUser = { id: 'u1', email: 'a@b.c', name: 'A' };
    await logActivity(ACTIVITY_TYPES.DOC_CREATED, {
      userId: 'u1',
      documentId: 'd1',
      docTitle: 'Spec',
    });

    const res = await activityGET(new Request('http://localhost/api/activity'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('doc_created');
    expect(body.events[0].docTitle).toBe('Spec');
    expect(body.nextCursor).toBeNull();
    expect(body.stats).toHaveProperty('created', 1);
  });
});
