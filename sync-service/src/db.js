import pg from 'pg';

/**
 * The sync service talks straight to Postgres over `pg` — deliberately
 * independent of the Next.js app's generated Prisma client so both halves of
 * Inkwell can be built and deployed separately.
 *
 * Tables/columns follow the Prisma schema's default naming (quoted,
 * case-sensitive identifiers).
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — the sync service cannot load or save documents.');
}

const globalForPg = globalThis;

export const pool =
  globalForPg.__inkwellSyncPool ??
  new pg.Pool({
    connectionString,
    max: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.__inkwellSyncPool = pool;
}

/** Fetch document row needed for room creation + handshake. */
export async function getDocumentForAuth(docId) {
  const { rows } = await pool.query(
    `SELECT "id", "deletedAt", "ownerId", "shareEnabled", "shareRole", "shareToken"
       FROM "Document" WHERE "id" = $1`,
    [docId]
  );
  return rows[0] ?? null;
}

export async function getUserRoleForDocument(docId, userId) {
  const { rows } = await pool.query(
    `SELECT "role" FROM "Permission" WHERE "documentId" = $1 AND "userId" = $2`,
    [docId, userId]
  );
  return rows[0]?.role ?? null;
}

export async function getUserByClerkId(clerkId) {
  const { rows } = await pool.query(
    `SELECT "id", "email", "name", "imageUrl" FROM "User" WHERE "clerkId" = $1`,
    [clerkId]
  );
  return rows[0] ?? null;
}

export async function getDocumentSnapshot(docId) {
  const { rows } = await pool.query(
    `SELECT "snapshot" FROM "Document" WHERE "id" = $1`,
    [docId]
  );
  return rows[0]?.snapshot ?? null;
}

export async function persistSnapshot({ docId, snapshot, stateVector }) {
  await pool.query(
    `UPDATE "Document"
        SET "snapshot" = $1, "stateVector" = $2, "updatedAt" = now()
      WHERE "id" = $3`,
    [snapshot, stateVector, docId]
  );
}

export async function getDocumentTitle(docId) {
  const { rows } = await pool.query(
    `SELECT "title" FROM "Document" WHERE "id" = $1`,
    [docId]
  );
  return rows[0]?.title ?? null;
}

export async function getDocumentOwnerId(docId) {
  const { rows } = await pool.query(
    `SELECT "ownerId" FROM "Document" WHERE "id" = $1`,
    [docId]
  );
  return rows[0]?.ownerId ?? null;
}

export async function createVersionSnapshot({ docId, snapshot, title }) {
  await pool.query(
    `INSERT INTO "VersionSnapshot" ("documentId", "snapshot", "title")
     VALUES ($1, $2, $3)`,
    [docId, snapshot, title ?? null]
  );
}

/** Timestamp of the newest version snapshot for a document (null if none). */
export async function getLatestVersionAt(docId) {
  const { rows } = await pool.query(
    `SELECT "createdAt" FROM "VersionSnapshot"
      WHERE "documentId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 1`,
    [docId]
  );
  return rows[0]?.createdAt ?? null;
}

/**
 * Write user-facing audit rows. The ActivityEvent table may not exist yet on
 * databases that predate the profile/audit feature, so the table is created
 * on demand here (idempotent) and individual failures are non-fatal.
 */
let activityTableReady = false;
async function ensureActivityTable() {
  if (activityTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "ActivityEvent" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "documentId" TEXT,
      "docTitle" TEXT,
      "meta" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "ActivityEvent_userId_createdAt_idx"
       ON "ActivityEvent"("userId", "createdAt" DESC)`
  );
  activityTableReady = true;
}

export async function logActivityEvents(events) {
  if (!events.length) return;
  try {
    await ensureActivityTable();
    const values = [];
    const params = [];
    events.forEach((e, i) => {
      const o = i * 6;
      values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`);
      params.push(e.id, e.userId, e.type, e.documentId ?? null, e.docTitle ?? null, e.meta ?? null);
    });
    await pool.query(
      `INSERT INTO "ActivityEvent"
         ("id", "userId", "type", "documentId", "docTitle", "meta")
       VALUES ${values.join(', ')}`,
      params
    );
  } catch (err) {
    // Audit is best-effort in the sync path — never break persistence.
    console.error('[activity] sync-service write failed:', err.message);
  }
}
