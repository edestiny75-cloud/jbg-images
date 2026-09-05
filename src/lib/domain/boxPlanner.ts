import { casePack, shipOz, stackCapacityIn, unitThicknessIn, weightsFor } from './weights';
import {
  SHEET_SIZES,
  type CatalogProduct,
  type PackingSettings,
  type ProductOverrides,
  type SheetSize,
} from './types';

/**
 * Cartonisation. Ported from index.html:776-800 (`grouped`, `planBoxes`) and
 * :1514-1526 (`reflowPending`).
 *
 * Two caps bind at once: gross weight (`settings.boxCapOz`) and stack height
 * (`settings.boxStackIn`, multiplied by how many columns the size packs in).
 * The strategy is first-fit with SKU mixing — a line that overflows the current
 * carton is split across the next one rather than opening a fresh carton per
 * SKU — which is what keeps the shop from shipping half-empty boxes.
 *
 * Sizes are planned in sequence and never share a carton: all 11x17 boxes are
 * numbered first, then all 8.5x11.
 */

/** One line of the customer's list after resolution, ready to be packed. */
export interface PlannableLine {
  /** Catalog SKU, or the raw list SKU when unresolved. */
  sku: string;
  size: SheetSize;
  requested: number;
  title?: string | null;
  asin?: string | null;
  thumbUrl?: string | null;
  fnskuPath?: string | null;
  /** Excluded from this run without being deleted from the list. */
  held?: boolean;
  /** The catalog row, when one was resolved. Drives weight and thickness. */
  product?: CatalogProduct | null;
  overrides?: ProductOverrides | null;
}

export type BoxStatus = 'pending' | 'picking' | 'packed' | 'shipped';

export interface PlannedItem {
  sku: string;
  title: string | null;
  asin: string | null;
  /** Planned quantity. */
  qty: number;
  /** Quantity actually packed; starts equal to `qty`. */
  actual: number;
  /** Shipped ounces of one unit, cached so the UI need not recompute. */
  unitOz: number;
  thumbUrl: string | null;
  fnskuPath: string | null;
}

export interface PlannedBox {
  boxNo: number;
  size: SheetSize;
  weightOz: number;
  thickIn: number;
  units: number;
  status: BoxStatus;
  items: PlannedItem[];
}

/** A box is committed once someone has started working it. Frozen thereafter. */
export function isCommitted(box: Pick<PlannedBox, 'status'>): boolean {
  return box.status === 'picking' || box.status === 'packed' || box.status === 'shipped';
}

/**
 * Units already committed per SKU, counting only boxes someone has started.
 *
 * Lives here rather than in pieceLedger because it aggregates over boxes and
 * the planner needs it to work out what is left to pack.
 */
export function committedBySku(boxes: readonly PlannedBox[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const box of boxes) {
    if (!isCommitted(box)) continue;
    for (const item of box.items) {
      totals.set(item.sku, (totals.get(item.sku) ?? 0) + item.qty);
    }
  }
  return totals;
}

/** Lines that count towards this run: not held, and with something requested. */
export function activeLines(lines: readonly PlannableLine[]): PlannableLine[] {
  return lines.filter((l) => !l.held && l.requested > 0);
}

/**
 * Split the active lines by sheet size, each sorted by quantity descending.
 *
 * Largest-first is what makes first-fit behave: the big lines establish the
 * carton boundaries and the small ones top up the remaining space.
 */
export function groupBySize(lines: readonly PlannableLine[]): Record<SheetSize, PlannableLine[]> {
  const groups: Record<SheetSize, PlannableLine[]> = { '11x17': [], '8.5x11': [] };
  for (const line of activeLines(lines)) groups[line.size].push(line);
  for (const size of SHEET_SIZES) groups[size].sort((a, b) => b.requested - a.requested);
  return groups;
}

/** Rounding used by the original, kept so old and new plans compare equal. */
const roundOz = (n: number) => Number(n.toFixed(1));
const roundIn = (n: number) => Number(n.toFixed(3));

export interface PlanOptions {
  /** Box numbers already taken by committed boxes, so new ones skip them. */
  reservedBoxNumbers?: ReadonlySet<number>;
}

/**
 * Pack the given lines into cartons.
 *
 * Guaranteed: every requested unit lands in exactly one box, boxes never exceed
 * either cap, and no box is emitted empty.
 */
