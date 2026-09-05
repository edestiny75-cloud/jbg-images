'use client';

import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * One table. Replaces eight hand-rolled `<thead><tr><th>` blocks — `.itable`
 * appears four times (index.html:892, :1028, :1207, :1447) and the print queue,
 * wholesale sheet, register and jobs list each grew their own near-copy.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways, which is what the legacy `.wsheet-wrap` did by hand for one of them.
 */

export interface Column<Row> {
  /** Stable identity, and the default header text. */
  key: string;
  header?: ReactNode;
  /** Rendered cell. Given the row and its index within the current page. */
  cell: (row: Row, index: number) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Tailwind width utility, e.g. "w-24". */
  width?: string;
  /** Hidden below the `sm` breakpoint. For columns a packer does not need. */
  secondary?: boolean;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string | number;
  /** Highlights a row — a shortage, a held line, a claimed job. */
  rowTone?: (row: Row) => 'default' | 'warn' | 'danger' | 'success' | undefined;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
  className?: string;
  /** Sticks the header while the body scrolls. */
  stickyHeader?: boolean;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

const ROW_TONES = {
  default: '',
  warn: 'bg-warn-bg/40',
  danger: 'bg-danger-bg/40',
  success: 'bg-success-bg/40',
} as const;

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowTone,
  onRowClick,
  empty = 'Nothing here yet.',
  className,
  stickyHeader = false,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-muted">{empty}</div>;
  }

  return (
    <div className={cn('overflow-x-auto rounded-md border border-line bg-panel', className)}>
      <table className="w-full border-collapse text-left text-sm">
        <thead className={cn('bg-panel-2 text-muted', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'border-b border-line px-3 py-2 text-xs font-bold uppercase tracking-wide',
                  ALIGN[c.align ?? 'left'],
                  c.width,
                  c.secondary && 'hidden sm:table-cell',
                )}
              >
                {c.header ?? c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line/60 last:border-0',
                ROW_TONES[rowTone?.(row) ?? 'default'],
                onRowClick && 'cursor-pointer hover:bg-panel-2',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-2 align-middle',
                    ALIGN[c.align ?? 'left'],
                    c.secondary && 'hidden sm:table-cell',
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
