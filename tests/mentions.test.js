/**
 * Tests for @mentions:
 *  - components/editor/mention: the matcher behind the "@" menu
 *  - lib/inbox: recordMentions (access filtering, dedupe, best-effort)
 *  - GET/POST /api/documents/[id]/mentions: roster + notification contract
 *
 * Prisma is mocked with an in-memory stand-in that honours the `where` clauses
 * the code under test relies on. That matters here: "can this person be
 * mentioned?" is answered by a filtered permission query, so a mock that
 * returned every row regardless would pass even if the filter were deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  user: null,
  doc: null,
  items: [],
};

let idCounter = 0;

/**
 * Minimal Prisma-style projection. Fields are returned only when selected, and
 * the one filter the code depends on — `permissions.where.userId` — is applied,
 * so a missing guard shows up as a failing assertion instead of a green test.
 */
function project(value, select) {
  if (!select) return value ?? null;
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => project(v, select));

  const out = {};
  for (const [key, spec] of Object.entries(select)) {
    if (['select', 'where', 'take', 'skip', 'cursor', 'orderBy'].includes(key)) continue;
    let child = value[key];

    if (key === 'permissions' && spec?.where?.userId) {
      const w = spec.where.userId;
      child = (child ?? []).filter((p) =>
        w === '__none__'
          ? false
          : typeof w === 'string'
            ? p.userId === w
            : (w.in ?? []).includes(p.userId)
      );
    }
    if (Array.isArray(child) && spec?.take) child = child.slice(0, spec.take);
    out[key] = project(child, spec === true ? null : spec.select);
  }
  return out;
}

function matchesWhere(doc, where = {}) {
  if (!doc) return false;
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    if (key === 'deletedAt' && expected === null && doc.deletedAt !== null) return false;
    if (key === 'id' && doc.id !== expected) return false;
    if (key !== 'id' && key !== 'deletedAt' && doc[key] !== expected) return false;
  }
  return true;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findUnique: vi.fn(async ({ where, select }) =>
        matchesWhere(state.doc, where) ? project(state.doc, select) : null
      ),
      findFirst: vi.fn(async ({ where, select }) =>
        matchesWhere(state.doc, where) ? project(state.doc, select) : null
      ),
    },
    inboxItem: {
      findFirst: vi.fn(
        async ({ where }) =>
          state.items.find(
            (r) =>
              r.userId === where.userId &&
              r.documentId === where.documentId &&
              r.type === where.type
          ) ?? null
      ),
      create: vi.fn(async ({ data }) => {
        const row = {
          id: `inbox_${++idCounter}`,
          readAt: null,
          createdAt: new Date(),
          ...data,
        };
        state.items.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = state.items.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => state.user),
}));

// requireDocument throttles before resolving the role; keep the tests off Redis.
vi.mock('@/lib/rate-limit', () => ({
  throttleShareLinkAttempt: vi.fn(async () => null),
  throttleWrite: vi.fn(async () => null),
}));

vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), EVENTS: { DOC_MENTIONED: 'doc_mentioned' } }));

import { prisma } from '../src/lib/prisma';
import { recordMentions, INBOX_TYPES } from '../src/lib/inbox';
import { mentionMatch, filterMentionItems } from '../src/components/editor/mention';
import {
  GET as mentionsGET,
  POST as mentionsPOST,
} from '../src/app/api/documents/[id]/mentions/route.js';

const OWNER = { id: 'owner1', name: 'Owner', email: 'owner@example.dev', imageUrl: null };
const ADA = { id: 'u2', name: 'Ada Lovelace', email: 'ada@example.dev', imageUrl: null };
const GRACE = { id: 'u3', name: 'Grace Hopper', email: 'grace@example.dev', imageUrl: null };
const OUTSIDER = { id: 'u9', name: 'Mallory', email: 'mallory@example.dev', imageUrl: null };

