import { Badge } from '@/components/ui/Chip';
import { isBundle, isRetired, sizeFromSku, type CatalogProduct } from '@/lib/domain';

/**
 * The badge strip under a product's title. Ported from `catBadges`
 * (index.html:695), which was one of four places these tags were built.
 */
export function ProductBadges({ product }: { product: CatalogProduct }) {
  const size = product.size ?? sizeFromSku(product.sku, product.meta);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {isBundle(product) && <Badge tone="info">📦 Bundle</Badge>}
      <Badge tone={size === '8.5x11' ? 'neutral' : 'mint'}>{size}</Badge>
      {product.pdfPath && <Badge tone="success">print</Badge>}
      {product.fnskuPath && <Badge title="Has an FNSKU sheet">🏷️</Badge>}
      {isRetired(product) && <Badge tone="warn">OLD</Badge>}
    </span>
  );
}
