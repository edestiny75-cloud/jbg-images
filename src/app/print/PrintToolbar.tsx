'use client';

import { useEffect } from 'react';

/**
 * The on-screen controls for a printed document. Never printed itself.
 *
 * The legacy version was `<script>window.onload=setTimeout(window.print,400)</script>`
 * written into a `window.open`ed document (index.html:1258). Four hundred
 * milliseconds is not how long it takes to fetch sixty product photographs from
 * Google Cloud Storage, which is why printed sheets came out with empty boxes.
 * This waits for the images to actually settle, and gives up after six seconds
 * rather than waiting on one that is never coming.
 */
export function PrintToolbar({ auto = false, hint }: { auto?: boolean; hint?: string }) {
  useEffect(() => {
    if (!auto) return;

    let cancelled = false;

    const settled = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...[...document.images]
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
    ]);

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 6000));

    void Promise.race([settled, timeout]).then(() => {
      if (!cancelled) window.print();
    });

    return () => {
      cancelled = true;
    };
  }, [auto]);

  return (
    <div className="doc-toolbar">
      <button type="button" className="doc-btn" onClick={() => window.print()}>
        🖨 Print / Save as PDF
      </button>
      <button type="button" className="doc-btn secondary" onClick={() => window.close()}>
        Close tab
      </button>
      {hint && <span className="doc-hint">{hint}</span>}
    </div>
  );
}
