/**
 * Start the sync service in load-test mode, cross-platform.
 *
 * Why a launcher instead of `PERF_TEST=1 node sync-service/src/server.js`:
 * npm scripts run under cmd.exe on Windows, where that prefix is a syntax
 * error. This also writes a pid file, which is exactly what the chaos harness
 * needs to kill the instance mid-session.
 *
 *   node perf/start-sync.mjs                 # PERF_TEST=1 + stubbed Clerk auth
 *   node perf/start-sync.mjs --real-clerk     # PERF_TEST=1, real Clerk JWTs
 *   node perf/start-sync.mjs --port 1235 --pid-file perf/.sync2.pid
 *
 * Ctrl+C stops the service (the launcher forwards the signal).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.SYNC_PORT ?? '1234' },
    'pid-file': { type: 'string', default: resolve(__dirname, '.sync.pid') },
    // Synonyms: both keep real Clerk JWT verification (no stub).
    'real-clerk': { type: 'boolean', default: false },
    'no-stub': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const env = {
  ...process.env,
  PERF_TEST: '1',
  SYNC_PORT: values.port,
};
if (!values['real-clerk'] && !values['no-stub']) env.PERF_TEST_STUB_CLERK = '1';

console.log(
  `starting sync service on :${values.port} with PERF_TEST=1` +
    (env.PERF_TEST_STUB_CLERK ? ' PERF_TEST_STUB_CLERK=1 (no real JWTs needed)' : '')
);

const child = spawn(process.execPath, ['sync-service/src/server.js'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

mkdirSync(dirname(values['pid-file']), { recursive: true });
writeFileSync(values['pid-file'], String(child.pid));
console.log(`pid ${child.pid} written to ${values['pid-file']}`);

const stop = () => {
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(143);
});

child.on('exit', (code, signal) => {
  console.log(`sync service exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
  process.exit(code ?? 0);
});
