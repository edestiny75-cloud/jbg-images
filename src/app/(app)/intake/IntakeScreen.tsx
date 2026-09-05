'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, QtyInput, Select, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatCard, StatRow } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/domain/EmptyState';
import { ProductCell } from '@/components/domain/ProductCell';
import { setActiveOrder } from '@/lib/orders/actions';
import { ORDER_KINDS, orderKindLabel, type OrderKind, type SheetSize } from '@/lib/domain';
import {
  createManualOrder,
  mapListSku,
  planAndSend,
  renameOrder,
  saveOrderLines,
  setProductSize,
  uploadList,
} from './actions';

/**
 * Upload a list, review what it resolved to, fix what it did not, then plan.
 *
 * The legacy screen re-rendered the whole document on every keystroke, and the
 * "held" flag plus per-line quantity edits lived in an `EDITS` global that was
 * lost on refresh. Edits are local state here and saved explicitly; holding a
 * line is expressed as a quantity of zero, which is what the planner already
 * treated it as.
 */

export type ResolveStatus = 'asin' | 'aliased' | 'matched' | 'needs_confirm' | 'unmapped' | null;

export interface IntakeLine {
  lineNo: number;
  listSku: string;
  resolvedProductSku: string | null;
  title: string | null;
  asin: string | null;
  requestedQty: number;
  size: SheetSize;
  resolveStatus: ResolveStatus;
  notes: string | null;
  thumbUrl: string | null;
  hasPrintFile: boolean;
}

export interface OrderChoice {
  id: number;
  name: string;
  kind: string;
  status: string;
  lines: number;
  boxes: number;
  createdAt: string;
}

export interface ActiveOrder {
  id: number;
  name: string;
  kind: OrderKind;
  status: string;
  needsLabels: boolean;
  boxes: number;
}

export interface CatalogChoice {
  sku: string;
  title: string | null;
  asin: string | null;
}

const STATUS_CHIP: Record<Exclude<ResolveStatus, null>, { tone: ChipTone; label: string }> = {
  asin: { tone: 'info', label: 'by ASIN' },
  aliased: { tone: 'success', label: 'aliased' },
  matched: { tone: 'success', label: 'matched' },
  needs_confirm: { tone: 'warn', label: 'confirm' },
  unmapped: { tone: 'danger', label: 'no file yet' },
};

