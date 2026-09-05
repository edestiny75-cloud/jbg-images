/**
 * Development seed.
 *
 * The catalog, the product lines and the packing settings all exist in the live
 * Supabase project already; this reproduces them locally from the constants
 * that were embedded in index.html, so screens can be built and tested without
 * pointing at production.
 *
 * Safe to re-run: every write is an upsert keyed on the natural key.
 *
 * Run with: npm run db:seed
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { hashPin } from './seed-support/hashPin';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(here, 'seed-data', name), 'utf8')) as T;

interface SeedProduct {
  sku: string;
  title: string;
  line: string;
  size: string;
  asin: string | null;
  sheetsPerUnit: number;
  thumbUrl: string | null;
  pdfPath: string | null;
  pdf12x18Path: string | null;
  fnskuPath: string | null;
  fnskuCode: string | null;
  meta: string | null;
  sortOrder: number | null;
}

/** Panels and actions land in jsonb columns, so they carry Prisma's Json type. */
type Json = Prisma.InputJsonValue;

interface SeedLine {
  id: string;
  label: string;
  panels: Json[];
  actions: Json[];
  steps: string | null;
  sortOrder: number;
}

/** Matches DEFAULT_SETTINGS in src/lib/domain/types.ts, which is the fallback. */
const SETTINGS = {
  boxCapOz: 800,
  boxStackIn: 10,
  weights: {
    '11x17': { sheet: 1.8, mailer: 6.4, base_in: 0.105, per_sheet_in: 0.02, columns: 1 },
    '8.5x11': { sheet: 1.0, mailer: 3.4, base_in: 0.105, per_sheet_in: 0.02, columns: 2 },
  },
};

/** Dev-only accounts. The PIN is printed once, below, and never stored in clear. */
const USERS = [
  { name: 'admin', pin: '4242', role: 'admin' as const },
  { name: 'packer', pin: '1111', role: 'packer' as const },
];

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL (or DIRECT_URL) before seeding.');
  if (/supabase\.(co|com)/i.test(connectionString) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error('Refusing to seed what looks like the live Supabase database. Set SEED_ALLOW_REMOTE=1 to override.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, ...SETTINGS },
      update: SETTINGS,
    });

    const lines = read<SeedLine[]>('product-lines.json');
    for (const l of lines) {
      const data = { label: l.label, panels: l.panels, actions: l.actions, steps: l.steps, sortOrder: l.sortOrder };
      await prisma.productLine.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data });
    }

    const products = read<SeedProduct[]>('products.json');
    for (const p of products) {
      const data = {
        title: p.title,
        line: p.line,
        size: p.size,
        asin: p.asin,
        sheetsPerUnit: p.sheetsPerUnit,
        thumbUrl: p.thumbUrl,
        pdfPath: p.pdfPath,
        pdf12x18Path: p.pdf12x18Path,
        fnskuPath: p.fnskuPath,
        fnskuCode: p.fnskuCode,
        meta: p.meta,
        sortOrder: p.sortOrder,
      };
      await prisma.product.upsert({ where: { sku: p.sku }, create: { sku: p.sku, ...data }, update: data });
    }

    for (const u of USERS) {
      const pinHash = await hashPin(u.pin);
      await prisma.user.upsert({
        where: { name: u.name },
        create: { name: u.name, pinHash, role: u.role },
        update: { role: u.role },
      });
    }

    console.log(`Seeded ${products.length} products, ${lines.length} product lines, settings, ${USERS.length} users.`);
    console.log('Dev sign-in:', USERS.map((u) => `${u.name}/${u.pin}`).join('  '));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
