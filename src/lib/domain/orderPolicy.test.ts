import { describe, expect, it } from 'vitest';
import {
  ORDER_KINDS,
  allowsAdHocBoxes,
  allowsFreeAdd,
  defaultNeedsLabels,
  isBoundToList,
  isOrderKind,
  orderKindLabel,
  parseLegacyOrderMeta,
} from './orderPolicy';

describe('isOrderKind', () => {
  it('accepts exactly the four kinds the tool sets', () => {
    for (const k of ORDER_KINDS) expect(isOrderKind(k)).toBe(true);
    expect(isOrderKind('FBA')).toBe(false);
    expect(isOrderKind(null)).toBe(false);
  });
});

describe('policy predicates', () => {
  it('binds only FBA shipments to the customer list', () => {
    expect(isBoundToList('fba')).toBe(true);
    expect(isBoundToList('wholesale')).toBe(false);
    expect(isBoundToList('quick')).toBe(false);
    expect(isBoundToList('pick')).toBe(false);
  });

  it('derives free-add and ad-hoc boxes from the same fact', () => {
    for (const k of ORDER_KINDS) {
      expect(allowsFreeAdd(k)).toBe(!isBoundToList(k));
      expect(allowsAdHocBoxes(k)).toBe(!isBoundToList(k));
    }
  });

  it('only asks for FNSKU labels on FBA', () => {
    expect(defaultNeedsLabels('fba')).toBe(true);
    expect(defaultNeedsLabels('wholesale')).toBe(false);
  });

  it('labels every kind', () => {
    for (const k of ORDER_KINDS) expect(orderKindLabel(k)).toBeTruthy();
  });
});

describe('parseLegacyOrderMeta', () => {
  it('reads the JBGMETA blob the old tool wrote into source_filename', () => {
    expect(parseLegacyOrderMeta('JBGMETA:{"kind":"quick","labels":false}')).toEqual({
      kind: 'quick',
      needsLabels: false,
      sourceFilename: null,
    });
  });

  it('keeps a real filename and defaults to an FBA shipment with labels', () => {
    expect(parseLegacyOrderMeta('weekly-list.xlsx')).toEqual({
      kind: 'fba',
      needsLabels: true,
      sourceFilename: 'weekly-list.xlsx',
    });
  });

  it('falls back safely on malformed or unknown values', () => {
    expect(parseLegacyOrderMeta('JBGMETA:not json')).toMatchObject({ kind: 'fba', needsLabels: true });
    expect(parseLegacyOrderMeta('JBGMETA:{"kind":"bogus"}')).toMatchObject({ kind: 'fba' });
    expect(parseLegacyOrderMeta(null)).toMatchObject({ kind: 'fba', sourceFilename: null });
  });
});
