'use client';

import { Button } from './Button';
import { cn } from '@/lib/ui/cn';

/**
 * Replaces `wholePagerHTML` (index.html:1277), the only paginator in the tool —
 * every other long list rendered all of its rows.
 */

export interface PagerProps {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** Shown as "1–50 of 264" when supplied. */
  total?: number;
  pageSize?: number;
  className?: string;
}

export function Pager({ page, pageCount, onPage, total, pageSize, className }: PagerProps) {
  if (pageCount <= 1) return null;

  const first = total != null && pageSize ? (page - 1) * pageSize + 1 : null;
  const last = total != null && pageSize ? Math.min(page * pageSize, total) : null;

  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <span className="text-sm text-muted">
        {first != null && last != null ? `${first}–${last} of ${total}` : `Page ${page} of ${pageCount}`}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" tone="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </Button>
        <span className="min-w-16 text-center text-sm font-bold" aria-current="page">
          {page} / {pageCount}
        </span>
        <Button size="sm" tone="ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next ›
        </Button>
      </div>
    </nav>
  );
}
