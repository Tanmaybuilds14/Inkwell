import { prisma } from '@/lib/prisma';

/**
 * Idempotent bootstrap for columns/tables that may be missing on a database
 * that was migrated before these features existed. `prisma migrate dev` still
 * owns the canonical migration history — this is a safety net so the app
 * boots (and the profile/audit features degrade gracefully) on older schemas.
 *
 * Uses raw SQL because the generated Prisma client validates against the
 * schema at build time and would not reference a column that might not exist.
 */
const BOOTSTRAP_STATEMENTS = [
  // Profile settings
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardedAt" TIMESTAMP(3)`,
  // Activity audit
  `CREATE TABLE IF NOT EXISTS "ActivityEvent" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "documentId" TEXT,
      "docTitle" TEXT,
      "meta" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "ActivityEvent_userId_createdAt_idx" ON "ActivityEvent"("userId", "createdAt" DESC)`,
  `DO $$ BEGIN
      CREATE INDEX IF NOT EXISTS "ActivityEvent_userId_type_documentId_day_idx"
        ON "ActivityEvent"("userId", "type", "documentId", date_trunc('day', "createdAt"));
    EXCEPTION WHEN others THEN NULL; END $$;`,
  `ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey"
     FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  // User inbox (collab invites + shared-link receipts)
  `CREATE TABLE IF NOT EXISTS "InboxItem" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "documentId" TEXT,
      "docTitle" TEXT,
      "inviterId" TEXT,
      "meta" JSONB,
      "readAt" TIMESTAMP(3),
      "claimedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "InboxItem_userId_createdAt_idx" ON "InboxItem"("userId", "createdAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "InboxItem_userId_readAt_idx" ON "InboxItem"("userId", "readAt")`,
  `ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_userId_fkey"
     FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_inviterId_fkey"
     FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

let done = null;

export function ensureSchema() {
  if (!done) {
    done = (async () => {
      for (const sql of BOOTSTRAP_STATEMENTS) {
        try {
          await prisma.$executeRawUnsafe(sql);
        } catch (err) {
          // Constraint/index already exists etc. — never block startup.
          console.warn('[bootstrap] skipped:', err.message.split('\n')[0]);
        }
      }
    })().catch((err) => {
      done = null; // allow retry on next request
      throw err;
    });
  }
  return done;
}
