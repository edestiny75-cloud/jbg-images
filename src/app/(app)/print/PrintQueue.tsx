'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QtyInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ProductCell } from '@/components/domain/ProductCell';
import { useSelection } from '@/lib/hooks/useSelection';
import { isTwoSided } from '@/lib/files';
import type { SheetSize } from '@/lib/domain';
import { queuePrintJobs } from './actions';

/**
 * Ported from `viewPrint` (index.html:932) and its six helpers — `printToggle`,
 * `printSelectAll`, `printClear`, `printQtyVal`, `setPrintQty`, `resetPrintQty`
 * — each of which called a full `render()`.
 */

export interface PrintRow {
  sku: string;
  title: string;
  thumbUrl: string | null;
  /** The full list quantity. */
  requested: number;
  size: SheetSize;
  sheets: number;
  fileName: string;
  pdfPath: string | null;
}

export interface PrintSection {
  size: SheetSize;
  rows: PrintRow[];
}

export function PrintQueue({
  batchId,
  orderName,
  sections,
}: {
  batchId: number;
  orderName: string;
  sections: readonly PrintSection[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  /** Per-SKU override of "copies to send". Absent means send the full quantity. */
  const [copies, setCopies] = useState<Record<string, number>>({});
  const selection = useSelection((r: PrintRow) => r.sku);

  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const copiesFor = (row: PrintRow) => copies[row.sku] ?? row.requested;

  const send = (rows: readonly PrintRow[], label: string) => {
    if (rows.length === 0) {
      toast('Check some rows first.', 'warn');
      return;
    }
    startTransition(async () => {
      const result = await queuePrintJobs({
        batchId,
        jobs: rows.map((r) => ({ sku: r.sku, size: r.size, copies: copiesFor(r) })),
      });
      if (result.ok) {
        toast(`${label}: ${result.files} file(s), ${result.copies} copies → Fiery.`, 'success');
        selection.clear();
      } else {
        toast(result.error, 'danger');
      }
    });
  };

  const columns: ReadonlyArray<Column<PrintRow>> = [
    {
      key: 'check',
      header: (
        <button
          type="button"
          onClick={() =>
            selection.count === allRows.length ? selection.clear() : selection.selectAll(allRows)
          }
          className="min-h-touch px-1"
        >
          {selection.count === allRows.length && allRows.length > 0 ? '✓' : '▢'}
        </button>
      ),
      width: 'w-12',
      align: 'center',
      cell: (row) => (
        <label className="flex min-h-touch items-center justify-center">
          <span className="sr-only">Send {row.sku}</span>
          <input
            type="checkbox"
            checked={selection.isSelected(row)}
            onChange={(e) => selection.set(row, e.target.checked)}
            className="size-5 accent-mint"
          />
        </label>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      cell: (row) => (
        <ProductCell
          sku={row.sku}
          title={row.title}
          thumbUrl={row.thumbUrl}
          detail={row.sheets > 1 ? `📦 ${row.sheets}-poster bundle master` : undefined}
        />
      ),
    },
    { key: 'onList', header: 'On list', align: 'right', width: 'w-20', cell: (row) => <span className="text-lg font-extrabold tabular-nums">{row.requested}</span> },
    {
      key: 'file',
      header: 'Print file → Fiery',
      secondary: true,
      cell: (row) => (
        <span className="block">
          <code className="font-mono text-xs text-muted">{row.fileName}</code>
          {row.size === '11x17' && isTwoSided(row.pdfPath) && (
            <span className="mt-0.5 block text-xs text-muted-dim">Side A colour · Side B B&amp;W</span>
          )}
        </span>
      ),
    },
    {
      key: 'send',
      header: 'Copies to send',
      align: 'right',
      width: 'w-64',
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          <span className="w-20">
            <QtyInput
              aria-label={`Copies of ${row.sku}`}
              value={copiesFor(row)}
              onValueChange={(v) =>
                setCopies((prev) => ({ ...prev, [row.sku]: v === '' ? 1 : Math.min(999, Math.max(1, v)) }))
              }
            />
          </span>
          {copiesFor(row) !== row.requested && (
            <Button
              size="sm"
              tone="ghost"
              title={`Reset to the full list quantity (${row.requested})`}
              onClick={() =>
                setCopies((prev) => {
                  const next = { ...prev };
                  delete next[row.sku];
                  return next;
                })
              }
            >
              ↺ {row.requested}
            </Button>
          )}
          <Button size="sm" pending={pending} onClick={() => send([row], 'Sent')}>
            Send
          </Button>
        </span>
      ),
    },
  ];

  const checked = allRows.filter((r) => selection.isSelected(r));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Print Queue</h1>
        <p className="mt-1 text-sm text-muted">
          Follows the edited list for <b className="text-ink">{orderName}</b> — held lines drop out
          and changed quantities update here. Each row shows the full list quantity; change{' '}
          <b>copies to send</b> to send only some.
        </p>
      </header>

      {allRows.length === 0 ? (
        <p className="rounded-md border border-line bg-panel px-4 py-10 text-center text-muted">
          Nothing on this order has a print file yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button pending={pending} onClick={() => send(allRows, 'Whole queue sent')}>
              Send whole queue in order
            </Button>
            <Chip>{checked.length} checked</Chip>
            <Button size="sm" tone="ghost" onClick={selection.clear}>
              Clear
            </Button>
            <Button
              tone="purple"
              disabled={checked.length === 0}
              pending={pending}
              onClick={() => send(checked, 'Sent checked')}
            >
              🖨 Send checked → Fiery ({checked.length})
            </Button>
          </div>

          {sections.map((section) => (
            <section key={section.size} className="flex flex-col gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">
                {section.size} · {section.rows.length} file{section.rows.length === 1 ? '' : 's'}
              </h2>
              <DataTable columns={columns} rows={section.rows} rowKey={(r) => r.sku} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
