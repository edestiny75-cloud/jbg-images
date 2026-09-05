'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, CardBody } from '@/components/ui/Card';
import { QtyInput } from '@/components/ui/Field';
import { SearchBar } from '@/components/ui/SearchBar';
import { useToast } from '@/components/ui/Toast';
import { BoxItemCard } from '@/components/domain/BoxItemCard';
import { BoxSummary } from '@/components/domain/BoxSummary';
import { ProductDetail, type ProductAssetUrls } from '@/components/domain/ProductDetail';
import { Thumb } from '@/components/domain/Thumb';
import type { ProductLineConfig } from '@/lib/db/products.repo';
import type { BoxStatus, CatalogProduct, PackingSettings, SheetSize } from '@/lib/domain';
import { cn } from '@/lib/ui/cn';
import { finishBox, printFnskuLabels, recordPackedQty, releaseBox, startBox, togglePicked } from './actions';

/**
 * One box, one item at a time, on an iPad.
 *
 * Every control here is at least 44px and every input is 16px — below that iOS
 * zooms the viewport on focus, which the shop found unusable with gloves on.
 */

export interface PackerItem {
  boxItemId: number;
  sku: string;
  title: string | null;
  asin: string | null;
  thumbUrl: string | null;
  qty: number;
  actual: number;
  picked: boolean;
  labelStatus: 'none' | 'queued' | 'printed';
  hasFnsku: boolean;
  product: CatalogProduct | null;
  line: ProductLineConfig | null;
  size: SheetSize;
  urls: ProductAssetUrls | null;
}

export interface PackerBox {
  id: number;
  boxNo: number;
  size: SheetSize;
  status: BoxStatus;
  weightOz: number;
  units: number;
  carton: string | null;
  items: PackerItem[];
}

export function PackerScreen({
  batchId,
  orderName,
  orderKind,
  needsLabels,
  settings,
  boxes,
  activeBoxNo,
  step,
}: {
  batchId: number;
  orderName: string;
  orderKind: string;
  needsLabels: boolean;
  settings: PackingSettings;
  boxes: readonly PackerBox[];
  activeBoxNo: number | null;
  step: number;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const active = boxes.find((b) => b.boxNo === activeBoxNo) ?? null;
  const done = boxes.filter((b) => b.status === 'packed' || b.status === 'shipped').length;
  const nextPending = boxes.find((b) => b.status === 'pending' || b.status === 'picking') ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boxes;
    return boxes.filter((b) =>
      `box ${b.boxNo} ${b.items.map((i) => `${i.sku} ${i.asin ?? ''} ${i.title ?? ''}`).join(' ')}`
        .toLowerCase()
        .includes(q),
    );
  }, [boxes, query]);

  const go = (boxNo: number | null, nextStep = 0) => {
    const params = new URLSearchParams();
    if (boxNo !== null) params.set('box', String(boxNo));
    if (nextStep > 0) params.set('step', String(nextStep));
    const query = params.toString();
    router.push((query ? `/packer?${query}` : '/packer') as Route);
  };

  const run = <T,>(
    work: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>,
    message: (data?: T) => string,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast(message(result.data), 'success');
        router.refresh();
        after?.();
      } else {
        toast(result.error, 'danger');
      }
    });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Packer · iPad</h1>
        <p className="mt-1 text-sm text-muted">
          Pick a box, then work through it one item at a time. Two packers can each take a different
          box. <b className="text-ink">{orderName}</b> · {orderKind}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          tone="primary"
          disabled={!nextPending || pending}
          onClick={() =>
            nextPending &&
            run(() => startBox({ boxId: nextPending.id }), () => `Box ${nextPending.boxNo} is yours.`, () =>
              go(nextPending.boxNo),
            )
          }
        >
          {nextPending ? `▶ Start next box (Box ${nextPending.boxNo})` : '✓ All boxes packed'}
        </Button>
        <SearchBar
          value={query}
          onQuery={setQuery}
          placeholder="Find a box by name, SKU or ASIN…"
          aria-label="Find a box"
        />
        <Chip tone={done === boxes.length && boxes.length > 0 ? 'success' : 'neutral'}>
          {done}/{boxes.length} boxes done
        </Chip>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((box) => (
          <BoxChip key={box.boxNo} box={box} active={box.boxNo === activeBoxNo} onPick={() => go(box.boxNo)} />
        ))}
        {shown.length === 0 && (
          <p className="col-span-full rounded-md border border-line bg-panel px-4 py-8 text-center text-muted">
            {boxes.length === 0 ? 'No boxes on this order yet.' : 'No box matches that search.'}
          </p>
        )}
      </div>

      {active === null ? (
        <p className="rounded-md border border-line bg-panel px-4 py-6 text-sm text-muted">
          Tap <b className="text-ink">Start next box</b> above, or pick any box, to begin. Each box
          tells you the carton, the items with pictures, and the exact amount to pick.
        </p>
      ) : (
        <ActiveBox
          box={active}
          batchId={batchId}
          step={Math.min(step, Math.max(0, active.items.length - 1))}
          needsLabels={needsLabels}
          settings={settings}
          pending={pending}
          onStep={(next) => go(active.boxNo, next)}
          onLeave={() => go(null)}
          run={run}
        />
      )}
    </div>
  );
}

