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
// Cross-reference: src/lib/redis.js defines the same MESSAGE_KINDS values.
// The Next.js restore route publishes with these kinds via publishToDocument().

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const SYNC_STEP1_REQUEST = 0;
const SYNC_STEP2_UPDATE = 1;

const PERSIST_INTERVAL_MS = 5_000;
const VERSION_INTERVAL_MS = 5 * 60_000;
const EMPTY_ROOM_TTL_MS = 60_000;

// ---- Redis leader lock for cross-instance persistence ----
// Only the instance holding the lock for a docId persists snapshots to DB.
// Uses SET NX PX (plain Redis, not Redlock — fine for a single Redis instance).
// If Redis is ever run in a clustered/HA config, revisit with Redlock.
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

/** Try to acquire or renew the persistence lock for a document. */
export async function acquireLock(docId) {
  try {
    const key = LOCK_KEY_PREFIX + docId;
    const redis = getLockRedis();
    // SET key value NX PX ttl — only sets if key doesn't exist.
    const result = await redis.set(key, INSTANCE_ID, 'PX', LOCK_TTL_MS, 'NX');
    if (result === 'OK') return true;
    // Key exists — check if we own it (renewal).
    const owner = await redis.get(key);
    return owner === INSTANCE_ID;
  } catch {
    // Redis unavailable — don't persist to avoid dual-write risk.
    return false;
  }
}

/** Release the persistence lock (only if we own it). */
export async function releaseLock(docId) {
  try {
    const key = LOCK_KEY_PREFIX + docId;
    const redis = getLockRedis();
    // Atomic check-and-delete: only delete if we still own it.
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await redis.eval(script, 1, key, INSTANCE_ID);
  } catch {
    // Best-effort — lock will expire via TTL anyway.
  }
}

/** Builds a wire message: [type][payload] */
function wrapMessage(type, payloadBytes) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (payloadBytes) encoding.writeVarUint8Array(encoder, payloadBytes);
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

    // Relay remote edits/awareness into this local replica.
    // Cross-reference: src/lib/redis.js — the restore route publishes with
    // kind: MESSAGE_KINDS.APPLY_SNAPSHOT (previously used 'type' field, causing
    // a silent no-op until the field was aligned to 'kind').
    this.unsubscribe = subscribeToDocument(docId, (msg) => {
      try {
        if (msg.kind === MESSAGE_KINDS.UPDATE) {
          const update = new Uint8Array(Buffer.from(msg.update, 'base64'));
          Y.applyUpdate(this.doc, update, 'redis');
          this.broadcastBuffer(wrapMessage(MESSAGE_SYNC, update));
          this.dirty = true;
        } else if (msg.kind === MESSAGE_KINDS.AWARENESS) {
          const aw = new Uint8Array(Buffer.from(msg.awareness, 'base64'));
          awarenessProtocol.applyAwarenessUpdate(this.awareness, aw, 'redis');
          this.broadcastBuffer(wrapMessage(MESSAGE_AWARENESS, aw));
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

    // Ask the client for anything we're missing (standard y-sync handshake).
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder), { binary: true });

    // Share existing presence states with the newcomer.
    const states = [...this.awareness.getStates().keys()];
    if (states.length > 0) {
      ws.send(
        wrapMessage(
          MESSAGE_AWARENESS,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)
        ),
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
      if (removed.length > 0) {
        const msg = wrapMessage(
          MESSAGE_AWARENESS,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, removed)
        );
        this.broadcastBuffer(msg);
      }
    }
  }

  handleMessage(ws, data) {
    this.touch();
    let buf;
    try {
      buf = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer ?? data);
    } catch {
      return this.reject(ws, 'Malformed message');
    }
    if (!this.conns.has(ws)) return;

    try {
      const probe = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(probe);

      if (messageType === MESSAGE_SYNC) {
        const syncType = decoding.readVarUint(probe);
        if (syncType === SYNC_STEP2_UPDATE && !canEditRole(this.conns.get(ws)?.role)) {
          return this.reject(ws, 'Viewers cannot edit');
        }
        if (syncType === SYNC_STEP2_UPDATE) {
          // Extract the actual CRDT delta so we can relay just that.
          const updateBytes = decoding.readVarUint8Array(probe);

          const decoder = decoding.createDecoder(buf);
          decoding.readVarUint(decoder); // outer type
          decoding.readVarUint(decoder); // sync subtype
          decoding.readVarUint8Array(decoder); // consume
          const replyEncoder = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, ws);
          if (encoding.length(replyEncoder) > 1) {
            this.send(ws, encoding.toUint8Array(replyEncoder));
          }

          this.dirty = true;
          publishMessage(this.docId, 'update', {
            update: Buffer.from(updateBytes).toString('base64'),
          });
          return;
        }
        // sync step1 / done: fall through to generic handling below.
      } else if (messageType === MESSAGE_AWARENESS) {
        const decoder = decoding.createDecoder(buf);
        decoding.readVarUint(decoder);
        const aw = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, aw, ws);
        this.broadcastBuffer(buf, ws);
        publishMessage(this.docId, 'awareness', {
          awareness: Buffer.from(aw).toString('base64'),
        });
        return;
      }

      // Generic path (e.g. sync step-1 requests).
      const decoder = decoding.createDecoder(buf);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const replyEncoder = encoding.createEncoder();
        syncProtocol.readSyncMessage(decoder, replyEncoder, this.doc, ws);
        if (encoding.length(replyEncoder) > 1) {
          this.send(ws, encoding.toUint8Array(replyEncoder));
        }
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

  /**
   * Replaces live CRDT state with a stored snapshot and re-syncs connected
   * clients without dropping sockets. Triggered over Redis by the restore API.
   */
  applySnapshotHotSwap(snapshotBytes) {
    const oldDoc = this.doc;
    const newDoc = new Y.Doc({ guid: this.docId });
    Y.applyUpdate(newDoc, new Uint8Array(snapshotBytes));
    this.doc = newDoc;
    this.dirty = true;
    oldDoc.destroy();

    const full = wrapMessage(
      MESSAGE_SYNC,
      new Uint8Array(Y.encodeStateAsUpdate(newDoc))
    );
    this.broadcastBuffer(full);
  }

  /* ---------------- persistence ---------------- */

  async persist() {
    if (!this.dirty || this.conns.size === 0) return;
    this.dirty = false;

    // Only the instance holding the Redis persistence lock writes to DB.
    // Other instances keep relaying live updates via pub/sub (unaffected)
    // but skip the DB write to prevent duplicate/stale snapshots.
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
      // Fail loudly: edits remain in memory + live relay, durable copy stale.
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

export async function getOrCreateRoom(docId) {
  let room = rooms.get(docId);
  if (room) return room;

  const snapshot = await getDocumentSnapshot(docId);
  if (!snapshot) {
    // Distinguish "no such document" from "never edited yet" (NULL snapshot
    // is valid for a brand-new doc; a missing row is not).
    const exists = await getDocumentTitle(docId);
    if (exists === null) {
      const err = new Error('Document not found');
      err.statusCode = 404;
      throw err;
    }
  }

  room = new Room(docId, snapshot);
  rooms.set(docId, room);
  return room;
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
      room.persist().finally(() => {
        room.destroy();
        rooms.delete(docId);
      });
    }
  }
}, PERSIST_INTERVAL_MS);
sweeper.unref();
