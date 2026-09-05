import { describe, expect, it } from 'vitest';
import { PRESIDENT_ORDER, compareProducts, compareSkuNumeric, presidentRank, sizesIn } from './sorting';
import type { CatalogProduct } from './types';

describe('PRESIDENT_ORDER', () => {
  it('holds 47 presidencies with no duplicates', () => {
    expect(PRESIDENT_ORDER).toHaveLength(47);
    expect(new Set(PRESIDENT_ORDER).size).toBe(47);
    expect(PRESIDENT_ORDER[0]).toBe('Washington');
  });
});

describe('presidentRank', () => {
  it('ranks by presidency, not alphabetically', () => {
    expect(presidentRank('JBG-BIN-LAM-WASHINGTON')).toBe(0);
    expect(presidentRank('JBG-BIN-LAM-Obama')).toBe(42);
    expect(presidentRank('JBG-BIN-LAM-jefferson')).toBe(2);
  });

  it('sorts the two collections after every individual president', () => {
    expect(presidentRank('JBG-BIN-LAM-PRES-48PC')).toBe(900);
    expect(presidentRank('JBG-BIN-LAM-PRES-BINDER-24')).toBe(901);
  });

  it('is null outside the Presidents line', () => {
    expect(presidentRank('JBG-POS-LAM-USA')).toBeNull();
    expect(presidentRank(null)).toBeNull();
  });
});

describe('compareSkuNumeric', () => {
  it('orders numbers by value, so 2 comes before 10', () => {
    const sorted = ['JBG-A-10', 'JBG-A-2', 'JBG-A-1'].sort(compareSkuNumeric);
    expect(sorted).toEqual(['JBG-A-1', 'JBG-A-2', 'JBG-A-10']);
  });

  it('ignores case', () => {
    expect(compareSkuNumeric('jbg-a', 'JBG-A')).toBe(0);
  });
});

describe('compareProducts', () => {
  const p = (sku: string, over: Partial<CatalogProduct> = {}): CatalogProduct => ({ sku, ...over });

  it('sorts the Presidents line into office order', () => {
    const sorted = [
      p('JBG-BIN-LAM-Obama'),
      p('JBG-BIN-LAM-Washington'),
      p('JBG-BIN-LAM-Lincoln'),
      p('JBG-BIN-LAM-PRES-48PC'),
    ].sort(compareProducts);

    expect(sorted.map((x) => x.sku)).toEqual([
      'JBG-BIN-LAM-Washington',
      'JBG-BIN-LAM-Lincoln',
      'JBG-BIN-LAM-Obama',
      'JBG-BIN-LAM-PRES-48PC',
    ]);
  });

  it('pushes bundles below the singles they are made of', () => {
    const sorted = [
      p('JBG-POS-LAM-GEO-24SET'),
      p('JBG-POS-LAM-AAA', { sheetsPerUnit: 1 }),
    ].sort(compareProducts);

    expect(sorted.map((x) => x.sku)).toEqual(['JBG-POS-LAM-AAA', 'JBG-POS-LAM-GEO-24SET']);
  });

  it('falls back to numeric SKU order within a group', () => {
    const sorted = [p('JBG-CC-010'), p('JBG-CC-002')].sort(compareProducts);
    expect(sorted.map((x) => x.sku)).toEqual(['JBG-CC-002', 'JBG-CC-010']);
  });
});

describe('sizesIn', () => {
  it('collects distinct sizes, inferring the ones the catalog leaves blank', () => {
    expect(
      sizesIn([
        { sku: 'JBG-POS-LAM-USA', size: '11x17' },
        { sku: 'JBG-BIN-LAM-X' }, // inferred 8.5x11
        { sku: 'JBG-POS-LAM-Y', size: '11x17' },
      ]),
    ).toEqual(['11x17', '8.5x11']);
  });
});
