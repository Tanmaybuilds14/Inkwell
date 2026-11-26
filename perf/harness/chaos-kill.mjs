/**
 * S4 — instance-kill resilience ("what happens when an instance dies mid-session").
 *
 * Three acts:
 *   1. N virtual editors join one document and type continuously, every token
 *      tagged `k<index>-<seq>` so loss is countable afterwards.
 *   2. After --kill-after seconds the sync instance is SIGKILLed — either one
 *      this script spawned itself (--spawn) or a process it was told about
 *      (--pid / --pid-file).
 *   3. Clients keep typing (offline edits), detect the close and reconnect with
 *      backoff. The harness then reports:
 *        - detection:    kill → client noticed               (p50/p97/p99)
 *        - reconnect:    kill → session usable again         (p50/p97/p99)
 *        - loss:         tokens typed BEFORE the kill that are gone afterwards
 *        - offline sync: tokens typed while disconnected that other clients see
 *        - convergence:  every reconnected client holds the same document text
 *
 * SIGKILL is deliberate: nothing gets to flush, so the result includes the real
 * cost of the 5s persistence interval and of clients re-pushing their state.
 *
 * Examples
 *   node perf/harness/chaos-kill.mjs --doc <id> --clients 20 --kill-after 15 --spawn
 *   node perf/harness/chaos-kill.mjs --doc <id> --pid-file perf/.sync.pid --restart-cmd "npm run dev:sync"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SyncClient } from '../lib/yclient.mjs';
import { summarize, table, tally } from '../lib/stats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { values } = parseArgs({
  options: {
    // No default: when unset it is derived from --port, so `--spawn --port N`
    // is enough (a hard-coded default here kept the health check pointed at
    // 1234 while the service listened elsewhere).
    url: { type: 'string' },
    docs: { type: 'string', default: resolve(ROOT, 'perf/.perf-docs.json') },
    doc: { type: 'string' },
    clients: { type: 'string', default: '20' },
    'kill-after': { type: 'string', default: '15' },
    'edit-interval': { type: 'string', default: '400' },
    'recover-timeout': { type: 'string', default: '45' },
    settle: { type: 'string', default: '4' },
    token: { type: 'string', default: 'perf-token' },
    pid: { type: 'string' },
    'pid-file': { type: 'string' },
    spawn: { type: 'boolean', default: false },
    'no-restart': { type: 'boolean', default: false },
    'restart-cmd': { type: 'string' },
    port: { type: 'string', default: '1234' },
    json: { type: 'string' },
    'fail-on-loss': { type: 'boolean', default: false },
    'no-fail': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const docId = values.doc ?? firstSeededDoc();
if (!docId) {
  console.error('No document. Run `node perf/seed.mjs` first, or pass --doc <documentId>.');
  process.exit(1);
}

const cfg = {
  // Default to the port we manage, so --port alone is enough for spawn mode.
  url: values.url ?? `ws://localhost:${values.port}`,
  clients: Math.max(1, Number(values.clients)),
  killAfterMs: Number(values['kill-after']) * 1000,
  editIntervalMs: Math.max(50, Number(values['edit-interval'])),
  recoverTimeoutMs: Number(values['recover-timeout']) * 1000,
  settleMs: Number(values.settle) * 1000,
  token: values.token,
};

const owned = { child: null };
process.on('SIGINT', () => {
  stopOwned();
  process.exit(130);
});

await main();

/* --------------------------------------------------------------------- */

