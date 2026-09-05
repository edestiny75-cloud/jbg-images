import 'server-only';
import { getSettings, listOverrides, listPrices, listProductLines, listProducts } from '@/lib/db';
import { thumbUrl } from '@/lib/assets';
import { compareProducts, isSheetSize, resolveSize } from '@/lib/domain';
import type { PackingSettings } from '@/lib/domain';
import { MAX_SELECTION } from './priceBook';
import type { ExportItem } from './priceBook';

/**
 * Which products a document covers.
 *
 * One resolver for both outputs — the .xlsx download and the printed price
 * sheet — so the two can never disagree about what "the current selection"
 * means. In the legacy tool `exportExcel` and `exportPDF` each called
 * `selectedProducts()` but `exportPDF` titled itself from `STATE.catQ` while
 * `exportExcel` titled itself from `STATE.catLine`, so the same click could
 * produce a spreadsheet and a PDF with different names over the same rows.
 */

export interface DocumentQuery {
  /** An explicit hand-picked set. Wins over the filters when present. */
  skus?: readonly string[];
  /** A `product_lines.id`. */
  line?: string;
  /** A `products.size` value, e.g. "11x17". */
  size?: string;
  /** Free text over SKU, title, ASIN and FNSKU. */
  q?: string;
}

export interface ResolvedDocument {
  items: ExportItem[];
  settings: PackingSettings;
  /** Human-readable description of the slice, for titles and filenames. */
  scope: string;
}

export async function resolveDocument(query: DocumentQuery): Promise<ResolvedDocument> {
  const [products, lines, settings, prices, overrides] = await Promise.all([
    listProducts(),
    listProductLines(),
    getSettings(),
    listPrices(),
    listOverrides(),
  ]);

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const picked = query.skus?.length ? new Set(query.skus) : null;

  const q = (query.q ?? '').trim().toLowerCase();

  const labelOf = (product: { line?: string | null }) =>
    lineById.get(product.line ?? '')?.label ?? product.line ?? 'Other';

  const matched = products.filter((product) => {
    if (picked) return picked.has(product.sku);
    if (query.line && product.line !== query.line) return false;
    if (query.size && (product.size ?? '') !== query.size) return false;
    if (!q) return true;
    // The same haystack the wholesale screen searches, theme label included, so
    // "export what I am looking at" exports what is on screen.
    const hay = `${product.sku} ${product.title ?? ''} ${product.asin ?? ''} ${product.fnskuCode ?? ''} ${labelOf(product)}`;
    return hay.toLowerCase().includes(q);
  });

  const items: ExportItem[] = matched
    .map((product) => {
      const override = overrides.get(product.sku) ?? null;
      return {
        product,
        lineLabel: labelOf(product),
        size: resolveSize({
          overrideSize: isSheetSize(override?.size) ? override.size : null,
          product,
          sku: product.sku,
        }),
        prices: prices.get(product.sku) ?? {
          wholesale: null,
          cost: null,
          costBulk: null,
          msrp: null,
          map: null,
        },
        overrides: override,
        imageUrl: thumbUrl(product),
      };
    })
    // Theme, then the catalog's own order inside it — the order the wholesale
    // screen shows, so the printed sheet reads the way the screen did.
    .sort((a, b) => a.lineLabel.localeCompare(b.lineLabel) || compareProducts(a.product, b.product));

  return { items, settings, scope: scopeLabel(query, lineById) };
}

function scopeLabel(
  query: DocumentQuery,
  lineById: ReadonlyMap<string, { label: string }>,
): string {
  if (query.skus?.length) return 'Selected Items';
  if (query.line) return lineById.get(query.line)?.label ?? query.line;
  if (query.q?.trim()) return `“${query.q.trim()}”`;
  if (query.size) return query.size;
  return 'Catalog';
}

/**
 * Read a document query out of URL search params, in one place.
 *
 * A selection longer than `MAX_SELECTION` is cut, and `dropped` says by how
 * much so the page can admit it. The .xlsx route refuses an oversized request
 * outright instead — it can, because it answers with a status code, whereas a
 * page that 400s over a long URL is no use to anybody.
 */
export function documentQueryFrom(params: {
  skus?: string;
  line?: string;
  size?: string;
  q?: string;
}): { query: DocumentQuery; dropped: number } {
  const all = (params.skus ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const skus = all.slice(0, MAX_SELECTION);

  return {
    query: {
      ...(skus.length ? { skus } : {}),
      ...(params.line ? { line: params.line } : {}),
      ...(params.size ? { size: params.size } : {}),
      ...(params.q ? { q: params.q } : {}),
    },
    dropped: all.length - skus.length,
  };
}
