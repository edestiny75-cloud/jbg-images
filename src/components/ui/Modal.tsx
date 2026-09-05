'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * One overlay. Replaces seven that shared an open/close idiom and a backdrop,
 * plus the hardcoded Escape priority chain at index.html:1945 — a single
 * keydown handler that knew, by name, which of the seven to close first.
 *
 * `<dialog>` gives that ordering for free: the topmost open dialog receives the
 * cancel event, and the browser handles focus trapping and inertness.
 */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Buttons pinned below the scrolling body. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
  /** Blocks backdrop and Escape dismissal — for a modal mid-write. */
  dismissible?: boolean;
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  full: 'max-w-[min(96vw,1400px)]',
} as const;

export function Modal({
  open,
  onClose,
  title,
  footer,
  size = 'md',
  children,
  dismissible = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // A click that lands on the dialog element itself is a backdrop click:
        // the panel below stops propagation of its own.
        if (dismissible && e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[min(96vw,100%)] bg-transparent p-0 text-ink backdrop:bg-black/70',
        SIZES[size],
      )}
    >
      <div className="flex max-h-[88vh] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-hover">
        {(title || dismissible) && (
          <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <h2 className="text-lg font-extrabold">{title}</h2>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="min-h-touch min-w-touch rounded-sm px-3 text-2xl leading-none text-muted hover:bg-panel-2 hover:text-ink"
              >
                ×
              </button>
            )}
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
