/**
 * S1/S2 — concurrent-editor stress harness.
 *
 * Answers "how many collaborative users can ONE sync-service instance serve?"
 * by opening real Yjs sessions (see perf/lib/yclient.mjs) that behave like
 * editors: they type in batches, send awareness frames, and measure the
 * send→broadcast round trip of every batch.
 *
 * Prints p50/p97/p99 for connect latency and update round-trip, then applies
 * the plan's pass/fail rule: p99 RTT <= --sla-p99 (300ms) AND error rate <=
 * --max-error-rate. Exit code 1 when the SLA is missed, so a build/CI job can
 * gate on the result (use --no-fail to always exit 0).
 *
 * Examples
 *   node perf/harness/editors.mjs --clients 50  --rooms 10 --ramp 10 --duration 30
 *   node perf/harness/editors.mjs --clients 500 --rooms 1  --ramp 30 --duration 120   # one huge room
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SyncClient } from '../lib/yclient.mjs';
import { summarize, table, slaVerdict, countAbove, tally } from '../lib/stats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:1234' },
    docs: { type: 'string', default: resolve(ROOT, 'perf/.perf-docs.json') },
    doc: { type: 'string' },
    rooms: { type: 'string', default: '10' },
    clients: { type: 'string', default: '50' },
    ramp: { type: 'string', default: '10' },
    duration: { type: 'string', default: '30' },
    interval: { type: 'string', default: '1500' },
    awareness: { type: 'string', default: '5000' },
    token: { type: 'string', default: 'perf-token' },
    'sla-p99': { type: 'string', default: '300' },
    'max-error-rate': { type: 'string', default: '0.01' },
    json: { type: 'string' },
    name: { type: 'string', default: 'editors' },
    'no-fail': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const cfg = {
  url: values.url,
  rooms: Math.max(1, Number(values.rooms)),
  clients: Math.max(1, Number(values.clients)),
  rampMs: Math.max(0, Number(values.ramp)) * 1000,
  durationMs: Math.max(1, Number(values.duration)) * 1000,
  intervalMs: Math.max(50, Number(values.interval)),
  awarenessMs: Math.max(100, Number(values.awareness)),
  token: values.token,
  slaP99: Number(values['sla-p99']),
  maxErrorRate: Number(values['max-error-rate']),
};

const docIds = resolveDocIds();
if (docIds.length === 0) {
  console.error(
    'No document ids. Run `node perf/seed.mjs` first, or pass --doc <documentId>.'
  );
  process.exit(1);
}

const summary = await run();
const code = summary.verdict.ok || values['no-fail'] ? 0 : 1;
// Let the event loop drain first (calling process.exit() while sockets are
// still closing trips a libuv assertion on Windows), but guarantee a prompt
// exit if some stray handle survives.
setTimeout(() => process.exit(code), 1_000).unref();
process.exitCode = code;

/* --------------------------------------------------------------------- */

async function run() {
  const startedAt = new Date();
  const clients = [];
  const connectLatencies = [];
  const failedConnects = [];
  const closedCodes = [];

  console.log(
    `starting ${cfg.clients} virtual editors across ${Math.min(cfg.rooms, docIds.length)} room(s) ` +
      `at ${cfg.url} — ramp ${cfg.rampMs / 1000}s, steady ${cfg.durationMs / 1000}s`
  );
  const before = await health();

  const stagger = cfg.clients > 1 ? cfg.rampMs / cfg.clients : 0;
  const started = [];

  for (let i = 0; i < cfg.clients; i++) {
    const docId = docIds[i % Math.min(cfg.rooms, docIds.length)];
    const client = new SyncClient({
      url: cfg.url,
      docId,
      token: `${cfg.token}-${i}`,
      name: `Perf User ${i}`,
    });
    client.roomIndex = i % Math.min(cfg.rooms, docIds.length);
    client.index = i;
    client.on('close', (code) => closedCodes.push(code));
    clients.push(client);

    started.push(
      (async () => {
        if (stagger > 0) await sleep(i * stagger);
        try {
          await client.connect();
          connectLatencies.push(client.metrics.connectMs);
          client.edits = 0;
          client.timer = setInterval(() => {
            client.type(`k${client.index}-${++client.edits} `);
          }, cfg.intervalMs + Math.random() * (cfg.intervalMs * 0.5));
          client.awarenessTimer = setInterval(() => coreTick(client), cfg.awarenessMs);
        } catch (err) {
          failedConnects.push({ index: i, docId, error: err.message });
        }
      })()
    );
  }

  await Promise.all(started);
  const rampDoneAt = Date.now();
  console.log(
    `ramp done: ${connectLatencies.length}/${cfg.clients} connected in ${(
      (rampDoneAt - startedAt.getTime()) / 1000
    ).toFixed(1)}s`
  );

  // Steady state. Report progress so a long run is visibly alive.
  const progress = setInterval(() => {
    const connected = clients.filter((c) => c.connected).length;
    const rtt = summarize(clients.flatMap((c) => c.metrics.rtts));
    process.stderr.write(
      `  [${new Date().toISOString().slice(11, 19)}] connected=${connected} ` +
        `rtt p50=${rtt.p50 ?? '-'} p99=${rtt.p99 ?? '-'}\n`
    );
  }, 10_000);

  await sleep(cfg.durationMs);
  clearInterval(progress);

  for (const c of clients) {
    clearInterval(c.timer);
    clearInterval(c.awarenessTimer);
  }

  // Let in-flight echoes land before closing, so the tail is not truncated.
  await sleep(1500);

  const after = await health();
  const rtts = clients.flatMap((c) => c.metrics.rtts);
  const errors = clients.flatMap((c) => c.metrics.errors);
  const totalSends = sum(clients.map((c) => c.metrics.sent));

  const summary = {
    scenario: values.name,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    target: cfg.url,
    config: { ...cfg, docIds: docIds.slice(0, Math.min(cfg.rooms, docIds.length)) },
    clients: {
      requested: cfg.clients,
      connected: connectLatencies.length,
      failed: failedConnects.length,
      stillConnected: clients.filter((c) => c.connected).length,
      closes: closedCodes.length,
      closesByCode: tally(closedCodes),
    },
    metrics: {
      connectMs: summarize(connectLatencies),
      updateRttMs: summarize(rtts),
      updatesSent: totalSends,
      echoesReceived: sum(clients.map((c) => c.metrics.echoes)),
      awarenessFramesIn: sum(clients.map((c) => c.metrics.awarenessIn)),
      remoteUpdatesIn: sum(clients.map((c) => c.metrics.remoteUpdates)),
      errors: errors.length,
      errorRate: totalSends > 0 ? errors.length / totalSends : 0,
      rttAboveSla: countAbove(rtts, cfg.slaP99),
    },
    server: { before, after },
    failureSamples: failedConnects.slice(0, 20),
    errorSamples: errors.slice(0, 20),
  };

  summary.verdict = slaVerdict({
    updateRtt: summary.metrics.updateRttMs,
    errorRate: summary.metrics.errorRate,
    p99LimitMs: cfg.slaP99,
    maxErrorRate: cfg.maxErrorRate,
  });

  print(summary);
  writeJson(values.json ?? resolve(ROOT, `perf/results/${values.name}-${stamp()}.json`), summary);

  for (const c of clients) c.destroy();
  return summary;
}

