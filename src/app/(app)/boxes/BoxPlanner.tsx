'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, QtyInput, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatCard, StatRow } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { BoxSummary } from '@/components/domain/BoxSummary';
import { Thumb } from '@/components/domain/Thumb';
import { CARTONS, SHEET_SIZES, type BoxStatus, type Carton, type SheetSize } from '@/lib/domain';
import {
  addEmptyBox,
  addItemIntoBox,
  editPlannedQty,
  removeBox,
  removeItemFromBox,
  replanBoxes,
  setCarton,
} from './actions';

/**
 * Review and adjust the plan before it goes to the floor.
 *
 * Committed boxes — picking, packed or shipped — are read-only here. The legacy
 * screen let you edit them and then silently re-planned them away.
 */

export interface PlannedItemView {
  boxItemId: number;
  sku: string;
  title: string | null;
  thumbUrl: string | null;
  qty: number;
  actual: number;
  casePack: number;
}

export interface PlannedBoxView {
  id: number;
  boxNo: number;
  size: SheetSize;
  status: BoxStatus;
  weightOz: number;
  thickIn: number;
  units: number;
  carton: string | null;
  items: PlannedItemView[];
}

export interface AddChoice {
  sku: string;
  title: string | null;
  asin: string | null;
  thumbUrl: string | null;
  /** Units still unpacked and free to pull. */
  free: number;
}

const DEFAULT_CARTON: Carton = '20×14×10';