async function main() {
  const startedAt = new Date();
  let target = null;
  try {
    target = await resolveTarget();
  } catch (err) {
    console.error(`could not start or reach the instance: ${err.message}`);
    stopOwned();
    process.exit(1);
  }
  if (!target) {
    console.error('No target instance: pass --spawn (or --pid / --pid-file).');
    process.exit(1);
  }

  console.log(
    `chaos: killing pid ${target.pid} after ${cfg.killAfterMs / 1000}s with ` +
      `${cfg.clients} editors on ${docId}`
  );

  const clients = [];
  const closeCodes = [];
  for (let i = 0; i < cfg.clients; i++) {
    const client = new SyncClient({
      url: cfg.url,
      docId,
      token: `${cfg.token}-${i}`,
      name: `Chaos User ${i}`,
    });
    client.index = i;
    client.seq = 0;
    client.issuedBeforeKill = 0;
    client.issuedOffline = 0;
    client.killing = false;
    client.killAt = null;
    client.detectedMs = null;
    client.reconnectedMs = null;
    client.reconnectResult = null;
    client.on('close', (code) => {
      closeCodes.push(code);
      if (client.killing && client.killAt !== null && client.detectedMs === null) {
        client.detectedMs = performance.now() - client.killAt;
      }
    });
    clients.push(client);
  }

  const tokenRegex = (i) => new RegExp(`k${i}-\\d+`, 'g');
  const failures = [];
  await Promise.all(
    clients.map(async (c) => {
      try {
        await c.connect();
        c.timer = setInterval(() => {
          if (!c.connected) c.issuedOffline += 1;
          c.type(`k${c.index}-${++c.seq} `);
        }, cfg.editIntervalMs);
      } catch (err) {
        failures.push({ index: c.index, error: err.message });
      }
    })
  );

  const live = clients.filter((c) => c.metrics.connectMs !== null);
  console.log(
    `connected ${live.length}/${cfg.clients} editors; typing for ${cfg.killAfterMs / 1000}s`
  );
  await sleep(cfg.killAfterMs);

  // ---- act 2: kill ----
  const killAt = performance.now();
  for (const c of live) {
    c.killing = true;
    c.killAt = killAt;
    c.issuedBeforeKill = c.seq;
  }
  const killed = kill(target.pid);
  console.log(
    killed
      ? `SIGKILL sent to pid ${target.pid} at ${new Date().toISOString()}`
      : `FAILED to kill pid ${target.pid} at ${new Date().toISOString()} — nothing was actually tested`
  );

  if (target.restart) {
    await sleep(500);
    target.restart();
  }

  // ---- act 3: detect, reconnect, keep typing offline ----
  await Promise.all(
    live.map(async (c) => {
      const result = await c.reconnect({ timeoutMs: cfg.recoverTimeoutMs });
      c.reconnectResult = result;
      c.reconnectedMs = performance.now() - killAt;
    })
  );

  await sleep(cfg.settleMs);
  for (const c of clients) clearInterval(c.timer);

  // ---- measure ----
  const reconnected = live.filter((c) => c.connected);
  const texts = reconnected.map((c) => c.text());
  const converged = new Set(texts).size <= 1;

  const perClient = reconnected.map((c) => {
    const tokens = [...c.text().matchAll(tokenRegex(c.index))].map((m) => m[0]);
    const survived = tokens.filter((t) => Number(t.split('-')[1]) <= c.issuedBeforeKill).length;
    const laterTokens = tokens.filter((t) => Number(t.split('-')[1]) > c.issuedBeforeKill);
    laterTokens.pop(); // in-flight token typed right after the flag flipped
    const seenByOthers = laterTokens.filter((t) =>
      texts.some((other, idx) => idx !== reconnected.indexOf(c) && other.includes(t))
    ).length;
    return {
      index: c.index,
      issuedBeforeKill: c.issuedBeforeKill,
      issuedOffline: c.issuedOffline,
      issuedTotal: c.seq,
      survivedBeforeKill: survived,
      lostBeforeKill: Math.max(0, c.issuedBeforeKill - survived),
      offlineTokensSeenByOthers: seenByOthers,
      detectedMs: round(c.detectedMs),
      reconnectedMs: round(c.reconnectedMs),
      reconnectAttempts: c.reconnectResult?.attempts ?? null,
      reconnected: c.connected,
      error: c.reconnectResult?.ok ? null : c.reconnectResult?.error,
    };
  });

  const detection = live.map((c) => c.detectedMs).filter((v) => Number.isFinite(v));
  const recoveries = reconnected.map((c) => c.reconnectedMs).filter((v) => Number.isFinite(v));
  const loss = perClient.reduce((a, c) => a + c.lostBeforeKill, 0);
  const offlineSynced = perClient.reduce((a, c) => a + c.offlineTokensSeenByOthers, 0);

  const summary = {
    scenario: 'chaos-kill',
    killSucceeded: killed,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    target: { url: cfg.url, pid: target.pid, mode: target.mode },
    documentId: docId,
    config: cfg,
    clients: {
      requested: cfg.clients,
      connected: live.length,
      reconnected: reconnected.length,
      failedConnect: failures.length,
      closesByCode: tally(closeCodes),
    },
    metrics: {
      detectionMs: summarize(detection),
      reconnectMs: summarize(recoveries),
      reconnectAttempts: summarize(
        reconnected.map((c) => c.reconnectResult?.attempts ?? 0),
        { unit: 'attempts' }
      ),
      converged,
      distinctTextsAfterRecovery: new Set(texts).size,
      lostEditsBeforeKill: loss,
      offlineEditsSynced: offlineSynced,
      totalIssued: perClient.reduce((a, c) => a + c.issuedTotal, 0),
    },
    verdict: {
      converged,
      allReconnected: reconnected.length === live.length,
      zeroLoss: loss === 0,
    },
    perClient,
    failureSamples: failures.slice(0, 10),
  };
  summary.verdict.ok =
    killed &&
    summary.verdict.converged &&
    summary.verdict.allReconnected &&
    (values['fail-on-loss'] ? loss === 0 : true);

  print(summary);
  writeJson(values.json ?? resolve(ROOT, `perf/results/chaos-kill-${stamp()}.json`), summary);

  for (const c of clients) c.destroy();
  stopOwned();
  const code = summary.verdict.ok || values['no-fail'] ? 0 : 1;
  // Let the event loop drain first (process.exit() while sockets are closing
  // trips a libuv assertion on Windows), with a bounded force-exit guard so a
  // stray handle cannot leave the harness hanging after it printed results.
  setTimeout(() => process.exit(code), 1_000).unref();
  process.exitCode = code;
}

