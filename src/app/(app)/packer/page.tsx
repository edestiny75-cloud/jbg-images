import Link from 'next/link';
import { EmptyState } from '@/components/domain/EmptyState';
import { listProductLines } from '@/lib/db';
import { resolveOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import { productAssetUrls } from '@/lib/products/assets';
import { isSheetSize, orderKindLabel, resolveSize } from '@/lib/domain';
import { PackerScreen, type PackerBox, type PackerItem } from './PackerScreen';

/**
 * Packer · iPad. Ported from `viewPacker` (index.html:1074), the heaviest
 * screen in the tool at ~290 lines with helpers.
 *
 * Which box is open now lives in the URL (`/packer?box=3`) instead of
 * `STATE.activeBox`, so a refresh, a deep link and the back button all work —
 * none of which they did before.
 */
export const metadata = { title: 'Packer · JBG Fulfillment' };

export default async function PackerPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; box?: string; step?: string }>;
}) {
  const params = await searchParams;
  const batchId = await resolveOrderId(params.batch);
  const [loaded, lines] = await Promise.all([batchId ? loadOrder(batchId) : null, listProductLines()]);

  if (!loaded) {
    return (
      <EmptyState title="No order open">
        <p>
          Plan an order on{' '}
          <Link href="/intake" className="font-bold text-mint underline">
            List Intake
          </Link>
          , then its boxes appear here to pack.
        </p>
      </EmptyState>
    );
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));

  const boxes: PackerBox[] = loaded.order.boxes.map((box) => ({
    id: box.id,
    boxNo: box.boxNo,
    size: isSheetSize(box.size) ? box.size : '11x17',
    status: box.status,
    weightOz: box.weightOz,
    units: box.unitCount,
    carton: box.carton,
    items: box.items.map((item): PackerItem => {
      const product = loaded.products.get(item.productSku) ?? null;
      const line = product ? (lineById.get(product.line ?? '') ?? null) : null;
      return {
        boxItemId: item.id,
        sku: item.productSku,
        title: item.title,
        asin: item.asin,
        thumbUrl: item.thumbUrl,
        qty: item.qty,
        actual: item.actualQty,
        picked: item.picked,
        labelStatus: item.labelStatus,
        hasFnsku: Boolean(product?.fnskuPath),
        product,
        line,
        size: product
          ? resolveSize({ product, sku: item.productSku })
          : isSheetSize(box.size)
            ? box.size
            : '11x17',
        urls: product ? productAssetUrls(product, line) : null,
      };
    }),
  }));

  const activeBoxNo = Number.parseInt(params.box ?? '', 10);
  const step = Number.parseInt(params.step ?? '', 10);

  return (
    <PackerScreen
      batchId={loaded.order.id}
      orderName={loaded.order.name ?? `Order ${loaded.order.id}`}
      orderKind={orderKindLabel(loaded.order.kind)}
      needsLabels={loaded.order.needsLabels}
      settings={loaded.settings}
      boxes={boxes}
      activeBoxNo={Number.isInteger(activeBoxNo) ? activeBoxNo : null}
      step={Number.isInteger(step) && step >= 0 ? step : 0}
    />
  );
}
