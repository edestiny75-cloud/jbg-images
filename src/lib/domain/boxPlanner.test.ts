import { describe, expect, it } from 'vitest';
import {
  PlanError,
  activeLines,
  committedBySku,
  groupBySize,
  isCommitted,
  planBoxes,
  reflowPending,
  renumber,
  type PlannableLine,
  type PlannedBox,
} from './boxPlanner';
import { DEFAULT_SETTINGS, type PackingSettings, type SheetSize } from './types';

/**
 * With DEFAULT_SETTINGS a single 11x17 sheet is 8.2 oz and 0.125 in thick, so
 * the 10 in height cap binds at 80 units before the 800 oz weight cap would at
 * 97. Several tests below use bespoke settings instead, so the arithmetic being
 * asserted is visible in the test rather than buried in the fixture.
 */

function line(over: Partial<PlannableLine> & { sku: string; requested: number }): PlannableLine {
  return { size: '11x17', ...over };
}

/** Settings where one unit is exactly 100 oz and 1 in thick: 8 per carton. */
const ROUND: PackingSettings = {
  boxCapOz: 800,
  boxStackIn: 10,
  weights: {
    '11x17': { sheet: 93.6, mailer: 6.4, base_in: 0.8, per_sheet_in: 0.2, columns: 1 },
    '8.5x11': { sheet: 1.0, mailer: 3.4, base_in: 0.105, per_sheet_in: 0.02, columns: 2 },
  },
};

const totalUnits = (boxes: PlannedBox[]) => boxes.reduce((n, b) => n + b.units, 0);

function unitsBySku(boxes: PlannedBox[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of boxes) for (const i of b.items) out[i.sku] = (out[i.sku] ?? 0) + i.qty;
  return out;
}

describe('activeLines', () => {
  it('drops held lines and zero-quantity lines', () => {
    const lines = [
      line({ sku: 'A', requested: 5 }),
      line({ sku: 'B', requested: 0 }),
      line({ sku: 'C', requested: 5, held: true }),
    ];
    expect(activeLines(lines).map((l) => l.sku)).toEqual(['A']);
  });
});

describe('groupBySize', () => {
  it('splits by size and sorts each group by quantity descending', () => {
    const groups = groupBySize([
      line({ sku: 'small', requested: 1 }),
      line({ sku: 'big', requested: 100 }),
      line({ sku: 'letter', requested: 50, size: '8.5x11' }),
    ]);
    expect(groups['11x17'].map((l) => l.sku)).toEqual(['big', 'small']);
    expect(groups['8.5x11'].map((l) => l.sku)).toEqual(['letter']);
  });
});

describe('planBoxes', () => {
  it('returns no boxes for an empty list', () => {
    expect(planBoxes([], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('splits a line larger than one carton across consecutive boxes', () => {
    // 20 units at 8 per carton = 2 full boxes and a third holding 4.
    const boxes = planBoxes([line({ sku: 'A', requested: 20 })], ROUND);

    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.units)).toEqual([8, 8, 4]);
    expect(boxes.map((b) => b.boxNo)).toEqual([1, 2, 3]);
    expect(totalUnits(boxes)).toBe(20);
  });

  it('mixes SKUs to fill a carton to capacity rather than opening one per SKU', () => {
    const boxes = planBoxes(
      [line({ sku: 'A', requested: 5 }), line({ sku: 'B', requested: 3 })],
      ROUND,
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.units).toBe(8);
    expect(boxes[0]!.items.map((i) => [i.sku, i.qty])).toEqual([
      ['A', 5],
      ['B', 3],
    ]);
  });

  it('never exceeds either cap', () => {
    const boxes = planBoxes([line({ sku: 'A', requested: 25 })], ROUND);
    for (const b of boxes) {
      expect(b.weightOz).toBeLessThanOrEqual(ROUND.boxCapOz);
      expect(b.thickIn).toBeLessThanOrEqual(ROUND.boxStackIn);
    }
  });

  it('lets the thickness cap bind before the weight cap', () => {
    // 1 oz but 2 in per unit: weight allows 800, height allows 5.
    const thick: PackingSettings = {
      boxCapOz: 800,
      boxStackIn: 10,
      weights: {
        ...ROUND.weights,
        '11x17': { sheet: 0.5, mailer: 0.5, base_in: 1.8, per_sheet_in: 0.2, columns: 1 },
      },
    };
    const boxes = planBoxes([line({ sku: 'A', requested: 12 })], thick);

    expect(boxes.map((b) => b.units)).toEqual([5, 5, 2]);
    expect(boxes[0]!.weightOz).toBe(5);
  });

  it('lets the weight cap bind before the thickness cap', () => {
    // 100 oz but paper-thin: weight allows 8, height allows 100.
    const heavy: PackingSettings = {
      boxCapOz: 800,
      boxStackIn: 10,
      weights: {
        ...ROUND.weights,
        '11x17': { sheet: 99.9, mailer: 0.1, base_in: 0.09, per_sheet_in: 0.01, columns: 1 },
      },
    };
    const boxes = planBoxes([line({ sku: 'A', requested: 20 })], heavy);
    expect(boxes.map((b) => b.units)).toEqual([8, 8, 4]);
  });

  it('gives 8.5x11 twice the stack height because it packs two columns wide', () => {
    const perBox = (size: SheetSize) =>
      planBoxes([line({ sku: 'A', requested: 500, size })], DEFAULT_SETTINGS)[0]!.units;

    expect(perBox('11x17')).toBe(80); // 10 in / 0.125 in
    expect(perBox('8.5x11')).toBe(160); // 10 in * 2 columns / 0.125 in
  });

  it('never puts two sizes in the same carton', () => {
    const boxes = planBoxes(
      [line({ sku: 'A', requested: 2 }), line({ sku: 'B', requested: 2, size: '8.5x11' })],
      DEFAULT_SETTINGS,
    );

    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.size).toBe('11x17');
    expect(boxes[1]!.size).toBe('8.5x11');
  });

  it('numbers all 11x17 boxes before any 8.5x11 box', () => {
    const boxes = planBoxes(
      [line({ sku: 'A', requested: 20 }), line({ sku: 'B', requested: 5, size: '8.5x11' })],
      ROUND,
    );
    const sizes = boxes.map((b) => b.size);
    expect(sizes).toEqual(['11x17', '11x17', '11x17', '8.5x11']);
    expect(boxes.map((b) => b.boxNo)).toEqual([1, 2, 3, 4]);
  });

  it('skips reserved box numbers', () => {
    const boxes = planBoxes([line({ sku: 'A', requested: 20 })], ROUND, {
      reservedBoxNumbers: new Set([1, 3]),
    });
    expect(boxes.map((b) => b.boxNo)).toEqual([2, 4, 5]);
  });

  it('conserves every requested unit', () => {
    const lines = [
      line({ sku: 'A', requested: 137 }),
      line({ sku: 'B', requested: 42 }),
      line({ sku: 'C', requested: 9, size: '8.5x11' }),
      line({ sku: 'D', requested: 0 }),
      line({ sku: 'E', requested: 50, held: true }),
    ];
    const boxes = planBoxes(lines, DEFAULT_SETTINGS);

    expect(unitsBySku(boxes)).toEqual({ A: 137, B: 42, C: 9 });
    expect(totalUnits(boxes)).toBe(188);
  });

  it('emits no empty boxes', () => {
    const boxes = planBoxes([line({ sku: 'A', requested: 24 })], ROUND);
    for (const b of boxes) expect(b.units).toBeGreaterThan(0);
  });

  it('throws rather than looping when one unit cannot fit a carton', () => {
    const tiny: PackingSettings = {
      boxCapOz: 5,
      boxStackIn: 10,
      weights: ROUND.weights,
    };
    expect(() => planBoxes([line({ sku: 'A', requested: 1 })], tiny)).toThrow(PlanError);
    expect(() => planBoxes([line({ sku: 'A', requested: 1 })], tiny)).toThrow(/does not fit/);
  });
});

describe('isCommitted', () => {
  it.each([
    ['pending', false],
    ['picking', true],
    ['packed', true],
    ['shipped', true],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isCommitted({ status })).toBe(expected);
  });
});

