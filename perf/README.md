# Inkwell performance tests

Everything needed to load-test Inkwell lives in this folder. Three questions are
answered, all about the **sync service** (the WebSocket/Yjs half of the product)
plus one HTTP baseline for the Next.js app:

1. **How many concurrent collaborative users can ONE sync-service instance serve?**
2. **What happens when an instance is killed mid-session?** (detection, reconnect, leader failover, data loss)
3. **What are the p50 / p97 / p99 latencies** for the operations that matter?

The written test plan (scenarios, rationale, SLA proposal) is in
[docs/perf-test-plan.md](../docs/perf-test-plan.md). This file is the runbook:
what to start, which command to run, and what the output means.

---

## 1. What is in this folder

| Path | What it is |
|---|---|
| `seed.mjs` | Creates the perf fixtures (1 owner user + N documents) and writes their ids to `perf/.perf-docs.json`. A handshake for a document that does not exist is rejected with close code `4404`, so this runs first. |
| `start-sync.mjs` | Starts the sync service with the load-test switches on and writes `perf/.sync.pid`. Cross-platform (no `VAR=value cmd` syntax needed). |
| `harness/editors.mjs` | **S1/S2** - the concurrent-editor stress harness. Real Yjs sessions that type, send awareness frames and measure send-to-broadcast round-trip. Prints p50/p97/p99 and the pass/fail verdict. |
| `harness/chaos-kill.mjs` | **S4** - kills the sync instance mid-session and measures detection, reconnect, convergence and lost edits. |
| `lib/yclient.mjs` | The virtual client: speaks the real y-websocket framing + Yjs sync/awareness protocol against the real rooms. |
| `lib/stats.mjs` | Nearest-rank percentile/table helpers and the SLA verdict used by both harnesses. |
| `artillery/handshake-stress.yml` | **S1 via Artillery** - connection storm: ramps 60 -> 120 -> 300 -> 500 -> 1000 held sockets. |
| `artillery/api-load.yml` | **S3** - HTTP baseline for the Next.js app (landing, sign-in, dashboard, `/api/documents`). |
| `artillery/processors.mjs` | Artillery processor: hands each virtual user a seeded document id and its own token. |
| `results/` | Written by every run (JSON). Gitignored. |

`PERF_TEST=1` is what makes a load generator possible at all - without it the
service throttles you to **30 handshakes per minute per IP** and your test
measures the limiter instead of the product. See section 3.

---

## 2. Prerequisites

- **Node 24** (`node -v`) and the repo installed (`npm install`, plus
  `npm ci --prefix sync-service` if `sync-service/node_modules` is missing).
- **Postgres and Redis.** The bundled ones are the quickest:
  ```bash
  docker compose up -d postgres redis
  ```
  (On Windows: start Docker Desktop first. Without the daemon, `docker compose`
  fails with "failed to connect to the docker API".)
- **`.env`** at the repo root with at least `DATABASE_URL` and `REDIS_URL`
  (copy `.env.example`).
- **Artillery**, only for the two `artillery/` configs:
  ```bash
  npm install -D artillery
  ```
  The two Node harnesses (S2 and S4 - the ones that produce the useful numbers)
  need **no extra dependencies**; they use the repo's existing `yjs`,
  `y-protocols`, `lib0` and `ws`.
- First-time database setup:
  ```bash
  npm run db:deploy     # apply Prisma migrations
  ```
- Run the load generator on a **different machine** from the service under test
  if the numbers have to be defensible. On one box the generator and the
  service compete for the same CPU and every latency percentile inflates.

---

## 3. The load-test switches

Set on the **service** (never on an internet-reachable deployment):

| Variable | Effect |
|---|---|
| `PERF_TEST=1` | Master switch. Bypasses the WebSocket handshake throttle, short-circuits the Next.js API rate limits, and scales every remaining bucket by the multiplier below. Off by default - with it unset, behaviour is identical to production. |
| `PERF_TEST_STUB_CLERK=1` | Requires `PERF_TEST=1`. Skips Clerk JWT verification on the handshake: **any** non-empty `token` authenticates as the document's OWNER with a deterministic `perf_*` identity. This is what lets a load generator connect without a Clerk test instance. |
| `PERF_TEST_RATE_MULTIPLIER` | With `PERF_TEST=1`, multiplies every rate-limit bucket (default `10000`). The handshake throttle is bypassed outright, so this only matters for the HTTP buckets. |

Authorization is untouched by any of them: roles, edit gating, share links and
permissions behave exactly as in production, so the numbers describe the real
product.

---

## 4. Start the stack

**Terminal A - database fixtures (once):**

```bash
npm run perf:seed                 # 20 documents by default
# npm run perf:seed -- --docs 100
# npm run perf:seed -- --clean    # remove the fixtures again
```

