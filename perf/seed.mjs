/**
 * Seed the database with the fixtures a perf run needs: one owner user and N
 * documents. The sync service refuses a handshake for a document that does not
 * exist (auth.js → getDocumentForAuth), so without this every virtual client
 * would be closed with 4404 and the run would measure nothing.
 *
 * Writes the document ids to perf/.perf-docs.json (gitignored), which the
 * harnesses and the Artillery configs read.
 *
 *   node perf/seed.mjs --docs 20
 *   node perf/seed.mjs --clean          # remove perf fixtures again
 *
 * Uses the `pg` driver directly (the same one the sync service uses) so the
 * seed does not depend on a generated Prisma client.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `.env` next to the repo root, regardless of the shell's cwd.
loadEnv({ path: resolve(__dirname, '../.env') });

const { values } = parseArgs({
  options: {
    docs: { type: 'string', default: '20' },
    out: { type: 'string', default: resolve(__dirname, '.perf-docs.json') },
    'clerk-id': { type: 'string', default: 'perf_seed_owner' },
    email: { type: 'string', default: 'perf-owner@example.test' },
    prefix: { type: 'string', default: 'Perf Doc' },
    clean: { type: 'boolean', default: false },
    'database-url': { type: 'string' },
  },
  allowPositionals: true,
});

const databaseUrl = values['database-url'] ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Put it in .env (see .env.example) or pass --database-url.'
  );
  process.exit(1);
}

// Resolve `pg` from this package first, then from the sync service's own
// node_modules — the repo only declares it there.
const require = createRequire(import.meta.url);
let pg;
try {
  pg = require('pg');
} catch {
  pg = createRequire(new URL('../sync-service/package.json', import.meta.url))('pg');
}

const docCount = Number(values.docs);
const prefix = values.prefix;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

try {
  if (values.clean) {
    const docs = await pool.query(
      `DELETE FROM "Document" WHERE "title" LIKE $1 RETURNING "id"`,
      [`${prefix} %`]
    );
    const users = await pool.query(
      `DELETE FROM "User" WHERE "clerkId" LIKE $1 RETURNING "id"`,
      [`${values['clerk-id'].replace(/[%_]/g, '')}%`]
    );
    console.log(`cleaned ${docs.rowCount} perf documents, ${users.rowCount} perf users`);
    await pool.end();
    process.exit(0);
  }

  const user = await pool.query(
    `INSERT INTO "User" ("id", "clerkId", "email", "name", "updatedAt")
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT ("clerkId") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = now()
     RETURNING "id"`,
    [`perf_user_${randomId()}`, values['clerk-id'], values.email, 'Perf Owner']
  );
  const ownerId = user.rows[0].id;

  const docs = [];
  for (let i = 0; i < docCount; i++) {
    const id = `perf_doc_${randomId()}`;
    await pool.query(
      `INSERT INTO "Document" ("id", "title", "ownerId", "updatedAt")
       VALUES ($1, $2, $3, now())`,
      [id, `${prefix} ${i + 1}`, ownerId]
    );
    docs.push(id);
  }

  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(
    values.out,
    JSON.stringify({ createdAt: new Date().toISOString(), ownerId, docs }, null, 2)
  );

  console.log(`seeded ${docs.length} documents (owner ${ownerId})`);
  console.log(`wrote ${values.out}`);
  console.log(`\nfirst doc: ${docs[0]}`);
} catch (err) {
  // Node raises an AggregateError with an EMPTY message when every resolved
  // address fails (ECONNREFUSED on both ::1 and 127.0.0.1), so fall back to
  // the per-address reasons or the error code.
  const reason =
    err.message ||
    (Array.isArray(err.errors) ? err.errors.map((e) => e?.message ?? e?.code).join('; ') : '') ||
    err.code;
  console.error(`seeding failed: ${reason}`);
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)) {
    console.error(
      '  Postgres is not reachable. Start it with `docker compose up -d postgres`\n' +
      '  and check DATABASE_URL in .env.'
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
