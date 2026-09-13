/**
 * Regression test for the viewer-edit-bypass bug in the sync service.
 *
 * The old code gated only sync subType 1 (messageYjsSyncStep2 — the one-time
 * initial-state exchange) but NOT subType 2 (messageYjsUpdate — the message
 * every incremental live edit travels on). A VIEWER could therefore send
 * arbitrary CRDT updates and mutate any document they could open.
 *
 * The fix gates BOTH subtypes 1 and 2 behind canEditRole (EDITOR/OWNER).
 *
 * Real lib0 encoding/decoding is used so the test builds genuinely
 * well-formed y-websocket frames; only the network-facing modules
 * (ioredis, Redis broadcast, Postgres) and the y-protocols handlers are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';

describe('sync-service edit permission gating', () => {
  let mockSet, mockGet, mockEval;
  let readSyncMessage, writeUpdate, writeSyncStep1;

  beforeEach(async () => {
    vi.resetModules();
    mockSet = vi.fn().mockResolvedValue('OK');
    mockGet = vi.fn().mockResolvedValue(null);
    mockEval = vi.fn().mockResolvedValue(1);

    vi.doMock('ioredis', () => {
      function MockRedis() {
        this.set = mockSet;
        this.get = mockGet;
        this.eval = mockEval;
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
      persistSnapshot: vi.fn(),
      createVersionSnapshot: vi.fn(),
    }));

    readSyncMessage = vi.fn();
    writeUpdate = vi.fn();
    writeSyncStep1 = vi.fn();
    vi.doMock('y-protocols/sync', () => ({
      readSyncMessage,
      writeUpdate,
      writeSyncStep1,
    }));

    class MockAwareness {
      constructor() {
        this.clientID = 1;
        this._states = new Map();
      }
      getStates() {
        return this._states;
      }
      setLocalState() {}
      on() {}
      off() {}
      destroy() {}
    }
    vi.doMock('y-protocols/awareness', () => ({
      Awareness: MockAwareness,
      applyAwarenessUpdate: vi.fn(),
      encodeAwarenessUpdate: vi.fn(() => new Uint8Array([0])),
      removeAwarenessStates: vi.fn(() => []),
    }));
  });

  /** Builds a well-formed [outer=sync][inner=subType][payload] frame. */
  function syncFrame(syncSubType, payloadBytes) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // outer: messageSync
    encoding.writeVarUint(encoder, syncSubType);
    if (payloadBytes) encoding.writeVarUint8Array(encoder, payloadBytes);
    return encoding.toUint8Array(encoder);
  }

  function makeWs() {
    return {
      readyState: 1,
      sent: [],
      closed: null,
      send(buf) { this.sent.push(buf); },
      close(code, reason) { this.closed = { code, reason }; },
      on() {},
      off() {},
    };
  }

  async function makeRoom() {
    // Seed a small real snapshot so the room has content to protect.
    const srcDoc = new Y.Doc();
    srcDoc.getText('default').insert(0, 'hello');
    const snapshot = Y.encodeStateAsUpdate(srcDoc);
    srcDoc.destroy();

    const { Room } = await import('../sync-service/src/rooms.js');
    const room = new Room('doc-1', snapshot);
    return room;
  }

  it.each(['VIEWER', 'COMMENTER'])('rejects a %s sending an incremental update (subType 2)', async (role) => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role, identity: {} });

    const edit = new Y.Doc();
    edit.getText('default').insert(0, 'MALICIOUS EDIT');
    const update = Y.encodeStateAsUpdate(edit);
    edit.destroy();

    room.handleMessage(ws, syncFrame(2, update));

    expect(ws.closed?.code).toBe(4003);
    expect(readSyncMessage).not.toHaveBeenCalled();
    expect(room.doc.getText('default').toString()).toBe('hello');
    room.destroy();
  });

  it('rejects a VIEWER sending syncStep2 (initial state) too', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'VIEWER', identity: {} });

    const edit = new Y.Doc();
    edit.getText('default').insert(0, 'MALICIOUS EDIT');
    const update = Y.encodeStateAsUpdate(edit);
    edit.destroy();

    room.handleMessage(ws, syncFrame(1, update));

    expect(ws.closed?.code).toBe(4003);
    expect(readSyncMessage).not.toHaveBeenCalled();
    expect(room.doc.getText('default').toString()).toBe('hello');
    room.destroy();
  });

  it('allows an EDITOR to send an incremental update (subType 2)', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'EDITOR', identity: {} });

    const edit = new Y.Doc();
    edit.getText('default').insert(0, 'legit edit');
    const update = Y.encodeStateAsUpdate(edit);
    edit.destroy();

    room.handleMessage(ws, syncFrame(2, update));

    expect(ws.closed).toBeNull();
    expect(readSyncMessage).toHaveBeenCalledTimes(1);
    room.destroy();
  });

  it('allows an OWNER to send syncStep2 (initial state)', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'OWNER', identity: {} });

    const edit = new Y.Doc();
    edit.getText('default').insert(0, 'owner state');
    const update = Y.encodeStateAsUpdate(edit);
    edit.destroy();

    room.handleMessage(ws, syncFrame(1, update));

    expect(ws.closed).toBeNull();
    expect(readSyncMessage).toHaveBeenCalledTimes(1);
    room.destroy();
  });
});
