import 'server-only';
import { env } from './env';

/**
 * Where every product file lives.
 *
 * All of these are derived from the SKU — the legacy tool stored relative paths
 * in `BYSKU` as well, but never used them for URL construction, which is how the
 * Print Queue came to *display* `products.pdf_path` while *queueing*
 * `printPdfUrl(sku)`: two different strings for the same job.
 *
 * The GCS base was also duplicated into agent/JBG_Fiery_Agent.ps1. It now comes
 * from GCS_PRINTS_URL, and the agent reads it from the API response instead.
 */

function base(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

const PRINTS = base(env.GCS_PRINTS_URL);
const THUMBS = `${base(env.SUPABASE_PUBLIC_URL)}thumbs/`;
const SUPABASE_PRINTS = `${base(env.SUPABASE_PUBLIC_URL)}prints/`;

/** The production print PDF sent to the Fiery. Hosted on Google Cloud Storage. */
export function printPdfUrl(sku: string): string {
  return `${PRINTS}${encodeURIComponent(sku)}.pdf`;
}

/** The separate 12x18 cut file. Only some SKUs have one. */
export function printPdf12x18Url(sku: string): string {
  return `${PRINTS}${encodeURIComponent(sku)}_12x18.pdf`;
}

/** Reverse of the poster, where one was uploaded. */
export function sideBUrl(sku: string): string {
  return `${THUMBS}${encodeURIComponent(sku)}_B.jpg`;
}

/** Preview image of the 30-up FNSKU sheet. */
export function fnskuPreviewUrl(sku: string): string {
  return `${THUMBS}${encodeURIComponent(sku)}_FN.jpg`;
}

/** The 30-up FNSKU sheet itself. Goes to the label printer, not the Fiery. */
export function fnskuPdfUrl(sku: string): string {
  return `${SUPABASE_PRINTS}${encodeURIComponent(sku)}_FN.pdf`;
}

/** Catalog thumbnail, falling back to nothing so the caller can show initials. */
export function thumbUrl(product: { sku: string; thumbUrl?: string | null }): string {
  return product.thumbUrl ?? '';
}

/** The fields LINECFG actions reference, resolved to real URLs. */
export function assetUrl(product: { sku: string; thumbUrl?: string | null }, field: string): string {
  switch (field) {
    case 'pdf':
      return printPdfUrl(product.sku);
    case 'pdf12x18':
      return printPdf12x18Url(product.sku);
    case 'pngB':
      return sideBUrl(product.sku);
    case 'fnsku':
      return fnskuPreviewUrl(product.sku);
    default:
      return thumbUrl(product);
  }
}
