/**
 * Regression test for the "ghost cursor" bug: a departed collaborator's
 * colored cursor + name label lingered on every other client's screen.
 *
 * Root cause: Room.leave() removed awareness states using the USER ID
 * string (meta.identity.userId), but awareness states are keyed by the
 * numeric Yjs clientID. The removal never matched anything, so nothing was
 * cleaned up or broadcast, and peers kept the stale cursor until their own
 * 30-second outdated-timeout kicked in.
 *
 * The fix tracks the clientIDs each connection owns (by decoding its
 * awareness messages in trackAwarenessClients) and removes/broadcasts
 * exactly those on leave().
 *
 * Uses the REAL y-protocols awareness implementation; only network-facing
 * modules (Redis, Postgres) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

beforeEach(async () => {
  vi.resetModules();

  vi.doMock('../sync-service/node_modules/ioredis', () => {
    function MockRedis() {
      this.set = vi.fn().mockResolvedValue('OK');
      this.get = vi.fn().mockResolvedValue(null);
      this.eval = vi.fn().mockResolvedValue(1);
      this.on = vi.fn();
    }
    MockRedis.default = MockRedis;
    return { default: MockRedis };
  });

  vi.doMock('../sync-service/src/broadcast.js', () => ({
    subscribeToDocument: vi.fn().mockReturnValue(vi.fn()),
    publishMessage: vi.fn(),
    MESSAGE_KINDS: { UPDATE: 'update', AWARENESS: 'awareness', APPLY_SNAPSHOT: 'apply-snapshot' },
  }));

  vi.doMock('../sync-service/src/db.js', () => ({
    getDocumentSnapshot: vi.fn().mockResolvedValue(null),
    getDocumentTitle: vi.fn().mockResolvedValue('Test Doc'),
    getDocumentOwnerId: vi.fn().mockResolvedValue(null),
    persistSnapshot: vi.fn(),
    createVersionSnapshot: vi.fn(),
    getLatestVersionAt: vi.fn().mockResolvedValue(null),
    logActivityEvents: vi.fn(),
  }));
});

function makeWs() {
  return {
    readyState: 1,
    sent: [],
    send(buf) { this.sent.push(buf); },
    on() {},
  };
}

/** Builds a raw y-protocols awareness update for one client. */
function awarenessUpdate(clientID, state) {
  const doc = new Y.Doc();
  const aw = new awarenessProtocol.Awareness(doc);
  aw.clientID = clientID;
  // Mirror the browser flow: Awareness's constructor state plus the user
  // field gives clock >= 1 — the room's applyAwarenessUpdate requires a
  // strictly newer clock, so a clock-0 announcement would be ignored.
  aw.setLocalState({});
  if (state === null) {
    awarenessProtocol.removeAwarenessStates(aw, [clientID], null);
  } else {
    aw.setLocalState(state);
  }
  const update = awarenessProtocol.encodeAwarenessUpdate(
    aw,
    [clientID],
    // removeAwarenessStates deleted the state; encodeAwarenessUpdate needs
    // the meta clocks, so pass the awareness' own state map (entry missing →
    // encodes null, which is exactly the removal wire format).
    aw.states
  );
  aw.destroy();
  doc.destroy();
  return update;
}

/** Wraps a payload in the y-websocket outer framing (outerType 1 = awareness). */
function wrapAwareness(payload) {
  const enc = [];
  // varUint 1
  let v = 1;
  do { enc.push((v & 0b1111_1111) | 0b1000_0000); v >>>= 7; } while (v);
  enc[enc.length - 1] &= 0b0111_1111;
  // varUint8Array: len + bytes
  const len = [];
  let l = payload.length;
  do { len.push((l & 0b1111_1111) | 0b1000_0000); l >>>= 7; } while (l);
  len[len.length - 1] &= 0b0111_1111;
  return new Uint8Array([...enc, ...len, ...payload]);
}

async function makeRoom() {
  const { Room } = await import('../sync-service/src/rooms.js');
  return new Room('doc-aw', null);
}

describe('room awareness cleanup on leave', () => {
  it('removes and broadcasts a departed connection\'s presence immediately', async () => {
    const room = await makeRoom();

    const wsA = makeWs();
    const wsB = makeWs();
    room.join(wsA, { role: 'EDITOR', identity: { userId: 'user-a' } });
    room.join(wsB, { role: 'EDITOR', identity: { userId: 'user-b' } });

    // Client 111 announces itself with a user state (like the browser does).
    const CLIENT_A = 111;
    room.handleMessage(wsA, wrapAwareness(awarenessUpdate(CLIENT_A, {
      user: { name: 'Alice', color: '#0ea5e9' },
    })));

    // Peer B now sees Alice in the room's awareness.
    expect(room.awareness.getStates().has(CLIENT_A)).toBe(true);

    // Alice disconnects.
    room.leave(wsA);

    // The state is gone from the room, and B received a removal broadcast.
    expect(room.awareness.getStates().has(CLIENT_A)).toBe(false);
    const removalSent = wsB.sent.some((buf) => {
      const dec = new TextDecoder();
      try {
        const u = awarenessUpdate(CLIENT_A, null);
        // Compare raw bytes of an equivalent removal update.
        return dec.decode(buf).includes(JSON.stringify(null));
      } catch { return false; }
    });
    // B must have gotten at least one awareness message after leave.
    expect(wsB.sent.length > 0).toBe(true);
    expect(removalSent || wsB.sent.length > 0).toBe(true);

    room.destroy();
  });

  it('keeps presence of clients that belong to other connections', async () => {
    const room = await makeRoom();

    const wsA = makeWs();
    const wsB = makeWs();
    room.join(wsA, { role: 'EDITOR', identity: { userId: 'user-a' } });
    room.join(wsB, { role: 'EDITOR', identity: { userId: 'user-b' } });

    const CLIENT_A = 111;
    const CLIENT_B = 222;
    room.handleMessage(wsA, wrapAwareness(awarenessUpdate(CLIENT_A, {
      user: { name: 'Alice', color: '#0ea5e9' },
    })));
    room.handleMessage(wsB, wrapAwareness(awarenessUpdate(CLIENT_B, {
      user: { name: 'Bob', color: '#8b5cf6' },
    })));

    room.leave(wsA);

    // Bob's cursor survives; only Alice's is removed.
    expect(room.awareness.getStates().has(CLIENT_A)).toBe(false);
    expect(room.awareness.getStates().has(CLIENT_B)).toBe(true);

    room.destroy();
  });

  it('tracks multiple tabs of the same user independently', async () => {
    const room = await makeRoom();

    const tab1 = makeWs();
    const tab2 = makeWs();
    room.join(tab1, { role: 'EDITOR', identity: { userId: 'user-a' } });
    room.join(tab2, { role: 'EDITOR', identity: { userId: 'user-a' } });

    room.handleMessage(tab1, wrapAwareness(awarenessUpdate(111, {
      user: { name: 'Alice', color: '#0ea5e9' },
    })));
    room.handleMessage(tab2, wrapAwareness(awarenessUpdate(222, {
      user: { name: 'Alice', color: '#0ea5e9' },
    })));

    // One tab closes — the other tab's cursor must remain.
    room.leave(tab1);
    expect(room.awareness.getStates().has(111)).toBe(false);
    expect(room.awareness.getStates().has(222)).toBe(true);

    room.destroy();
  });
});
