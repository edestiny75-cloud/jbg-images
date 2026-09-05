import { describe, expect, it } from 'vitest';
import {
  isBinderSku,
  isBundle,
  isBundleFile,
  isRetired,
  normalizeSku,
  resolveSize,
  sheetsFor,
  sheetsFromSku,
  sizeFromSku,
} from './sizing';
import type { CatalogProduct } from './types';

describe('normalizeSku', () => {
  it.each([
    ['jbg-pos-lam-usa', 'JBG-POS-LAM-USA'],
    ['jbg_pos_lam_usa', 'JBG-POS-LAM-USA'],
    ['JBG  POS  LAM  USA', 'JBG-POS-LAM-USA'],
    ['--JBG--POS--', 'JBG-POS'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSku(input)).toBe(expected);
  });

  it('handles null and undefined', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku(undefined)).toBe('');
  });
});

describe('sizeFromSku', () => {
  it('defaults to 11x17', () => {
    expect(sizeFromSku('JBG-POS-LAM-USA')).toBe('11x17');
  });

  it('treats binder inserts and calm-corner cards as 8.5x11', () => {
    expect(sizeFromSku('JBG-BIN-LAM-USMAP3_WRLD')).toBe('8.5x11');
    expect(sizeFromSku('JBG-CC-006')).toBe('8.5x11');
  });

  it('reads an explicit size out of the SKU', () => {
    expect(sizeFromSku('JBG-POS-LAM-ExcelShortcuts-85x11')).toBe('8.5x11');
  });

  it('prefers the meta string when it names a size', () => {
    // The SKU alone would say 11x17.
    expect(sizeFromSku('JBG-POS-LAM-USA', 'Single · Map · 8.5x11 · $9.99')).toBe('8.5x11');
  });

  it('normalises 17x11 to 11x17, since the catalog writes it both ways', () => {
    expect(sizeFromSku('JBG-POS-LAM-USA', 'Poster · 17x11')).toBe('11x17');
  });
});

describe('sheetsFromSku', () => {
  it.each([
    ['JBG-POS-LAM-USA', 1],
    ['JBL-POS-LAM-GEO BUNDLE 9PK', 9],
    ['JBG-POS-LAM-GEO-24SET', 24],
    ['JBG-POS-LAM-Laundry3Pack', 3],
    ['JBG-BIN-LAM-PRES-48PC', 48],
    ['JBG-POS-LAM-HumanBody_Bundle_Vitals_6pk', 6],
  ])('%s -> %i sheets', (sku, expected) => {
    expect(sheetsFromSku(sku)).toBe(expected);
  });

  it('assumes six sheets for an unnumbered master or bundle', () => {
    expect(sheetsFromSku('JBG-CC-MASTER-001')).toBe(6);
    expect(sheetsFromSku('JBG-CC-BASE-001')).toBe(6);
  });

  it('returns 1 for empty input rather than throwing', () => {
    expect(sheetsFromSku('')).toBe(1);
    expect(sheetsFromSku(null)).toBe(1);
  });
});

describe('sheetsFor', () => {
  const sku = 'JBG-POS-LAM-Laundry3Pack';

  it('prefers the catalog column over the SKU heuristic', () => {
    // The heuristic would say 3. The database is the authority.
    expect(sheetsFor({ sku, sheetsPerUnit: 4 })).toBe(4);
  });

  it('falls back to the heuristic when the column is unset', () => {
    expect(sheetsFor({ sku, sheetsPerUnit: null })).toBe(3);
    expect(sheetsFor({ sku })).toBe(3);
  });

  it('ignores a zero or negative column value', () => {
    expect(sheetsFor({ sku, sheetsPerUnit: 0 })).toBe(3);
  });

  it('uses the fallback SKU when there is no product at all', () => {
    expect(sheetsFor(null, sku)).toBe(3);
    expect(sheetsFor(null)).toBe(1);
  });
});

describe('isBundleFile', () => {
  it.each([
    ['prints/JBG-POS-LAM-FOUND-MASTER.pdf', true],
    ['prints/GEO_BUNDLE_9pk.pdf', true],
    ['prints/JBG-BIN-LAM-PRES-48pc.pdf', true],
    ['prints/JBG-POS-LAM-USA.pdf', false],
    ['', false],
  ])('%s -> %s', (path, expected) => {
    expect(isBundleFile(path)).toBe(expected);
  });
});

describe('isRetired', () => {
  it('flags wording in the title or the SKU', () => {
    expect(isRetired({ sku: 'JBG-POS-A', title: 'Map (OLD)' })).toBe(true);
    expect(isRetired({ sku: 'JBG-POS-A-OLD', title: 'Map' })).toBe(true);
    expect(isRetired({ sku: 'JBG-POS-A', title: 'superseded by B' })).toBe(true);
    expect(isRetired({ sku: 'JBG-POS-A', title: 'Map' })).toBe(false);
  });

  it('does not match OLD inside a longer word', () => {
    expect(isRetired({ sku: 'JBG-POS-GOLD', title: 'Gold Chart' })).toBe(false);
  });

  it('handles null', () => {
    expect(isRetired(null)).toBe(false);
  });
});

describe('isBundle', () => {
  it('is true when the unit packs more than one sheet', () => {
    expect(isBundle({ sku: 'JBG-POS-LAM-Laundry3Pack' })).toBe(true);
  });

  it('is true when only the print file says so', () => {
    expect(isBundle({ sku: 'JBG-POS-LAM-USA', pdfPath: 'prints/USA_master.pdf' })).toBe(true);
  });

  it('respects the catalog sheet count over the SKU', () => {
    expect(isBundle({ sku: 'JBG-POS-LAM-Laundry3Pack', sheetsPerUnit: 1 })).toBe(false);
  });

  it('is false for a plain single', () => {
    expect(isBundle({ sku: 'JBG-POS-LAM-USA', pdfPath: 'prints/USA.pdf' })).toBe(false);
  });
});

describe('resolveSize', () => {
  const product: CatalogProduct = { sku: 'JBG-POS-LAM-USA', size: '11x17' };

  it('follows the priority ladder: session, override, catalog, heuristic', () => {
    expect(
      resolveSize({ sku: 'X', product, sessionSize: '8.5x11', overrideSize: '11x17' }),
    ).toBe('8.5x11');

    expect(resolveSize({ sku: 'X', product, overrideSize: '8.5x11' })).toBe('8.5x11');
    expect(resolveSize({ sku: 'X', product })).toBe('11x17');
    expect(resolveSize({ sku: 'JBG-BIN-LAM-USMAP3' })).toBe('8.5x11');
  });

  it('ignores a catalog size that is not one of the two formats', () => {
    expect(resolveSize({ sku: 'JBG-BIN-LAM-X', product: { sku: 'JBG-BIN-LAM-X', size: 'A4' } }))
      .toBe('8.5x11');
  });
});

describe('isBinderSku', () => {
  it('recognises a binder SKU', () => {
    expect(isBinderSku('JBG-BIN-LAM-LINCOLN')).toBe(true);
  });

  it('rejects a poster SKU', () => {
    expect(isBinderSku('JBG-POS-LAM-LaundryToday-Rustic')).toBe(false);
  });

  it('does not match BIN inside a word', () => {
    expect(isBinderSku('JBG-POS-LAM-BINDING-Guide')).toBe(false);
  });

  it('handles a missing SKU', () => {
    expect(isBinderSku(null)).toBe(false);
  });
});
