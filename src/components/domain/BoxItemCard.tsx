'use client';

import { QtyInput } from '@/components/ui/Field';
import { Chip } from '@/components/ui/Chip';
import { Thumb } from './Thumb';
import { cn } from '@/lib/ui/cn';

/**
 * One line inside a box, as the packer sees it on the iPad.
 *
 * The planned quantity and the packed quantity are shown separately on purpose:
 * the legacy tool overwrote `qty` with what was actually packed in some paths,
 * which is what made shortages disappear from the Register.
 */

export interface BoxItemCardProps {
  sku: string;
  title?: string | null;
  thumbUrl?: string | null;
  /** What the planner asked for. */
  qty: number;
  /** What is in the box. */
  actualQty: number;
  picked: boolean;
  onActualQty?: (qty: number) => void;
  onTogglePicked?: (picked: boolean) => void;
  onOpen?: () => void;
  className?: string;
}

export function BoxItemCard({
  sku,
  title,
  thumbUrl,
  qty,
  actualQty,
  picked,
  onActualQty,
  onTogglePicked,
  onOpen,
  className,
}: BoxItemCardProps) {
  const short = qty - actualQty;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border bg-panel p-3',
        picked ? 'border-mint/50 bg-success-bg/20' : 'border-line',
        className,
      )}
    >
      {onTogglePicked ? (
        <label className="flex min-h-touch min-w-touch cursor-pointer items-center justify-center">
          <span className="sr-only">Mark {sku} picked</span>
          <input
            type="checkbox"
            checked={picked}
            onChange={(e) => onTogglePicked(e.target.checked)}
            className="size-5 accent-mint"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <Thumb sku={sku} src={thumbUrl} size="md" />
        <span className="min-w-0">
          <span className="block truncate font-bold text-ink">{title || sku}</span>
          <span className="block truncate font-mono text-xs text-muted">{sku}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-right">
          <span className="block text-xs font-bold text-muted">Planned</span>
          <span className="block text-lg font-extrabold tabular-nums text-ink">{qty}</span>
        </span>
        {onActualQty ? (
          <span className="w-24">
            <span className="mb-1 block text-xs font-bold text-muted">Packed</span>
            <QtyInput
              aria-label={`Quantity packed for ${sku}`}
              value={actualQty}
              onValueChange={(v) => onActualQty(v === '' ? 0 : v)}
            />
          </span>
        ) : (
          <span className="text-right">
            <span className="block text-xs font-bold text-muted">Packed</span>
            <span className="block text-lg font-extrabold tabular-nums text-ink">{actualQty}</span>
          </span>
        )}
        {short > 0 ? <Chip tone="danger">−{short}</Chip> : null}
      </div>
    </div>
  );
}