async function coreTick(client) {
  client.sendAwareness();
}

function print(s) {
  console.log('\n=== results ===');
  console.log(
    table([
      { metric: 'connect (ms)', summary: s.metrics.connectMs },
      { metric: 'update RTT (ms)', summary: s.metrics.updateRttMs },
    ])
  );
  console.log(
    `\nclients: connected ${s.clients.connected}/${s.clients.requested}, ` +
      `failed ${s.clients.failed}, socket closes ${s.clients.closes} ` +
      `${describeCloses(s.clients.closesByCode)}`
  );
  console.log(
    `updates sent ${s.metrics.updatesSent}, echoes ${s.metrics.echoesReceived}, ` +
      `remote updates in ${s.metrics.remoteUpdatesIn}, awareness in ${s.metrics.awarenessFramesIn}`
  );
  console.log(
    `errors ${s.metrics.errors} (rate ${(s.metrics.errorRate * 100).toFixed(3)}%), ` +
      `samples above ${s.config.slaP99}ms: ${s.metrics.rttAboveSla}`
  );
  if (s.server.before || s.server.after) {
    console.log(
      `server rooms/conns: before ${fmtRoom(s.server.before)} → after ${fmtRoom(s.server.after)}`
    );
  }
  console.log(
    `\nverdict: ${s.verdict.ok ? 'PASS' : 'FAIL'} — p99 ${s.verdict.p99 === null ? 'n/a' : `${s.verdict.p99}ms`} ` +
      `(limit ${s.verdict.p99LimitMs}ms), error rate ${(s.verdict.errorRate * 100).toFixed(2)}% ` +
      `(limit ${(s.verdict.maxErrorRate * 100).toFixed(2)}%)`
  );
  if (s.failureSamples.length) {
    console.log('\nconnect failures:');
    for (const f of s.failureSamples) console.log(`  client ${f.index}: ${f.error}`);
  }
  if (s.errorSamples.length) {
    console.log('\nerror samples:');
    for (const e of s.errorSamples) console.log(`  ${e}`);
  }
}

/** "4408=throttled, 4404=not found, 1006=peer gone" — why sessions ended. */
function describeCloses(closesByCode) {
  const entries = Object.entries(closesByCode ?? {});
  if (entries.length === 0) return '';
  const MEANINGS = {
    1000: 'normal close',
    1006: 'peer vanished (kill/network)',
    4400: 'token expired',
    4401: 'invalid token',
    4403: 'no access',
    4404: 'document not found',
    4408: 'throttled — is PERF_TEST=1 set on the service?',
  };
  return `(${entries.map(([code, n]) => `${code}=${n} ${MEANINGS[code] ?? 'unknown'}`).join('; ')})`;
}

function fmtRoom(h) {
  return h ? `${h.rooms ?? '?'} rooms / ${h.connections ?? '?'} conns` : '-';
}

async function health() {
  try {
    const httpUrl = cfg.url.replace(/^ws/, 'http');
    const res = await fetch(`${httpUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = await res.json();
    return { rooms: body.rooms, connections: body.connections };
  } catch {
    return null;
  }
}

function resolveDocIds() {
  if (values.doc) return [values.doc];
  try {
    const parsed = JSON.parse(readFileSync(values.docs, 'utf8'));
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

function writeJson(path, data) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`\nwrote ${path}`);
  } catch (err) {
    console.error(`could not write ${path}: ${err.message}`);
  }
}

// Declared as functions (not consts) so run() can use them: the top-level
// `await run()` executes before the statements below it are evaluated.
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
