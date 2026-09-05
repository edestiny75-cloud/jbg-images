import { describe, expect, it } from 'vitest';
import { buildPriceBook, columnsFor, exportFilename, type ExportItem } from './priceBook';
import { DEFAULT_SETTINGS } from '@/lib/domain';

const item = (over: Partial<ExportItem> = {}): ExportItem => ({
  product: { sku: 'JBG-POS-LAM-USA', title: 'USA Map', asin: 'B01', fnskuCode: 'X001', size: '11x17', sheetsPerUnit: 1 },
  lineLabel: 'Presidents',
  size: '11x17',
  prices: { wholesale: 9.5, cost: 2.25, costBulk: 1.8, msrp: 19.99, map: null },
  imageUrl: 'https://example.test/usa.jpg',
  ...over,
});

describe('columnsFor', () => {
  it('keeps cost out of the customer-facing sheet', () => {
    const brief = columnsFor('brief').map((c) => c.header);
    expect(brief).toEqual(['Item Name', 'SKU', 'Wholesale Price', 'Image URL']);
    expect(brief.join(' ')).not.toMatch(/cost/i);
  });

  it('carries the full internal column set', () => {
    expect(columnsFor('full')).toHaveLength(15);
  });
});

describe('buildPriceBook', () => {
  it('builds the brief sheet with only the four public facts', () => {
    const { rows } = buildPriceBook([item()], { shape: 'brief', settings: DEFAULT_SETTINGS });
    expect(rows[0]).toEqual({
      name: 'USA Map',
      sku: 'JBG-POS-LAM-USA',
      wholesale: 9.5,
      image: 'https://example.test/usa.jpg',
    });
  });

  it('falls back to the SKU when a product has no title', () => {
    const { rows } = buildPriceBook([item({ product: { sku: 'JBG-POS-LAM-X' } })], {
      shape: 'brief',
      settings: DEFAULT_SETTINGS,
    });
    expect(rows[0]?.name).toBe('JBG-POS-LAM-X');
  });

  it('writes a missing price as null, not zero', () => {
    const { rows } = buildPriceBook(
      [item({ prices: { wholesale: null, cost: null, costBulk: null, msrp: null, map: null } })],
      { shape: 'full', settings: DEFAULT_SETTINGS },
    );
    // A blank cell means "not priced yet". Zero would mean "free".
    expect(rows[0]?.wholesale).toBeNull();
    expect(rows[0]?.costIndiv).toBeNull();
  });

  it('writes a missing image URL as null rather than an empty string', () => {
    const { rows } = buildPriceBook([item({ imageUrl: '' })], { shape: 'brief', settings: DEFAULT_SETTINGS });
    expect(rows[0]?.image).toBeNull();
  });

  it('computes weights and case pack from the domain layer', () => {
    const { rows } = buildPriceBook([item()], { shape: 'full', settings: DEFAULT_SETTINGS });
    expect(rows[0]?.itemWt).toBe(1.8);
    expect(rows[0]?.shipWt).toBe(8.2); // 1.8 sheet + 6.4 mailer
    expect(rows[0]?.casePack).toBe(80); // 10" of stack / 0.125" per unit
    expect(rows[0]?.caseDims).toBe('20×14×10');
  });

  it('lets a weight override reach the export', () => {
    const { rows } = buildPriceBook([item({ overrides: { shipWeightOz: 16 } })], {
      shape: 'full',
      settings: DEFAULT_SETTINGS,
    });
    expect(rows[0]?.shipWt).toBe(16);
    expect(rows[0]?.casePack).toBe(50); // 800 oz cap / 16 oz — weight binds first now
  });

  it('rounds weights to one decimal place', () => {
    const { rows } = buildPriceBook([item({ overrides: { weightOz: 2.44449 } })], {
      shape: 'full',
      settings: DEFAULT_SETTINGS,
    });
    expect(rows[0]?.itemWt).toBe(2.4);
  });
});

describe('exportFilename', () => {
  it('slugifies the scope', () => {
    expect(exportFilename('Bible Heroes', 'xlsx')).toBe('JBG_Wholesale_Bible_Heroes.xlsx');
  });

  it('does not leave stray separators at the ends', () => {
    expect(exportFilename('  Faith & Life  ', 'xlsx')).toBe('JBG_Wholesale_Faith_Life.xlsx');
  });

  it('falls back to a name when the scope reduces to nothing', () => {
    expect(exportFilename('···', 'xlsx')).toBe('JBG_Wholesale_catalog.xlsx');
    expect(exportFilename('', 'xlsx')).toBe('JBG_Wholesale_catalog.xlsx');
  });
});
