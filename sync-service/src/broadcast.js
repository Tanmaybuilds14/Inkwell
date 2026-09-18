import Redis from 'ioredis';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { warnRateLimited } from './log.js';
import { MESSAGE_KINDS, docChannel } from '../../shared/protocol.js';

// Message kinds and channel naming are the shared wire contract with the
// Next.js publisher — see shared/protocol.js. Re-exported here because
// rooms.js and the tests import them from this module.
export { MESSAGE_KINDS } from '../../shared/protocol.js';

/**
 * Publishing an unrecognised kind used to be a silent no-op on every peer —
 * exactly the class of bug the old "keep these copies in sync" comments were
 * papering over. Assert the kind instead.
 */
const KNOWN_KINDS = new Set(Object.values(MESSAGE_KINDS));

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

let sub = null;
let pub = null;
const subscriptions = new Map(); // channel → Set<handler>

function getSub() {
  if (!sub) {
    sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      // Keep internal command queues unbounded (pub/sub semantics), but stop
      // ioredis from probing availability with its own PINGs — we probe once
      // at startup instead, so a down Redis surfaces as one clear message.
      enableOfflineQueue: true,
      enableAutoPipelining: false,
    });
    sub.on('error', (err) =>
      warnRateLimited('redis-sub', '[redis] subscriber error:', err.message)
    );
    // NOTE: deliberately no `close → sub = null` here. ioredis keeps the
    // client object alive and auto-reconnects it; nulling the handle while
    // the old client still reconnects produces two live subscribers (each
    // remote message delivered twice) and leaked connections.
    sub.on('ready', () => {
      // A fresh connection forgets all pub/sub subscriptions, so re-subscribe
      // every tracked channel. Handlers themselves stay registered on this
      // client instance across reconnects — re-adding them here would make
      // every remote message fan out twice.
      for (const channel of subscriptions.keys()) {
        sub.subscribe(channel).catch((err) =>
          console.error(`[redis] re-subscribe failed for ${channel}:`, err.message)
        );
      }
    });
  }
  return sub;
}

function getPub() {
  if (!pub) {
    pub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      enableAutoPipelining: false,
    });
    pub.on('error', (err) =>
      warnRateLimited('redis-pub', '[redis] publisher error:', err.message)
    );
    // Same reasoning as the subscriber: keep one self-healing client.
  }
  return pub;
}

/**
 * Subscribes this instance to a document channel. onMessage(docId, message)
 * is invoked for every remote message (own messages are filtered by origin).
 */
export function subscribeToDocument(docId, onMessage) {
  const channel = docChannel(docId);
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

/**
 * Fire-and-forget publish. Callers invoke this from hot paths (every doc
 * update) without awaiting or catching, so a failed publish must never
 * surface as an unhandled rejection — that would take the whole process
 * down during a Redis outage. Failures are logged (rate-limited) instead.
 */
export function publishMessage(docId, kind, payload) {
  if (!KNOWN_KINDS.has(kind)) {
    warnRateLimited('publish-kind', `[redis] refusing to publish unknown kind "${kind}"`);
    return Promise.resolve();
  }
  return getPub()
    .publish(
      docChannel(docId),
      JSON.stringify({ origin: INSTANCE_ID, docId, kind, ...payload })
    )
    .catch((err) =>
      warnRateLimited('redis-pub', '[redis] publish failed:', err.message)
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
