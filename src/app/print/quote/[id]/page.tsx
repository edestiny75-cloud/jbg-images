import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { thumbUrl } from '@/lib/assets';
import { getQuote, productMap } from '@/lib/db';
import { skuInitials } from '@/lib/ui/initials';
import { usd } from '@/lib/ui/money';
import { DocHead } from '../../DocHead';
import { PrintImage } from '../../PrintImage';
import { PrintToolbar } from '../../PrintToolbar';

/**
 * A wholesale quote, as a route.
 *
 * Ported from `quoteMultiHtml` + `downloadQuoteMulti` (index.html:1456, :1477),
 * which built the document as a string and wrote it into a `window.open`ed tab.
 * Two consequences of that, both fixed by this being a real page:
 *
 *  - The quote existed only in that tab. Closing it lost the document, and the
 *    only record left behind was a localStorage entry on the device that made
 *    it. This one has an id and a number, and can be reopened by anyone.
 *  - Pop-up blocking produced nothing — `window.open` returned null and the
 *    tool said "Allow pop-ups to open the quote", which on an iPad in a shop is
 *    where the quote ended.
 */

// The date the quote was raised, not the date it was printed — the legacy
// `todayStr()` stamped the latter, so reprinting an old quote re-dated it and
// silently extended the 30-day validity.
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const quote = await getQuote((await params).id);
  if (!quote) return { title: 'Quote not found' };
  return { title: `JBG Quote #${quote.number} — ${quote.customer ?? 'Customer'}` };
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ id }, { auto }] = await Promise.all([params, searchParams]);

  const [quote, products] = await Promise.all([getQuote(id), productMap()]);
  if (!quote) notFound();

  const customer = quote.customer ?? 'Customer';

  return (
    <>
      <DocHead title="Wholesale Quote" subtitle="Jelly Bean Genius · Fulfillment" />

      <div className="doc-meta">
        <div>
          <b>To:</b> {customer}
        </div>
        <div>
          <b>Quote:</b> #{quote.number}
        </div>
        <div>
          <b>Date:</b> {DATE.format(quote.createdAt)}
        </div>
      </div>

      <PrintToolbar auto={auto === '1'} />

      <table className="doc-table">
        <thead>
          <tr>
            <th>Image</th>
            <th>Item</th>
            <th>SKU</th>
            <th className="num">Qty</th>
            <th className="num">Unit Price</th>
            <th className="num">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => {
            const product = products.get(line.productSku);
            const image = product ? thumbUrl(product) : '';
            return (
              <tr key={line.id}>
                <td>
                  {image ? (
                    <PrintImage
                      src={image}
                      alt={line.title ?? line.productSku}
                      className="doc-pimg"
                    />
                  ) : (
                    <span className="wc-sku">{skuInitials(line.productSku)}</span>
                  )}
                </td>
                <td>{line.title ?? product?.title ?? line.productSku}</td>
                <td>{line.productSku}</td>
                <td className="num">{line.qty}</td>
                <td className="num">{usd(line.unitPrice)}</td>
                <td className="num">{usd(line.lineTotal)}</td>
              </tr>
            );
          })}
          <tr className="total">
            <td colSpan={5} style={{ textAlign: 'right' }}>
              Quote Total
            </td>
            <td className="num">{usd(quote.total)}</td>
          </tr>
        </tbody>
      </table>

      {quote.notes && <div className="doc-notes">{quote.notes}</div>}

      <p className="doc-foot">
        Prices valid 30 days from the date above. Jelly Bean Genius — thank you for your business.
      </p>
    </>
  );
}
