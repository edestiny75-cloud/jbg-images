'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/ui/cn';
import { skuInitials } from '@/lib/ui/initials';

/**
 * A product thumbnail with an initials fallback.
 *
 * Replaces `thumbEl` (index.html:826, used at eight sites) and, more usefully,
 * the ten copies of
 *
 *   onerror="this.parentNode.textContent='…'"
 *
 * that each rebuilt the same fallback inline — and which, at five of those
 * sites, interpolated a raw spreadsheet SKU into an HTML attribute through an
 * `esc()` that does not escape quotes.
 */

const SIZES = {
  sm: 'size-10 text-[11px]',
  md: 'size-14 text-xs',
  lg: 'size-20 text-sm',
  xl: 'aspect-[3/4] w-full text-base',
} as const;

/** Rendered widths per size, so the optimiser fetches the right source. */
const SIZE_HINTS = {
  sm: '40px',
  md: '56px',
  lg: '80px',
  xl: '(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw',
} as const;

export interface ThumbProps {
  sku: string;
  src?: string | null;
  alt?: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function Thumb({ sku, src, alt, size = 'md', className }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm',
        'border border-line bg-panel-2 font-bold uppercase tracking-tight text-muted',
        SIZES[size],
        className,
      )}
    >
      {showImage ? (
        <Image
          src={src as string}
          alt={alt ?? sku}
          fill
          sizes={SIZE_HINTS[size]}
          onError={() => setFailed(true)}
          className="object-cover"
        />
      ) : (
        <span aria-hidden>{skuInitials(sku)}</span>
      )}
    </span>
  );
}
