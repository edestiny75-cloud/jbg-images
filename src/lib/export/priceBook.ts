import { CARTONS, casePack, itemOz, shipOz } from '@/lib/domain';
import type { CatalogProduct, PackingSettings, ProductOverrides, SheetSize } from '@/lib/domain';

/**
 * The wholesale export, as data.
 *
 * Ported from `exportExcel` (index.html:1216), which built the rows in the
 * browser and handed them to SheetJS — 881 KB of the 1.39 MB base64 vendor blob
 * on line 4, at a version that predates the fix for CVE-2023-30533, shipped to
 * every device that opened the tool so that four functions could be called on
 * the rare occasion somebody exported a sheet.
 *
 * Nothing here touches Excel. This module decides *what* the sheet says; the
 * route handler decides how to spell it in xlsx. That split is what lets the
 * column set be unit-tested, and it is the reason the shape below can change
 * without anyone reading ExcelJS's API.
 */

/**
 * A hand-picked selection travels in a URL when it is printed, so it has a
 * ceiling. 250 SKUs is roughly 7 KB of query string — comfortably inside
 * Node's 16 KB header limit and every browser's URL limit — and past that the
 * honest answer is a filter, not a list, because 250 of 265 products is "the
 * catalog". The .xlsx route holds to the same number so the two outputs never
 * cover different rows.
 */
export const MAX_SELECTION = 250;

export interface ExportColumn {
  key: string;
  header: string;
  /** Width in characters — the unit both ExcelJS and SheetJS use. */
  width: number;
  /**
   * What the column holds, so the writer can pick a cell format without
   * pattern-matching on the header text. Money is the one that matters: a
   * price written as a bare number loses its trailing zero and `9.5` reads as
   * a quantity rather than a dollar amount.
   */
  kind?: 'money' | 'number' | 'text';
}

export type CellValue = string | number | null;

/** Prices as the price book holds them: absent is null, not zero. */
export interface ExportPrices {
  wholesale: number | null;
  cost: number | null;
  costBulk: number | null;
  msrp: number | null;
  map: number | null;
}

export interface ExportItem {
  product: CatalogProduct;
  /** Theme label, e.g. "Presidents" — not the raw `products.line` id. */
  lineLabel: string;
  size: SheetSize;
  prices: ExportPrices;
  overrides?: ProductOverrides | null;
  /** Public thumbnail URL, or '' when the product has none. */
  imageUrl: string;
}

/**
 * `brief` is the sheet a customer sees: what it is, its number, what it costs.
 * `full` is the internal one, and includes cost — which is why it is not the
 * default and why the two are separate names rather than a boolean at the call
 * site spelled `true`.
 */
export type ExportShape = 'brief' | 'full';

export interface PriceBookSheet {
  columns: readonly ExportColumn[];
  rows: ReadonlyArray<Record<string, CellValue>>;
}

const BRIEF: readonly ExportColumn[] = [
  { key: 'name', header: 'Item Name', width: 42 },
  { key: 'sku', header: 'SKU', width: 26 },
  { key: 'wholesale', header: 'Wholesale Price', width: 16, kind: 'money' },
  { key: 'image', header: 'Image URL', width: 60 },
];

const FULL: readonly ExportColumn[] = [
  { key: 'name', header: 'Item Name', width: 40 },
  { key: 'sku', header: 'SKU', width: 26 },
  { key: 'fnsku', header: 'FNSKU', width: 14 },
  { key: 'asin', header: 'ASIN', width: 12 },
  { key: 'size', header: 'Size', width: 8 },
  { key: 'theme', header: 'Theme', width: 15 },
  { key: 'costIndiv', header: 'Cost Indiv', width: 10, kind: 'money' },
  { key: 'costBulk', header: 'Cost Bulk', width: 10, kind: 'money' },
  { key: 'wholesale', header: 'Wholesale Price', width: 13, kind: 'money' },
  { key: 'msrp', header: 'MSRP', width: 10, kind: 'money' },
  { key: 'itemWt', header: 'Item Wt (oz)', width: 11, kind: 'number' },
  { key: 'shipWt', header: 'B2C Ship Wt (oz)', width: 14, kind: 'number' },
  { key: 'casePack', header: 'Case Pack', width: 10, kind: 'number' },
  { key: 'caseDims', header: 'Case Dims', width: 11 },
  { key: 'image', header: 'Image URL', width: 52 },
];

export function columnsFor(shape: ExportShape): readonly ExportColumn[] {
  return shape === 'full' ? FULL : BRIEF;
}

/** One decimal place, as a number — the legacy `+x.toFixed(1)`. */
function oneDp(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the sheet.
 *
 * Weights come from the domain layer rather than being recomputed here, so a
 * manual override entered on the wholesale screen is the figure that appears in
 * the export — the legacy `getItemOz`/`getShipOz` read the same localStorage
 * maps the screen wrote, which is why the two agreed on one iPad and nowhere
 * else.
 */
export function buildPriceBook(
  items: readonly ExportItem[],
  options: { shape: ExportShape; settings: PackingSettings },
): PriceBookSheet {
  const { shape, settings } = options;
  const columns = columnsFor(shape);

  const rows = items.map((item) => {
    const { product, prices, overrides, size } = item;

    const base: Record<string, CellValue> = {
      name: product.title ?? product.sku,
      sku: product.sku,
      wholesale: prices.wholesale,
      image: item.imageUrl || null,
    };

    if (shape === 'brief') return base;

    return {
      ...base,
      fnsku: product.fnskuCode ?? null,
      asin: product.asin ?? null,
      size: product.size ?? size,
      theme: item.lineLabel,
      costIndiv: prices.cost,
      costBulk: prices.costBulk,
      msrp: prices.msrp,
      itemWt: oneDp(itemOz(product, size, settings, overrides)),
      shipWt: oneDp(shipOz(product, size, settings, overrides)),
      casePack: casePack(product, size, settings, overrides),
      caseDims: CARTONS[0],
    };
  });

  return { columns, rows };
}

/**
 * `JBG_Wholesale_Presidents.xlsx`. Ported from `exportFilename` (:1215), which
 * named every file after whatever the catalog tab happened to be showing.
 */
export function exportFilename(scope: string, extension: string): string {
  const slug = (scope || 'catalog').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `JBG_Wholesale_${slug || 'catalog'}.${extension}`;
}
