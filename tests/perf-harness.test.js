/**
 * Integration test for the performance harness itself (perf/lib/yclient.mjs).
 *
 * The harnesses are only trustworthy if their virtual client really speaks the
 * sync protocol: these tests run the real `Room` (with database and Redis
 * replaced by test doubles, exactly like the other sync-service tests) behind a
 * real WebSocket server and assert the three things the reported numbers depend
 * on:
 *
 *   1. two clients converge, and every edit produces a measurable echo RTT;
 *   2. an instance can be killed mid-session without losing edits — each client
 *      re-pushes its state on reconnect (this is what S4's "zero loss" claims);
 *   3. percentile/summary maths used for p50/p97/p99 is correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { percentile, summarize, slaVerdict } from '../perf/lib/stats.mjs';

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
  getDocumentTitle: vi.fn().mockResolvedValue('Perf Harness Test'),
  persistSnapshot: vi.fn(),
  createVersionSnapshot: vi.fn(),
  getLatestVersionAt: vi.fn().mockResolvedValue(null),
  getDocumentOwnerId: vi.fn().mockResolvedValue('user-1'),
  logActivityEvents: vi.fn(),
}));

const DOC = 'perf-harness-doc';

let Room;
let SyncClient;

beforeEach(async () => {
  vi.resetModules();
  ({ Room } = await import('../sync-service/src/rooms.js'));
  ({ SyncClient } = await import('../perf/lib/yclient.mjs'));
});

/** Start one "instance": HTTP server + upgrade handling wired to a Room. */
async function startInstance({ port = 0, snapshot = null } = {}) {
  const room = new Room(DOC, snapshot);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: 1, roomsList: [DOC], connections: room.conns.size }));
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/ws' || url.searchParams.get('docId') !== DOC) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      room.join(ws, { role: 'OWNER', identity: { userId: 'perf-test', name: 'Perf Test' } });
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actualPort = server.address().port;
  return { room, server, port: actualPort, url: `ws://127.0.0.1:${actualPort}` };
}

/** Hard-stop an instance the way SIGKILL does: sockets drop, nothing flushes. */
async function killInstance(instance) {
  for (const ws of instance.room.conns.keys()) {
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  }
  await new Promise((resolve) => instance.server.close(resolve));
  instance.room.destroy();
}

async function waitFor(predicate, { timeoutMs = 8000, everyMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

describe('perf harness client', () => {
  it('converges two editors and records an echo round-trip per edit', async () => {
    const instance = await startInstance();
    const a = new SyncClient({ url: instance.url, docId: DOC, token: 'a', name: 'A' });
    const b = new SyncClient({ url: instance.url, docId: DOC, token: 'b', name: 'B' });

    try {
      await a.connect();
      await b.connect();

      a.type('k0-1 ');
      a.type('k0-2 ');
      b.type('k1-1 ');

      expect(await waitFor(() => a.metrics.echoes >= 2 && b.metrics.echoes >= 1)).toBe(true);
      expect(await waitFor(() => a.text() === b.text() && a.countTokens(/k\d-\d/g) === 3)).toBe(true);

      expect(a.metrics.rtts.length).toBeGreaterThanOrEqual(2);
      expect(a.metrics.connectMs).toBeGreaterThan(0);
      // Different clients, identical content — and an identical state vector,
      // because both have seen every update.
      expect(a.text()).toBe(b.text());
      expect(a.stateVector()).toBe(b.stateVector());
      expect(a.metrics.errors).toEqual([]);
    } finally {
      a.destroy();
      b.destroy();
      await killInstance(instance);
    }
  }, 20_000);

  it('keeps pre-kill and offline edits and re-syncs them after the instance restarts', async () => {
    const first = await startInstance();
    const port = first.port;
    const a = new SyncClient({ url: first.url, docId: DOC, token: 'a', name: 'A' });

    try {
      await a.connect();
      for (let i = 1; i <= 4; i++) a.type(`k0-${i} `);
      expect(await waitFor(() => a.metrics.echoes >= 4)).toBe(true);

      // ---- kill: the room and its in-memory state are gone, unfushed ----
      let detectedAt = null;
      a.on('close', () => {
        detectedAt = performance.now();
      });
      const killAt = performance.now();
      await killInstance(first);
      expect(await waitFor(() => detectedAt !== null, { timeoutMs: 5000 })).toBe(true);
      expect(detectedAt - killAt).toBeLessThan(5000);

      // ---- offline edits, exactly what a browser keeps locally ----
      a.type('k0-5 ');
      a.type('k0-6 ');

      // ---- restart on the same port; the snapshot never made it to the DB ----
      const second = await startInstance({ port });
      try {
        const recovery = await a.reconnect({ timeoutMs: 8000 });
        expect(recovery.ok).toBe(true);
        expect(a.metrics.connectDurations.length).toBe(2);

        // A fresh client joining the restarted instance must see everything:
        // A re-pushed its state on reconnect, so "zero loss" is real.
        const b = new SyncClient({ url: second.url, docId: DOC, token: 'b', name: 'B' });
        try {
          await b.connect();
          expect(await waitFor(() => b.countTokens(/k0-\d/g) === 6)).toBe(true);
          expect(a.text()).toBe(b.text());
          expect(a.countTokens(/k0-\d/g)).toBe(6);
        } finally {
          b.destroy();
        }
      } finally {
        await killInstance(second);
      }
    } finally {
      a.destroy();
    }
  }, 25_000);
});

describe('perf harness stats', () => {
  it('computes nearest-rank p50/p97/p99', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 97)).toBe(97);
    expect(percentile(samples, 99)).toBe(99);

    const s = summarize(samples);
    expect(s.count).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p97).toBe(97);
    expect(s.p99).toBe(99);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.mean).toBe(50.5);
  });

  it('returns a null summary for no samples', () => {
    expect(summarize([]).p99).toBeNull();
    expect(percentile([], 99)).toBeNull();
  });

  it('applies the SLA rule (p99 and error rate)', () => {
    const baseline = { p99: 120 };
    expect(slaVerdict({ updateRtt: baseline, errorRate: 0 }).ok).toBe(true);
    expect(slaVerdict({ updateRtt: { p99: 420 }, errorRate: 0 }).ok).toBe(false);
    expect(slaVerdict({ updateRtt: baseline, errorRate: 0.05 }).ok).toBe(false);
    expect(slaVerdict({ updateRtt: summarize([]), errorRate: 0 }).latencyOk).toBe(false);
  });
});
