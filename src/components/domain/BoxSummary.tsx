import { Chip } from '@/components/ui/Chip';
import { cn } from '@/lib/ui/cn';
import type { BoxStatus } from '@/lib/domain';
import type { ReactNode } from 'react';

/**
 * The header line of a box: number, size, carton, weight, unit count, status.
 * Replaces four separate renderings of the same facts (index.html:1009, :1070,
 * :1789, :1800), which disagreed about whether to show pounds or ounces.
 */

const STATUS_TONE = {
  pending: 'neutral',
  picking: 'warn',
  packed: 'success',
  shipped: 'info',
} as const satisfies Record<BoxStatus, 'neutral' | 'warn' | 'success' | 'info'>;

const STATUS_LABEL = {
  pending: 'Pending',
  picking: 'Picking',
  packed: 'Packed',
  shipped: 'Shipped',
} as const satisfies Record<BoxStatus, string>;

export interface BoxSummaryProps {
  boxNo: number;
  size: string;
  status: BoxStatus;
  weightOz: number;
  unitCount: number;
  carton?: string | null;
  /** Shown when the packed total is under the plan. */
  shortBy?: number;
  actions?: ReactNode;
  className?: string;
}

export function BoxSummary({
  boxNo,
  size,
  status,
  weightOz,
  unitCount,
  carton,
  shortBy = 0,
  actions,
  className,
}: BoxSummaryProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <span className="text-lg font-extrabold text-ink">Box {boxNo}</span>
      <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
      <span className="text-sm text-muted">{size}</span>
      {carton ? <span className="text-sm text-muted">{carton}</span> : null}
      <span className="text-sm tabular-nums text-muted">
        {unitCount} {unitCount === 1 ? 'unit' : 'units'}
      </span>
      <span className="text-sm tabular-nums text-muted">{(weightOz / 16).toFixed(1)} lb</span>
      {shortBy > 0 ? <Chip tone="danger">short {shortBy}</Chip> : null}
      {actions ? <span className="ml-auto flex flex-wrap items-center gap-2">{actions}</span> : null}
    </div>
  );
}
