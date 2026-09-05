import {
  getSettings,
  listOverrides,
  listPrices,
  listProductLines,
  listProducts,
  listQuotes,
} from '@/lib/db';
import { thumbUrl } from '@/lib/assets';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { isSheetSize, resolveSize } from '@/lib/domain';
import { QuotesPanel, type QuoteRow } from './QuotesPanel';
import { WholesaleSheet, type SheetRow } from './WholesaleSheet';

/**
 * The wholesale sheet. Ported from `viewWholesale` (index.html:1322).
 *
 * The whole catalog, its prices and its weight overrides are joined here, on
 * the server, and sent down once. The legacy screen read the same five prices
 * out of five separate localStorage maps on every render, which is how the
 * shop's price book came to live on one iPad.
 */
export const metadata = { title: 'Wholesale Sheet · JBG Fulfillment' };

export default async function WholesalePage() {
  const [products, lines, settings, prices, overrides, quotes, session] = await Promise.all([
    listProducts(),
    listProductLines(),
    getSettings(),
    listPrices(),
    listOverrides(),
    listQuotes(15),
    auth(),
  ]);

  const lineById = new Map(lines.map((l) => [l.id, l]));

  // Theme, then the catalog's own order within it — the legacy sort, with the
  // line label compared once rather than rebuilt per comparison.
  const sorted = [...products].sort((a, b) => {
    const la = lineById.get(a.line ?? '')?.label ?? a.line ?? '';
    const lb = lineById.get(b.line ?? '')?.label ?? b.line ?? '';
    return la.localeCompare(lb);
  });

  const money = (v: number | null | undefined) => (v == null ? '' : String(v));

  const rows: SheetRow[] = sorted.map((product) => {
    const price = prices.get(product.sku);
    const override = overrides.get(product.sku);
    return {
      product,
      lineId: product.line ?? '',
      lineLabel: lineById.get(product.line ?? '')?.label ?? product.line ?? 'Other',
      size: resolveSize({
        overrideSize: isSheetSize(override?.size) ? override.size : null,
        product,
        sku: product.sku,
      }),
      thumb: thumbUrl(product) || null,
      prices: {
        wholesale: money(price?.wholesale),
        cost: money(price?.cost),
        costBulk: money(price?.costBulk),
        msrp: money(price?.msrp),
        map: money(price?.map),
      },
      weights: {
        weightOz: money(override?.weightOz),
        shipWeightOz: money(override?.shipWeightOz),
      },
    };
  });

  const themes = lines
    .filter((l) => products.some((p) => p.line === l.id))
    .map((l) => ({ id: l.id, label: l.label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const sizes = [...new Set(products.map((p) => p.size).filter((s): s is string => Boolean(s)))].sort();

  // Dates cross the server/client boundary as strings; the panel formats them.
  const quoteRows: QuoteRow[] = quotes.map((q) => ({
    ...q,
    createdAt: q.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <WholesaleSheet rows={rows} themes={themes} sizes={sizes} settings={settings} />
      <QuotesPanel quotes={quoteRows} canDelete={can.deleteOrders(session?.user.role)} />
    </div>
  );
}
