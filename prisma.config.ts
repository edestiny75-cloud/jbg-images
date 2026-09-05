import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Next loads .env.local automatically; the Prisma CLI does not, so do it here.
 * Order matters: the first file to define a variable wins.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    /**
     * Migrations run over the direct connection (port 5432). Supabase pools the
     * runtime connection on 6543, and pgbouncer cannot carry the session-level
     * statements DDL needs. The runtime client uses DATABASE_URL; see
     * src/lib/db/client.ts.
     */
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    /**
     * Optional: a *separate*, empty database Prisma uses to detect drift. Not
     * the same thing as DIRECT_URL. Supabase does not let Prisma create one on
     * demand, so point this at a scratch database if you want `migrate dev`
     * drift detection there.
     */
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
