/**
 * Regression tests for the collaborator list in the share dialog.
 *
 * Symptom reported: after an invite was accepted, the dialog still showed the
 * "pending" badge and it never cleared.
 *
 * Root cause: GET /api/documents/[id]/share computed
 * `pending: !p.user.clerkId || p.user.clerkId.startsWith('pending_')` from a
 * Prisma select that never fetched `clerkId`. `p.user.clerkId` was therefore
 * undefined for every row, `!undefined` is true, and the badge was
 * unconditional — including for collaborators whose real Clerk id had already
 * been written to the database. Verified against the live database: the
 * invited rows held real `user_…` ids and zero placeholder users existed, so
 * the data was correct and only the read select was wrong.
 *
 * Two layers are pinned here: the route must select the field the predicate
 * reads, and the predicate must report a claimed row as not pending.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { doc: null, findUniqueCalls: [] };

/**
 * Minimal Prisma-style select projection.
 *
 * This is what makes the behavioural test real: returning the whole row
 * regardless of the select would hand the route a `clerkId` it never asked
 * for, so the test would pass even with the field missing from the select —
 * which is exactly the bug. Prisma returns only the selected columns, so a
 * field omitted from the select must read back as undefined here too.
 */
function project(value, select) {
  if (!select) return value ?? null;
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => project(v, select));
  const out = {};
  for (const [key, spec] of Object.entries(select)) {
    // Filtering/paging clauses in the mock's shape aren't returned fields.
    if (['select', 'where', 'take', 'skip', 'cursor', 'orderBy'].includes(key)) continue;
    out[key] = project(value[key], spec === true ? null : spec.select);
  }
  return out;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findUnique: vi.fn(async (args) => {
        // Pushed raw: `args` IS the query object (not an { args } wrapper).
        state.findUniqueCalls.push(args);
        return project(state.doc, args?.select);
      }),
    },
  },
}));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'owner1', name: 'Owner', email: 'owner@example.dev' })),
}));
// requireDocument throttles before resolving the role; keep the test off Redis.
vi.mock('@/lib/rate-limit', () => ({
  throttleShareLinkAttempt: vi.fn(async () => null),
  throttleWrite: vi.fn(async () => null),
}));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), EVENTS: {} }));
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn(),
  ACTIVITY_TYPES: { DOC_SHARED: 'doc_shared' },
}));
vi.mock('@/lib/inbox', () => ({
  recordInvite: vi.fn(),
  recordLinkShared: vi.fn(),
}));

import { GET } from '../src/app/api/documents/[id]/share/route.js';
import { buildCollaborators, isPendingUser } from '../src/lib/collaborators.js';

const OWNER = { id: 'owner1', name: 'Owner', email: 'owner@example.dev' };

function permission(overrides = {}) {
  return {
    id: 'perm1',
    role: 'EDITOR',
    invitedEmail: 'invitee@example.dev',
    user: { id: 'invitee1', name: 'Invitee', email: 'invitee@example.dev', clerkId: 'user_real_123' },
    ...overrides,
  };
}

/** One object satisfies both requireDocument's role lookup and the route's. */
function doc(permissions = []) {
  return {
    id: 'doc1',
    ownerId: OWNER.id,
    owner: OWNER,
    deletedAt: null,
    shareEnabled: false,
    shareRole: 'VIEWER',
    shareToken: null,
    permissions,
  };
}

function callGET() {
  return GET(new Request('http://localhost/api/documents/doc1/share'), {
    params: Promise.resolve({ id: 'doc1' }),
  });
}

/**
 * The route's own select, as opposed to requireDocument's role lookup (which
 * also selects `permissions`, with a where-clause). Only the route selects
 * `owner`.
 */
function displaySelectArgs() {
  return state.findUniqueCalls.find((args) => args?.select?.owner);
}

beforeEach(() => {
  state.doc = null;
  state.findUniqueCalls = [];
  vi.clearAllMocks();
});

describe('GET /api/documents/[id]/share — collaborator pending state', () => {
  it('selects the clerkId the pending predicate reads', async () => {
    state.doc = doc();
    await callGET();

    const args = displaySelectArgs();
    expect(args, 'route should query the document with a permissions select').toBeTruthy();
    expect(args.select.permissions.select.user.select.clerkId).toBe(true);
  });

  it('does not mark an accepted collaborator as pending', async () => {
    state.doc = doc([permission()]);
    const res = await callGET();
    const body = await res.json();

    const invitee = body.collaborators.find((c) => c.userId === 'invitee1');
    expect(invitee.pending).toBe(false);
    expect(invitee.role).toBe('EDITOR');
  });

  it('marks a pre-provisioned placeholder as pending', async () => {
    state.doc = doc([
      permission({
        user: {
          id: 'invitee2',
          name: null,
          email: 'newbie@example.dev',
          clerkId: 'pending_9f8e7d6c',
        },
      }),
    ]);
    const res = await callGET();
    const body = await res.json();

    const invitee = body.collaborators.find((c) => c.userId === 'invitee2');
    expect(invitee.pending).toBe(true);
    // No name yet — the dialog shows the email until they sign in.
    expect(invitee.name).toBe('newbie@example.dev');
  });

  it('lists the owner first as OWNER and never pending', async () => {
    state.doc = doc([permission()]);
    const res = await callGET();
    const body = await res.json();

    expect(body.collaborators[0]).toMatchObject({
      userId: 'owner1',
      permissionId: null,
      role: 'OWNER',
      pending: false,
    });
  });

  it('reports one entry per permission row', async () => {
    state.doc = doc([permission(), permission({ id: 'perm2', role: 'VIEWER' })]);
    const res = await callGET();
    const body = await res.json();
    expect(body.collaborators).toHaveLength(3);
  });
});

describe('isPendingUser', () => {
  it('is false for a real Clerk id', () => {
    expect(isPendingUser({ clerkId: 'user_2abc' })).toBe(false);
  });

  it('is true for a pre-provisioned placeholder', () => {
    expect(isPendingUser({ clerkId: 'pending_abc' })).toBe(true);
  });

  it('treats a missing clerkId as pending rather than asserting an account', () => {
    expect(isPendingUser({ email: 'a@b.c' })).toBe(true);
    expect(isPendingUser(null)).toBe(true);
  });
});

describe('buildCollaborators', () => {
  it('falls back to email when there is no display name', () => {
    const [owner, invitee] = buildCollaborators({
      owner: { id: 'o', name: null, email: 'o@example.dev' },
      permissions: [
        permission({ user: { id: 'u', name: null, email: 'u@example.dev', clerkId: 'user_x' } }),
      ],
    });
    expect(owner.name).toBe('o@example.dev');
    expect(invitee.name).toBe('u@example.dev');
  });

  it('handles a document with no collaborators', () => {
    expect(buildCollaborators({ owner: OWNER })).toHaveLength(1);
  });
});
