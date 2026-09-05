import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';

/**
 * One PrismaClient per process. Next's dev server re-evaluates modules on every
 * HMR pass, so without the global cache each edit would leak a connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? create();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