export function IntakeScreen({
  order,
  lines,
  orders,
  catalog,
}: {
  order: ActiveOrder | null;
  lines: readonly IntakeLine[];
  orders: readonly OrderChoice[];
  catalog: readonly CatalogChoice[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /** Per-line quantity edits, applied on save. Zero holds a line out of the run. */
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [mapping, setMapping] = useState<IntakeLine | null>(null);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const qtyFor = useCallback((line: IntakeLine) => edits[line.lineNo] ?? line.requestedQty, [edits]);
  const dirty = Object.keys(edits).length > 0;

  const totals = useMemo(() => {
    const active = lines.filter((l) => qtyFor(l) > 0);
    return {
      lines: lines.length,
      units: active.reduce((sum, l) => sum + qtyFor(l), 0),
      held: lines.length - active.length,
      unresolved: lines.filter((l) => !l.resolvedProductSku).length,
      noFile: lines.filter((l) => l.resolvedProductSku && !l.hasPrintFile).length,
    };
  }, [lines, qtyFor]);

  const run = <T,>(work: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, message: (data?: T) => string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast(message(result.data), 'success');
        setEdits({});
        router.refresh();
      } else {
        toast(result.error, 'danger');
      }
    });

  const columns: ReadonlyArray<Column<IntakeLine>> = [
    { key: 'no', header: '#', width: 'w-12', align: 'right', cell: (l) => <span className="tabular-nums text-muted">{l.lineNo}</span> },
    {
      key: 'product',
      header: 'Product',
      cell: (l) => (
        <ProductCell
          sku={l.resolvedProductSku ?? l.listSku}
          title={l.title}
          thumbUrl={l.thumbUrl}
          detail={l.resolvedProductSku && l.resolvedProductSku !== l.listSku ? `list SKU ${l.listSku}` : l.notes}
        />
      ),
    },
    {
      key: 'status',
      header: 'Match',
      width: 'w-40',
      cell: (l) => {
        const chip = l.resolveStatus ? STATUS_CHIP[l.resolveStatus] : null;
        return (
          <span className="flex flex-wrap items-center gap-1">
            {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
            {l.resolvedProductSku && !l.hasPrintFile && <Chip tone="warn">no print file</Chip>}
          </span>
        );
      },
    },
    {
      key: 'size',
      header: 'Size',
      width: 'w-28',
      align: 'center',
      cell: (l) => (
        <Button
          size="sm"
          tone="ghost"
          title="Switch the size and remember the correction"
          onClick={() =>
            run(
              () => setProductSize({ sku: l.resolvedProductSku ?? l.listSku, size: l.size === '11x17' ? '8.5x11' : '11x17' }),
              () => `${l.listSku} → ${l.size === '11x17' ? '8.5x11' : '11x17'}, remembered.`,
            )
          }
        >
          {l.size}
        </Button>
      ),
    },
    {
      key: 'qty',
      header: 'Requested',
      width: 'w-32',
      align: 'right',
      cell: (l) => (
        <QtyInput
          aria-label={`Quantity for ${l.listSku}`}
          value={qtyFor(l)}
          onValueChange={(v) => setEdits((prev) => ({ ...prev, [l.lineNo]: v === '' ? 0 : v }))}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 'w-40',
      cell: (l) => (
        <span className="flex justify-end gap-2">
          <Button
            size="sm"
            tone="ghost"
            title={qtyFor(l) > 0 ? 'Hold this line out of the run' : 'Include it again'}
            onClick={() =>
              setEdits((prev) => ({ ...prev, [l.lineNo]: qtyFor(l) > 0 ? 0 : l.requestedQty || 1 }))
            }
          >
            {qtyFor(l) > 0 ? 'Hold' : 'Include'}
          </Button>
          {!l.resolvedProductSku && (
            <Button size="sm" onClick={() => setMapping(l)}>
              Map
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">List Intake</h1>
          <p className="mt-1 text-sm text-muted">
            Upload the customer&apos;s inventory request, check what it matched, then plan the boxes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UploadButton pending={pending} onDone={() => router.refresh()} />
          <Button tone="ghost" onClick={() => setNewOrderOpen(true)}>
            Start a manual order
          </Button>
        </div>
      </header>

      <OrderSwitcher orders={orders} activeId={order?.id ?? null} />

      {!order ? (
        <EmptyState title="No order open">
          <p>Upload a spreadsheet, or pick one of the recent orders above.</p>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <OrderName order={order} pending={pending} onSaved={() => router.refresh()} />
            <Chip>{orderKindLabel(order.kind)}</Chip>
            <Chip tone={order.status === 'draft' ? 'warn' : 'success'}>{order.status}</Chip>
            {order.needsLabels && <Chip tone="info">FNSKU labels</Chip>}
          </div>

          <StatRow>
            <StatCard value={totals.lines} label="lines" />
            <StatCard value={totals.units} label="units to ship" tone="good" />
            <StatCard value={totals.held} label="held" tone={totals.held > 0 ? 'warn' : 'neutral'} />
            <StatCard value={totals.unresolved} label="unmatched" tone={totals.unresolved > 0 ? 'bad' : 'neutral'} />
            <StatCard value={totals.noFile} label="no print file" tone={totals.noFile > 0 ? 'warn' : 'neutral'} />
          </StatRow>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="primary"
              disabled={!dirty}
              pending={pending}
              onClick={() =>
                run(
                  () =>
                    saveOrderLines({
                      batchId: order.id,
                      lines: lines.map((l) => ({
                        lineNo: l.lineNo,
                        listSku: l.listSku,
                        resolvedProductSku: l.resolvedProductSku,
                        asin: l.asin,
                        title: l.title,
                        requestedQty: qtyFor(l),
                        size: l.size,
                        notes: l.notes,
                      })),
                    }),
                  () => 'Saved.',
                )
              }
            >
              Save changes
            </Button>
            {dirty && (
              <Button tone="ghost" onClick={() => setEdits({})}>
                Discard changes
              </Button>
            )}
            <Button
              tone="gold"
              disabled={dirty || totals.units === 0}
              pending={pending}
              title={dirty ? 'Save your changes first' : undefined}
              onClick={() => run(() => planAndSend({ batchId: order.id }), (data) => `Planned ${data?.boxes ?? 0} boxes — sent to the packer.`)}
            >
              Plan boxes &amp; send to packer →
            </Button>
            {order.boxes > 0 && <Chip tone="info">{order.boxes} boxes planned</Chip>}
          </div>

          <DataTable
            columns={columns}
            rows={lines}
            rowKey={(l) => l.lineNo}
            rowTone={(l) => (!l.resolvedProductSku ? 'danger' : qtyFor(l) === 0 ? 'warn' : undefined)}
            empty="This order has no lines yet."
          />
        </>
      )}

      <MapModal
        line={mapping}
        catalog={catalog}
        batchId={order?.id ?? null}
        pending={pending}
        onClose={() => setMapping(null)}
        onMap={(productSku) => {
          if (!order || !mapping) return;
          run(
            () => mapListSku({ batchId: order.id, listSku: mapping.listSku, productSku, remember: true }),
            () => `${mapping.listSku} → ${productSku}, remembered.`,
          );
          setMapping(null);
        }}
      />

      <NewOrderModal
        open={newOrderOpen}
        pending={pending}
        onClose={() => setNewOrderOpen(false)}
        onCreate={(name, kind) => {
          run(() => createManualOrder({ name, kind, lines: [] }), () => `Created “${name}”.`);
          setNewOrderOpen(false);
        }}
      />
    </div>
  );
}

/** Ported from `onListFile`, minus the FileReader — the file goes to the server. */
function UploadButton({ pending, onDone }: { pending: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const data = new FormData();
          data.set('file', file);
          data.set('kind', 'fba');
          startTransition(async () => {
            const result = await uploadList(data);
            if (result.ok) {
              const { lines, skipped } = result.data;
              toast(
                `Loaded ${lines} lines${skipped ? `, skipped ${skipped} without a SKU` : ''} — review, then plan.`,
                'success',
              );
              onDone();
            } else {
              toast(result.error, 'danger');
            }
          });
        }}
      />
      <Button tone="primary" pending={pending || busy} onClick={() => inputRef.current?.click()}>
        ⬆ Upload a list
      </Button>
    </>
  );
}

function OrderSwitcher({ orders, activeId }: { orders: readonly OrderChoice[]; activeId: number | null }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (orders.length === 0) return null;

  return (
    <Field label="Recent orders" className="max-w-lg">
      {(id) => (
        <Select
          id={id}
          value={activeId ?? ''}
          disabled={pending}
          onChange={(e) => {
            const value = e.target.value;
            startTransition(async () => {
              const result = await setActiveOrder({ batchId: value === '' ? null : Number(value) });
              if (result.ok) router.refresh();
              else toast(result.error, 'danger');
            });
          }}
        >
          <option value="">— none —</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              #{o.id} · {o.name} · {o.kind} · {o.status} · {o.lines} lines
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function OrderName({ order, pending, onSaved }: { order: ActiveOrder; pending: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(order.name);
  const [busy, startTransition] = useTransition();

  return (
    <span className="flex items-center gap-2">
      <TextInput
        aria-label="Order name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-64"
      />
      {name !== order.name && (
        <Button
          size="sm"
          pending={pending || busy}
          onClick={() =>
            startTransition(async () => {
              const result = await renameOrder({ batchId: order.id, name });
              toast(result.ok ? 'Renamed.' : result.error, result.ok ? 'success' : 'danger');
              if (result.ok) onSaved();
            })
          }
        >
          Rename
        </Button>
      )}
    </span>
  );
}

/** Ported from the picker's "map to" mode, narrowed to one job. */
function MapModal({
  line,
  catalog,
  batchId,
  pending,
  onClose,
  onMap,
}: {
  line: IntakeLine | null;
  catalog: readonly CatalogChoice[];
  batchId: number | null;
  pending: boolean;
  onClose: () => void;
  onMap: (productSku: string) => void;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, 40);
    return catalog
      .filter((p) => `${p.sku} ${p.title ?? ''} ${p.asin ?? ''}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [catalog, query]);

  return (
    <Modal open={line !== null && batchId !== null} onClose={onClose} size="md" title={`Map ${line?.listSku ?? ''}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Nothing in the catalog matched this SKU. Pick the product it should be — the mapping is
          remembered, so the same spelling never needs a decision twice.
        </p>
        <SearchBar value={query} onQuery={setQuery} placeholder="Search the catalog…" autoFocus />
        <ul className="flex flex-col gap-1">
          {matches.map((p) => (
            <li key={p.sku}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onMap(p.sku)}
                className="w-full rounded-sm px-3 py-2 text-left hover:bg-panel-2 disabled:opacity-50"
              >
                <span className="block font-bold">{p.title || p.sku}</span>
                <code className="block font-mono text-xs text-muted">{p.sku}</code>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function NewOrderModal({
  open,
  pending,
  onClose,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onCreate: (name: string, kind: OrderKind) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrderKind>('fba');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Start a manual order"
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" pending={pending} disabled={name.trim() === ''} onClick={() => onCreate(name.trim(), kind)}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Order name">
          {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Type" hint="FBA orders are bound to the customer's list; the others allow free adds.">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as OrderKind)}>
              {ORDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {orderKindLabel(k)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