export function planBoxes(
  lines: readonly PlannableLine[],
  settings: PackingSettings,
  options: PlanOptions = {},
): PlannedBox[] {
  const reserved = options.reservedBoxNumbers ?? new Set<number>();
  const boxes: PlannedBox[] = [];

  let nextNo = 1;
  const takeBoxNumber = () => {
    while (reserved.has(nextNo)) nextNo++;
    return nextNo++;
  };

  const groups = groupBySize(lines);

  for (const size of SHEET_SIZES) {
    const capOz = settings.boxCapOz;
    const capIn = stackCapacityIn(settings, size);

    // A carton is only carried forward within its own size.
    let box: PlannedBox | null = null;
    const open = (): PlannedBox => {
      const fresh: PlannedBox = {
        boxNo: takeBoxNumber(),
        size,
        weightOz: 0,
        thickIn: 0,
        units: 0,
        status: 'pending',
        items: [],
      };
      boxes.push(fresh);
      box = fresh;
      return fresh;
    };

    for (const line of groups[size]) {
      if (line.requested <= 0) continue;

      const unitOz = shipOz(line.product, size, settings, line.overrides);
      const unitIn = unitThicknessIn(line.product, size, settings);

      // A single unit that fits in no carton would loop forever below.
      if (unitOz > capOz || unitIn > capIn) {
        throw new PlanError(
          `${line.sku} does not fit a carton on its own ` +
            `(${roundOz(unitOz)} oz / ${roundIn(unitIn)} in vs caps ${capOz} oz / ${capIn} in). ` +
            `Check its weight settings for ${size}.`,
          line.sku,
        );
      }

      let remaining = line.requested;
      while (remaining > 0) {
        const current: PlannedBox = box ?? open();

        const roomByWeight = Math.floor((capOz - current.weightOz) / unitOz);
        const roomByHeight = Math.floor((capIn - current.thickIn) / unitIn);
        const room = Math.min(roomByWeight, roomByHeight);

        if (room <= 0) {
          open();
          continue;
        }

        const put = Math.min(room, remaining);
        current.items.push({
          sku: line.sku,
          title: line.title ?? null,
          asin: line.asin ?? null,
          qty: put,
          actual: put,
          unitOz,
          thumbUrl: line.thumbUrl ?? null,
          fnskuPath: line.fnskuPath ?? null,
        });
        current.weightOz = roundOz(current.weightOz + put * unitOz);
        current.thickIn = roundIn(current.thickIn + put * unitIn);
        current.units += put;
        remaining -= put;
      }
    }

    // Do not let the next size continue filling this size's last carton.
    box = null;
  }

  return boxes;
}

/** Thrown when a line cannot be packed at all, rather than looping forever. */
export class PlanError extends Error {
  constructor(
    message: string,
    readonly sku: string,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

/**
 * Rebuild only the boxes nobody has touched, leaving committed ones frozen.
 *
 * Called whenever the picker pulls pieces into a box they are working: those
 * pieces leave the pending pool, so the not-yet-started boxes reshuffle around
 * what is left. Ported from `reflowPending` (:1514).
 */
export function reflowPending(
  lines: readonly PlannableLine[],
  currentBoxes: readonly PlannedBox[],
  settings: PackingSettings,
): PlannedBox[] {
  const committed = currentBoxes.filter(isCommitted);
  const reservedBoxNumbers = new Set(committed.map((b) => b.boxNo));
  const alreadyPacked = committedBySku(currentBoxes);

  const pool = activeLines(lines)
    .map((line) => ({
      ...line,
      requested: Math.max(0, line.requested - (alreadyPacked.get(line.sku) ?? 0)),
    }))
    .filter((line) => line.requested > 0);

  const fresh = planBoxes(pool, settings, { reservedBoxNumbers });

  return [...committed, ...fresh].sort((a, b) => a.boxNo - b.boxNo);
}

/**
 * Renumber boxes 1..n in their current order.
 *
 * The legacy tool never did this, so deleting a box left a permanent gap in the
 * numbering that the packer then had to reconcile against physical labels.
 */
export function renumber(boxes: readonly PlannedBox[]): PlannedBox[] {
  return boxes.map((b, i) => ({ ...b, boxNo: i + 1 }));
}

/** Recompute a box's totals from its items. Use after any manual edit. */
export function recomputeBox(box: PlannedBox, settings: PackingSettings): PlannedBox {
  let weightOz = 0;
  let thickIn = 0;
  let units = 0;

  const w = weightsFor(settings, box.size);
  for (const item of box.items) {
    const qty = item.actual ?? item.qty;
    weightOz += qty * item.unitOz;
    // Thickness per unit is recoverable from the cached unit weight only for
    // single-sheet items, so derive sheets back out of the mailer-adjusted oz.
    const sheets = Math.max(1, Math.round((item.unitOz - w.mailer) / w.sheet));
    thickIn += qty * (w.base_in + sheets * w.per_sheet_in);
    units += qty;
  }

  return { ...box, weightOz: roundOz(weightOz), thickIn: roundIn(thickIn), units };
}

export { casePack };
