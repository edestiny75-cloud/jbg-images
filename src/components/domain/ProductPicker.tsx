'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SearchBar } from '@/components/ui/SearchBar';
import { Field, QtyInput } from '@/components/ui/Field';
import { Chip } from '@/components/ui/Chip';
import { ProductTile } from './ProductTile';
import type { CatalogProduct } from '@/lib/domain';

/**
 * "Tap a poster to add it." Replaces `viewPickerModal` (index.html:1685) — one
 * modal whose behaviour was keyed off four separate booleans (`pickBox`,
 * `pickList`, `pickPlan`, `pickQuote`), regenerated on *every* render (:1944),
 * and which re-rendered all 240 cards on each keystroke.
 *
 * The mode is now one prop, filtering is memoised, and the caller decides what
 * "add" means.
 */

export type PickerMode = 'box' | 'list' | 'plan' | 'quote';

const NOTES: Record<PickerMode, string> = {
  box: 'Tap a poster to drop it into the box. SKU, ASIN and FNSKU fill in automatically. The green badge is how many units are still unpacked and can be pulled.',
  list: 'Tap posters to build a manual order. Set the quantity first, then tap. Close when done, then save and plan.',
  plan: 'Tap posters to build a pack. Set the quantity first, then tap — the planner shows how it boxes up and whether each item makes a full case.',
  quote: 'Tap posters to add them to the quote. Set the quantity first, then tap. Close when done to set prices and print.',
};

export interface ProductPickerProps {
  open: boolean;
  onClose: () => void;
  mode: PickerMode;
  products: readonly CatalogProduct[];
  /** Called with the SKU and the current "qty each" value. */
  onPick: (sku: string, qty: number) => void;
  /**
   * Units of a SKU still unpacked and available to pull. Only meaningful in
   * `box` mode, where over-picking would break piece conservation against the
   * customer's list.
   */
  freeAvailable?: (sku: string) => number | null;
  /** Total units already on the order/pack/quote, shown in the header. */
  onOrderCount?: number;
  title?: string;
}

export function ProductPicker({
  open,
  onClose,
  mode,
  products,
  onPick,
  freeAvailable,
  onOrderCount,
  title,
}: ProductPickerProps) {
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState<number | ''>(1);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q) ||
        (p.asin ?? '').toLowerCase().includes(q),
    );
  }, [products, query]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={
        <span className="flex flex-wrap items-baseline gap-3">
          {title ?? 'Add posters'}
          {onOrderCount != null && (
            <span className="text-sm font-bold text-muted">
              {onOrderCount} {onOrderCount === 1 ? 'unit' : 'units'} so far
            </span>
          )}
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar
          value={query}
          onQuery={setQuery}
          placeholder="Search posters by name, SKU or ASIN…"
          aria-label="Search posters"
        />
        <Field label="Qty each" className="w-28">
          {(id) => <QtyInput id={id} value={qty} onValueChange={setQty} />}
        </Field>
      </div>

      <p className="mb-4 rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-muted">
        {NOTES[mode]}
      </p>

      {matches.length === 0 ? (
        <p className="py-10 text-center text-muted">No posters match “{query}”.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {matches.map((p) => {
            const free = freeAvailable?.(p.sku) ?? null;
            const blocked = mode === 'box' && free !== null && free <= 0;
            return (
              <ProductTile
                key={p.sku}
                product={p}
                muted={blocked}
                onOpen={blocked ? undefined : () => onPick(p.sku, qty === '' ? 1 : qty)}
                footer={
                  free === null ? null : (
                    <Chip tone={free > 0 ? 'success' : 'danger'}>
                      {free > 0 ? `${free} free` : 'not on list'}
                    </Chip>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </Modal>
  );
}
