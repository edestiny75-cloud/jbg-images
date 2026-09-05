import Link from 'next/link';
import { EmptyState } from '@/components/domain/EmptyState';
import { resolveOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import { activeLines, groupBySize, SHEET_SIZES } from '@/lib/domain';
import { fileName } from '@/lib/files';
import { printPdfUrl } from '@/lib/assets';
import { PrintQueue, type PrintRow } from './PrintQueue';

/**
 * The Print Queue. Ported from `viewPrint` (index.html:932).
 *
 * It follows the *edited* list: held lines drop out and changed quantities
 * carry through, exactly as before — except the list now comes from the
 * database rather than a module-level global, so a refresh no longer empties it.
 */
export const metadata = { title: 'Print Queue · JBG Fulfillment' };

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const batchId = await resolveOrderId((await searchParams).batch);
  const loaded = batchId ? await loadOrder(batchId) : null;

  if (!loaded) {
    return (
      <EmptyState title="No order selected">
        <p>
          Upload or open a list on the{' '}
          <Link href="/intake" className="font-bold text-mint underline">
            List Intake
          </Link>{' '}
          tab, then come back here to send the print files.
        </p>
      </EmptyState>
    );
  }

  // Only lines with a print file can be queued, and sizes never mix in one run.
  const printable = activeLines(loaded.lines).filter((l) => l.product?.pdfPath);
  const grouped = groupBySize(printable);

  const sections = SHEET_SIZES.map((size) => ({
    size,
    rows: grouped[size].map(
      (line): PrintRow => ({
        sku: line.sku,
        title: line.title ?? line.sku,
        thumbUrl: line.thumbUrl ?? null,
        requested: line.requested,
        size: line.size,
        sheets: line.product?.sheetsPerUnit ?? 1,
        fileName: fileName(printPdfUrl(line.sku)),
        pdfPath: line.product?.pdfPath ?? null,
      }),
    ),
  })).filter((s) => s.rows.length > 0);

  return (
    <PrintQueue
      batchId={loaded.order.id}
      orderName={loaded.order.name ?? `Order ${loaded.order.id}`}
      sections={sections}
    />
  );
}
