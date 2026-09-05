'use client';

import { cn } from '@/lib/ui/cn';

/**
 * One search input. Replaces four copies (index.html:877, :1080, :1329, :1702)
 * that each had different re-render semantics — one of which caused the
 * confirmed live bug where typing in catalog search while export mode was on
 * lost focus on every keystroke, because `catSearch` fell back to a full
 * `render()`.
 *
 * Fully controlled and stateless. Screens that filter a long list should pass
 * the query through `useDeferredValue` before filtering: that keeps the caret
 * responsive without a debounce, and without this component holding a second
 * copy of the query that could fall out of step with the parent's.
 */

export interface SearchBarProps {
  value: string;
  onQuery: (query: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function SearchBar({
  value,
  onQuery,
  placeholder = 'Search SKU, title or ASIN…',
  autoFocus = false,
  className,
  'aria-label': ariaLabel = 'Search',
}: SearchBarProps) {
  return (
    <div className={cn('relative flex-1', className)}>
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        🔎
      </span>
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        className={cn(
          'w-full rounded-sm border border-line bg-panel-2 py-2.5 pl-9 pr-3',
          // 16px: anything smaller makes iOS zoom the whole page on focus.
          'text-touch text-ink placeholder:text-muted',
          'focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint',
        )}
      />
    </div>
  );
}