/** Ported from the `pchip` box tiles. */
function BoxChip({ box, active, onPick }: { box: PackerBox; active: boolean; onPick: () => void }) {
  const first = box.items[0];
  const more = box.items.length - 1;

  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex min-h-touch flex-col gap-2 rounded-md border bg-panel p-3 text-left transition-colors',
        active ? 'border-mint shadow-hover' : 'border-line hover:border-muted',
        box.status === 'packed' && 'opacity-70',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <b className="text-base">Box {box.boxNo}</b>
        <Chip
          tone={
            box.status === 'packed' ? 'success' : box.status === 'picking' ? 'warn' : box.status === 'shipped' ? 'info' : 'neutral'
          }
        >
          {STATUS_WORD[box.status]}
        </Chip>
      </span>
      <span className="flex items-center gap-2">
        <Thumb sku={first?.sku ?? '—'} src={first?.thumbUrl} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <b>{first?.qty ?? 0}×</b> {shortName(first)}
          </span>
          {more > 0 && <span className="block text-xs text-muted">+{more} more</span>}
        </span>
      </span>
      <span className="text-xs text-muted">
        {box.size} · {box.units} units · {(box.weightOz / 16).toFixed(1)} lb
      </span>
    </button>
  );
}

const STATUS_WORD: Record<BoxStatus, string> = {
  pending: 'to pack',
  picking: 'in progress',
  packed: '✓ packed',
  shipped: 'shipped',
};

function shortName(item: PackerItem | undefined): string {
  const name = (item?.title || item?.sku || 'empty').replace(/^[^A-Za-z0-9]+/, '');
  return name.length > 22 ? `${name.slice(0, 22)}…` : name;
}

