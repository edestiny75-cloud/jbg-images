import Link from 'next/link';
import { EmptyState } from '@/components/domain/EmptyState';
import { resolveOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import { allowsAdHocBoxes, casePack, freeAvailable, orderKindLabel } from '@/lib/domain';
import { BoxPlanner, type PlannedBoxView } from './BoxPlanner';

/**
 * Box Planner. Ported from `viewBoxes` (index.html:1006).
 *
 * The carton choice is persisted now, and the "how many fill a case" check uses
 * the same `casePack` the planner and the product modal use — the legacy screen
 * had its own third copy of that formula.
 */
export const metadata = { title: 'Box Planner · JBG Fulfillment' };

export default async function BoxesPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const batchId = await resolveOrderId((await searchParams).batch);
  const loaded = batchId ? await loadOrder(batchId) : null;

  if (!loaded) {
    return (
      <EmptyState title="No order open">
        <p>
          Upload a list on{' '}
          <Link href="/intake" className="font-bold text-mint underline">
            List Intake
          </Link>{' '}
          and plan it, then the boxes appear here.
        </p>
      </EmptyState>
    );
  }

  const byBoxNo = new Map(loaded.order.boxes.map((b) => [b.boxNo, b]));

  const boxes: PlannedBoxView[] = loaded.boxes.map((box) => {
    const row = byBoxNo.get(box.boxNo);
    return {
      id: row?.id ?? 0,
      boxNo: box.boxNo,
      size: box.size,
      status: box.status,
      weightOz: box.weightOz,
      thickIn: box.thickIn,
      units: box.units,
      carton: row?.carton ?? null,
      items: box.items.map((item) => {
        const rowItem = row?.items.find((i) => i.productSku === item.sku);
        const product = loaded.products.get(item.sku) ?? null;
        return {
          boxItemId: rowItem?.id ?? 0,
          sku: item.sku,
          title: item.title,
          thumbUrl: item.thumbUrl,
          qty: item.qty,
          actual: item.actual,
          /** Units of this SKU that fill one carton on their own. */
          casePack: product ? casePack(product, box.size, loaded.settings) : 0,
        };
      }),
    };
  });

  const catalogForAdds = [...loaded.products.values()].map((p) => ({
    sku: p.sku,
    title: p.title ?? null,
    asin: p.asin ?? null,
    thumbUrl: p.thumbUrl ?? null,
    free: freeAvailable(p.sku, loaded.lines, loaded.boxes),
  }));

  return (
    <BoxPlanner
      batchId={loaded.order.id}
      orderName={loaded.order.name ?? `Order ${loaded.order.id}`}
      orderKind={orderKindLabel(loaded.order.kind)}
      canAddBoxes={allowsAdHocBoxes(loaded.order.kind)}
      boxes={boxes}
      catalog={catalogForAdds}
    />
  );
}
