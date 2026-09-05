'use client';

/**
 * The legacy per-SKU maps in browser storage: jbg_wprice, jbg_cost,
 * jbg_cost_bulk, jbg_msrp, jbg_map, jbg_wt, jbg_shipwt.
 *
 * Replaces seven identical `try{JSON.parse}catch{}` + strip-non-numeric
 * accessor pairs. All seven keys become real tables in Phase 9; this module
 * exists so the one-time import screen can read what the live tool left behind
 * on each iPad before index.html is deleted.
 *
 * Deliberately not a hook that reads on mount: importing someone's price book
 * is an explicit action, and reading storage during render would differ between
 * the server pass and the client one.
 */

/** Every localStorage key the legacy tool wrote a per-SKU number map to. */
export const LEGACY_PRICE_KEYS = {
  wholesale: 'jbg_wprice',
  cost: 'jbg_cost',
  costBulk: 'jbg_cost_bulk',
  msrp: 'jbg_msrp',
  map: 'jbg_map',
} as const;

export const LEGACY_WEIGHT_KEYS = {
  weightOz: 'jbg_wt',
  shipWeightOz: 'jbg_shipwt',
} as const;

export const LEGACY_SIZE_KEY = 'jbg_sizeoverride';

/** Reads one of the legacy maps. Returns {} for anything missing or unparseable. */
export function readLocalMap(key: string): Record<string, number> {
  const parsed = readLocalJson(key);
  if (!parsed || typeof parsed !== 'object') return {};

  const out: Record<string, number> = {};
  for (const [sku, value] of Object.entries(parsed as Record<string, unknown>)) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) out[sku] = n;
  }
  return out;
}

/** Reads a legacy map whose values are strings, such as the size overrides. */
export function readLocalStringMap(key: string): Record<string, string> {
  const parsed = readLocalJson(key);
  if (!parsed || typeof parsed !== 'object') return {};

  const out: Record<string, string> = {};
  for (const [sku, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value) out[sku] = value;
  }
  return out;
}

export function readLocalJson(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Private browsing, or site data is blocked.
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