| Flag | Default | Meaning |
|---|---|---|
| `--docs N` | 20 | how many documents to create |
| `--clean` | off | delete the perf documents + owner instead of creating |
| `--out PATH` | `perf/.perf-docs.json` | where the ids are written (set `PERF_DOCS_FILE` to match if you move it) |
| `--prefix` | `Perf Doc` | title prefix, used for both create and clean |
| `--clerk-id` / `--email` | `perf_seed_owner` / `perf-owner@example.test` | identity of the perf owner row |
| `--database-url` | `DATABASE_URL` | override the connection string |

**Terminal B - sync service in load-test mode:**

```bash
npm run perf:sync
# same as: node perf/start-sync.mjs   (PERF_TEST=1 PERF_TEST_STUB_CLERK=1, port 1234)
# with real Clerk JWTs:  node perf/start-sync.mjs --real-clerk
```

It prints `[sync] Inkwell sync service listening on :1234` and writes
`perf/.sync.pid`. Check it:

```bash
curl http://localhost:1234/healthz      # {"ok":true,"rooms":0,"connections":0,...}
```

| Flag | Default | Meaning |
|---|---|---|
| `--port N` | `1234` (`SYNC_PORT`) | listen on N |
| `--pid-file PATH` | `perf/.sync.pid` | where the service pid is written (S4 reads it) |
| `--real-clerk` / `--no-stub` | off | keep real Clerk verification instead of the stub; the load generator then needs valid JWTs |

**Terminal C - web app in load-test mode (only for S3):**

```bash
# bash / Git Bash
PERF_TEST=1 npm run dev
# PowerShell
$env:PERF_TEST='1'; npm run dev
```

---

## 5. Running the tests

### S1 - connection storm / handshake ceiling

How many sockets one instance holds, and what the handshake costs (the auth +
DB lookup path). 500 virtual users hold a socket for 60s each.

```bash
npm run perf:s1
npm run perf:s1 -- --output perf/results/s1.json
```

Or use the Node harness, which additionally reports the round-trip of real
edits and prints the verdict (the same harness with a very slow edit cadence is
a pure connection test):

```bash
node perf/harness/editors.mjs --clients 500 --rooms 20 --ramp 30 --duration 60 --interval 60000
```

Read: Artillery's `websocket.messages_*` counters and its connect/response
percentiles; the harness's `connect (ms)` p50/p97/p99 and its `clients.failed`
count.

### S2 - concurrent editors (the "users per instance" number)

Each virtual user is a real Yjs session: it types a batch every `--interval` ms
into a tiptap-shaped `default` XmlFragment, and the server echoes that update to
the whole room, so the measured round-trip includes Yjs apply + broadcast
(+ Redis relay when several instances serve the same document).

```bash
# Config A - one giant room (worst-case fan-out per room)
node perf/harness/editors.mjs --clients 100 --rooms 1 --ramp 10 --duration 60

# Config B - 100 users in 20 rooms of 5 (realistic shared-document shape)
node perf/harness/editors.mjs --clients 100 --rooms 20 --ramp 10 --duration 60

# Ramp the load and stop at the first breach
node perf/harness/editors.mjs --clients 250 --rooms 25 --ramp 20 --duration 120 --interval 2000
node perf/harness/editors.mjs --clients 500 --rooms 25 --ramp 30 --duration 120 --interval 2000
```

Useful flags:

| Flag | Default | Meaning |
|---|---|---|
| `--clients` | 50 | total virtual editors |
| `--rooms` | 10 | how many seeded documents to spread them across |
| `--ramp` | 10 | seconds over which clients start (avoids a synchronised stampede) |
| `--duration` | 30 | seconds of steady state after the ramp |
| `--interval` | 1500 | ms between edit batches per client (1500 is roughly a real typist) |
| `--awareness` | 5000 | ms between presence (cursor) frames |
| `--sla-p99` | 300 | p99 update round-trip limit in ms |
| `--max-error-rate` | 0.01 | error-rate limit |
| `--doc` | - | run against a single document instead of `perf/.perf-docs.json` |
| `--docs` | `perf/.perf-docs.json` | the seed output to read document ids from |
| `--url` | `ws://localhost:1234` | sync service to hit |
| `--token` | `perf-token` | base token string; each client gets `perf-token-<n>` |
| `--name` | `editors` | name used for the result file |
| `--json` | `perf/results/<name>-<ts>.json` | where the full result lands |
| `--no-fail` | off | exit 0 even when the SLA is missed |

Example output:

```text
=== results ===
metric             count  min   mean  p50   p97   p99   max
connect (ms)       100    41.2  96.4  88.1  232.0 301.5 610.2
update RTT (ms)    3480   6.1   21.7  18.4  62.9  141.8 588.0

clients: connected 100/100, failed 0, socket closes 0
updates sent 3480, echoes 3480, remote updates in 0, awareness in 1900
errors 0 (rate 0.000%), samples above 300ms: 0
server rooms/conns: before 0 rooms / 0 conns -> after 20 rooms / 100 conns
verdict: PASS - p99 141.8ms (limit 300ms), error rate 0.00% (limit 1.00%)
```

**How to derive "users per sync instance":** raise `--clients` in steps until
the verdict flips to FAIL - i.e. **p99 update round-trip > `--sla-p99`
(300 ms) or error rate > 1 %**. The last passing step is the number to quote,
together with the room shape (`--rooms`) and cadence (`--interval`), because
fan-out cost depends on **people per room**, not on the global total. Report
both Config A and Config B - they usually differ by a large factor.

While a run is going, watch the process and the database from another terminal:

```bash
curl -s http://localhost:1234/healthz        # rooms / connections, live
# Windows: CPU + RSS of the node processes
powershell -NoProfile "Get-Process node | Select-Object Id,CPU,WorkingSet64"
# Postgres connections
docker compose exec postgres psql -U postgres -d inkwell -c "select count(*) from pg_stat_activity;"
```

Event-loop lag is not exposed by the service; the practical proxies are a p99
that rises at constant CPU, or RSS that grows across a soak run (S5).

### S3 - Next.js HTTP baseline

```bash
npm run perf:s3
npm run perf:s3 -- --output perf/results/s3.json
# signed-in numbers need a Clerk session cookie:
PERF_COOKIE="__session=..." npm run perf:s3      # PowerShell: $env:PERF_COOKIE="__session=..."
```

Without `PERF_COOKIE` the authed scenario measures the redirect/401 path - the
result file records which status codes came back, so do not quote those numbers
as dashboard latency.

### S4 - kill an instance mid-session

Two modes. **Spawn mode** is fully automatic: the harness starts the service,
kills it, restarts it, and measures everything.

```bash
node perf/harness/chaos-kill.mjs --doc <documentId> --clients 20 --kill-after 15 --spawn
```

**Attached mode** kills a service you started yourself (useful when the instance
runs in Docker or under a supervisor). Tell the harness how to bring it back, or
restart it by hand in Terminal B:

```bash
# Terminal B (leave running): npm run perf:sync
node perf/harness/chaos-kill.mjs --doc <documentId> --clients 20 \
  --kill-after 15 --pid-file perf/.sync.pid --restart-cmd "npm run perf:sync"
```

| Flag | Default | Meaning |
|---|---|---|
| `--clients` | 20 | concurrent editors on the document |
| `--kill-after` | 15 | seconds of editing before the SIGKILL |
| `--edit-interval` | 400 | ms between edits per client |
| `--recover-timeout` | 45 | seconds allowed for reconnecting |
| `--settle` | 4 | seconds to wait after reconnecting before comparing documents |
| `--spawn` | off | start (and restart) the instance itself on `--port` |
| `--port` | 1234 | port for `--spawn`; with no `--url`, the target is derived from it |
| `--pid` / `--pid-file` | - | attach to an already-running instance |
| `--restart-cmd` | - | shell command used to bring an attached instance back |
| `--no-restart` | off | kill without restarting (measures detection only) |
| `--fail-on-loss` | off | exit non-zero if any pre-kill edit is missing |
| `--url` / `--doc` / `--docs` / `--token` | as above | target, document and token |
| `--json` / `--no-fail` | as above | result file, exit code |

If the harness cannot signal the pid it prints `FAILED to kill pid ... — nothing
was actually tested`, marks the run `INVALID RUN` and exits non-zero: the
resilience numbers would otherwise describe a run in which the instance never
died. On Windows, a pid captured from a shell's `$!` is an MSYS pid that Node
cannot signal — use `--spawn`, or the pid file `perf/start-sync.mjs` writes.

What the output means:

```text
metric                        count  min    mean   p50    p97     p99     max
kill -> detected (ms)         4      6.71   7.69   7.81   8.24    8.24    8.24
kill -> reconnected (ms)      4      5826   5851   5858   5861    5861    5861
reconnect attempts            4      2      2      2      2       2       2

clients: 4 connected, 4 reconnected after the kill
socket closes: 1006=8 (1006 = killed instance; 44xx = rejected at the handshake)
converged: yes (1 distinct document states among reconnected clients)
edits lost from BEFORE the kill: 0 of 152 issued
offline edits later visible to other clients: 96
verdict: PASS - converged=true, allReconnected=true, zeroLoss=true
```

(That block is a real run against this repo's rooms: detection in single-digit
milliseconds, recovery dominated by process restart, and 96 edits typed while the
instance was dead were merged back in afterwards.)

- **detection** - kill to the moment the client's socket saw the close
  (TCP-level; tens of milliseconds on loopback).