/* ----------------------------- target ------------------------------ */

async function resolveTarget() {
  if (values.pid || values['pid-file']) {
    const pid = Number(values.pid ?? readFileSync(values['pid-file'], 'utf8').trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      pid,
      mode: 'attached',
      restart: values['restart-cmd']
        ? () => {
            const child = spawn(values['restart-cmd'], {
              shell: true,
              cwd: ROOT,
              detached: true,
              stdio: 'ignore',
            });
            child.unref();
            console.log(`restart command launched: ${values['restart-cmd']}`);
          }
        : null,
    };
  }

  if (!values.spawn) return null;

  const child = spawnService();
  await waitForHealth(20_000);
  owned.child = child;
  return {
    pid: child.pid,
    mode: 'spawned',
    restart: values['no-restart']
      ? null
      : () => {
          const next = spawnService();
          owned.child = next;
          waitForHealth(20_000)
            .then(() => console.log(`service restarted (pid ${next.pid})`))
            .catch((err) => console.error(`service did not come back: ${err.message}`));
        },
  };
}

function spawnService() {
  const env = {
    ...process.env,
    PERF_TEST: '1',
    PERF_TEST_STUB_CLERK: '1',
    SYNC_PORT: values.port,
  };
  const child = spawn(process.execPath, ['sync-service/src/server.js'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  console.log(`spawned sync service (pid ${child.pid}) with PERF_TEST=1 PERF_TEST_STUB_CLERK=1`);
  return child;
}

async function waitForHealth(timeoutMs) {
  const httpUrl = cfg.url.replace(/^ws/, 'http');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${httpUrl}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`service not healthy within ${timeoutMs}ms`);
}

function kill(pid) {
  try {
    // On Windows 'SIGKILL' maps to TerminateProcess — still a hard kill.
    process.kill(pid, 'SIGKILL');
    return true;
  } catch (err) {
    console.error(`could not kill pid ${pid}: ${err.message}`);
    if (err.code === 'ESRCH') {
      console.error(
        '  That pid does not exist as a native process. On Windows a pid captured from\n' +
        "  a shell's $! is an MSYS pid — use the file written by perf/start-sync.mjs,\n" +
        '  or run this harness with --spawn so it manages the instance itself.'
      );
    }
    return false;
  }
}

function stopOwned() {
  if (!owned.child) return;
  try {
    owned.child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  owned.child = null;
}

/* ----------------------------- output ------------------------------ */

function print(s) {
  console.log('\n=== results ===');
  console.log(
    table([
      { metric: 'kill → detected (ms)', summary: s.metrics.detectionMs },
      { metric: 'kill → reconnected (ms)', summary: s.metrics.reconnectMs },
      { metric: 'reconnect attempts', summary: s.metrics.reconnectAttempts },
    ])
  );
  const closes = Object.entries(s.clients.closesByCode ?? {});
  console.log(
    `\nclients: ${s.clients.connected} connected, ${s.clients.reconnected} reconnected after the kill` +
      (s.clients.failedConnect ? `, ${s.clients.failedConnect} failed to connect` : '')
  );
  if (closes.length > 0) {
    console.log(
      `socket closes: ${closes.map(([code, n]) => `${code}=${n}`).join(', ')} ` +
        '(1006 = killed instance; 44xx = rejected at the handshake)'
    );
  }
  console.log(
    `converged: ${s.metrics.converged ? 'yes' : 'NO'} ` +
      `(${s.metrics.distinctTextsAfterRecovery} distinct document states among reconnected clients)`
  );
  console.log(
    `edits lost from BEFORE the kill: ${s.metrics.lostEditsBeforeKill} of ${s.metrics.totalIssued} issued`
  );
  console.log(`offline edits later visible to other clients: ${s.metrics.offlineEditsSynced}`);
  console.log(
    `\nverdict: ${s.verdict.ok ? 'PASS' : 'FAIL'} — converged=${s.verdict.converged}, ` +
      `allReconnected=${s.verdict.allReconnected}, zeroLoss=${s.verdict.zeroLoss}`
  );
  if (s.killSucceeded === false) {
    console.log(
      'INVALID RUN: the instance was never killed, so nothing about resilience was\n' +
      'measured — treat every number above as "the instance stayed up".'
    );
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

function firstSeededDoc() {
  try {
    const parsed = JSON.parse(readFileSync(values.docs, 'utf8'));
    return parsed.docs?.[0];
  } catch {
    return null;
  }
}

// Functions rather than consts: the top-level `await main()` runs before the
// statements below it are evaluated, and main() uses these early.
function round(v) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
