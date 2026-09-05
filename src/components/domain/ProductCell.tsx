import { Thumb } from './Thumb';
import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * Thumbnail + title + SKU, the identity of a product inside a table row.
 * Replaces `.prodcell`, which was copied verbatim four times (index.html:894,
 * :940, :1019, :1448).
 */

export interface ProductCellProps {
  sku: string;
  title?: string | null;
  thumbUrl?: string | null;
  /** Secondary line under the SKU — a size, an ASIN, a shortage note. */
  detail?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ProductCell({ sku, title, thumbUrl, detail, onClick, className }: ProductCellProps) {
  const body = (
    <>
      <Thumb sku={sku} src={thumbUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-bold text-ink">{title || sku}</span>
        <span className="block truncate font-mono text-xs text-muted">{sku}</span>
        {detail ? <span className="block truncate text-xs text-muted">{detail}</span> : null}
      </span>
    </>
  );

  if (!onClick) {
    return <span className={cn('flex items-center gap-2.5', className)}>{body}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-sm text-left',
        'hover:bg-panel-2 focus:outline-none focus:ring-1 focus:ring-mint',
        className,
      )}
    >
      {body}
    </button>
  );
}
