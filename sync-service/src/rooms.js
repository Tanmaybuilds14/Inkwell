import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import Redis from 'ioredis';
import {
  getDocumentSnapshot,
  getDocumentTitle,
  persistSnapshot,
  createVersionSnapshot,
} from './db.js';
import { subscribeToDocument, publishMessage, MESSAGE_KINDS } from './broadcast.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// y-protocols/sync sub-types: messageYjsSyncStep1=0 (state-vector request),
// messageYjsSyncStep2=1 (full initial state) and messageYjsUpdate=2 (incremental
// delta — the message every live edit travels on). BOTH 1 and 2 mutate the doc,
// so both are edit-gated in handleMessage.
const SYNC_STEP2_UPDATE = 1;
const SYNC_UPDATE = 2;

const PERSIST_INTERVAL_MS = 5_000;
const VERSION_INTERVAL_MS = 5 * 60_000;
const EMPTY_ROOM_TTL_MS = 60_000;

// ---- Redis leader lock for cross-instance persistence ----
const LOCK_TTL_MS = 15_000;
const LOCK_KEY_PREFIX = 'inkwell:lock:doc:';
const INSTANCE_ID = `inst-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let lockRedis = null;
function getLockRedis() {
  if (!lockRedis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    lockRedis = new Redis(url, { maxRetriesPerRequest: 1 });
    lockRedis.on('error', (err) => console.error('[redis] lock error:', err.message));
  }
  return lockRedis;
}

export async function acquireLock(docId) {
  try {
    const key = LOCK_KEY_PREFIX + docId;
    const redis = getLockRedis();
    const result = await redis.set(key, INSTANCE_ID, 'PX', LOCK_TTL_MS, 'NX');
    if (result === 'OK') return true;
    const owner = await redis.get(key);
    return owner === INSTANCE_ID;
  } catch {
    return false;
  }
}

export async function releaseLock(docId) {
  try {
    const key = LOCK_KEY_PREFIX + docId;
    const redis = getLockRedis();
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await redis.eval(script, 1, key, INSTANCE_ID);
  } catch {
    /* best-effort */
  }
}

/**
 * Encode a y-protocols sync message inside the y-websocket outer framing.
 * Wire format: [varUint: MESSAGE_SYNC(0)] [inner sync bytes...]
 */
function encodeSyncMessage(writeFn, ...args) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  writeFn(encoder, ...args);
  return encoding.toUint8Array(encoder);
}

/** Awareness wire format: [varUint: MESSAGE_AWARENESS(1)] [payload] */
function wrapAwareness(payloadBytes) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payloadBytes);
  return encoding.toUint8Array(encoder);
}

export class Room {
  constructor(docId, snapshotBytes) {
    this.docId = docId;
    this.doc = new Y.Doc({ guid: docId });
    if (snapshotBytes && snapshotBytes.length > 0) {
      Y.applyUpdate(this.doc, new Uint8Array(snapshotBytes));
    }

    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    /** @type {Map<WebSocket, { role: string, identity: object }>} */
    this.conns = new Map();
    this.dirty = false;
    this.lastVersionAt = Date.now();
    this.lastActivityAt = Date.now();

    // ----- Doc update handler -----
    // When a local edit or client-sourced applyUpdate fires, broadcast the
    // update to every other client on this instance and relay it via Redis
    // so other instances see it too.  Updates that originated from Redis
    // are skipped to avoid pub/sub loops.
    this._onDocUpdate = (update, origin) => {
      if (origin === 'redis') return;
      // Broadcast to same-instance peers
      this.broadcastBuffer(encodeSyncMessage(syncProtocol.writeUpdate, update));
      // Relay to other instances via Redis
      this.dirty = true;
      publishMessage(this.docId, 'update', {
        update: Buffer.from(update).toString('base64'),
      });
    };
    // Register AFTER the snapshot load above so the initial apply doesn't
    // trigger a pointless Redis publish.
    this.doc.on('update', this._onDocUpdate);

    // ----- Redis cross-instance relay -----
    this.unsubscribe = subscribeToDocument(docId, (msg) => {
      try {
        if (msg.kind === MESSAGE_KINDS.UPDATE) {
          const update = new Uint8Array(Buffer.from(msg.update, 'base64'));
          // Apply with origin 'redis' so _onDocUpdate skips the loop.
          Y.applyUpdate(this.doc, update, 'redis');
          // Manually broadcast to same-instance clients (the handler skips redis).
          this.broadcastBuffer(encodeSyncMessage(syncProtocol.writeUpdate, update));
        } else if (msg.kind === MESSAGE_KINDS.AWARENESS) {
          const aw = new Uint8Array(Buffer.from(msg.awareness, 'base64'));
          awarenessProtocol.applyAwarenessUpdate(this.awareness, aw, 'redis');
          this.broadcastBuffer(wrapAwareness(aw));
        } else if (msg.kind === MESSAGE_KINDS.APPLY_SNAPSHOT) {
          this.applySnapshotHotSwap(Buffer.from(msg.update, 'base64'));
        }
      } catch (err) {
        console.error(`[room ${docId}] relay error:`, err.message);
      }
    });
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  /* ---------------- connections ---------------- */

  join(ws, meta) {
    this.conns.set(ws, meta);
    this.touch();

    // y-websocket wire format: [outerType=0, innerSyncType=0, stateVector]
    ws.send(encodeSyncMessage(syncProtocol.writeSyncStep1, this.doc), { binary: true });

    // Share existing presence states with the newcomer.
    const states = [...this.awareness.getStates().keys()];
    if (states.length > 0) {
      ws.send(
        wrapAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)),
        { binary: true }
      );
    }

    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.leave(ws));
    ws.on('error', () => this.leave(ws));
  }

  leave(ws) {
    const meta = this.conns.get(ws);
    if (!meta) return;
    this.conns.delete(ws);
    this.touch();
    if (meta.identity?.userId) {
      const removed = awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [meta.identity.userId],
        null
      );
      if (removed?.length > 0) {
        this.broadcastBuffer(
          wrapAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, removed))
        );
      }
    }
  }

  /**
   * All incoming WebSocket messages arrive in the y-websocket outer format:
   *   [varUint: outerType, ...]
   *
   * outerType 0 = messageSync  → inner payload is a y-protocols sync message
   * outerType 1 = messageAwareness
   *
   * For sync messages the inner format is:
   *   [varUint: syncSubType, ...]
   *   syncSubType 0 = syncStep1  (state vector request)
   *   syncSubType 1 = syncStep2  (state update)
   *   syncSubType 2 = update     (incremental delta)
   *
   * readSyncMessage expects the decoder to be positioned at the inner
   * syncSubType — so we must consume the outer type first.
   */
  handleMessage(ws, data) {
    this.touch();
    let buf;
    try {
      // Node.js ws delivers Buffer instances which may be slices of a larger
      // pool ArrayBuffer. Using data.buffer directly creates a view over the
      // entire pool (including bytes before/after the actual message), causing
      // the decoder to read garbage and throw "Unexpected end of array".
      // Constructing a new Uint8Array from the TypedArray copies only the
      // actual message bytes.
      buf = new Uint8Array(data instanceof ArrayBuffer ? data : data);
    } catch {
      return this.reject(ws, 'Malformed message');
    }
    if (!this.conns.has(ws)) return;

    try {
      const probe = decoding.createDecoder(buf);
      const outerType = decoding.readVarUint(probe);

      // ---- Awareness ----
      if (outerType === MESSAGE_AWARENESS) {
        const aw = decoding.readVarUint8Array(probe);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, aw, ws);
        // Forward the raw framed message to other clients (already has outer type).
        this.broadcastBuffer(buf, ws);
        publishMessage(this.docId, 'awareness', {
          awareness: Buffer.from(aw).toString('base64'),
        });
        return;
      }

      // ---- Sync ----
      if (outerType === MESSAGE_SYNC) {
        const syncType = decoding.readVarUint(probe);
        // Only EDITOR / OWNER may send syncStep2 / update messages — both
        // mutate document state (subtype 2 is what incremental edits travel on).
        if ((syncType === SYNC_STEP2_UPDATE || syncType === SYNC_UPDATE) && !canEditRole(this.conns.get(ws)?.role)) {
          return this.reject(ws, 'Viewers cannot edit');
        }

        // Create a fresh decoder positioned at the start of buf.
        // Consume the outer messageSync type, then let readSyncMessage
        // handle the inner sync sub-type + payload.
        const decoder = decoding.createDecoder(buf);
        decoding.readVarUint(decoder); // consume outer type (0)

        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC); // outer wrapper for reply
        syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, ws);
        if (encoding.length(replyEncoder) > 1) {
          this.send(ws, encoding.toUint8Array(replyEncoder));
        }
        // No manual publish needed here — the doc 'update' event handler
        // (_onDocUpdate) takes care of broadcasting + Redis relay.
        return;
      }
    } catch (err) {
      console.error(`[room ${this.docId}] message error:`, err.message);
    }
  }

  reject(ws, reason) {
    try {
      ws.close(4003, reason);
    } catch {
      /* already closed */
    }
  }

  send(ws, bytes) {
    if (ws.readyState === 1 /* OPEN */) ws.send(bytes, { binary: true });
  }

  broadcastBuffer(bytes, exceptWs = null) {
    for (const [ws] of this.conns) {
      if (ws !== exceptWs) this.send(ws, bytes);
    }
  }

  /* ---------------- version restore hot-swap ---------------- */

  applySnapshotHotSwap(snapshotBytes) {
    const oldDoc = this.doc;
    const newDoc = new Y.Doc({ guid: this.docId });
    Y.applyUpdate(newDoc, new Uint8Array(snapshotBytes));
    // Re-register the update handler on the new doc instance.
    newDoc.on('update', this._onDocUpdate);
    this.doc = newDoc;
    this.dirty = true;
    // Detach handler from old doc before destroying.
    oldDoc.off('update', this._onDocUpdate);
    oldDoc.destroy();

    // Push the full state to every connected client with proper framing.
    this.broadcastBuffer(
      encodeSyncMessage(syncProtocol.writeUpdate, Y.encodeStateAsUpdate(newDoc))
    );
  }

  /* ---------------- persistence ---------------- */

  async persist() {
    if (!this.dirty || this.conns.size === 0) return;
    await this._persistLocked();
  }

  /**
   * Final flush used by the sweeper right before an idle room is evicted.
   * Unlike persist(), it intentionally runs when the room is empty — that is
   * exactly the moment unsaved edits would otherwise be destroyed (everyone
   * left, `dirty` still true, destroy() drops the in-memory doc).
   */
  async finalFlush() {
    if (!this.dirty) return;
    await this._persistLocked();
  }

  async _persistLocked() {
    this.dirty = false;

    if (!(await acquireLock(this.docId))) return;

    const snapshot = Buffer.from(Y.encodeStateAsUpdate(this.doc));
    try {
      await persistSnapshot({
        docId: this.docId,
        snapshot,
        stateVector: Buffer.from(Y.encodeStateVector(this.doc)),
      });

      if (Date.now() - this.lastVersionAt >= VERSION_INTERVAL_MS) {
        this.lastVersionAt = Date.now();
        const title = await getDocumentTitle(this.docId);
        await createVersionSnapshot({
          docId: this.docId,
          snapshot,
          title,
        });
      }
    } catch (err) {
      this.dirty = true;
      console.error(`[room ${this.docId}] snapshot save failed:`, err.message);
    }
  }

  get isEmpty() {
    return this.conns.size === 0;
  }

  destroy() {
    try {
      this.unsubscribe?.();
      this.awareness.destroy();
      this.doc.off('update', this._onDocUpdate);
      this.doc.destroy();
      releaseLock(this.docId).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

function canEditRole(role) {
  return role === 'OWNER' || role === 'EDITOR';
}

/* ---------------- registry ---------------- */

const rooms = new Map();

// In-flight room creations, keyed by docId. Without memoizing, two
// simultaneous handshakes for the same document both await
// getDocumentSnapshot() and then both construct a Room; the second
// rooms.set() overwrites the first, whose Redis subscription and doc are
// then leaked forever (never destroyed, still applying relayed updates).
const pendingRooms = new Map();

export async function getOrCreateRoom(docId) {
  const existing = rooms.get(docId);
  if (existing) return existing;

  let pending = pendingRooms.get(docId);
  if (!pending) {
    pending = (async () => {
      const snapshot = await getDocumentSnapshot(docId);
      if (!snapshot) {
        const exists = await getDocumentTitle(docId);
        if (exists === null) {
          const err = new Error('Document not found');
          err.statusCode = 404;
          throw err;
        }
      }
      return new Room(docId, snapshot);
    })()
      .then((room) => {
        // Another creation may have won the slot in the meantime — keep
        // exactly one room per document and discard the duplicate.
        const current = rooms.get(docId);
        if (current) {
          room.destroy();
          return current;
        }
        rooms.set(docId, room);
        return room;
      })
      .finally(() => {
        pendingRooms.delete(docId);
      });
    pendingRooms.set(docId, pending);
  }
  return pending;
}

export function listRooms() {
  return [...rooms.keys()];
}

export function roomStats() {
  let conns = 0;
  for (const room of rooms.values()) conns += room.conns.size;
  return { rooms: rooms.size, connections: conns };
}

// Periodic persistence + idle-room eviction.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [docId, room] of rooms) {
    room.persist().catch(() => {});
    if (room.isEmpty && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS) {
      // Final flush BEFORE destroy: persist() skips empty rooms, so without
      // this the last edits made just before everyone left would be lost.
      room.finalFlush().finally(() => {
        room.destroy();
        rooms.delete(docId);
      });
    }
  }
}, PERSIST_INTERVAL_MS);
sweeper.unref();