function ActiveBox({
  box,
  batchId,
  step,
  needsLabels,
  settings,
  pending,
  onStep,
  onLeave,
  run,
}: {
  box: PackerBox;
  batchId: number;
  step: number;
  needsLabels: boolean;
  settings: PackingSettings;
  pending: boolean;
  onStep: (step: number) => void;
  onLeave: () => void;
  run: <T>(
    work: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>,
    message: (data?: T) => string,
    after?: () => void,
  ) => void;
}) {
  const total = box.items.length;
  const item = box.items[step];
  const pickedCount = box.items.filter((i) => i.picked).length;
  const allPicked = total > 0 && pickedCount === total;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <BoxSummary
            boxNo={box.boxNo}
            size={box.size}
            status={box.status}
            weightOz={box.weightOz}
            unitCount={box.units}
            carton={box.carton ?? '20×14×10'}
            shortBy={box.items.reduce((sum, i) => sum + Math.max(0, i.qty - i.actual), 0)}
            actions={
              <>
                <Chip>{pickedCount}/{total} picked</Chip>
                <Button
                  size="sm"
                  tone="ghost"
                  disabled={pending}
                  title="Put this box back in the pool"
                  onClick={() => run(() => releaseBox({ boxId: box.id }), () => `Box ${box.boxNo} released.`, onLeave)}
                >
                  ✕ Release
                </Button>
              </>
            }
          />
        </CardBody>
      </Card>

      {total === 0 || !item ? (
        <p className="rounded-md border border-line bg-panel px-4 py-8 text-center text-muted">
          This box is empty. Add items to it on the Box Planner, or release it.
        </p>
      ) : (
        <Card>
          <CardBody className="flex flex-col gap-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">
              Item {step + 1} of {total} · Box {box.boxNo}
            </p>

            {item.product && item.urls ? (
              <ProductDetail
                product={item.product}
                line={item.line}
                size={item.size}
                settings={settings}
                urls={item.urls}
                hideActions
              />
            ) : (
              <p className="text-sm text-muted">
                <b className="text-ink">{item.title || item.sku}</b> is not in the catalog, so there
                is no picture for it. Pick by SKU: <code className="font-mono">{item.sku}</code>
              </p>
            )}

            <div className="flex flex-wrap items-end gap-5 rounded-md border border-line bg-panel-2 p-4">
              <span>
                <span className="block text-xs font-bold uppercase text-muted">Pick</span>
                <span className="text-4xl font-extrabold tabular-nums text-mint">{item.qty}×</span>
              </span>

              <span className="w-32">
                <span className="mb-1 block text-xs font-bold uppercase text-muted">
                  Packed of {item.qty}
                </span>
                <QtyInput
                  aria-label={`Quantity packed for ${item.sku}`}
                  value={item.actual}
                  disabled={pending}
                  onValueChange={(v) =>
                    run(
                      () => recordPackedQty({ boxItemId: item.boxItemId, actualQty: v === '' ? 0 : v }),
                      () => `${item.sku}: packed ${v === '' ? 0 : v} of ${item.qty}.`,
                    )
                  }
                />
              </span>

              {item.actual < item.qty ? (
                <Chip tone="danger">SHORT {item.qty - item.actual}</Chip>
              ) : (
                <Chip tone="success">✓ full</Chip>
              )}

              {needsLabels ? (
                <span className="flex items-center gap-2">
                  <Button
                    size="sm"
                    tone={item.labelStatus === 'none' ? 'gold' : 'ghost'}
                    disabled={!item.hasFnsku || pending}
                    title={item.hasFnsku ? undefined : 'This product has no FNSKU sheet'}
                    onClick={() =>
                      run(
                        () =>
                          printFnskuLabels({
                            boxItemId: item.boxItemId,
                            sku: item.sku,
                            batchId,
                            copies: Math.max(1, item.actual || item.qty),
                          }),
                        () => 'FNSKU sheet queued for the label printer.',
                      )
                    }
                  >
                    🏷️ Print FNSKU
                  </Button>
                  {item.labelStatus !== 'none' && <Chip tone="info">{item.labelStatus}</Chip>}
                </span>
              ) : (
                <span className="text-sm text-muted">Wholesale — no Amazon labels.</span>
              )}

              <label className="flex min-h-touch cursor-pointer items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={item.picked}
                  disabled={pending}
                  onChange={(e) =>
                    run(
                      () => togglePicked({ boxItemId: item.boxItemId, picked: e.target.checked }),
                      () => (e.target.checked ? `${item.sku} in the box.` : `${item.sku} unticked.`),
                    )
                  }
                  className="size-5 accent-mint"
                />
                picked &amp; in the box
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button tone="ghost" disabled={step === 0} onClick={() => onStep(step - 1)}>
                ← Prev
              </Button>

              <span className="flex flex-wrap items-center gap-1.5">
                {box.items.map((it, i) => (
                  <button
                    key={it.boxItemId}
                    type="button"
                    aria-label={`Go to item ${i + 1}, ${it.sku}`}
                    aria-current={i === step ? 'step' : undefined}
                    onClick={() => onStep(i)}
                    className={cn(
                      'size-4 rounded-pill border',
                      i === step ? 'border-mint bg-mint' : it.picked ? 'border-mint/50 bg-mint/40' : 'border-line bg-panel-2',
                    )}
                  />
                ))}
              </span>

              {step < total - 1 ? (
                <Button onClick={() => onStep(step + 1)}>Next →</Button>
              ) : (
                <Button
                  tone={allPicked ? 'primary' : 'ghost'}
                  pending={pending}
                  onClick={() =>
                    run(
                      () => finishBox({ boxId: box.id }),
                      (data) =>
                        data && data.short > 0
                          ? `Box ${box.boxNo} closed — ${data.short} units short, recorded on the register.`
                          : `Box ${box.boxNo} packed.`,
                      onLeave,
                    )
                  }
                >
                  ✓ Box done → next box
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">
          Everything in Box {box.boxNo}
        </h2>
        <ul className="flex flex-col gap-2">
          {box.items.map((it, i) => (
            <li key={it.boxItemId}>
              <BoxItemCard
                sku={it.sku}
                title={it.title}
                thumbUrl={it.thumbUrl}
                qty={it.qty}
                actualQty={it.actual}
                picked={it.picked}
                onOpen={() => onStep(i)}
                onTogglePicked={(picked) =>
                  run(
                    () => togglePicked({ boxItemId: it.boxItemId, picked }),
                    () => (picked ? `${it.sku} in the box.` : `${it.sku} unticked.`),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
