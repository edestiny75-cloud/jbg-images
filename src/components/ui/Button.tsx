import { cn } from '@/lib/ui/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Replaces `.btn` / `.jbtn` and, more importantly, the colour-by-position rule
 * that governed them:
 *
 *   .btn:nth-of-type(7n+1) { background: #2b7ad6 !important }   // blue
 *   .btn:nth-of-type(7n+2) { background: #e84c8a !important }   // pink
 *   …
 *
 * Under that rule inserting one button silently re-coloured every button after
 * it. Colour is now a `tone`, chosen for meaning.
 */

export type ButtonTone =
  /** Neutral action. */
  | 'default'
  /** The one action the screen exists for. */
  | 'primary'
  /** Destructive or irreversible. */
  | 'danger'
  /** Low-emphasis, sits inside dense rows. */
  | 'ghost'
  /** Brand colours, for nav and for screens that want visual variety. */
  | 'blue'
  | 'pink'
  | 'orange'
  | 'purple'
  | 'green'
  | 'gold'
  | 'teal'
  | 'red';

export type ButtonSize = 'sm' | 'md' | 'lg';

const TONES: Record<ButtonTone, string> = {
  default: 'bg-panel-2 text-ink hover:brightness-125 border border-line',
  primary: 'bg-jbg-green text-white hover:brightness-110',
  danger: 'bg-jbg-red text-white hover:brightness-110',
  ghost: 'bg-transparent text-muted hover:bg-panel-2 hover:text-ink border border-line',
  blue: 'bg-jbg-blue text-white hover:brightness-110',
  pink: 'bg-jbg-pink text-white hover:brightness-110',
  orange: 'bg-jbg-orange text-white hover:brightness-110',
  purple: 'bg-jbg-purple text-white hover:brightness-110',
  green: 'bg-jbg-green text-white hover:brightness-110',
  gold: 'bg-jbg-gold text-white hover:brightness-110',
  teal: 'bg-jbg-teal text-white hover:brightness-110',
  red: 'bg-jbg-red text-white hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  // 44px minimum height throughout: these are pressed on an iPad.
  sm: 'text-sm px-3 py-2 min-h-9 rounded-sm',
  md: 'text-base px-4 py-2.5 min-h-11 rounded-sm',
  lg: 'text-lg px-6 py-3.5 min-h-touch rounded-md font-extrabold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Stretch to the width of the container. */
  block?: boolean;
  /** Shows a busy state and blocks further presses. */
  pending?: boolean;
  children?: ReactNode;
}

export function Button({
  tone = 'default',
  size = 'md',
  block = false,
  pending = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-bold',
        'shadow-raised transition-[filter,transform,box-shadow] duration-100',
        'hover:-translate-y-0.5 hover:shadow-hover active:translate-y-0',
        'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        TONES[tone],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-pill border-2 border-current border-t-transparent"
    />
  );
}
