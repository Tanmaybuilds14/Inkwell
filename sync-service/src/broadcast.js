import Redis from 'ioredis';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';

/**
 * Redis pub/sub relay — lets every sync-service instance share one logical
 * "room" per document across horizontally-scaled instances (PRD Journey 8).
 *
 * Message envelope: { origin, docId, kind, payload }
 *   kind: 'update'         → base64 Yjs update
 *         'awareness'      → base64 awareness update
 *         'apply-snapshot' → version restore hot-swap
 */
const INSTANCE_ID = `inst-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export const channelFor = (docId) => `inkwell:doc:${docId}`;

let sub = null;
let pub = null;

function getSub() {
  if (!sub) {
    sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    sub.on('error', (err) => console.error('[redis] subscriber error:', err.message));
  }
  return sub;
}

function getPub() {
  if (!pub) {
    pub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    pub.on('error', (err) => console.error('[redis] publisher error:', err.message));
  }
  return pub;
}

/**
 * Subscribes this instance to a document channel. onMessage(docId, message)
 * is invoked for every remote message (own messages are filtered by origin).
 */
export function subscribeToDocument(docId, onMessage) {
  const s = getSub();
  s.subscribe(channelFor(docId)).catch((err) =>
    console.error(`[redis] subscribe failed for ${docId}:`, err.message)
  );
  const handler = (channel, raw) => {
    if (channel !== channelFor(docId)) return;
    try {
      const msg = JSON.parse(raw);
      if (msg.origin === INSTANCE_ID) return; // ignore our own broadcasts
      onMessage(msg);
    } catch {
      // Malformed payload — ignore rather than crash the instance.
    }
  };
  s.on('message', handler);
  return () => {
    s.off('message', handler);
    s.unsubscribe(channelFor(docId)).catch(() => {});
  };
}

export function publishMessage(docId, kind, payload) {
  return getPub().publish(
    channelFor(docId),
    JSON.stringify({ origin: INSTANCE_ID, docId, kind, ...payload })
  );
}

/** Convenience wrappers used by rooms.js */
export function publishUpdate(docId, updateB64) {
  return publishMessage(docId, 'update', { update: updateB64 });
}

export function publishAwareness(docId, awarenessB64) {
  return publishMessage(docId, 'awareness', { awareness: awarenessB64 });
}

export function publishSnapshotApply(docId, snapshotB64) {
  return publishMessage(docId, 'apply-snapshot', { update: snapshotB64 });
}

export { encodeStateAsUpdate, applyUpdate };
