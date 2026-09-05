import { describe, expect, it } from 'vitest';
import { priceSheetUrl } from './useDocuments';

describe('priceSheetUrl', () => {
  it('sends an explicit selection as a SKU list', () => {
    expect(priceSheetUrl({ skus: ['A', 'B'] })).toBe('/print/price-sheet?skus=A%2CB');
  });

  it('prefers the selection over the filters, as the server does', () => {
    expect(priceSheetUrl({ skus: ['A'], line: 'presidents', q: 'eagle' })).toBe(
      '/print/price-sheet?skus=A',
    );
  });

  it('sends the filters when nothing is selected', () => {
    expect(priceSheetUrl({ line: 'presidents', size: '11x17' })).toBe(
      '/print/price-sheet?line=presidents&size=11x17',
    );
  });

  it('treats an empty selection as no selection', () => {
    expect(priceSheetUrl({ skus: [], line: 'maps' })).toBe('/print/price-sheet?line=maps');
  });

  it('asks for the print dialog only when told to', () => {
    expect(priceSheetUrl({ line: 'maps' }, { auto: true })).toBe('/print/price-sheet?line=maps&auto=1');
    expect(priceSheetUrl({}, { auto: true })).toBe('/print/price-sheet?auto=1');
  });

  it('produces a bare URL for the whole catalog', () => {
    expect(priceSheetUrl({})).toBe('/print/price-sheet');
  });

  it('escapes a query that would otherwise break the URL', () => {
    expect(priceSheetUrl({ q: 'a&b=c' })).toBe('/print/price-sheet?q=a%26b%3Dc');
  });
});
