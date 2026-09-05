import { getSettings, listOverrides, listProductLines, listProducts, quoteHistoryBySku } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { productAssetUrls } from '@/lib/products/assets';
import { isSheetSize, resolveSize } from '@/lib/domain';
import type { ProductQuote } from '@/components/domain/QuoteLog';
import { CatalogBrowser, type CatalogEntry } from './CatalogBrowser';

/**
 * The catalog, as a Server Component.
 *
 * All 265 rows plus their line configs and asset URLs are assembled here and
 * sent down once. The legacy tool shipped the same data to every browser as a
 * 136 KB `BYSKU` constant and rebuilt every URL client-side.
 */
export const metadata = { title: 'Catalog · JBG Fulfillment' };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  // The proxy redirects here when a role is turned away from a route, rather
  // than showing a 403 nobody can act on. Say why, once.
  const { denied } = await searchParams;

  const [products, lines, settings, overrides, session, quoteHistory] = await Promise.all([
    listProducts(),
    listProductLines(),
    getSettings(),
    listOverrides(),
    auth(),
    quoteHistoryBySku(),
  ]);

  const lineById = new Map(lines.map((l) => [l.id, l]));

  const entries: CatalogEntry[] = products.map((product) => {
    const line = lineById.get(product.line ?? '') ?? null;
    const override = overrides.get(product.sku);
    return {
      product,
      lineLabel: line?.label ?? product.line ?? 'Other',
      size: resolveSize({
        overrideSize: isSheetSize(override?.size) ? override.size : null,
        product,
        sku: product.sku,
      }),
      urls: productAssetUrls(product, line),
      line,
      overrides: override ?? null,
    };
  });

  // Only quoted SKUs are sent down, and Dates become strings on the way — most
  // of the catalog has never been quoted, so this map is short.
  const quotes: Record<string, ProductQuote[]> = {};
  for (const [sku, mentions] of quoteHistory) {
    quotes[sku] = mentions.map((m) => ({
      number: m.number,
      customer: m.customer,
      qty: m.qty,
      unitPrice: m.unitPrice,
      date: m.createdAt.toISOString(),
    }));
  }

  // Tab order comes from product_lines.sort_order, not from whatever the
  // catalog query happened to return first.
  const tabs = lines
    .filter((l) => products.some((p) => p.line === l.id))
    .map((l) => ({ id: l.id, label: l.label }));

  return (
    <>
      {denied && (
        <p className="mb-4 rounded-md border border-warn-fg/25 bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          <b>{denied}</b> needs a higher role than yours. Ask an admin if you need access.
        </p>
      )}
      <CatalogBrowser
        entries={entries}
        lines={tabs}
        settings={settings}
        canExport={can.plan(session?.user.role)}
        quotes={quotes}
      />
    </>
  );
}
