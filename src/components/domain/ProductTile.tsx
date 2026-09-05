'use client';

import { Thumb } from './Thumb';
import { ProductBadges } from './ProductBadges';
import { cn } from '@/lib/ui/cn';
import type { CatalogProduct } from '@/lib/domain';
import type { ReactNode } from 'react';

/**
 * The product card. Replaces four near-identical renderings: the catalog card,
 * its copy inside `catSearch` (index.html:1192) and the three `pk-card`
 * variants inside the 48-line `pickCards()` (:1647, :1659, :1670).
 *
 * The `catSearch` copy had already drifted — it dropped the export-mode branch,
 * which is why searching in export mode fell back to a full re-render. Here
 * selection is a prop, so there is only one card and it cannot drift.
 */

export interface ProductTileProps {
  product: CatalogProduct;
  onOpen?: (sku: string) => void;
  /** Renders a checkbox and the selected state. Undefined means not selectable. */
  selected?: boolean;
  onSelect?: (sku: string, selected: boolean) => void;
  /** Quantity stepper, shortage note, "on list" chip — whatever the screen adds. */
  footer?: ReactNode;
  /** Dims the card without disabling it. For lines already fully committed. */
  muted?: boolean;
  className?: string;
}

export function ProductTile({
  product,
  onOpen,
  selected,
  onSelect,
  footer,
  muted = false,
  className,
}: ProductTileProps) {
  const selectable = selected !== undefined && onSelect !== undefined;

  return (
    <article
      className={cn(
        'relative flex flex-col gap-2 rounded-md border bg-panel p-3',
        selected ? 'border-mint shadow-hover' : 'border-line',
        muted && 'opacity-60',
        className,
      )}
    >
      {selectable && (
        <label className="absolute right-2 top-2 z-10 flex min-h-touch min-w-touch cursor-pointer items-start justify-end p-1">
          <span className="sr-only">Select {product.sku}</span>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(product.sku, e.target.checked)}
            // 20px: the legacy tool enlarged these for gloved fingers on an iPad.
            className="size-5 accent-mint"
          />
        </label>
      )}

      <button
        type="button"
        onClick={onOpen ? () => onOpen(product.sku) : undefined}
        disabled={!onOpen}
        className="flex flex-col gap-2 text-left disabled:cursor-default"
      >
        <Thumb sku={product.sku} src={product.thumbUrl} size="xl" alt={product.title ?? product.sku} />
        <span className="line-clamp-2 min-h-10 text-sm font-bold leading-tight text-ink">
          {product.title || product.sku}
        </span>
        <span className="truncate font-mono text-[11px] text-muted">{product.sku}</span>
      </button>

      <ProductBadges product={product} />
      {footer}
    </article>
  );
}
