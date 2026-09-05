'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { usd } from '@/lib/ui/money';
import { removeQuote } from './actions';

/**
 * Quotes already raised.
 *
 * There was no such list. A legacy quote existed as a pop-up window and a
 * localStorage entry on the device that made it, so "what did we quote Acme?"
 * had no answer unless you were holding the right iPad.
 */

export interface QuoteRow {
  id: string;
  number: number;
  customer: string | null;
  createdAt: string;
  createdBy: string | null;
  lineCount: number;
  total: number;
}

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

export function QuotesPanel({ quotes, canDelete }: { quotes: readonly QuoteRow[]; canDelete: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const open = (id: string) => window.open(`/print/quote/${id}`, '_blank', 'noopener');

  const remove = (row: QuoteRow) => {
    if (!confirm(`Delete quote #${row.number} for ${row.customer ?? 'Customer'}? This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      const result = await removeQuote({ id: row.id });
      toast(result.ok ? `Quote #${row.number} deleted.` : result.error, result.ok ? 'success' : 'danger');
      if (result.ok) router.refresh();
    });
  };

  const columns: ReadonlyArray<Column<QuoteRow>> = [
    {
      key: 'number',
      header: 'Quote',
      width: 'w-20',
      cell: (row) => <b className="tabular-nums">#{row.number}</b>,
    },
    { key: 'customer', header: 'Customer', cell: (row) => row.customer ?? 'Customer' },
    {
      key: 'items',
      header: 'Items',
      align: 'right',
      width: 'w-20',
      cell: (row) => <span className="tabular-nums">{row.lineCount}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      width: 'w-28',
      cell: (row) => <span className="font-bold tabular-nums">{usd(row.total)}</span>,
    },
    {
      key: 'raised',
      header: 'Raised',
      secondary: true,
      cell: (row) => (
        <span className="text-muted">
          {DATE.format(new Date(row.createdAt))}
          {row.createdBy && ` · ${row.createdBy}`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 'w-44',
      cell: (row) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" tone="ghost" onClick={() => open(row.id)}>
            Open ↗
          </Button>
          {canDelete && (
            <Button size="sm" tone="ghost" disabled={pending} onClick={() => remove(row)}>
              Delete
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Card className="p-5">
      <h2 className="text-lg font-extrabold">Recent quotes</h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        Every quote raised from this sheet, by anyone. Opening one reprints it exactly as the
        customer received it — the prices on it do not move when the price book does.
      </p>
      <DataTable
        columns={columns}
        rows={quotes}
        rowKey={(row) => row.id}
        empty="No quotes yet. Check some rows above and press Quote."
      />
    </Card>
  );
}
