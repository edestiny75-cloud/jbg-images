import Link from 'next/link';
import { EmptyState } from '@/components/domain/EmptyState';
import { resolveOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import { shortages } from '@/lib/domain';
import { RegisterTable, type RegisterRow } from './RegisterTable';

/**
 * Box Register & Shipment Log. Ported from `viewRegister` (index.html:1148).
 *
 * The legacy screen advertised "▦ Synced to Google Sheet" and offered an
 * "Open Sheet ↗" button whose handler was `toast('Demo: opens the linked Google
 * Sheet')`. There is no Google Sheets integration anywhere in the tool, so the
 * claim is dropped rather than reproduced.
 */
export const metadata = { title: 'Box Register · JBG Fulfillment' };

export default async function RegisterPage({
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
          Pack a box on the{' '}
          <Link href="/packer" className="font-bold text-mint underline">
            Packer
          </Link>{' '}
          tab and it lands here with its weight, units and contents.
        </p>
      </EmptyState>
    );
  }

  const registered = loaded.order.boxes.filter((b) => b.status === 'packed' || b.status === 'shipped');

  const rows: RegisterRow[] = registered.map((box) => ({
    id: box.id,
    boxNo: box.boxNo,
    status: box.status === 'shipped' ? 'shipped' : 'packed',
    carton: box.carton ?? '20×14×10',
    size: box.size,
    weightLb: Number((box.weightOz / 16).toFixed(1)),
    units: box.unitCount,
    contents: box.items.map((i) => ({
      sku: i.productSku,
      asin: i.asin,
      packed: i.actualQty,
      planned: i.qty,
    })),
    labels: [...new Set(box.items.map((i) => i.labelStatus).filter((l) => l !== 'none'))],
  }));

  return (
    <RegisterTable
      batchId={loaded.order.id}
      orderName={loaded.order.name ?? `Order ${loaded.order.id}`}
      orderStatus={loaded.order.status}
      shipmentNo={loaded.order.shipmentNo}
      rows={rows}
      shortages={shortages(loaded.boxes)}
      totalBoxes={loaded.order.boxes.length}
    />
  );
}
