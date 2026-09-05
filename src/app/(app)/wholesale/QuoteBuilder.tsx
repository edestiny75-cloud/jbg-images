'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, MoneyInput, QtyInput, TextArea, TextInput, parseMoney } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Thumb } from '@/components/domain/Thumb';
import { usd } from '@/lib/ui/money';
import { raiseQuote } from './actions';

/**
 * The multi-product quote builder. Ported from `renderQuoteBuilder`
 * (index.html:1444) and the `QUOTE_CART` global behind it.
 *
 * The cart was a module-level array that survived every close of the modal, so
 * reopening the builder showed the last customer's items unless the caller
 * happened to pass a seed — `openQuoteBuilder` cleared it only when
 * `seed.length || !QUOTE_CART.length`, which meant "reopening with no seed
 * keeps whatever was there". The cart is component state now and the component
 * is mounted when the modal opens, so it starts from the checked rows every
 * time.
 */

export interface QuoteSeedLine {
  sku: string;
  title: string;
  thumb: string | null;
  /** The wholesale price as the sheet currently shows it, including staged edits. */
  unitPrice: string;
}

interface CartLine extends QuoteSeedLine {
  qty: number | '';
}

export function QuoteBuilder({ seed, onClose }: { seed: readonly QuoteSeedLine[]; onClose: () => void }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CartLine[]>(() => seed.map((s) => ({ ...s, qty: 1 })));

  const patch = (sku: string, next: Partial<CartLine>) =>
    setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, ...next } : l)));

  const lineTotal = (line: CartLine) => (line.qty === '' ? 0 : line.qty * (parseMoney(line.unitPrice) ?? 0));
  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const unpriced = lines.filter((l) => parseMoney(l.unitPrice) == null).length;

  const submit = () => {
    const payload = lines
      .filter((l) => l.qty !== '' && l.qty > 0)
      .map((l) => ({
        productSku: l.sku,
        title: l.title,
        qty: l.qty as number,
        // A blank price on a quote means zero, and saying so is the point of a
        // quote — but it is worth warning about first, which the footer does.
        unitPrice: parseMoney(l.unitPrice) ?? 0,
      }));

    if (payload.length === 0) {
      toast('Every line is set to zero, so there is nothing to quote.', 'warn');
      return;
    }

    startTransition(async () => {
      const result = await raiseQuote({ customer, notes, lines: payload });
      if (!result.ok) {
        toast(result.error, 'danger');
        return;
      }
      toast(`Quote #${result.data.number} created for ${customer.trim() || 'Customer'}.`, 'success');
      onClose();
      // A new tab, because the quote is a document to hand over — and unlike the
      // legacy `window.open` of a generated string, this one has a URL that
      // works if the pop-up blocker eats it.
      window.open(`/print/quote/${result.data.id}?auto=1`, '_blank', 'noopener');
    });
  };

  const columns: ReadonlyArray<Column<CartLine>> = [
    {
      key: 'item',
      header: 'Item',
      cell: (line) => (
        <span className="flex items-center gap-2">
          <Thumb sku={line.sku} src={line.thumb} size="sm" />
          <span className="flex flex-col">
            <b className="line-clamp-2 max-w-56">{line.title}</b>
            <code className="font-mono text-xs text-muted">{line.sku}</code>
          </span>
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      width: 'w-24',
      cell: (line) => (
        <QtyInput
          aria-label={`Quantity of ${line.sku}`}
          value={line.qty}
          onValueChange={(qty) => patch(line.sku, { qty })}
        />
      ),
    },
    {
      key: 'price',
      header: 'Unit $',
      width: 'w-32',
      cell: (line) => (
        <MoneyInput
          aria-label={`Unit price of ${line.sku}`}
          value={line.unitPrice}
          onValueChange={(unitPrice) => patch(line.sku, { unitPrice })}
          placeholder="0.00"
        />
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      width: 'w-28',
      cell: (line) => <span className="font-bold tabular-nums">{usd(lineTotal(line))}</span>,
    },
    {
      key: 'remove',
      header: '',
      align: 'center',
      width: 'w-12',
      cell: (line) => (
        <Button
          size="sm"
          tone="ghost"
          aria-label={`Remove ${line.sku} from the quote`}
          onClick={() => setLines((prev) => prev.filter((l) => l.sku !== line.sku))}
        >
          ×
        </Button>
      ),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="🧾 Create wholesale quote"
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            {lines.length} {lines.length === 1 ? 'item' : 'items'} ·{' '}
            <b className="text-ink">{usd(grandTotal)}</b>
            {unpriced > 0 && (
              <span className="ml-2 text-warn-fg">
                {unpriced} with no price — they will quote at $0.00
              </span>
            )}
          </span>
          <Button tone="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} pending={pending} disabled={lines.length === 0}>
            Create quote →
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer / company">
            {(id) => (
              <TextInput
                id={id}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Acme School Supply"
                autoFocus
              />
            )}
          </Field>
          <Field label="Notes" hint="Printed under the table. Delivery terms, PO number, anything.">
            {(id) => <TextArea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>

        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => line.sku}
          empty="No items left on this quote. Close, check some rows and start again."
        />
      </div>
    </Modal>
  );
}
