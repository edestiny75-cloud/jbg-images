'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * Replaces the global `toast()` function, which appended a div to the body and
 * removed it on a timer. Same one-line API for callers, but it now announces
 * itself to screen readers and cannot leak nodes if the screen unmounts first.
 */

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONES: Record<ToastTone, string> = {
  info: 'bg-info-bg text-info-fg border-info-fg/30',
  success: 'bg-success-bg text-success-fg border-success-fg/30',
  warn: 'bg-warn-bg text-warn-fg border-warn-fg/30',
  danger: 'bg-danger-bg text-danger-fg border-danger-fg/30',
};

const DURATION_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), DURATION_MS);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto max-w-lg rounded-md border px-4 py-2.5 text-sm font-bold shadow-hover',
              TONES[t.tone],
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}
