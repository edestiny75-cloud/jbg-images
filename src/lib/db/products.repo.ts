import 'server-only';
import { cache } from 'react';
import { compareProducts, isSheetSize, type CatalogProduct, type ProductOverrides } from '@/lib/domain';
import { prisma } from './client';

/**
 * The catalog. ~264 rows, read whole on almost every screen — which is exactly
 * why it now lives on the server instead of being shipped to the browser at
 * boot as the 136 KB `BYSKU` constant.
 */

/** Only the columns the app actually renders. `meta` is the folded-in BYSKU field. */
const CATALOG_SELECT = {
  sku: true,
  title: true,
  line: true,
  size: true,
  asin: true,
  sheetsPerUnit: true,
  pdfPath: true,
  pdf12x18Path: true,
  fnskuPath: true,
  fnskuCode: true,
  thumbUrl: true,
  meta: true,
  sortOrder: true,
} as const;

export interface CatalogRow extends CatalogProduct {
  sortOrder: number | null;
}

/**
 * Sort order.
 *
 * `sort_order` positions a product *within its own line* — it replaces the
 * hard-coded PRES_ORDER array, which only ever ordered the Presidents line.
 * Comparing it across lines would hoist all 47 presidents above every other
 * product in the catalog, which is not what the column means. Anything without
 * one falls back to the bundle/SKU comparison in lib/domain/sorting.
 */
function sortCatalog(rows: CatalogRow[]): CatalogRow[] {
  return rows.sort((a, b) => {
    if (a.line === b.line) {
      if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      if (a.sortOrder != null && b.sortOrder == null) return -1;
      if (a.sortOrder == null && b.sortOrder != null) return 1;
    }
    return compareProducts(a, b);
  });
}

export const listProducts = cache(async (): Promise<CatalogRow[]> => {
  const rows = await prisma.product.findMany({ select: CATALOG_SELECT });
  return sortCatalog(rows);
});

export const getProduct = cache(async (sku: string): Promise<CatalogRow | null> => {
  return prisma.product.findUnique({ where: { sku }, select: CATALOG_SELECT });
});

/** SKU -> row, for the O(1) lookups every screen does while rendering. */
export const productMap = cache(async (): Promise<Map<string, CatalogRow>> => {
  const rows = await listProducts();
  return new Map(rows.map((r) => [r.sku, r]));
});

// --- product lines (was the LINECFG constant) ------------------------------

export interface ProductLinePanel {
  label: string;
  field: string;
}

export interface ProductLineAction {
  label: string;
  field: string;
  primary?: boolean;
}

export interface ProductLineConfig {
  id: string;
  label: string;
  panels: ProductLinePanel[];
  actions: ProductLineAction[];
  /** Packing instructions. Contains raw HTML; sanitise before rendering. */
  steps: string | null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export const listProductLines = cache(async (): Promise<ProductLineConfig[]> => {
  const rows = await prisma.productLine.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    panels: asArray<ProductLinePanel>(r.panels),
    actions: asArray<ProductLineAction>(r.actions),
    steps: r.steps,
  }));
});

// --- overrides (Phase 9: were jbg_wt / jbg_shipwt / jbg_sizeoverride) ------

export const listOverrides = cache(async (): Promise<Map<string, ProductOverrides>> => {
  const rows = await prisma.productOverride.findMany();
  return new Map(
    rows.map((r) => [
      r.productSku,
      {
        weightOz: r.weightOz,
        shipWeightOz: r.shipWeightOz,
        size: isSheetSize(r.size) ? r.size : null,
      } satisfies ProductOverrides,
    ]),
  );
});

export async function saveOverride(sku: string, next: ProductOverrides): Promise<void> {
  const data = {
    weightOz: next.weightOz ?? null,
    shipWeightOz: next.shipWeightOz ?? null,
    size: next.size ?? null,
  };
  await prisma.productOverride.upsert({
    where: { productSku: sku },
    create: { productSku: sku, ...data },
    update: data,
  });
}

export async function clearOverride(sku: string): Promise<void> {
  await prisma.productOverride.deleteMany({ where: { productSku: sku } });
}

// --- prices (Phase 9: were five separate localStorage maps) ---------------

export interface PriceBook {
  wholesale: number | null;
  cost: number | null;
  costBulk: number | null;
  msrp: number | null;
  map: number | null;
}

const EMPTY_PRICES: PriceBook = { wholesale: null, cost: null, costBulk: null, msrp: null, map: null };

/** Prisma returns Decimal; the UI wants a plain number. */
function dec(v: { toNumber(): number } | null): number | null {
  return v == null ? null : v.toNumber();
}

export const listPrices = cache(async (): Promise<Map<string, PriceBook>> => {
  const rows = await prisma.productPrice.findMany();
  return new Map(
    rows.map((r) => [
      r.productSku,
      { wholesale: dec(r.wholesale), cost: dec(r.cost), costBulk: dec(r.costBulk), msrp: dec(r.msrp), map: dec(r.map) },
    ]),
  );
});

export async function savePrices(sku: string, next: Partial<PriceBook>): Promise<void> {
  const data = { ...EMPTY_PRICES, ...next };
  await prisma.productPrice.upsert({
    where: { productSku: sku },
    create: { productSku: sku, ...data },
    update: next,
  });
}

/** Bulk write, used by the wholesale sheet and the one-time localStorage import. */
export async function savePricesMany(entries: Iterable<[string, Partial<PriceBook>]>): Promise<number> {
  const list = [...entries];
  if (list.length === 0) return 0;
  await prisma.$transaction(
    list.map(([sku, next]) =>
      prisma.productPrice.upsert({
        where: { productSku: sku },
        create: { productSku: sku, ...EMPTY_PRICES, ...next },
        update: next,
      }),
    ),
  );
  return list.length;
}
