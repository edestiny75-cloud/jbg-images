/**
 * The four-character stand-in shown when a product has no photograph.
 *
 * Ported from `initials` (index.html:814). It lives here, outside any
 * `'use client'` module, because both the browser's `<Thumb>` and the printed
 * price sheet — which is rendered on the server — need the same answer, and a
 * function exported from a client module cannot be called during a server
 * render.
 */
export function skuInitials(sku: string): string {
  const trimmed = (sku || '').replace(/^JB[GL]-(POS|BIN|CC)?-?(LAM-)?/, '').slice(0, 4);
  return trimmed || 'JBG';
}
