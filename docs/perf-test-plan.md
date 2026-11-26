# Inkwell — Sync Service Performance Test Plan (Artillery)

## Goals

1. **G1 — Stress test**: find the maximum number of concurrent collaborative users a
   **single sync-service instance** can serve with acceptable quality.
2. **G2 — Resilience**: kill an instance mid-session and measure what users experience
   (reconnect time, data loss, leader failover).
3. **G3 — Latency percentiles**: derive **p50 / p97 / p99** for the operations that matter.

## What we are testing

| Surface | Where | Testable with Artillery? |
|---|---|---|
| Next.js HTTP API (`:3000`) — documents, folders, share, versions, trash, inbox, activity | `src/app/api/**` | Yes — native HTTP |
| Next.js pages (landing, dashboard) | `src/app/**/page.js` | Yes — native HTTP |
| WebSocket sync service (`:1234`) — Yjs rooms, awareness, persistence | `sync-service/src/` | Partially — Artillery v2 has a WebSocket engine, but Yjs sync is a *binary protocol on top of WS*. We'll use Artillery to drive **connection count + handshake + keepalive traffic**, and use the built-in Yjs protocol where practical for edit fan-out. |
| Redis pub/sub fan-out across instances | `sync-service/src/broadcast.js` | Indirect — measured via multi-document rooms spread across 2 instances |

Key constraints discovered in the code:

- **Handshake rate limit**: `WS_HANDSHAKE` bucket = **30 connects / 60s per client IP**.
  A load generator from one IP would hit this in the first 2 seconds. **Implemented:**
  set `PERF_TEST=1` on the sync service (and web app) for the run — it disables the
  handshake throttle and scales every other rate limit by a multiplier (default
  10,000x; override with `PERF_TEST_RATE_MULTIPLIER`). See “Perf-test switches” below.
- **Auth is expensive per handshake**: every WS connect runs a Clerk JWT verify + DB
  lookup. This is likely the **first bottleneck** — expect CPU-bound auth, not I/O.
- **Persistence leader lock**: with one sync instance, that instance is always the
  leader and writes snapshots to Postgres every 5 minutes per active room. With 2+
  instances the leader is elected via Redis; killing the leader forces a failover.
- **Rooms are per-document**: one `docId` = one room. Fan-out cost scales with
  participants **per room**, not globally. Test both: many small rooms (dashboard
  reality) and a few very large rooms (worst case for awareness broadcast).

## Perf-test switches (implemented)

Both runtimes read one shared module, `shared/perf-test.js`:

| Env var | Effect |
|---|---|
| `PERF_TEST=1` | Master switch. WS handshake throttle is bypassed entirely; web API rate limits short-circuit to "allowed". OFF by default. |
| `PERF_TEST_STUB_CLERK=1` | Requires `PERF_TEST=1`. Skips Clerk JWT verification on the sync handshake: any non-empty token authenticates as the document OWNER with a deterministic `perf_*` user id derived from the token. Lets the load generator connect without a Clerk dev instance. |
| `PERF_TEST_RATE_MULTIPLIER` | With `PERF_TEST=1`, scales `RATE_LIMITS` by this factor (default 10,000x) wherever the shared specs are read. |

Guarantees: with no env vars set, all behaviour is identical to production. The
switches relax **abuse guards only** — role checks, edit gating and the permission
model are unchanged, so the numbers measure the real product. Never set these on an
internet-reachable deployment.

Example run:

```bash
# web app
PERF_TEST=1 npm start
# sync service (auth stubbed so no Clerk dev instance is needed)
PERF_TEST=1 PERF_TEST_STUB_CLERK=1 npm run dev:sync
```

## Test environment

- Single machine (or container) running **one** sync-service instance unless testing
  cross-instance relay.
- Postgres + Redis in Docker Compose, same host, or on dedicated infra if the goal is a
  production-like number.
