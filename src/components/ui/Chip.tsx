import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * Replaces `statusChip` (index.html:827), `catBadges` (:695), `.bdg.*`, `.pchip`
 * and `.jp` — five status-pill idioms that had drifted apart.
 */

export type ChipTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'mint';

const TONES: Record<ChipTone, string> = {
  neutral: 'bg-panel-2 text-muted border-line',
  success: 'bg-success-bg text-success-fg border-success-fg/25',
  warn: 'bg-warn-bg text-warn-fg border-warn-fg/25',
  danger: 'bg-danger-bg text-danger-fg border-danger-fg/25',
  info: 'bg-info-bg text-info-fg border-info-fg/25',
  mint: 'bg-mint-dark text-mint-ink border-transparent',
};

export interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Chip({ tone = 'neutral', children, className, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill border',
        'px-2.5 py-1 text-xs font-bold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Square-cornered variant used inside product cards for size/format tags. */
export function Badge({ tone = 'neutral', children, className, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-xs border',
        'px-1.5 py-0.5 text-[11px] font-bold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
