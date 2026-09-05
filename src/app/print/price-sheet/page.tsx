import type { Metadata } from 'next';
import { documentQueryFrom, resolveDocument } from '@/lib/export/selection';
import { skuInitials } from '@/lib/ui/initials';
import { usd } from '@/lib/ui/money';
import { DocHead } from '../DocHead';
import { PrintImage } from '../PrintImage';
import { PrintToolbar } from '../PrintToolbar';
import type { ExportItem } from '@/lib/export/priceBook';

/**
 * The wholesale price sheet, as a route.
 *
 * Ported from `exportPDF` (index.html:1235), which concatenated an entire HTML
 * document — doctype, `<style>`, an inline base64 logo and a `<script>` that
 * called `window.print()` on a timer — into a string and wrote it into a
 * `window.open`ed tab. That tab could not be refreshed, linked, or reopened,
 * and pop-up blocking silently produced nothing at all.
 *
 * The slice is in the URL, so this page can be sent to somebody:
 *
 *   /print/price-sheet?line=presidents
 *   /print/price-sheet?skus=JBG-POS-LAM-A,JBG-POS-LAM-B
 *   /print/price-sheet?q=eagle&auto=1
 *
 * One deliberate change: a product with no price reads "Price on request"
 * rather than leaving an empty gap where a number should be. The legacy sheet
 * printed the gap, and it was routinely read as free.
 */

interface SearchParams {
  skus?: string;
  line?: string;
  size?: string;
  q?: string;
  auto?: string;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { scope } = await resolveDocument(documentQueryFrom(await searchParams).query);
  return { title: `JBG Wholesale — ${scope}` };
}

export default async function PriceSheetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { query, dropped } = documentQueryFrom(params);
  const { items, scope } = await resolveDocument(query);

  const title = `JBG Wholesale — ${scope}`;
  const priced = items.filter((i) => i.prices.wholesale != null).length;
  const groups = groupByTheme(items);

  return (
    <>
      <DocHead
        title={title}
        subtitle={`Jelly Bean Genius · Wholesale price sheet · ${items.length} ${
          items.length === 1 ? 'item' : 'items'
        }`}
      />

      <PrintToolbar auto={params.auto === '1'} hint={hint(items.length, priced, dropped)} />

      {items.length === 0 ? (
        <p className="doc-empty">Nothing matched that selection, so there is no sheet to print.</p>
      ) : (
        groups.map(([theme, group]) => (
          <section key={theme}>
            {/* One theme needs no heading — the masthead already named it. */}
            {groups.length > 1 && <h2 className="doc-section">{theme}</h2>}
            <div className="doc-grid">
              {group.map((item) => (
                <ProductCard key={item.product.sku} item={item} />
              ))}
            </div>
          </section>
        ))
      )}

      <p className="doc-foot">
        Jelly Bean Genius — prices subject to change. Generated from the live catalog.
      </p>
    </>
  );
}

/** What the toolbar says about the sheet, when there is something to say. */
function hint(total: number, priced: number, dropped: number): string | undefined {
  const notes: string[] = [];
  if (dropped > 0) notes.push(`${dropped} more were asked for than one sheet holds and were left off.`);
  if (priced < total) notes.push(`${total - priced} of ${total} have no wholesale price set.`);
  return notes.length > 0 ? notes.join(' ') : undefined;
}

function ProductCard({ item }: { item: ExportItem }) {
  const price = usd(item.prices.wholesale);

  return (
    <article className="wc">
      <div className="wc-im">
        {item.imageUrl ? (
          <PrintImage src={item.imageUrl} alt={item.product.title ?? item.product.sku} />
        ) : (
          <span>{skuInitials(item.product.sku)}</span>
        )}
      </div>
      <div className="wc-nm">{item.product.title ?? item.product.sku}</div>
      <div className="wc-sku">{item.product.sku}</div>
      <div className={price ? 'wc-pr' : 'wc-pr tbd'}>{price ?? 'Price on request'}</div>
    </article>
  );
}

/** Items arrive sorted by theme, so consecutive runs are the groups. */
function groupByTheme(items: readonly ExportItem[]): Array<[string, ExportItem[]]> {
  const groups: Array<[string, ExportItem[]]> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0] === item.lineLabel) last[1].push(item);
    else groups.push([item.lineLabel, [item]]);
  }
  return groups;
}
