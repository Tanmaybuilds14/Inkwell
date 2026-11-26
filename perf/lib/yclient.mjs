/**
 * Virtual collaborative client for the perf harnesses.
 *
 * Speaks the REAL wire protocol the browser speaks: a y-websocket-framed
 * WebSocket session carrying y-protocols sync messages and Yjs awareness
 * updates, against the same `docId`-scoped rooms the editor connects to. That
 * fidelity is the point — a load generator that only opened sockets would
 * never touch Yjs apply/broadcast, Redis relay or persistence.
 *
 * Framing (mirrors sync-service/src/rooms.js):
 *   [varUint outerType] ...
 *     outerType 0 = sync      → inner y-protocols sync message (step1/step2/update)
 *     outerType 1 = awareness → varUint8Array awareness payload
 *
 * Every update this client sends is tracked by its bytes; the server echoes
 * the same update to every connection in the room (including the sender), so
 * send→echo is a true round-trip measurement through apply + broadcast.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SYNC_UPDATE = 2;
/** Transaction origin used when applying remote bytes — never echoed back. */
const REMOTE_ORIGIN = 'perf-remote';

/** Stable 32-bit-ish hex key for an update's bytes (RTT correlation only). */
const keyOf = (u8) => Buffer.from(u8).toString('hex');

/**
 * Human-readable form of a socket error.
 *
 * Node raises an AggregateError with an EMPTY message when every resolved
 * address fails (e.g. ECONNREFUSED on both ::1 and 127.0.0.1), so a plain
 * `err.message` would report nothing at all — the per-address reasons live in
 * `err.errors`.
 */
export function describeError(err) {
  if (!err) return 'unknown error';
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map((e) => e?.message ?? e?.code ?? String(e)).join('; ');
  }
  return err.code ?? String(err);
}

