import { listOrders, listProducts } from '@/lib/db';
import { resolveOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import { orderKindLabel } from '@/lib/domain';
import { IntakeScreen, type IntakeLine, type OrderChoice } from './IntakeScreen';

/**
 * List Intake. Ported from the upload/review flow around index.html:1820-1900.
 *
 * The customer's list is parsed on the server and stored as a draft batch
 * immediately, so a refresh, a closed tab or a flat iPad battery no longer
 * loses the work — the legacy list lived only in the `CURRENT_LIST` global.
 */
export const metadata = { title: 'List Intake · JBG Fulfillment' };

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const batchId = await resolveOrderId((await searchParams).batch);
  const [loaded, orders, catalog] = await Promise.all([
    batchId ? loadOrder(batchId) : null,
    listOrders({ limit: 40 }),
    listProducts(),
  ]);

  const choices: OrderChoice[] = orders.map((o) => ({
    id: o.id,
    name: o.name ?? `Order ${o.id}`,
    kind: orderKindLabel(o.kind),
    status: o.status,
    lines: o._count.items,
    boxes: o._count.boxes,
    createdAt: o.createdAt.toISOString(),
  }));

  const lines: IntakeLine[] =
    loaded?.order.items.map((item, i) => {
      const line = loaded.lines[i];
      return {
        lineNo: item.lineNo,
        listSku: item.listSku,
        resolvedProductSku: item.resolvedProductSku,
        title: item.title,
        asin: item.asin,
        requestedQty: item.requestedQty,
        size: line?.size ?? '11x17',
        resolveStatus: item.resolveStatus,
        notes: item.notes,
        thumbUrl: line?.thumbUrl ?? null,
        hasPrintFile: Boolean(line?.product?.pdfPath),
      };
    }) ?? [];

  return (
    <IntakeScreen
      order={
        loaded
          ? {
              id: loaded.order.id,
              name: loaded.order.name ?? `Order ${loaded.order.id}`,
              kind: loaded.order.kind,
              status: loaded.order.status,
              needsLabels: loaded.order.needsLabels,
              boxes: loaded.boxes.length,
            }
          : null
      }
      lines={lines}
      orders={choices}
      catalog={catalog.map((p) => ({ sku: p.sku, title: p.title ?? null, asin: p.asin ?? null }))}
    />
  );
}
