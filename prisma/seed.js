// Prisma seed — creates a demo user + sample document for local development.
// Run with: npm run db:seed  (or: npx prisma db seed)
//
// This is safe to re-run: it upserts by a stable clerkId so duplicates are
// not created on subsequent runs.

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set — cannot seed.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // Demo user (matches the clerkId pattern used in local dev).
  const user = await prisma.user.upsert({
    where: { clerkId: 'demo-local-user' },
    update: { name: 'Demo User', email: 'demo@inkwell.local' },
    create: {
      clerkId: 'demo-local-user',
      email: 'demo@inkwell.local',
      name: 'Demo User',
    },
  });

  // Sample folder.
  const folder = await prisma.folder.upsert({
    where: { id: 'demo-folder' },
    update: {},
    create: {
      id: 'demo-folder',
      name: 'Getting Started',
      ownerId: user.id,
    },
  });

  // Sample document inside the folder.
  const doc = await prisma.document.upsert({
    where: { id: 'demo-document' },
    update: {},
    create: {
      id: 'demo-document',
      title: 'Welcome to Inkwell',
      ownerId: user.id,
      folderId: folder.id,
      originalFolderId: folder.id,
    },
  });

  console.log('Seeded:', { user: user.id, folder: folder.id, document: doc.id });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
