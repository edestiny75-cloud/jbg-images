'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { MAX_SELECTION, type ExportShape } from '@/lib/export/priceBook';
import { downloadFile } from '@/lib/ui/download';

/**
 * The two documents a screen can produce from a set of products: the .xlsx
 * download and the printed price sheet.
 *
 * Both the Catalog and the Wholesale sheet offer them, over different
 * selections, and in the legacy tool that meant two copies of the export
 * plumbing that had already drifted — `exportExcel` titled its file from
 * `STATE.catLine` while `exportPDF` titled its document from `STATE.catQ`, so
 * the same selection came out under two different names. One hook, one set of
 * rules.
 */

/**
 * What the document covers. An explicit `skus` list wins; otherwise the filter
 * fields describe the slice and the server resolves it — which is how "export
 * everything" stays four query parameters instead of 265 SKUs.
 */
export interface DocumentTarget {
  skus?: readonly string[];
  line?: string;
  size?: string;
  q?: string;
}

/** `/print/price-sheet?…` for a target. Exported for its own test. */
export function priceSheetUrl(target: DocumentTarget, options: { auto?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (target.skus?.length) params.set('skus', target.skus.join(','));
  else {
    if (target.line) params.set('line', target.line);
    if (target.size) params.set('size', target.size);
    if (target.q) params.set('q', target.q);
  }
  if (options.auto) params.set('auto', '1');

  const query = params.toString();
  return query ? `/print/price-sheet?${query}` : '/print/price-sheet';
}

export function useDocuments() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  /** A hand-picked set has to survive a URL, so it has a ceiling. */
  const withinLimit = (target: DocumentTarget): boolean => {
    const picked = target.skus?.length ?? 0;
    if (picked <= MAX_SELECTION) return true;
    toast(
      `${picked} selected — a document holds ${MAX_SELECTION}. Narrow the selection, or clear it to send the whole filtered list.`,
      'warn',
    );
    return false;
  };

  const exportExcel = (target: DocumentTarget, shape: ExportShape, count: number) => {
    if (!withinLimit(target)) return;
    setExporting(true);
    void downloadFile('/api/export/wholesale', { shape, ...target }).then((result) => {
      setExporting(false);
      if (!result.ok) toast(result.error ?? 'The export failed.', 'danger');
      else toast(`Exported ${count} ${count === 1 ? 'product' : 'products'}.`, 'success');
    });
  };

  const openPriceSheet = (target: DocumentTarget) => {
    if (!withinLimit(target)) return;
    // A new tab: the sheet is a document to keep open beside the app, and it
    // has a URL, unlike the `window.open('')` + `document.write` it replaces.
    window.open(priceSheetUrl(target, { auto: true }), '_blank', 'noopener');
  };

  return { exporting, exportExcel, openPriceSheet };
}