- **reconnect** - kill to a usable session again. Includes your restart delay,
  so with `--spawn` it is dominated by process start + room re-hydration from
  Postgres.
- **lost edits before the kill** - tokens typed before the SIGKILL that the
  client can no longer see. Expected **0**, because every client keeps its own
  Yjs doc and re-pushes its state on reconnect (syncStep2). A non-zero value
  means edits died with the room and no client had them.
- **offline edits synced** - tokens typed *while disconnected* that another
  client can see afterwards; non-zero proves the local-first path
  (offline edit -> reconnect -> merge) works.
- **converged** - all reconnected clients hold identical document text. `no`
  means a genuine CRDT/sync bug, not a performance problem.

For the **two-instance leader-failover** variant, start a second instance, point
half the load at it, and kill whichever one holds the persistence lock:

```bash
node perf/start-sync.mjs --port 1235 --pid-file perf/.sync2.pid
docker compose exec redis redis-cli --scan --pattern 'inkwell:lock:doc:*'
```

### S5 - soak (memory / connection leaks)

Run the largest **passing** S2 configuration for 30-60 minutes and watch RSS:

```bash
node perf/harness/editors.mjs --clients 200 --rooms 40 --ramp 60 --duration 3600 --interval 3000
```

RSS growing monotonically at a flat client count points at room/awareness leaks
or pool exhaustion; p99 drifting upward at constant CPU points at the event
loop. Rooms are evicted 60 s after the last participant leaves, so
`curl -s localhost:1234/healthz` should return to `rooms:0` once the run ends -
if it does not, rooms are being retained.

---

## 6. Percentile targets used by the verdicts

| Metric | p50 | p97 | p99 |
|---|---|---|---|
| WS connect (auth + room join included) | < 100 ms | < 300 ms | < 500 ms |
| Update round-trip, same instance | < 50 ms | < 150 ms | **< 300 ms** |
| Update round-trip, cross-instance (Redis relay) | < 100 ms | < 250 ms | < 300 ms |
| HTTP GET (dashboard) | < 150 ms | < 400 ms | < 800 ms |

S1 and S2 automate the bolded one: the harness prints p50/p97/p99 and exits
non-zero when p99 > `--sla-p99` or errors > `--max-error-rate`. Agree the
targets with the product owners before quoting results.

---

## 7. Results and cleanup

Each harness writes JSON to `perf/results/` (gitignored) with the full config,
every percentile, server room/connection counts before and after, and per-client
detail:

```text
perf/results/editors-2026-10-18T05-41-02-310Z.json
perf/results/chaos-kill-2026-10-18T06-02-44-512Z.json
```

Artillery can write its own report:

```bash
npm run perf:s1 -- --output perf/results/s1.json
npx artillery report perf/results/s1.json      # produces s1.json.html
```

Cleanup:

```bash
npm run perf:seed -- --clean        # delete the perf documents + owner
docker compose down                 # stop Postgres/Redis
```

---

## 8. Gotchas

- **Never** set `PERF_TEST` / `PERF_TEST_STUB_CLERK` on a deployment reachable
  from the internet - `PERF_TEST_STUB_CLERK=1` authenticates any caller as the
  OWNER of any document.
- The handshake throttle is per **client IP**. Without `PERF_TEST=1` a single
  generator box is cut off (close code `4408`) after 30 connects a minute. To
  test the throttle itself, drop `PERF_TEST` and use
  `PERF_TEST_RATE_MULTIPLIER`.
- Windows: `SIGKILL` is emulated by `TerminateProcess` - still a hard kill and
  still unflushed, so the S4 numbers remain representative.
- SIGKILL drops up to one persistence interval (5 s) of unsaved edits from the
  *server's* copy. Clients still hold them, which is what "lost edits before the
  kill: 0" measures. To see the flush interval explicitly, watch
  `Document."updatedAt"` during a run.
- Rooms are per document: 1000 users in one room and 1000 users in 200 rooms are
  very different tests. Always report which shape produced a number.
- Read the `socket closes:` line when a run looks wrong. `4408=...` means the
  service was NOT started in perf mode (its handshake throttle cut you off),
  `4404=...` means the seeded documents are gone (re-run `npm run perf:seed`),
  `4401`/`4403` mean auth rejected the session, and `1006` is a peer that
  vanished — expected in S4, suspicious anywhere else.
- `npm run perf:s1` / `perf:s3` need Artillery installed
  (`npm install -D artillery`); the S2/S4 harnesses need nothing beyond the
  repo's existing dependencies.
- Both harnesses are verified against a real `Room` by
  `tests/perf-harness.test.js` (`npm test`), which also asserts that a killed
  instance loses nothing: pre-kill *and* offline edits come back after the
  restart.
