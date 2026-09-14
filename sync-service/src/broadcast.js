import Redis from 'ioredis';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';

/**
 * Message-kind constants shared (by value) with src/lib/redis.js.
 * Both deployables cannot share a literal module, so the string values must
 * stay identical — cross-reference: src/lib/redis.js
 */
export const MESSAGE_KINDS = {
  UPDATE: 'update',
  AWARENESS: 'awareness',
  APPLY_SNAPSHOT: 'apply-snapshot',
};

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
const subscriptions = new Map(); // channel → Set<handler>

function getSub() {
  if (!sub) {
    sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    sub.on('error', (err) => console.error('[redis] subscriber error:', err.message));
    sub.on('close', () => {
      sub = null;
    });
    sub.on('ready', () => {
      // Re-subscribe all tracked channels and re-register handlers after
      // the connection was dropped and a new client was created.
      for (const [channel, handlers] of subscriptions) {
        sub.subscribe(channel).catch((err) =>
          console.error(`[redis] re-subscribe failed for ${channel}:`, err.message)
        );
        for (const h of handlers) sub.on('message', h);
      }
    });
  }
  return sub;
}

function getPub() {
  if (!pub) {
    pub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    pub.on('error', (err) => console.error('[redis] publisher error:', err.message));
    pub.on('close', () => { pub = null; });
  }
  return pub;
}

/**
 * Subscribes this instance to a document channel. onMessage(docId, message)
 * is invoked for every remote message (own messages are filtered by origin).
 */
export function subscribeToDocument(docId, onMessage) {
  const channel = channelFor(docId);
  const s = getSub();
  const handler = (ch, raw) => {
    if (ch !== channel) return;
    try {
      const msg = JSON.parse(raw);
      if (msg.origin === INSTANCE_ID) return;
      onMessage(msg);
    } catch {
      // Malformed payload — ignore rather than crash the instance.
    }
  };
  if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
  subscriptions.get(channel).add(handler);
  s.subscribe(channel).catch((err) =>
    console.error(`[redis] subscribe failed for ${docId}:`, err.message)
  );
  s.on('message', handler);
  return () => {
    subscriptions.get(channel)?.delete(handler);
    if (subscriptions.get(channel)?.size === 0) subscriptions.delete(channel);
    s.off('message', handler);
    s.unsubscribe(channel).catch(() => {});
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