describe('reflowPending', () => {
  const lines = [line({ sku: 'A', requested: 20 })];

  it('leaves committed boxes untouched and replans only the rest', () => {
    const initial = planBoxes(lines, ROUND);
    expect(initial.map((b) => b.units)).toEqual([8, 8, 4]);

    // The picker starts box 1 and packs it.
    const started: PlannedBox[] = [{ ...initial[0]!, status: 'picking' }, ...initial.slice(1)];

    const reflowed = reflowPending(lines, started, ROUND);

    const committed = reflowed.filter(isCommitted);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toBe(started[0]); // same object, frozen

    // 12 units remain, so the pending side is 8 + 4.
    expect(reflowed.filter((b) => !isCommitted(b)).map((b) => b.units)).toEqual([8, 4]);
    expect(totalUnits(reflowed)).toBe(20);
  });

  it('does not reuse a committed box number', () => {
    const initial = planBoxes(lines, ROUND);
    const started: PlannedBox[] = [
      initial[0]!,
      { ...initial[1]!, status: 'packed' },
      initial[2]!,
    ];
    const reflowed = reflowPending(lines, started, ROUND);

    const numbers = reflowed.map((b) => b.boxNo);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('drops pending boxes entirely once everything is committed', () => {
    const initial = planBoxes(lines, ROUND).map(
      (b): PlannedBox => ({ ...b, status: 'packed' }),
    );
    const reflowed = reflowPending(lines, initial, ROUND);

    expect(reflowed).toHaveLength(3);
    expect(reflowed.every(isCommitted)).toBe(true);
  });

  it('reopens pending boxes when the list quantity is raised', () => {
    const initial = planBoxes(lines, ROUND);
    const started: PlannedBox[] = [{ ...initial[0]!, status: 'picking' }];

    const raised = [line({ sku: 'A', requested: 30 })];
    const reflowed = reflowPending(raised, started, ROUND);

    // 8 committed + 22 still to pack.
    expect(totalUnits(reflowed)).toBe(30);
    expect(unitsBySku(reflowed)).toEqual({ A: 30 });
  });
});

describe('committedBySku', () => {
  it('counts only boxes someone has started', () => {
    const boxes = planBoxes([line({ sku: 'A', requested: 20 })], ROUND);
    const mixed: PlannedBox[] = [{ ...boxes[0]!, status: 'picking' }, ...boxes.slice(1)];
    expect(committedBySku(mixed)).toEqual(new Map([['A', 8]]));
  });
});

describe('renumber', () => {
  it('closes gaps left by deleted boxes', () => {
    const boxes = planBoxes([line({ sku: 'A', requested: 20 })], ROUND);
    const withGap = [boxes[0]!, boxes[2]!];
    expect(renumber(withGap).map((b) => b.boxNo)).toEqual([1, 2]);
  });
});
