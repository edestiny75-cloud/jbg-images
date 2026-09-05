import 'server-only';
import { getOrder, getSettings, listOverrides, listProducts, type Order } from '@/lib/db';
import { thumbUrl } from '@/lib/assets';
import {
  isSheetSize,
  resolveSize,
  type CatalogProduct,
  type PackingSettings,
  type PlannableLine,
  type PlannedBox,
  type PlannedItem,
} from '@/lib/domain';

/**
 * Assemble everything a working screen needs about one order.
 *
 * Print Queue, Box Planner and Packer each rebuilt this join by hand from the
 * globals, with slightly different rules about which size to believe. It is
 * done once here, and `resolveSize` decides the size everywhere.
 */

export interface LoadedOrder {
  order: Order;
  settings: PackingSettings;
  /** The customer's list, resolved against the catalog. */
  lines: PlannableLine[];
  /** Boxes as the planner's own type, so domain functions can consume them directly. */
  boxes: PlannedBox[];
  /** Every product on the order, keyed by SKU. */
  products: Map<string, CatalogProduct>;
}

export async function loadOrder(batchId: number): Promise<LoadedOrder | null> {
  const [order, settings, catalog, overrides] = await Promise.all([
    getOrder(batchId),
    getSettings(),
    listProducts(),
    listOverrides(),
  ]);
  if (!order) return null;

  const bySku = new Map<string, CatalogProduct>(catalog.map((p) => [p.sku, p]));

  const lines: PlannableLine[] = order.items.map((item) => {
    const sku = item.resolvedProductSku ?? item.listSku;
    const product = bySku.get(sku) ?? null;
    const override = overrides.get(sku) ?? null;
    return {
      sku,
      size: resolveSize({
        sessionSize: isSheetSize(item.size) ? item.size : null,
        overrideSize: isSheetSize(override?.size) ? override.size : null,
        product,
        sku,
      }),
      requested: item.requestedQty,
      title: item.title ?? product?.title ?? null,
      asin: item.asin ?? product?.asin ?? null,
      thumbUrl: product ? thumbUrl(product) || null : null,
      fnskuPath: product?.fnskuPath ?? null,
      product,
      overrides: override,
    };
  });

  const boxes: PlannedBox[] = order.boxes.map((box) => ({
    boxNo: box.boxNo,
    size: isSheetSize(box.size) ? box.size : '11x17',
    weightOz: box.weightOz,
    thickIn: box.thickIn ?? 0,
    units: box.unitCount,
    status: box.status,
    items: box.items.map(
      (i): PlannedItem => ({
        sku: i.productSku,
        title: i.title,
        asin: i.asin,
        qty: i.qty,
        actual: i.actualQty,
        unitOz: 0,
        thumbUrl: i.thumbUrl,
        fnskuPath: i.fnskuPath,
      }),
    ),
  }));

  const products = new Map<string, CatalogProduct>();
  for (const line of lines) if (line.product) products.set(line.sku, line.product);

  return { order, settings, lines, boxes, products };
}
