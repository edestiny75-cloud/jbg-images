import { activeLines, committedBySku, type PlannableLine, type PlannedBox } from './boxPlanner';

/**
 * Piece conservation. Ported from index.html:1509-1512.
 *
 * The invariant the shop cares about: across every box, no more units of a SKU
 * may be committed than the customer's list asked for. The packer screen leans
 * on this when someone adds a piece to a box by hand — it caps the addition at
 * what is still free rather than silently over-shipping.
 */

/** Units requested per SKU, across the active lines of the list. */
export function requestedBySku(lines: readonly PlannableLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of activeLines(lines)) {
    totals.set(line.sku, (totals.get(line.sku) ?? 0) + line.requested);
  }
  return totals;
}

/** How many units of a SKU are still unspoken for. Never negative. */
export function freeAvailable(
  sku: string,
  lines: readonly PlannableLine[],
  boxes: readonly PlannedBox[],
): number {
  const requested = requestedBySku(lines).get(sku) ?? 0;
  const committed = committedBySku(boxes).get(sku) ?? 0;
  return Math.max(0, requested - committed);
}

/** Whether a SKU appears on the customer's list at all. */
export function isOnList(sku: string, lines: readonly PlannableLine[]): boolean {
  return (requestedBySku(lines).get(sku) ?? 0) > 0;
}

export interface Shortage {
  sku: string;
  title: string | null;
  planned: number;
  packed: number;
  short: number;
}

/**
 * SKUs where the packer recorded fewer units than the plan called for.
 *
 * The legacy tool surfaced this only as a banner computed inline in the packer
 * view; it is a property of the shipment, so it lives here.
 */
export function shortages(boxes: readonly PlannedBox[]): Shortage[] {
  const planned = new Map<string, { qty: number; actual: number; title: string | null }>();

  for (const box of boxes) {
    for (const item of box.items) {
      const acc = planned.get(item.sku) ?? { qty: 0, actual: 0, title: item.title };
      acc.qty += item.qty;
      acc.actual += item.actual ?? item.qty;
      planned.set(item.sku, acc);
    }
  }

  return [...planned.entries()]
    .filter(([, v]) => v.actual < v.qty)
    .map(([sku, v]) => ({
      sku,
      title: v.title,
      planned: v.qty,
      packed: v.actual,
      short: v.qty - v.actual,
    }))
    .sort((a, b) => b.short - a.short);
}
