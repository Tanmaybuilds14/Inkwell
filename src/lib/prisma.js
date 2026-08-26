import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Lazily-instantiated singleton. The client is created on first use so that
 * builds (which import route modules for data collection) never require a
 * live DATABASE_URL.
 */
const globalForPrisma = globalThis;

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.'
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function getClient() {
  if (!globalForPrisma.__inkwellPrisma) {
    globalForPrisma.__inkwellPrisma = createPrismaClient();
  }
  return globalForPrisma.__inkwellPrisma;
}

export const prisma = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      const client = getClient();
      const value = Reflect.get(client, prop, receiver);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);