function doc(overrides = {}) {
  return {
    id: 'doc1',
    title: 'Spec',
    ownerId: OWNER.id,
    owner: OWNER,
    deletedAt: null,
    shareEnabled: false,
    shareRole: 'VIEWER',
    shareToken: null,
    permissions: [
      { userId: ADA.id, role: 'EDITOR', user: ADA },
      { userId: GRACE.id, role: 'VIEWER', user: GRACE },
    ],
    ...overrides,
  };
}

function req(body, method = 'POST', shareToken = null) {
  const url = new URL('http://localhost/api/documents/doc1/mentions');
  if (shareToken) url.searchParams.set('share', shareToken);
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: Promise.resolve({ id: 'doc1' }) };

beforeEach(() => {
  state.user = null;
  state.doc = doc();
  state.items = [];
  vi.clearAllMocks();
});

describe('mention menu matching', () => {
  it('ranks prefix matches above substring matches', () => {
    const people = [
      { id: 'a', name: 'Sally Field' },
      { id: 'b', name: 'Alex Lin' },
    ];
    expect(filterMentionItems(people, 'al').map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('matches subsequences inside a name', () => {
    expect(mentionMatch({ name: 'Grace Hopper' }, 'gh')).toBeGreaterThan(0);
    expect(mentionMatch({ name: 'Grace Hopper' }, 'zz')).toBe(-1);
  });

  it('keeps the roster order when nothing is typed', () => {
    const people = [
      { id: 'a', name: 'Owner' },
      { id: 'b', name: 'Ada' },
    ];
    expect(filterMentionItems(people, '').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('never offers the author themselves', () => {
    const people = [
      { id: 'me', name: 'Me' },
      { id: 'you', name: 'You' },
    ];
    expect(filterMentionItems(people, '', { excludeId: 'me' }).map((p) => p.id)).toEqual(['you']);
  });

  it('ignores entries with no id', () => {
    expect(filterMentionItems([{ name: 'ghost' }], '')).toEqual([]);
  });
});

describe('recordMentions', () => {
  it('notifies collaborators and the owner', async () => {
    const notified = await recordMentions({
      userIds: [ADA.id, OWNER.id],
      documentId: 'doc1',
      docTitle: 'Spec',
      actorId: GRACE.id,
      actorName: 'Grace',
    });

    expect(notified).toBe(2);
    expect(state.items.map((i) => i.userId).sort()).toEqual([ADA.id, OWNER.id].sort());
    expect(state.items.every((i) => i.type === INBOX_TYPES.MENTION)).toBe(true);
    expect(state.items.every((i) => i.meta.count === 1)).toBe(true);
    expect(state.items.every((i) => i.readAt === null)).toBe(true);
  });

  it('drops people who cannot see the document', async () => {
    const notified = await recordMentions({
      userIds: [OUTSIDER.id],
      documentId: 'doc1',
      docTitle: 'Spec',
      actorId: ADA.id,
    });

    expect(notified).toBe(0);
    expect(state.items).toHaveLength(0);
  });

  it('drops self-mentions and duplicates', async () => {
    const notified = await recordMentions({
      userIds: [ADA.id, ADA.id],
      documentId: 'doc1',
      docTitle: 'Spec',
      actorId: ADA.id,
    });

    expect(notified).toBe(0);
    expect(state.items).toHaveLength(0);
  });

  it('bumps the existing row instead of stacking one per occurrence', async () => {
    await recordMentions({ userIds: [ADA.id], documentId: 'doc1', docTitle: 'Spec', actorId: OWNER.id });
    state.items[0].readAt = new Date(); // Ada already read it

    await recordMentions({ userIds: [ADA.id], documentId: 'doc1', docTitle: 'Spec', actorId: OWNER.id });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].meta.count).toBe(2);
    // Mentioned again = unread again, otherwise a second mention is silent.
    expect(state.items[0].readAt).toBeNull();
  });

  it('is a no-op without a document or actor', async () => {
    expect(await recordMentions({ userIds: [ADA.id], documentId: null, actorId: OWNER.id })).toBe(0);
    expect(await recordMentions({ userIds: [ADA.id], documentId: 'doc1', actorId: null })).toBe(0);
    expect(state.items).toHaveLength(0);
  });

  it('never throws on write failure (best-effort by contract)', async () => {
    prisma.inboxItem.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordMentions({ userIds: [ADA.id], documentId: 'doc1', actorId: OWNER.id })
    ).resolves.toBe(0);
  });
});

describe('GET /api/documents/[id]/mentions', () => {
  it('requires sign-in, even for a document that is readable by link', async () => {
    state.doc = doc({ shareEnabled: true, shareToken: 'tok_abc1234567890123456789012' });
    const res = await mentionsGET(new Request('http://localhost/api/documents/doc1/mentions?share=tok_abc1234567890123456789012'), ctx);
    expect(res.status).toBe(401);
  });

  it('requires access to the document', async () => {
    state.user = OUTSIDER;
    const res = await mentionsGET(req(null, 'GET'), ctx);
    expect(res.status).toBe(404);
  });

  it('returns the roster without the caller and without any email address', async () => {
    state.user = ADA;
    const res = await mentionsGET(req(null, 'GET'), ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.people.map((p) => p.id)).toEqual([OWNER.id, GRACE.id]);
    expect(body.people.map((p) => p.name)).toEqual(['Owner', 'Grace Hopper']);
    expect(JSON.stringify(body)).not.toContain('@example.dev');
  });

  it('falls back to the email local part for a collaborator with no display name', async () => {
    state.user = ADA;
    state.doc = doc({
      permissions: [
        { userId: ADA.id, role: 'EDITOR', user: ADA },
        { userId: GRACE.id, role: 'VIEWER', user: { ...GRACE, name: null } },
      ],
    });

    const body = await (await mentionsGET(req(null, 'GET'), ctx)).json();
    expect(body.people.map((p) => p.name)).toEqual(['Owner', 'grace']);
  });
});

describe('POST /api/documents/[id]/mentions', () => {
  it('answers a signed-out caller with 404, not 401 (existence is never disclosed)', async () => {
    const res = await mentionsPOST(req({ userIds: [ADA.id] }), ctx);
    expect(res.status).toBe(404);
  });

  it('refuses a guest holding an edit link — nobody to attribute the mention to', async () => {
    const token = 'tok_abc1234567890123456789012';
    state.doc = doc({ shareEnabled: true, shareRole: 'EDITOR', shareToken: token });

    const res = await mentionsPOST(req({ userIds: [ADA.id] }, 'POST', token), ctx);
    expect(res.status).toBe(401);
    expect(state.items).toHaveLength(0);
  });

  it('rejects a viewer — mentioning is writing', async () => {
    state.user = GRACE;
    const res = await mentionsPOST(req({ userIds: [ADA.id] }), ctx);
    expect(res.status).toBe(403);
  });

  it('rejects an empty payload', async () => {
    state.user = ADA;
    const res = await mentionsPOST(req({ userIds: [] }), ctx);
    expect(res.status).toBe(400);
  });

  it('notifies the mentioned collaborator', async () => {
    state.user = ADA;
    const res = await mentionsPOST(req({ userIds: [GRACE.id] }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notified: 1 });
    expect(state.items[0].userId).toBe(GRACE.id);
    expect(state.items[0].docTitle).toBe('Spec');
    expect(state.items[0].meta.inviterName).toBe('Ada Lovelace');
  });

  it('reports 0 for a user with no access rather than leaking that they exist', async () => {
    state.user = ADA;
    const res = await mentionsPOST(req({ userIds: [OUTSIDER.id] }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notified: 0 });
    expect(state.items).toHaveLength(0);
  });
});
