import { isBundle, sizeFromSku } from './sizing';
import type { CatalogProduct } from './types';

/**
 * Catalog ordering. Ported from index.html:683-694.
 *
 * Two rules stack: the Presidents line sorts by presidency rather than
 * alphabetically, and within every other line bundles are pushed below the
 * singles they are made of.
 */

/**
 * The Presidents line in office order. Kept here as the seed for
 * `products.sort_order`; once that column is populated the database is the
 * authority and this array is only used to backfill it.
 */
export const PRESIDENT_ORDER = [
  'Washington', 'JAdams', 'Jefferson', 'Madison', 'Monroe', 'JQAdams', 'Jackson',
  'VanBuren', 'WHHarrison', 'Tyler', 'Polk', 'Taylor', 'Fillmore', 'Pierce',
  'Buchanan', 'Lincoln', 'AJohnson', 'Grant', 'Hayes', 'Garfield', 'Arthur',
  'Cleveland', 'BHarrison', 'McKinley', 'TRoosevelt', 'Taft', 'Wilson', 'Harding',
  'Coolidge', 'Hoover', 'FDR', 'Truman', 'Eisenhower', 'Kennedy', 'LBJ', 'Nixon',
  'Ford', 'Carter', 'Reagan', 'GHWBush', 'Clinton', 'GWBush', 'Obama', 'Trump45',
  'Biden', 'Trump47', 'Pres48',
] as const;

const PRESIDENT_RANK = new Map<string, number>(
  PRESIDENT_ORDER.map((name, i) => [`JBG-BIN-LAM-${name.toUpperCase()}`, i]),
);

/** The two collection SKUs sort after all 47 individual presidents. */
const PRESIDENT_COLLECTIONS = new Map<string, number>([
  ['JBG-BIN-LAM-PRES-48PC', 900],
  ['JBG-BIN-LAM-PRES-BINDER-24', 901],
]);

/** Position in the Presidents line, or null for anything outside it. */
export function presidentRank(sku: string | null | undefined): number | null {
  if (!sku) return null;
  const u = sku.toUpperCase();
  return PRESIDENT_COLLECTIONS.get(u) ?? PRESIDENT_RANK.get(u) ?? null;
}

/**
 * SKU comparison in true numeric order, so "…-2" sorts before "…-10".
 * Plain lexicographic ordering put 10 before 2 and confused the pickers.
 */
export function compareSkuNumeric(a: string | null | undefined, b: string | null | undefined) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Catalog display order.
 *
 * `products.sort_order` wins when both rows have one — that is the column that
 * replaces the hard-coded Presidents array. Otherwise fall back to the legacy
 * rules so a partially-populated catalog still sorts sensibly.
 */
export function compareProducts(a: CatalogProduct, b: CatalogProduct): number {
  const sa = presidentRank(a.sku);
  const sb = presidentRank(b.sku);
  if (sa !== null && sb !== null) return sa - sb;

  const bundleA = isBundle(a) ? 1 : 0;
  const bundleB = isBundle(b) ? 1 : 0;
  return bundleA - bundleB || compareSkuNumeric(a.sku, b.sku);
}

/** Distinct sheet sizes present in a catalog, for filter dropdowns. */
export function sizesIn(products: readonly CatalogProduct[]): string[] {
  const seen = new Set<string>();
  for (const p of products) seen.add(p.size ?? sizeFromSku(p.sku, p.meta));
  return [...seen].sort();
}
