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
 * Uses the REAL y-protocol handlers and real Yjs: the assertions check the
 * actual document state after each message, so the test cannot pass while
 * the gating is bypassed. Only the network-facing modules (Redis, Postgres)
 * are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';

describe('sync-service edit permission gating', () => {
  let mockSet, mockGet, mockEval;

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

  /** Creates a room seeded with the text "hello". */
  async function makeRoom() {
    const srcDoc = new Y.Doc();
    srcDoc.getText('default').insert(0, 'hello');
    const snapshot = Y.encodeStateAsUpdate(srcDoc);
    srcDoc.destroy();

    const { Room } = await import('../sync-service/src/rooms.js');
    return new Room('doc-1', snapshot);
  }

  /** Builds an update from a fresh doc whose text diverges from "hello". */
  function maliciousUpdate(text) {
    const edit = new Y.Doc();
    edit.getText('default').insert(0, text);
    const update = Y.encodeStateAsUpdate(edit);
    edit.destroy();
    return update;
  }

  it.each(['VIEWER', 'COMMENTER'])('rejects a %s sending an incremental update (subType 2)', async (role) => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role, identity: {} });

    room.handleMessage(ws, syncFrame(2, maliciousUpdate('MALICIOUS EDIT')));

    expect(ws.closed?.code).toBe(4003);
    expect(room.doc.getText('default').toString()).toBe('hello');
    room.destroy();
  });

  it('rejects a VIEWER sending syncStep2 (initial state) too', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'VIEWER', identity: {} });

    room.handleMessage(ws, syncFrame(1, maliciousUpdate('MALICIOUS EDIT')));

    expect(ws.closed?.code).toBe(4003);
    expect(room.doc.getText('default').toString()).toBe('hello');
    room.destroy();
  });

  it('allows an EDITOR to send an incremental update (subType 2)', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'EDITOR', identity: {} });

    room.handleMessage(ws, syncFrame(2, maliciousUpdate('legit edit')));

    expect(ws.closed).toBeNull();
    expect(room.doc.getText('default').toString()).toContain('legit edit');
    room.destroy();
  });

  it('allows an OWNER to send syncStep2 (initial state)', async () => {
    const room = await makeRoom();
    const ws = makeWs();
    room.join(ws, { role: 'OWNER', identity: {} });

    room.handleMessage(ws, syncFrame(1, maliciousUpdate('owner state')));

    expect(ws.closed).toBeNull();
    expect(room.doc.getText('default').toString()).toContain('owner state');
    room.destroy();
  });
});