export function BoxPlanner({
  batchId,
  orderName,
  orderKind,
  canAddBoxes,
  boxes,
  catalog,
}: {
  batchId: number;
  orderName: string;
  orderKind: string;
  canAddBoxes: boolean;
  boxes: readonly PlannedBoxView[];
  catalog: readonly AddChoice[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addingTo, setAddingTo] = useState<PlannedBoxView | null>(null);

  const run = <T,>(
    work: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>,
    message: (data?: T) => string,
  ) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast(message(result.data), 'success');
        router.refresh();
      } else {
        toast(result.error, 'danger');
      }
    });

  const bySize = useMemo(
    () => SHEET_SIZES.map((size) => ({ size, boxes: boxes.filter((b) => b.size === size) })).filter((g) => g.boxes.length > 0),
    [boxes],
  );

  const committed = boxes.filter((b) => b.status !== 'pending').length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Box Planner</h1>
          <p className="mt-1 text-sm text-muted">
            The plan for <b className="text-ink">{orderName}</b>. One size per box, 50 lb cap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{orderKind}</Chip>
          <Button
            tone="ghost"
            pending={pending}
            onClick={() => run(() => replanBoxes({ batchId }), (d) => `Re-planned into ${d?.boxes ?? 0} boxes.`)}
          >
            ↻ Re-plan pending boxes
          </Button>
          {canAddBoxes && <AddBoxButton batchId={batchId} pending={pending} onDone={() => router.refresh()} />}
        </div>
      </header>

      {boxes.length === 0 ? (
        <p className="rounded-md border border-line bg-panel px-4 py-10 text-center text-muted">
          No boxes yet. Plan the order on List Intake, or add one above.
        </p>
      ) : (
        <>
          <StatRow>
            <StatCard value={boxes.length} label="total boxes" />
            {SHEET_SIZES.map((size) => (
              <StatCard key={size} value={boxes.filter((b) => b.size === size).length} label={`${size} boxes`} />
            ))}
            <StatCard value={boxes.reduce((s, b) => s + b.units, 0)} label="units" tone="good" />
            <StatCard value={committed} label="already started" tone={committed > 0 ? 'info' : 'neutral'} />
          </StatRow>

          {bySize.map((group) => (
            <section key={group.size} className="flex flex-col gap-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">
                {group.size} · {group.boxes.length} box{group.boxes.length === 1 ? '' : 'es'}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {group.boxes.map((box) => (
                  <BoxCard
                    key={box.boxNo}
                    box={box}
                    batchId={batchId}
                    pending={pending}
                    onAdd={() => setAddingTo(box)}
                    run={run}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <AddItemModal
        box={addingTo}
        catalog={catalog}
        batchId={batchId}
        pending={pending}
        onClose={() => setAddingTo(null)}
        onAdd={(sku, qty) => {
          if (!addingTo) return;
          run(() => addItemIntoBox({ batchId, boxId: addingTo.id, sku, qty }), () => `Added ${qty} × ${sku}.`);
          setAddingTo(null);
        }}
      />
    </div>
  );
}

function BoxCard({
  box,
  batchId,
  pending,
  onAdd,
  run,
}: {
  box: PlannedBoxView;
  batchId: number;
  pending: boolean;
  onAdd: () => void;
  run: <T>(work: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, message: (data?: T) => string) => void;
}) {
  const frozen = box.status !== 'pending';

  return (
    <Card as="article">
      <CardHeader className="flex-wrap">
        <BoxSummary
          boxNo={box.boxNo}
          size={box.size}
          status={box.status}
          weightOz={box.weightOz}
          unitCount={box.units}
          carton={box.carton ?? DEFAULT_CARTON}
        />
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {frozen && (
          <p className="rounded-sm border border-info-fg/25 bg-info-bg px-3 py-2 text-xs text-info-fg">
            Someone is working this box — its contents are frozen so a re-plan cannot take it apart.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {box.items.length === 0 && <li className="text-sm text-muted">Empty.</li>}
          {box.items.map((item) => (
            <li key={item.sku} className="flex items-center gap-2">
              <Thumb sku={item.sku} src={item.thumbUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{item.title || item.sku}</span>
                <code className="block truncate font-mono text-xs text-muted">{item.sku}</code>
              </span>
              {item.casePack > 0 && (
                <Chip tone={item.qty >= item.casePack ? 'success' : 'warn'} title={`${item.casePack} fill a carton`}>
                  {item.qty >= item.casePack ? '✓ full case' : `${item.casePack}/case`}
                </Chip>
              )}
              <span className="w-20">
                <QtyInput
                  aria-label={`Planned quantity of ${item.sku} in box ${box.boxNo}`}
                  value={item.qty}
                  disabled={frozen}
                  onValueChange={(v) =>
                    run(
                      () => editPlannedQty({ batchId, boxNo: box.boxNo, sku: item.sku, qty: v === '' ? 0 : v }),
                      () => `Box ${box.boxNo}: ${item.sku} → ${v === '' ? 0 : v}.`,
                    )
                  }
                />
              </span>
              <Button
                size="sm"
                tone="ghost"
                disabled={frozen || pending}
                title="Take this item out of the box"
                onClick={() => run(() => removeItemFromBox({ boxItemId: item.boxItemId }), () => `Removed ${item.sku}.`)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Carton" className="w-44">
            {(id) => (
              <Select
                id={id}
                value={box.carton ?? DEFAULT_CARTON}
                disabled={pending}
                onChange={(e) =>
                  run(() => setCarton({ boxId: box.id, carton: e.target.value }), () => `Box ${box.boxNo} → ${e.target.value}.`)
                }
              >
                {CARTONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button size="sm" tone="ghost" disabled={frozen} onClick={onAdd}>
            ＋ Add an item
          </Button>
          <Button
            size="sm"
            tone="ghost"
            disabled={frozen || pending}
            onClick={() => run(() => removeBox({ boxId: box.id }), () => `Box ${box.boxNo} deleted.`)}
          >
            Delete box
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AddBoxButton({ batchId, pending, onDone }: { batchId: number; pending: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<SheetSize>('11x17');
  const [carton, setCartonChoice] = useState<Carton>(DEFAULT_CARTON);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <Button tone="gold" onClick={() => setOpen(true)}>
        ＋ Add a box
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Add an empty box"
        footer={
          <>
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              pending={pending || busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await addEmptyBox({ batchId, size, carton });
                  toast(result.ok ? `Box ${result.data.boxNo} added.` : result.error, result.ok ? 'success' : 'danger');
                  if (result.ok) {
                    setOpen(false);
                    onDone();
                  }
                })
              }
            >
              Add box
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Poster size">
            {(id) => (
              <Select id={id} value={size} onChange={(e) => setSize(e.target.value as SheetSize)}>
                {SHEET_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Carton" hint="20×14×10 is the working carton; the rest are for sending samples.">
            {(id) => (
              <Select id={id} value={carton} onChange={(e) => setCartonChoice(e.target.value as Carton)}>
                {CARTONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

function AddItemModal({
  box,
  catalog,
  batchId,
  pending,
  onClose,
  onAdd,
}: {
  box: PlannedBoxView | null;
  catalog: readonly AddChoice[];
  batchId: number;
  pending: boolean;
  onClose: () => void;
  onAdd: (sku: string, qty: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState<number | ''>(1);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? catalog.filter((p) => `${p.sku} ${p.title ?? ''} ${p.asin ?? ''}`.toLowerCase().includes(q))
      : catalog;
    return list.slice(0, 60);
  }, [catalog, query]);

  return (
    <Modal open={box !== null && batchId > 0} onClose={onClose} size="md" title={`Add to Box ${box?.boxNo ?? ''}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <SearchBar value={query} onQuery={setQuery} placeholder="Search this order's products…" autoFocus />
          <Field label="Qty" className="w-24">
            {(id) => <QtyInput id={id} value={qty} onValueChange={setQty} />}
          </Field>
        </div>
        <ul className="flex flex-col gap-1">
          {matches.map((p) => (
            <li key={p.sku}>
              <button
                type="button"
                disabled={pending || p.free <= 0}
                onClick={() => onAdd(p.sku, qty === '' ? 1 : qty)}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-panel-2 disabled:opacity-40"
              >
                <Thumb sku={p.sku} src={p.thumbUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{p.title || p.sku}</span>
                  <code className="block truncate font-mono text-xs text-muted">{p.sku}</code>
                </span>
                <Chip tone={p.free > 0 ? 'success' : 'danger'}>{p.free > 0 ? `${p.free} free` : 'none free'}</Chip>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