export class SyncClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.url      ws://host:port (no path/query)
   * @param {string} opts.docId    document = room to join
   * @param {string} [opts.token]  any non-empty string when the service runs
   *                               with PERF_TEST_STUB_CLERK=1; a real Clerk
   *                               JWT otherwise
   * @param {string} [opts.share]  share token (guest path) instead of a JWT
   * @param {string} [opts.name]   display name for awareness
   */
  constructor({ url, docId, token = 'perf-token', share = null, name = 'Perf User' }) {
    super();
    this.url = url;
    this.docId = docId;
    this.token = token;
    this.share = share;
    this.name = name;

    this.doc = new Y.Doc({ guid: docId });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalStateField('user', {
      name,
      color: colorFor(name),
      colorLight: '#ffffff',
    });

    this.ws = null;
    this.connected = false;
    /** updateHex → performance.now() when it was sent (awaiting echo). */
    this.pending = new Map();

    this.metrics = {
      connectMs: null,
      connectDurations: [],
      sent: 0,
      echoes: 0,
      awarenessIn: 0,
      remoteUpdates: 0,
      rtts: [],
      errors: [],
      closes: 0,
      lastCloseCode: null,
    };

    // Local edits (NOT remote applies) are what a browser sends. Setting the
    // pending timestamp before the send means a fast echo can never arrive
    // before the entry exists.
    this._onDocUpdate = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      this.metrics.sent += 1;
      if (this.connected) {
        this.pending.set(keyOf(update), performance.now());
        this._send(encodeSyncMessage(syncProtocol.writeUpdate, update));
      }
    };
    this.doc.on('update', this._onDocUpdate);
  }

  get roomUrl() {
    const query = this.share
      ? `share=${encodeURIComponent(this.share)}`
      : `token=${encodeURIComponent(this.token)}`;
    return `${this.url}/ws?docId=${encodeURIComponent(this.docId)}&${query}`;
  }

  /** Open the socket. Resolves on WebSocket open, rejects on failure/timeout. */
  connect({ timeoutMs = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const ws = new WebSocket(this.roomUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        this.metrics.errors.push(`connect timeout after ${timeoutMs}ms`);
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        reject(new Error(`connect timeout after ${timeoutMs}ms (${this.roomUrl})`));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        const duration = performance.now() - startedAt;
        this.metrics.connectDurations.push(duration);
        // First connect only — reconnects are reported separately.
        if (this.metrics.connectMs === null) this.metrics.connectMs = duration;
        // Opening handshake: state-vector request. The server replies step1 of
        // its own in room.join(), and OUR reply to that carries any offline
        // edits made while disconnected — the y-websocket contract.
        this._send(encodeSyncMessage(syncProtocol.writeSyncStep1, this.doc));
        this.sendAwareness();
        this.emit('open', this);
        resolve(this);
      });

      ws.on('message', (data) => this._onMessage(data));

      ws.on('close', (code) => {
        this.connected = false;
        this.metrics.closes += 1;
        this.metrics.lastCloseCode = code;
        this.emit('close', code);
      });

      ws.on('error', (err) => {
        // 'close' always follows; reject only while still connecting.
        const reason = describeError(err);
        if (!this.connected && this.metrics.connectMs === null) {
          clearTimeout(timer);
          this.metrics.errors.push(`connect error: ${reason}`);
          // Drop the failed socket for good: a rejected connect() must not
          // leave a handle that could still open later and keep the process
          // (or an orphaned session) alive.
          try {
            ws.removeAllListeners();
            ws.terminate();
          } catch {
            /* already gone */
          }
          const failure = new Error(reason);
          failure.cause = err;
          reject(failure);
        } else {
          this.metrics.errors.push(`socket error: ${reason}`);
          this.emit('socket-error', err);
        }
      });
    });
  }

  /**
   * Reconnect until the socket is open again, with capped exponential backoff.
   * Returns how long recovery took (from the first attempt) and how many
   * attempts it needed, which is what the chaos harness reports as p50/p99
   * "time to recover a session".
   */
  async reconnect({ timeoutMs = 30_000, baseDelayMs = 250, maxDelayMs = 2_000, onAttempt } = {}) {
    const startedAt = performance.now();
    let attempts = 0;
    let lastError = null;
    while (performance.now() - startedAt < timeoutMs) {
      attempts += 1;
      onAttempt?.(attempts);
      try {
        await this.connect({ timeoutMs: Math.min(5_000, timeoutMs) });
        return { ok: true, attempts, ms: performance.now() - startedAt };
      } catch (err) {
        lastError = err;
        this.metrics.errors.push(`reconnect ${attempts} failed: ${describeError(err)}`);
        await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempts - 1)));
      }
    }
    return { ok: false, attempts, ms: performance.now() - startedAt, error: lastError?.message };
  }

  close() {
    this.connected = false;
    try {
      this.ws?.close(1000, 'perf done');
    } catch {
      /* ignore */
    }
  }

  destroy() {
    // Terminate rather than close: the harness is finished with this session,
    // and waiting for a close handshake while the peer is already gone (the
    // kill scenario) leaves handles in a half-closed state at process exit.
    try {
      this.ws?.removeAllListeners();
      this.ws?.terminate();
    } catch {
      /* already gone */
    }
    this.connected = false;
    this.doc.off('update', this._onDocUpdate);
    try {
      this.awareness.destroy();
    } catch {
      /* ignore */
    }
    this.doc.destroy();
  }

  /* ------------------------------ traffic ------------------------------ */

  /** Frame and send an awareness update for this client (cursor/presence). */
  sendAwareness() {
    if (!this.connected) return;
    const payload = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
      this.doc.clientID,
    ]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    this._send(encoding.toUint8Array(encoder));
  }

  /**
   * Append `text` to a paragraph in the tiptap-shaped XmlFragment ('default'),
   * i.e. exactly the structure the editor writes. Each call is one "keystroke
   * batch": one local update, one RTT sample when the echo returns.
   */
  type(text) {
    const fragment = this.doc.getXmlFragment('default');
    let last = fragment.length > 0 ? fragment.get(fragment.length - 1) : null;
    let para = last && last.nodeName === 'paragraph' ? last : null;
    if (!para) {
      para = new Y.XmlElement('paragraph');
      fragment.insert(fragment.length, [para]);
    }
    let xmlText = para.length > 0 && para.get(0) instanceof Y.XmlText ? para.get(0) : null;
    if (!xmlText) {
      xmlText = new Y.XmlText();
      para.insert(0, [xmlText]);
    }
    this.doc.transact(() => {
      xmlText.insert(xmlText.length, text);
    });
    return text;
  }

  _send(bytes) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(bytes, { binary: true });
  }

  _onMessage(data) {
    let buf;
    try {
      buf = new Uint8Array(data);
    } catch {
      this.metrics.errors.push('undecodable frame');
      return;
    }
    try {
      const probe = decoding.createDecoder(buf);
      const outer = decoding.readVarUint(probe);

      if (outer === MESSAGE_AWARENESS) {
        const payload = decoding.readVarUint8Array(probe);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, this);
        this.metrics.awarenessIn += 1;
        return;
      }
      if (outer !== MESSAGE_SYNC) return;

      const syncType = decoding.readVarUint(probe);
      if (syncType === SYNC_UPDATE) {
        // Peek (on a copy) to correlate the echo with the send timestamp, then
        // let readSyncMessage apply the frame normally on the original buffer.
        const update = decoding.readVarUint8Array(probe);
        const key = keyOf(update);
        const sentAt = this.pending.get(key);
        if (sentAt !== undefined) {
          this.pending.delete(key);
          this.metrics.echoes += 1;
          this.metrics.rtts.push(performance.now() - sentAt);
        } else {
          this.metrics.remoteUpdates += 1;
        }
      }

      const decoder = decoding.createDecoder(buf);
      decoding.readVarUint(decoder); // outer type
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, REMOTE_ORIGIN);
      // length > 1 means readSyncMessage queued a step2/step1 answer.
      if (encoding.length(reply) > 1) this._send(encoding.toUint8Array(reply));
    } catch (err) {
      this.metrics.errors.push(`decode: ${err.message}`);
    }
  }

  /* ---------------------------- inspection ---------------------------- */

  /** Flattened text of the collaborative document (convergence checking). */
  text() {
    return fragmentText(this.doc.getXmlFragment('default'));
  }

  /** Yjs state vector as hex — clients that share history have equal prefix. */
  stateVector() {
    return Buffer.from(Y.encodeStateVector(this.doc)).toString('hex');
  }

  /** How many `token` occurrences this client can see. */
  countTokens(regex) {
    const text = this.text();
    let n = 0;
    for (const _ of text.matchAll(regex)) n += 1;
    return n;
  }
}

/** Recursively flatten an XmlFragment/XmlElement tree into text. */
export function fragmentText(node) {
  if (node instanceof Y.XmlText) return node.toString();
  let out = '';
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText || child instanceof Y.XmlElement) {
      out += fragmentText(child);
    }
  }
  return node.nodeName === 'paragraph' || node.nodeName === 'heading' ? `${out}\n` : out;
}

/** Just enough framing to build a raw sync-step1 probe (used by tests). */
export function encodeSyncMessage(writeFn, ...args) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  writeFn(encoder, ...args);
  return encoding.toUint8Array(encoder);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function colorFor(seed) {
  const palette = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
