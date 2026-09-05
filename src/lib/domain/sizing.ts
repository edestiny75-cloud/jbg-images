import { type CatalogProduct, type SheetSize, isSheetSize } from './types';

/**
 * SKU/filename classification. Ported from index.html:673-683.
 *
 * These are heuristics over strings the shop types by hand, so they are
 * deliberately forgiving. Where the database has an authoritative answer
 * (`products.size`, `products.sheets_per_unit`), the resolver functions at the
 * bottom of this file prefer it and fall back to the heuristic.
 */

/** Canonical SKU form: upper-case, separators collapsed to single hyphens. */
export function normalizeSku(sku: string | null | undefined): string {
  return (sku ?? '')
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Guess the sheet format from the SKU, optionally helped by the legacy `meta`
 * display string, which often spells the size out.
 *
 * Binder inserts (JBG-BIN-) and calm-corner cards (JBG-CC-) are 8.5x11;
 * everything else defaults to 11x17.
 */
export function sizeFromSku(sku: string | null | undefined, meta?: string | null): SheetSize {
  const fromMeta = /(8\.5x11|17x11|11x17)/i.exec(meta ?? '');
  if (fromMeta?.[1]) {
    const m = fromMeta[1].toLowerCase();
    // The catalog writes this dimension both ways round.
    return m === '17x11' ? '11x17' : (m as SheetSize);
  }

  const s = (sku ?? '').toUpperCase();
  if (
    s.startsWith('JBG-BIN') ||
    s.startsWith('JBG-CC') ||
    s.includes('-85X11') ||
    s.includes('8.5X11')
  ) {
    return '8.5x11';
  }
  return '11x17';
}

/**
 * Guess how many printed sheets make up one saleable unit, from pack-size
 * markers in the SKU ("-9PK", "-24SET", "COMPLETE-6", "-48PC", …).
 *
 * A bare MASTER/BUNDLE/BASE with no number is assumed to be six sheets, which
 * is what the original did and what the catalog's unnumbered bundles are.
 */
export function sheetsFromSku(sku: string | null | undefined): number {
  const s = (sku ?? '').toUpperCase();

  const numbered = [
    /(\d+)\s*PK/,
    /(\d+)\s*SET/,
    /(\d+)\s*PACK/,
    /COMPLETE-?(\d+)/,
    /(\d+)\s*PC\b/,
    /(\d+)-?POSTER/,
  ];
  for (const re of numbered) {
    const m = re.exec(s);
    if (m?.[1]) return Number(m[1]);
  }

  if (/_6PK|6-PACK|VITALS_6PK/.test(s)) return 6;
  if (/MASTER|BUNDLE|BASE/.test(s)) return 6;
  return 1;
}

/** True when a filename looks like a multi-poster master file. */
export function isBundleFile(path: string | null | undefined): boolean {
  return /master|bundle|pack|complete|_all|[0-9]+pk|[0-9]+set|[0-9]+pc\b/i.test(path ?? '');
}

/** Superseded or retired products, flagged by wording in the title or SKU. */
export function isRetired(p: Pick<CatalogProduct, 'title' | 'sku'> | null | undefined): boolean {
  if (!p) return false;
  return /\bOLD\b|not in use|retired|superseded/i.test(`${p.title ?? ''} ${p.sku ?? ''}`);
}

/**
 * A binder set rather than a poster. Ported from `isBinderSku`
 * (index.html:842): JBG-BIN-… is a binder, and binders are 8.5x11.
 *
 * The catalog groups posters and binders separately, and the packer counts
 * binder contents in sheets rather than posters.
 */
export function isBinderSku(sku: string | null | undefined): boolean {
  return /(^|-)BIN(-|$)/i.test(sku ?? '');
}

/** A product is a bundle if it prints from a master file or packs >1 sheet. */
export function isBundle(p: CatalogProduct | null | undefined): boolean {
  if (!p) return false;
  return sheetsFor(p) > 1 || isBundleFile(p.pdfPath);
}

// ---------------------------------------------------------------- resolvers --

/**
 * Sheets per unit for a product.
 *
 * The legacy tool answered this question two different ways: `planBoxes` used
 * the SKU regex (via buildBatch), while `unitOzFor` and `casePackFor` preferred
 * `products.sheets_per_unit`. That meant the planner and the case-pack
 * calculator could disagree about the same SKU.
 *
 * Resolved here in favour of the database, which a human maintains, over the
 * regex, which only ever guessed.
 */
export function sheetsFor(p: CatalogProduct | null | undefined, fallbackSku?: string): number {
  const fromDb = p?.sheetsPerUnit;
  if (typeof fromDb === 'number' && fromDb > 0) return fromDb;
  return sheetsFromSku(p?.sku ?? fallbackSku);
}

/**
 * Sheet format for a product, honouring the priority the shop expects:
 *
 *   1. this session's toggle in List Intake
 *   2. the remembered per-SKU correction
 *   3. the catalog column
 *   4. the SKU/meta heuristic
 *
 * The original spread this ladder across index.html:762 and :841 with slightly
 * different rungs in each.
 */
export function resolveSize(args: {
  sessionSize?: SheetSize | null;
  overrideSize?: SheetSize | null;
  product?: CatalogProduct | null;
  sku: string;
}): SheetSize {
  const { sessionSize, overrideSize, product, sku } = args;
  if (isSheetSize(sessionSize)) return sessionSize;
  if (isSheetSize(overrideSize)) return overrideSize;
  if (isSheetSize(product?.size)) return product.size;
  return sizeFromSku(product?.sku ?? sku, product?.meta);
}