- Node 24, matching CI/images.
- Artillery installed as a devDependency of the repo (`artillery` + `artillery-engine-websocket` if the core WebSocket engine isn't enough).

> ⚠️ Run the **load generator on a different machine** than the service under test if
> possible. On the same box, CPU contention will corrupt latency numbers.

## Scenarios

### S1 — Handshake / connection storm (auth ceiling)

Purpose: find the max **connects/sec** and **max concurrent sockets** one instance
holds before auth or memory saturates.

- **Arrival**: open 10 → 200 → 500 → 1000 sockets in ramping steps, hold each 60s.
- Each virtual user connects to `/ws?docId=<id>&token=<jwt>` against one of ~20
  pre-seeded documents (so we spread rooms).
- Measure: connect success rate, time-to-open (Artillery reports WS connect latency),
  instance CPU, RSS, event-loop lag (log via a debug endpoint or `process.monitor`).
- **Pass/fail**: p99 connect < 500ms, error rate < 1%.

### S2 — Concurrent editors (CRDT fan-out under load)

Purpose: measure how many **active typists** a room (and an instance) supports while
keeping sync latency inside SLA.

- One VU = one WebSocket session joined to a document room.
- Each VU sends Yjs update frames at a realistic cadence: **1 update every 1–3s**
  (a keystroke batch), plus periodic awareness (cursor) frames every ~5s.
- Ramp: 10 → 50 → 100 → 250 → 500 VUs split across rooms:
  - **Config A**: 1 room × N users (worst-case fan-out per room)
  - **Config B**: N/5 rooms × 5 users (realistic doc-sharing)
- Measure: per-update broadcast latency (time from send → echo back from server),
  p50/p97/p99 of that round-trip, dropped frames, socket backpressure.
- **Pass/fail**: p99 round-trip < 300ms (the README's cross-instance target).

### S3 — API + page load (Next.js)

Purpose: baseline the web app, since real users hit HTTP too.

- Landing `/` (anonymous) — 200 RPS for 3 min.
- `/documents` dashboard + `/api/documents` (authed) — needs a Clerk session token;
  bake one in via a custom phantom or pre-generated session cookie.
- `/api/documents/[id]/versions`, `/api/documents/[id]/share` GETs — read-only paths.
- **Respect existing rate limits**: `WRITE` = 120/min/user, `DOC_CREATE` = 30/h/user.
  Either disable limits for the test run or run enough distinct test users to stay
  under the per-user caps.

### S4 — Instance-kill resilience (chaos)

Purpose: answer "what happens when an instance dies mid-session".

Two variants:

**4a. Single instance, no fallback**
- 50 VUs editing in 10 rooms, steady state for 2 min.
- `SIGKILL` the sync process.
- Measure: time until clients notice (TCP close → client reconnect attempt), whether
  edits typed offline survive (they should — `y-indexeddb` queues them), and total
  time until the service is back and rooms re-hydrate from Postgres.

**4b. Two instances, leader failover**
- Same load, but clients are split across `sync` (:1234) and `sync2` (:1235), so the
  Redis cross-instance relay is exercised.
- `SIGKILL` whichever instance currently holds the **persistence leader lock**.
- Measure:
  - do sockets on the survivor keep working? (they should — relay is pub/sub)
  - how long until a survivor takes the leader lock and resumes Postgres snapshots?
  - do clients that were on the killed instance reconnect to the survivor (via LB or
    direct URL) and re-sync without conflict?
- **Pass/fail**: zero data loss (post-restart doc converges to what every client last
  saw), reconnect < 5s p95, no permanent role loss.

### S5 — Soak

Run S2 config B at the "max sustainable" VU count found in S1/S2 for 30–60 min. Watch
for memory leaks in rooms/awareness maps, Postgres connection pool exhaustion, and
Redis subscriber backlog.

## Metrics to capture

Artillery gives p50/p95/p99 out of the box. Add:

- **App-level**: connect latency, update round-trip latency, auth verdict time,
  snapshot write duration.
- **Process-level**: CPU %, RSS, event-loop lag (from a tiny `/metrics`-style endpoint
  or `node --inspect` sampling).
- **Infra-level**: Postgres active connections + query latency, Redis ops/sec,
  pub/sub channel throughput.
- **Chaos (S4)**: time-to-detect, time-to-reconnect, time-to-leader-takeover, edits
  lost (should be 0), snapshot staleness at kill time.

Percentile targets (proposed SLA, adjust with product):

| Metric | p50 | p97 | p99 |
|---|---|---|---|
| WS connect (auth incl.) | < 100ms | < 300ms | < 500ms |
| Update round-trip (same instance) | < 50ms | < 150ms | < 300ms |
| Update round-trip (cross-instance via Redis) | < 100ms | < 250ms | < 300ms |
| HTTP API GET (dashboard) | < 150ms | < 400ms | < 800ms |

## Tooling (implemented)

```
perf/
  README.md                   # runbook: every command, every flag, how to read output
  seed.mjs                    # fixtures: owner user + N documents → perf/.perf-docs.json
  start-sync.mjs              # sync service with PERF_TEST=1 (+ pid file for S4)
  lib/yclient.mjs             # virtual editor speaking the real Yjs/y-websocket protocol
  lib/stats.mjs               # p50/p97/p99, SLA verdict, close-code tally
  harness/editors.mjs         # S1 + S2 + S5 (Node; prints percentiles and PASS/FAIL)
  harness/chaos-kill.mjs      # S4 (Node; kills, restarts, measures loss + convergence)
  artillery/handshake-stress.yml  # S1 connection storm (needs `npm i -D artillery`)
  artillery/api-load.yml          # S3 HTTP baseline
  artillery/processors.mjs        # seeds doc ids / tokens into Artillery virtual users
  results/                    # per-run JSON, gitignored
```

Decisions taken while implementing:

- **S2/S4 are Node harnesses, not Artillery configs.** Yjs traffic is a binary
  y-protocol stream, which Artillery's `ws` engine cannot express; the harness uses
  `y-protocols` directly (deps already in the repo) and measures the send→broadcast
  echo of every update, which is the round-trip a user actually feels. Artillery
  stays for S1 (connection storm) and S3 (HTTP), where its engines fit natively.
- **No Clerk instance is required.** `PERF_TEST=1 PERF_TEST_STUB_CLERK=1` makes any
  non-empty token authenticate as the document OWNER with a deterministic `perf_*`
  identity, so the load generator never needs JWTs. Authorization still flows through
  the real role/room/edit-gating code.
- **The harnesses own the pass/fail call.** They print p50/p97/p99 and exit non-zero
  when p99 > `--sla-p99` (default 300 ms) or errors > 1%, so a ramp can be scripted
  until the first breach — that breach point IS the "users per instance" number.

Run steps, flags and expected output are in [../perf/README.md](../perf/README.md).

## Execution order

1. Stand up infra (`docker compose up -d postgres redis`), apply migrations (`npm run db:deploy`).
2. Seed fixtures: `npm run perf:seed` (documents + a perf owner; no JWTs needed).
3. Start the sync service in test mode: `npm run perf:sync`.
4. S3 first (cheap, validates the harness), then S1, S2, S5, and S4 last (destructive).
5. After each ramp step, record CPU/RSS alongside the harness output; both harnesses already
   report how many sockets/rooms the server holds before and after the run.
6. Findings: the "max users" number is where p99 update RTT first breaches 300ms **or**
   error rate exceeds 1% — whichever comes first. The harness exits non-zero at exactly
   that point, so a ramp can be automated.

## Deliverables

- `perf/` tooling checked into the repo (see `perf/README.md`).
- A results table per scenario (VU count → p50/p97/p99, errors, CPU, RSS).
- A single headline number: **max concurrent editors per sync instance** at SLA.
- A short incident-style writeup of S4: what clients saw, how long recovery took.
