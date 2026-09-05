import { describe, expect, it } from 'vitest';
import { casePack, itemOz, packVerdict, shipOz, stackCapacityIn, unitThicknessIn } from './weights';
import { DEFAULT_SETTINGS, type CatalogProduct } from './types';

const single: CatalogProduct = { sku: 'JBG-POS-LAM-USA', sheetsPerUnit: 1 };
const sixPack: CatalogProduct = { sku: 'JBG-POS-LAM-BUNDLE_6PK', sheetsPerUnit: 6 };

describe('itemOz', () => {
  it('is sheets times the per-sheet weight, with no packaging', () => {
    expect(itemOz(single, '11x17', DEFAULT_SETTINGS)).toBeCloseTo(1.8);
    expect(itemOz(sixPack, '11x17', DEFAULT_SETTINGS)).toBeCloseTo(10.8);
    expect(itemOz(single, '8.5x11', DEFAULT_SETTINGS)).toBeCloseTo(1.0);
  });

  it('lets a manual override win', () => {
    expect(itemOz(sixPack, '11x17', DEFAULT_SETTINGS, { weightOz: 2 })).toBe(2);
  });

  it('ignores a null or non-finite override', () => {
    expect(itemOz(single, '11x17', DEFAULT_SETTINGS, { weightOz: null })).toBeCloseTo(1.8);
    expect(itemOz(single, '11x17', DEFAULT_SETTINGS, { weightOz: NaN })).toBeCloseTo(1.8);
  });

  it('treats an override of zero as a real answer, not a missing one', () => {
    expect(itemOz(single, '11x17', DEFAULT_SETTINGS, { weightOz: 0 })).toBe(0);
  });
});

describe('shipOz', () => {
  it('adds the mailer to the item weight', () => {
    expect(shipOz(single, '11x17', DEFAULT_SETTINGS)).toBeCloseTo(8.2); // 1.8 + 6.4
    expect(shipOz(single, '8.5x11', DEFAULT_SETTINGS)).toBeCloseTo(4.4); // 1.0 + 3.4
  });

  it('lets a manual ship-weight override win outright', () => {
    expect(shipOz(single, '11x17', DEFAULT_SETTINGS, { shipWeightOz: 12 })).toBe(12);
  });

  it('still adds the mailer on top of an item-weight override', () => {
    expect(shipOz(single, '11x17', DEFAULT_SETTINGS, { weightOz: 3 })).toBeCloseTo(9.4);
  });
});

describe('unitThicknessIn', () => {
  it('is the empty mailer plus each sheet inside it', () => {
    expect(unitThicknessIn(single, '11x17', DEFAULT_SETTINGS)).toBeCloseTo(0.125);
    expect(unitThicknessIn(sixPack, '11x17', DEFAULT_SETTINGS)).toBeCloseTo(0.225);
  });
});

describe('stackCapacityIn', () => {
  it('multiplies the carton height by the number of columns', () => {
    expect(stackCapacityIn(DEFAULT_SETTINGS, '11x17')).toBe(10);
    expect(stackCapacityIn(DEFAULT_SETTINGS, '8.5x11')).toBe(20);
  });
});

describe('casePack', () => {
  it('takes whichever cap binds first', () => {
    // 11x17 single: 800/8.2 = 97 by weight, 10/0.125 = 80 by height.
    expect(casePack(single, '11x17', DEFAULT_SETTINGS)).toBe(80);
    // 8.5x11 single: 800/4.4 = 181 by weight, 20/0.125 = 160 by height.
    expect(casePack(single, '8.5x11', DEFAULT_SETTINGS)).toBe(160);
  });

  it('respects a manual ship-weight override, which the planner also uses', () => {
    // 400 oz each: weight now binds at 2, well before the height cap of 80.
    expect(casePack(single, '11x17', DEFAULT_SETTINGS, { shipWeightOz: 400 })).toBe(2);
  });

  it('never returns less than one, even for an absurdly heavy unit', () => {
    expect(casePack(single, '11x17', DEFAULT_SETTINGS, { shipWeightOz: 100_000 })).toBe(1);
  });
});

describe('packVerdict', () => {
  it('reports whole cases and the loose remainder', () => {
    expect(packVerdict(180, 80)).toMatchObject({ ok: true, fullCases: 2, loose: 20, shortBy: 0 });
  });

  it('reports how many more units complete the first case', () => {
    expect(packVerdict(50, 80)).toMatchObject({ ok: false, fullCases: 0, loose: 50, shortBy: 30 });
  });

  it('treats an exact multiple as full with nothing loose', () => {
    expect(packVerdict(160, 80)).toMatchObject({ ok: true, fullCases: 2, loose: 0, shortBy: 0 });
  });

  it('guards against a case-pack size of zero', () => {
    expect(packVerdict(5, 0)).toMatchObject({ casePackSize: 1, fullCases: 5, loose: 0 });
  });
});
