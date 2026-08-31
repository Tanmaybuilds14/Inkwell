# Inkwell

A self-hostable, real-time collaborative document platform — create, organize, share, and co-edit documents in real time with conflict-free sync.

Built with **Next.js 16** (App Router), **Yjs** CRDTs, **Prisma** + **PostgreSQL**, **Clerk** auth, **Inngest** background jobs, **Redis** pub/sub, and **Tiptap** rich text editor.

---

## Architecture

Inkwell splits into two runtime halves:

| Runtime | Location | Responsibility |
|---|---|---|
| **Next.js App** | `src/` | UI, CRUD API routes, sharing/permissions, folder management, auth, Inngest route handler |
| **WebSocket Sync Service** | `sync-service/` | Live Yjs document rooms, Redis cross-server broadcast, snapshot persistence |

Both share the same PostgreSQL database and are secured by the same Clerk session tokens. See [`docs/inkwell_system_overview.md`](../docs/inkwell_system_overview.md) for the full architecture, dataflow diagrams, and system design.

### Key features

- **Real-time co-editing** — Yjs CRDTs merge edits conflict-free; Redis pub/sub relays across horizontally-scaled sync instances
- **Sharing & permissions** — Email invites and revocable share links with four roles (Owner → Editor → Commenter → Viewer), enforced server-side
- **Document organization** — Folders with nesting, title search, owned/shared scopes
- **Version history** — Auto-snapshots every 5 minutes; preview and restore any prior version (with pre-restore backup)
- **Soft-delete & trash** — 30-day retention window with automatic Inngest purge
- **Guest access** — Share links grant access without an account

---

## Prerequisites

- **Node.js** 20+ (tested on Node 24)
- **PostgreSQL** 15+ (or use Docker Compose — see below)
- **Redis** 7+ (or use Docker Compose)
- A **Clerk** application ([dashboard.clerk.com](https://dashboard.clerk.com))
- Optional: **Inngest** account for background jobs, **Resend** for invite emails

---

## Quick start

### 1. Install dependencies

```bash
cd docssy
npm install --legacy-peer-deps
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in at minimum:
- `DATABASE_URL` — your Postgres connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` — from Clerk dashboard
- `REDIS_URL` — your Redis connection string

### 3. Start local infrastructure (Postgres + Redis)

```bash
docker compose up -d
```

This starts Postgres on `:5432` and Redis on `:6379` with health checks.

### 4. Set up the database

```bash
npm run db:generate        # Generate the Prisma client
npm run db:migrate         # Create tables (creates a new migration)
npm run db:seed            # Optional: seed a demo user + document
```

### 5. Run the development servers

**Terminal 1 — Next.js app (port 3000):**
```bash
npm run dev
```

**Terminal 2 — Sync service (port 1234):**
```bash
npm run dev:sync
```

Open [http://localhost:3000](http://localhost:3000) — sign in via Clerk, and you're ready to create documents.

---

## Full local stack (Docker)

To run the entire application (web + two sync instances + Postgres + Redis) in Docker:

```bash
docker compose --profile app up --build
```

The `app` profile runs:
- **web** on `:3000`
- **sync** on `:1234` and **sync2** on `:1235` — two instances to exercise the Redis cross-server broadcast path locally

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/inkwell` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client-side) | — |
| `CLERK_SECRET_KEY` | Clerk secret key (server-side) | — |
| `NEXT_PUBLIC_SYNC_WS_URL` | WebSocket URL for the sync service | `ws://localhost:1234` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `INNGEST_EVENT_KEY` | Inngest event key (optional) | — |
| `INNGEST_SIGNING_KEY` | Inngest signing key (production) | — |
| `RESEND_API_KEY` | Resend API key for invite emails (optional in dev) | — |
| `EMAIL_FROM` | From address for invite emails | — |
| `NEXT_PUBLIC_APP_URL` | Public app origin for share links | `http://localhost:3000` |
| `SYNC_PORT` | Port the sync service listens on | `1234` |

---

## npm scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (port 3000) |
| `npm run dev:sync` | Start the WebSocket sync service (port 1234) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply existing migrations |

---

## Testing

### Unit tests (Vitest)

```bash
npm test
```

Covers:
- Role hierarchy and capability matrix (including fail-closed cases)
- Yjs snapshot round-trip, empty-doc handling, HTML rendering
- Concurrent-edit merge guarantee (both inserts survive)

### E2E tests (Playwright)

Playwright is installed (`@playwright/test`) but E2E tests for multi-client sync and permission boundaries are a planned phase.

---

## Project structure

```
docssy/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.js                # Demo data seeder
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── api/               # API routes (documents, folders, trash, share, inngest)
│   │   ├── documents/[id]/    # Document editor page
│   │   ├── trash/             # Trash page
│   │   ├── sign-in|sign-up/   # Clerk auth catch-all pages
│   │   ├── layout.js          # Root layout (ClerkProvider)
│   │   └── page.js           # Landing page
│   ├── components/
│   │   ├── editor/            # Tiptap + Yjs collaborative editor
│   │   └── documents/        # Dashboard, share dialog, version history
│   ├── lib/                  # Shared utilities (auth, prisma, permissions, etc.)
│   ├── inngest/              # Background jobs (trash purge, snapshot pruning, invites)
│   └── proxy.js              # Clerk middleware (Next.js 16 renamed from middleware)
├── sync-service/
│   ├── src/
│   │   ├── server.js         # HTTP + WebSocket server
│   │   ├── auth.js           # Clerk JWT + share link handshake
│   │   ├── rooms.js          # Yjs document rooms + y-protocols sync
│   │   ├── broadcast.js      # Redis pub/sub relay
│   │   └── db.js             # Raw pg queries
│   └── package.json
├── tests/                    # Vitest unit tests
├── docker-compose.yml        # Postgres + Redis (+ optional app profile)
├── Dockerfile.web            # Multi-stage Next.js container
└── vitest.config.mjs
```

---

## Security model

- **Authentication:** Clerk session tokens, validated on every API request (`proxy.js`) and during the WebSocket handshake (`sync-service/src/auth.js`)
- **Authorization:** Role hierarchy (`OWNER > EDITOR > COMMENTER > VIEWER`), enforced server-side in both Next.js API routes and the sync service
- **Fail-closed:** Any uncertainty in a permission check denies access by default
- **Share links:** Use signed, revocable tokens — not document IDs — so revoking a link invalidates access immediately

---

## Deployment

| Component | Recommended host | Why |
|---|---|---|
| Next.js app | Vercel | Native Next.js hosting, serverless auto-scaling |
| Sync service | Railway / Fly.io | Needs always-on process for WebSocket (not serverless) |
| PostgreSQL | NeonDB | Serverless Postgres |
| Redis | Upstash | Serverless Redis pub/sub |

The sync service should run with **≥2 instances** behind a load balancer to exercise the cross-server Redis broadcast path.

---

## License

Private project.
