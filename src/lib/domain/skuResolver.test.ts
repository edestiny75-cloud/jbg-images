import { describe, expect, it } from 'vitest';
import {
  buildCatalogIndex,
  levenshtein,
  resolveSku,
  stripSuffix,
} from './skuResolver';
import type { CatalogProduct } from './types';

const p = (sku: string, over: Partial<CatalogProduct> = {}): CatalogProduct => ({ sku, ...over });

const CATALOG: CatalogProduct[] = [
  p('JBG-POS-LAM-USA', { asin: 'B0G61NCFGN' }),
  p('JBG-POS-LAM-WorldMap', { asin: 'B0GVMQL5DP' }),
  p('JBG-BIN-LAM-Washington'),
  p('JBG-POS-LAM-CHINA'),
];
const index = buildCatalogIndex(CATALOG);

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
  ])('%s -> %s = %i', (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
  });

  it('is symmetric', () => {
    expect(levenshtein('JBG-POS-USA', 'JBG-POS-UAS')).toBe(
      levenshtein('JBG-POS-UAS', 'JBG-POS-USA'),
    );
  });
});

describe('stripSuffix', () => {
  it.each([
    ['JBG-POS-LAM-USA', 'JBG-POS-LAM-USA'],
    ['JBG-POS-LAM-USA-FBA', 'JBG-POS-LAM-USA'],
    ['JBG-POS-LAM-USA-2', 'JBG-POS-LAM-USA'],
    // Both suffixes, in either order, stripped to exhaustion.
    ['JBG-POS-LAM-USA-2-FBA', 'JBG-POS-LAM-USA'],
    ['JBG-POS-LAM-USA-FBA-2', 'JBG-POS-LAM-USA'],
  ])('%s -> %s', (input, expected) => {
    expect(stripSuffix(input)).toBe(expected);
  });

  it('terminates on a string that is entirely suffix', () => {
    expect(stripSuffix('-FBA')).toBe('');
  });
});

describe('resolveSku', () => {
  it('prefers ASIN, which is unambiguous', () => {
    // Deliberately wrong SKU; the ASIN must win.
    const r = resolveSku(index, 'TOTAL-NONSENSE', 'B0G61NCFGN');
    expect(r.status).toBe('asin');
    expect(r.product?.sku).toBe('JBG-POS-LAM-USA');
  });

  it('uses a confirmed alias before attempting any matching', () => {
    const aliases = new Map([['PATRICK-USA-MAP', 'JBG-POS-LAM-USA']]);
    const r = resolveSku(index, 'PATRICK-USA-MAP', null, aliases);
    expect(r.status).toBe('aliased');
    expect(r.product?.sku).toBe('JBG-POS-LAM-USA');
  });

  it('ignores an alias pointing at a SKU no longer in the catalog', () => {
    const aliases = new Map([['X', 'DELETED-SKU']]);
    expect(resolveSku(index, 'X', null, aliases).status).toBe('unmapped');
  });

  it('matches exactly', () => {
    const r = resolveSku(index, 'JBG-POS-LAM-USA');
    expect(r.status).toBe('matched');
    expect(r.product?.sku).toBe('JBG-POS-LAM-USA');
  });

  it('matches after normalising case and separators', () => {
    for (const variant of ['jbg_pos_lam_usa', 'JBG  POS  LAM  USA', 'jbg--pos--lam--usa']) {
      const r = resolveSku(index, variant);
      expect(r.status, variant).toBe('matched');
      expect(r.product?.sku, variant).toBe('JBG-POS-LAM-USA');
    }
  });

  it('matches after stripping an -FBA or numeric suffix', () => {
    expect(resolveSku(index, 'JBG-POS-LAM-USA-FBA').product?.sku).toBe('JBG-POS-LAM-USA');
    expect(resolveSku(index, 'JBG-POS-LAM-USA-2').product?.sku).toBe('JBG-POS-LAM-USA');
  });

  it('offers a near miss for confirmation rather than accepting it', () => {
    const r = resolveSku(index, 'JBG-POS-LAM-CHNA'); // one deletion
    expect(r.status).toBe('needs_confirm');
    expect(r.product?.sku).toBe('JBG-POS-LAM-CHINA');
    expect(r.candidates[0]).toBe('JBG-POS-LAM-CHINA');
  });

  it('gives up past the edit-distance threshold but still suggests candidates', () => {
    const r = resolveSku(index, 'COMPLETELY-DIFFERENT-THING');
    expect(r.status).toBe('unmapped');
    expect(r.product).toBeNull();
    expect(r.candidates).toHaveLength(3);
  });

  it('returns unmapped against an empty catalog without throwing', () => {
    const empty = buildCatalogIndex([]);
    const r = resolveSku(empty, 'ANYTHING');
    expect(r).toEqual({ product: null, status: 'unmapped', candidates: [] });
  });
});

describe('buildCatalogIndex', () => {
  it('keeps the first product when two SKUs normalise the same way', () => {
    const dupes = buildCatalogIndex([p('JBG-POS-A'), p('jbg_pos_a')]);
    expect(dupes.byNormalizedSku.get('JBG-POS-A')?.sku).toBe('JBG-POS-A');
  });

  it('ignores products with no ASIN', () => {
    expect(index.byAsin.has('')).toBe(false);
    expect(index.byAsin.size).toBe(2);
  });
});
