import { normalizeSku } from './sizing';
import type { CatalogProduct } from './types';

/**
 * Matching a customer's SKU against the catalog. Ported from index.html:700-712.
 *
 * Customer lists arrive as spreadsheets typed by other people, so the same
 * product turns up as "JBG-POS-LAM-USA", "jbg_pos_lam_usa", "JBG-POS-LAM-USA-2"
 * and "JBG-POS-LAM-USA-FBA". The ladder below tries the cheap exact answers
 * first and only falls back to edit distance at the end.
 */

export type ResolveStatus =
  /** Matched on ASIN, which is unambiguous. */
  | 'asin'
  /** Matched through a mapping a human previously confirmed. */
  | 'aliased'
  /** Matched exactly, or after normalising / stripping suffixes. */
  | 'matched'
  /** A close spelling was found, but a human should confirm it. */
  | 'needs_confirm'
  /** Nothing close enough. */
  | 'unmapped';

export interface ResolveResult {
  product: CatalogProduct | null;
  status: ResolveStatus;
  /** Nearest catalog SKUs, best first. Only populated for the fuzzy outcomes. */
  candidates: string[];
}

/** Edit distance between two strings, iterative two-row Wagner-Fischer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Repeatedly strip the suffixes sellers append to a base SKU: "-FBA" for the
 * Amazon variant, and a trailing single digit for pack-size variants.
 */
export function stripSuffix(normalized: string): string {
  let s = normalized;
  for (;;) {
    const next = s.replace(/-FBA$/, '').replace(/-[0-9]$/, '');
    if (next === s) return s;
    s = next;
  }
}

/**
 * Lookup tables over the catalog. Built once per request and passed in, rather
 * than living in module-level Maps the way `byRaw` / `byNorm` / `byAsin` did.
 */
export interface CatalogIndex {
  products: readonly CatalogProduct[];
  bySku: ReadonlyMap<string, CatalogProduct>;
  byNormalizedSku: ReadonlyMap<string, CatalogProduct>;
  byAsin: ReadonlyMap<string, CatalogProduct>;
}

export function buildCatalogIndex(products: readonly CatalogProduct[]): CatalogIndex {
  const bySku = new Map<string, CatalogProduct>();
  const byNormalizedSku = new Map<string, CatalogProduct>();
  const byAsin = new Map<string, CatalogProduct>();

  for (const p of products) {
    bySku.set(p.sku, p);
    // First one wins: the catalog can hold two SKUs that normalise the same way.
    const n = normalizeSku(p.sku);
    if (!byNormalizedSku.has(n)) byNormalizedSku.set(n, p);
    if (p.asin && !byAsin.has(p.asin)) byAsin.set(p.asin, p);
  }

  return { products, bySku, byNormalizedSku, byAsin };
}

/** Edit distance at or below which a fuzzy match is worth offering. */
export const FUZZY_THRESHOLD = 3;

/** How many near-misses to show the operator when nothing matched cleanly. */
const CANDIDATE_COUNT = 3;

export function resolveSku(
  index: CatalogIndex,
  listSku: string,
  asin?: string | null,
  aliases: ReadonlyMap<string, string> = new Map(),
): ResolveResult {
  if (asin) {
    const byAsin = index.byAsin.get(asin);
    if (byAsin) return { product: byAsin, status: 'asin', candidates: [] };
  }

  const aliased = aliases.get(listSku);
  if (aliased) {
    const p = index.bySku.get(aliased);
    if (p) return { product: p, status: 'aliased', candidates: [] };
  }

  const exact = index.bySku.get(listSku);
  if (exact) return { product: exact, status: 'matched', candidates: [] };

  const normalized = normalizeSku(listSku);
  const byNorm = index.byNormalizedSku.get(normalized);
  if (byNorm) return { product: byNorm, status: 'matched', candidates: [] };

  const stripped = stripSuffix(normalized);
  if (stripped !== normalized) {
    const bySuffix = index.byNormalizedSku.get(stripped);
    if (bySuffix) return { product: bySuffix, status: 'matched', candidates: [] };
  }

  const scored = index.products
    .map((p) => ({ p, d: levenshtein(stripped, normalizeSku(p.sku)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, CANDIDATE_COUNT);

  const candidates = scored.map((s) => s.p.sku);
  const best = scored[0];

  if (best && best.d <= FUZZY_THRESHOLD) {
    return { product: best.p, status: 'needs_confirm', candidates };
  }
  return { product: null, status: 'unmapped', candidates };
}
