import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * A big number over a caption. Replaces nine hand-built copies across three
 * views (index.html:922-925, :1030-1032, :1040-1042) that had drifted in
 * padding, font size and colour.
 */

export type StatTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<StatTone, string> = {
  neutral: 'text-ink',
  good: 'text-mint',
  warn: 'text-warn-fg',
  bad: 'text-danger-fg',
  info: 'text-info-fg',
};

export interface StatCardProps {
  value: ReactNode;
  label: ReactNode;
  tone?: StatTone;
  /** Optional supporting line under the caption. */
  hint?: ReactNode;
  className?: string;
}

export function StatCard({ value, label, tone = 'neutral', hint, className }: StatCardProps) {
  return (
    <div className={cn('rounded-md bg-panel px-4 py-3 shadow-panel', className)}>
      <div className={cn('text-2xl leading-tight font-extrabold tabular-nums', TONES[tone])}>
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold text-muted">{label}</div>
      {hint ? <div className="mt-1 text-xs text-muted-dim">{hint}</div> : null}
    </div>
  );
}

/** A responsive row of stat cards. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
