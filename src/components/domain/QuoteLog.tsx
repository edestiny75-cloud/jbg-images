import { usd } from '@/lib/ui/money';

/**
 * What this product has been quoted at. Ported from `quoteLogHtml`
 * (index.html:1421).
 *
 * The legacy version read `QUOTES[sku]` out of localStorage, so it showed the
 * quotes raised on *that iPad* and nothing else — two people quoting the same
 * customer saw two different histories, and neither saw the other's price. This
 * reads the `quotes` table, so there is one answer.
 */

export interface ProductQuote {
  number: number;
  customer: string;
  qty: number;
  unitPrice: number;
  /** ISO string: dates cross the server/client boundary as text. */
  date: string;
}

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/** Six, as the original showed — enough to see the trend, short enough to skim. */
const SHOWN = 6;

export function QuoteLog({ quotes }: { quotes: readonly ProductQuote[] }) {
  if (quotes.length === 0) {
    return <p className="text-sm text-muted-dim">No quotes sent yet for this product.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
        🧾 Quotes sent ({quotes.length})
      </h4>
      <ul className="flex flex-col gap-1 text-sm">
        {quotes.slice(0, SHOWN).map((q) => (
          <li
            key={`${q.number}-${q.date}`}
            className="flex flex-wrap items-baseline gap-x-3 rounded-xs bg-panel-2 px-2.5 py-1.5"
          >
            <b className="text-ink">{q.customer}</b>
            <span className="tabular-nums text-muted">{q.qty}×</span>
            <span className="tabular-nums text-muted">@ {usd(q.unitPrice)}</span>
            <span className="font-bold tabular-nums text-mint">{usd(q.qty * q.unitPrice)}</span>
            <span className="ml-auto text-xs text-muted-dim">
              #{q.number} · {DATE.format(new Date(q.date))}
            </span>
          </li>
        ))}
      </ul>
      {quotes.length > SHOWN && (
        <p className="text-xs text-muted-dim">
          and {quotes.length - SHOWN} more — the full list is on the Wholesale tab.
        </p>
      )}
    </div>
  );
}
