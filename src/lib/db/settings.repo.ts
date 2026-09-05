import 'server-only';
import { cache } from 'react';
import type { Prisma } from '@/generated/prisma/client';
import { DEFAULT_SETTINGS, isSheetSize, type PackingSettings, type SheetSize, type SizeWeights } from '@/lib/domain';
import { prisma } from './client';

/**
 * The `settings` table is a single row (id = 1) whose `weights` column is
 * untyped jsonb. The legacy tool trusted it blindly; here it is narrowed once,
 * on the way out, so nothing downstream has to guess.
 */
const SETTINGS_ID = 1;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sizeWeights(raw: unknown, fallback: SizeWeights): SizeWeights {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  return {
    sheet: num(o.sheet, fallback.sheet),
    mailer: num(o.mailer, fallback.mailer),
    base_in: num(o.base_in, fallback.base_in),
    per_sheet_in: num(o.per_sheet_in, fallback.per_sheet_in),
    columns: num(o.columns, fallback.columns),
  };
}

function toPackingSettings(row: { boxCapOz: number; boxStackIn: number | null; weights: unknown } | null): PackingSettings {
  if (!row) return DEFAULT_SETTINGS;
  const raw = (row.weights ?? {}) as Record<string, unknown>;
  const weights = {} as Record<SheetSize, SizeWeights>;
  for (const size of Object.keys(DEFAULT_SETTINGS.weights)) {
    if (!isSheetSize(size)) continue;
    weights[size] = sizeWeights(raw[size], DEFAULT_SETTINGS.weights[size]);
  }
  return {
    boxCapOz: num(row.boxCapOz, DEFAULT_SETTINGS.boxCapOz),
    boxStackIn: num(row.boxStackIn, DEFAULT_SETTINGS.boxStackIn),
    weights,
  };
}

/**
 * Deduped per request: every screen that plans or weighs anything needs this,
 * and it is one row.
 */
export const getSettings = cache(async (): Promise<PackingSettings> => {
  const row = await prisma.setting.findUnique({ where: { id: SETTINGS_ID } });
  return toPackingSettings(row);
});

/**
 * Prisma's Json input type wants an index signature, which a declared interface
 * never has. Spelling the columns out is also the write-side schema check the
 * jsonb column does not give us.
 */
function toJson(weights: PackingSettings['weights']): Prisma.InputJsonValue {
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [size, w] of Object.entries(weights)) {
    out[size] = {
      sheet: w.sheet,
      mailer: w.mailer,
      base_in: w.base_in,
      per_sheet_in: w.per_sheet_in,
      columns: w.columns,
    };
  }
  return out;
}

export async function saveSettings(next: PackingSettings): Promise<PackingSettings> {
  const data = {
    boxCapOz: next.boxCapOz,
    boxStackIn: next.boxStackIn,
    weights: toJson(next.weights),
  };
  const row = await prisma.setting.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  return toPackingSettings(row);
}
