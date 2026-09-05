'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatCard, StatRow } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import type { Shortage } from '@/lib/domain';
import { shipAll, shipBox } from './actions';

/**
 * The shipment log: one row per finished box, and the button that closes it out.
 *
 * The legacy screen (index.html:1148) rebuilt this table as an HTML string on
 * every render and interpolated `r.asin` straight into the markup. Contents are
 * a real list here, and a line the packer came up short on is marked in place
 * rather than only in the banner above.
 */

export interface RegisterContent {
  sku: string;
  asin: string | null;
  packed: number;
  planned: number;
}

export interface RegisterRow {
  id: number;
  boxNo: number;
  status: 'packed' | 'shipped';
  carton: string;
  size: string;
  weightLb: number;
  units: number;
  contents: RegisterContent[];
  labels: string[];
}

export function RegisterTable({
  batchId,
  orderName,
  orderStatus,
  shipmentNo,
  rows,
  shortages,
  totalBoxes,
}: {
  batchId: number;
  orderName: string;
  orderStatus: string;
  shipmentNo: number | null;
  rows: readonly RegisterRow[];
  shortages: readonly Shortage[];
  totalBoxes: number;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const shipped = rows.filter((r) => r.status === 'shipped').length;
  const waiting = rows.length - shipped;
  const shortPieces = shortages.reduce((sum, s) => sum + s.short, 0);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      const result = await task();
      toast(result.ok ? success : (result.error ?? 'That did not work.'), result.ok ? 'success' : 'danger');
      if (result.ok) router.refresh();
    });
  };

  const columns: ReadonlyArray<Column<RegisterRow>> = [
    {
      key: 'boxNo',
      header: 'Box',
      align: 'center',
      width: 'w-16',
      cell: (row) => <span className="text-lg font-extrabold tabular-nums">{row.boxNo}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-28',
      cell: (row) =>
        row.status === 'shipped' ? (
          <Chip tone="success">SHIPPED</Chip>
        ) : (
          <Chip tone="warn">packed</Chip>
        ),
    },
    { key: 'carton', header: 'Carton', secondary: true, cell: (row) => row.carton },
    { key: 'size', header: 'Size', align: 'center', width: 'w-24', cell: (row) => row.size },
    {
      key: 'weight',
      header: 'Weight',
      align: 'right',
      width: 'w-24',
      cell: (row) => <span className="tabular-nums">{row.weightLb.toFixed(1)} lb</span>,
    },
    {
      key: 'units',
      header: 'Units',
      align: 'right',
      width: 'w-20',
      cell: (row) => <span className="font-bold tabular-nums">{row.units}</span>,
    },
    {
      key: 'contents',
      header: 'Contents (ASIN × qty)',
      cell: (row) => (
        <ul className="flex flex-col gap-0.5 text-xs">
          {row.contents.map((c, i) => (
            <li key={`${c.sku}-${i}`}>
              <span className="font-bold tabular-nums">{c.packed}</span>
              {c.packed < c.planned && (
                <span className="text-danger-fg tabular-nums" title={`${c.planned} planned`}>
                  /{c.planned}
                </span>
              )}
              <span className="text-muted">× </span>
              <code className="font-mono">{c.asin ?? c.sku}</code>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'labels',
      header: 'Labels',
      secondary: true,
      width: 'w-28',
      cell: (row) =>
        row.labels.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-xs font-semibold uppercase">{row.labels.join(', ')}</span>
        ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      width: 'w-36',
      cell: (row) =>
        row.status === 'shipped' ? null : (
          <Button
            size="sm"
            pending={pending}
            onClick={() => run(() => shipBox({ boxId: row.id }), `Box ${row.boxNo} marked shipped.`)}
          >
            Mark shipped
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Box Register &amp; Shipment Log</h1>
        <p className="mt-1 text-sm text-muted">
          Every box you finish lands here with its carton, weight, units and ASIN contents. Marking
          it shipped keeps the record in the order&rsquo;s history.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-panel px-4 py-3 shadow-panel">
        <span className="rounded-pill bg-mint-dark px-2.5 py-1 text-xs font-extrabold tracking-wide text-mint-ink">
          SHIPMENT
        </span>
        <b className="text-lg tabular-nums">{shipmentNo ?? '—'}</b>
        <span className="text-sm text-muted">
          {`${orderName} · ${orderStatus} · ${rows.length} of ${totalBoxes} ${
            totalBoxes === 1 ? 'box' : 'boxes'
          } registered · ${shipped} shipped`}
        </span>
      </div>

      <StatRow>
        <StatCard value={rows.length} label="registered" />
        <StatCard value={waiting} label="awaiting shipment" tone={waiting > 0 ? 'warn' : 'neutral'} />
        <StatCard value={shipped} label="shipped" tone="good" />
        <StatCard
          value={shortPieces}
          label="pieces short"
          tone={shortPieces > 0 ? 'bad' : 'neutral'}
        />
      </StatRow>

      {shortages.length > 0 && (
        <div className="rounded-md border border-danger-fg/25 bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <b>⚠ Shortages ({shortPieces} pcs):</b>{' '}
          {shortages.map((s) => `${s.title ?? s.sku} short ${s.short}`).join(' · ')} — flagged for
          refill or backorder.
        </div>
      )}

      {waiting > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            tone="ghost"
            size="sm"
            pending={pending}
            onClick={() => run(() => shipAll({ batchId }), `Marked ${waiting} box(es) shipped.`)}
          >
            Mark all {waiting} shipped
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowTone={(row) =>
          row.contents.some((c) => c.packed < c.planned) ? 'danger' : undefined
        }
        empty="No boxes registered yet. Go to the Packer tab, work a box and hit Box done — it lands here."
      />
    </div>
  );
}
