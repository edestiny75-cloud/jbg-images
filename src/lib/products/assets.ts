import 'server-only';
import { assetUrl, fnskuPdfUrl, fnskuPreviewUrl, printPdfUrl, sideBUrl, thumbUrl } from '@/lib/assets';
import type { ProductAssetUrls } from '@/components/domain/ProductDetail';
import type { CatalogProduct } from '@/lib/domain';
import type { ProductLineConfig } from '@/lib/db/products.repo';

/**
 * Resolves every URL a product modal needs, on the server.
 *
 * The client never sees a storage base URL, and the panel/action `field` names
 * from `product_lines` are resolved here rather than by a switch in the browser
 * — which is what let the Print Queue display `products.pdf_path` while queueing
 * a different string for the same job.
 */
export function productAssetUrls(
  product: CatalogProduct,
  line: ProductLineConfig | null,
): ProductAssetUrls {
  const panels: Record<string, string> = { thumb: thumbUrl(product) };
  for (const panel of line?.panels ?? []) {
    panels[panel.field] = panel.field === 'pngB' ? sideBUrl(product.sku) : thumbUrl(product);
  }

  const actions: Record<string, string> = {};
  for (const action of line?.actions ?? []) {
    actions[action.field] = assetUrl(product, action.field);
  }

  return {
    panels,
    actions,
    fnskuPreview: fnskuPreviewUrl(product.sku),
    fnskuPdf: fnskuPdfUrl(product.sku),
    printPdf: printPdfUrl(product.sku),
  };
}
