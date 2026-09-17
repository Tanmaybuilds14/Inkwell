/**
 * Regression test for the "no version snapshots ever created" bug.
 *
 * The old code initialized lastVersionAt = Date.now() at ROOM creation and
 * required VERSION_INTERVAL_MS (5 min) of continuous room uptime before the
 * first snapshot. Real sessions are short bursts (open, edit, close), so the
 * condition never fired and VersionSnapshot stayed empty forever.
 *
 * The fix seeds lastVersionAt from the DB's latest version timestamp on
 * first use (maybeCreateVersion), so a document whose last version is older
 * than the interval gets snapshotted on the very next persist tick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createVersionSnapshot: vi.fn().mockResolvedValue(undefined),
  latestVersionAt: null,
  persistSnapshot: vi.fn().mockResolvedValue(undefined),
  getDocumentTitle: vi.fn().mockResolvedValue('Test Doc'),
  getDocumentOwnerId: vi.fn().mockResolvedValue('owner-1'),
  logActivityEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sync-service/node_modules/ioredis', () => {
  function MockRedis() {
    this.set = vi.fn().mockResolvedValue('OK');
    this.get = vi.fn().mockResolvedValue(null);
    this.eval = vi.fn().mockResolvedValue(1);
    this.on = vi.fn();
  }
  MockRedis.default = MockRedis;
  return { default: MockRedis };
});

vi.mock('../sync-service/src/broadcast.js', () => ({
  subscribeToDocument: vi.fn().mockReturnValue(vi.fn()),
  publishMessage: vi.fn(),
  MESSAGE_KINDS: { UPDATE: 'update', AWARENESS: 'awareness', APPLY_SNAPSHOT: 'apply-snapshot' },
}));

vi.mock('../sync-service/src/db.js', () => ({
  getDocumentSnapshot: vi.fn().mockResolvedValue(null),
  getDocumentTitle: mocks.getDocumentTitle,
  getDocumentOwnerId: mocks.getDocumentOwnerId,
  persistSnapshot: mocks.persistSnapshot,
  createVersionSnapshot: mocks.createVersionSnapshot,
  getLatestVersionAt: vi.fn(async () => mocks.latestVersionAt),
  logActivityEvents: mocks.logActivityEvents,
}));

import { Room } from '../sync-service/src/rooms.js';

const FIVE_MIN = 5 * 60_000;

function makeRoom() {
  return new Room('doc-ver', null);
}

/** Simulates a persist cycle with an active connection and edits. */
async function persistOnce(room) {
  if (room.conns.size === 0) {
    room.join({ readyState: 1, send() {}, on() {} }, { role: 'EDITOR', identity: {} });
  }
  room.dirty = true;
  await room.persist();
}

describe('version snapshot cadence (maybeCreateVersion)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.latestVersionAt = null;
  });

  it('creates the FIRST version on the first persist of a fresh document', async () => {
    // Never snapshotted before: DB returns null.
    mocks.latestVersionAt = null;
    const room = makeRoom();

    await persistOnce(room);

    expect(mocks.createVersionSnapshot).toHaveBeenCalledTimes(1);
    room.destroy();
  });

  it('creates a version when the last one is older than the interval', async () => {
    mocks.latestVersionAt = new Date(Date.now() - (FIVE_MIN + 60_000)).toISOString();
    const room = makeRoom();

    await persistOnce(room);

    expect(mocks.createVersionSnapshot).toHaveBeenCalledTimes(1);
    room.destroy();
  });

  it('does NOT create a version when the last one is recent', async () => {
    mocks.latestVersionAt = new Date(Date.now() - 60_000).toISOString();
    const room = makeRoom();

    await persistOnce(room);

    expect(mocks.createVersionSnapshot).not.toHaveBeenCalled();
    room.destroy();
  });

  it('respects the interval across consecutive persists in one room', async () => {
    mocks.latestVersionAt = null;
    const room = makeRoom();

    await persistOnce(room); // first ever version
    expect(mocks.createVersionSnapshot).toHaveBeenCalledTimes(1);

    mocks.latestVersionAt = new Date().toISOString();
    await persistOnce(room); // within 5 min of the version just created
    expect(mocks.createVersionSnapshot).toHaveBeenCalledTimes(1); // unchanged

    room.destroy();
  });
});
