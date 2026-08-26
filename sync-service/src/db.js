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
    `SELECT "id", "email", "name" FROM "User" WHERE "clerkId" = $1`,
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

export async function createVersionSnapshot({ docId, snapshot, title }) {
  await pool.query(
    `INSERT INTO "VersionSnapshot" ("documentId", "snapshot", "title")
     VALUES ($1, $2, $3)`,
    [docId, snapshot, title ?? null]
  );
}
