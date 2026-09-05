import { describe, expect, it } from 'vitest';
import { planBoxes, type PlannableLine, type PlannedBox } from './boxPlanner';
import { freeAvailable, isOnList, requestedBySku, shortages } from './pieceLedger';
import { DEFAULT_SETTINGS } from './types';

const line = (sku: string, requested: number, over: Partial<PlannableLine> = {}): PlannableLine => ({
  sku,
  size: '11x17',
  requested,
  ...over,
});

const LINES = [line('A', 100), line('B', 30), line('C', 5, { held: true })];

describe('requestedBySku', () => {
  it('sums active lines and skips held ones', () => {
    expect(requestedBySku(LINES)).toEqual(
      new Map([
        ['A', 100],
        ['B', 30],
      ]),
    );
  });

  it('combines duplicate lines for the same SKU', () => {
    expect(requestedBySku([line('A', 10), line('A', 5)]).get('A')).toBe(15);
  });
});

describe('freeAvailable', () => {
  it('is the full request when nothing is committed', () => {
    const boxes = planBoxes(LINES, DEFAULT_SETTINGS);
    expect(freeAvailable('A', LINES, boxes)).toBe(100);
  });

  it('drops by whatever committed boxes already hold', () => {
    const boxes = planBoxes(LINES, DEFAULT_SETTINGS);
    // Box 1 holds 80 of A (the 11x17 height cap) and is being picked.
    const started: PlannedBox[] = [{ ...boxes[0]!, status: 'picking' }, ...boxes.slice(1)];

    expect(started[0]!.items[0]).toMatchObject({ sku: 'A', qty: 80 });
    expect(freeAvailable('A', LINES, started)).toBe(20);
  });

  it('never goes negative when a box holds more than the list asks for', () => {
    const boxes = planBoxes(LINES, DEFAULT_SETTINGS);
    const over: PlannedBox[] = [
      { ...boxes[0]!, status: 'packed', items: [{ ...boxes[0]!.items[0]!, qty: 500 }] },
    ];
    expect(freeAvailable('A', LINES, over)).toBe(0);
  });

  it('is zero for a SKU that is not on the list', () => {
    expect(freeAvailable('NOPE', LINES, [])).toBe(0);
  });
});

describe('isOnList', () => {
  it('is false for held lines and unknown SKUs', () => {
    expect(isOnList('A', LINES)).toBe(true);
    expect(isOnList('C', LINES)).toBe(false); // held
    expect(isOnList('NOPE', LINES)).toBe(false);
  });
});

describe('shortages', () => {
  it('is empty when every item was packed in full', () => {
    expect(shortages(planBoxes(LINES, DEFAULT_SETTINGS))).toEqual([]);
  });

  it('reports each SKU packed short, worst first', () => {
    const boxes = planBoxes(LINES, DEFAULT_SETTINGS);
    const short: PlannedBox[] = boxes.map((b) => ({
      ...b,
      items: b.items.map((i) => ({ ...i, actual: Math.max(0, i.qty - 3) })),
    }));

    const result = shortages(short);
    expect(result.map((s) => s.sku)).toEqual(['A', 'B']);
    // A spans two boxes, so it is short 3 in each.
    expect(result[0]).toMatchObject({ sku: 'A', planned: 100, packed: 94, short: 6 });
    expect(result[1]).toMatchObject({ sku: 'B', planned: 30, packed: 27, short: 3 });
  });

  it('ignores an item packed over its plan', () => {
    const boxes = planBoxes([line('A', 10)], DEFAULT_SETTINGS);
    const over = boxes.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i, actual: 12 })) }));
    expect(shortages(over)).toEqual([]);
  });
});
