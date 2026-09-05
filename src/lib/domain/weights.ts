import { sheetsFor } from './sizing';
import {
  DEFAULT_SETTINGS,
  type CatalogProduct,
  type PackingSettings,
  type ProductOverrides,
  type SheetSize,
  type SizeWeights,
} from './types';

/**
 * Weight and thickness maths. Ported from index.html:740-748, :1493 and :1601.
 *
 * Three vocabulary terms the original mixed freely:
 *
 *   item weight     bare posters, no packaging
 *   ship weight     item + mailer; what the carrier charges for
 *   unit weight     same as ship weight, but computed inside the box planner
 *
 * `unitOzFor` and `computedShipOz` were two functions calculating the same
 * number by different routes. They are one function here.
 */

export function weightsFor(settings: PackingSettings, size: SheetSize): SizeWeights {
  return settings.weights[size] ?? DEFAULT_SETTINGS.weights[size];
}

/** Bare weight of one unit in ounces: posters only, no mailer. */
export function itemOz(
  product: CatalogProduct | null | undefined,
  size: SheetSize,
  settings: PackingSettings,
  overrides?: ProductOverrides | null,
): number {
  const manual = overrides?.weightOz;
  if (typeof manual === 'number' && Number.isFinite(manual)) return manual;
  return sheetsFor(product) * weightsFor(settings, size).sheet;
}

/**
 * Shipped weight of one unit in ounces: item + mailer.
 *
 * This is the figure the carton cap is measured against, and the one the FBA
 * 50 lb case-pack rule uses.
 */
export function shipOz(
  product: CatalogProduct | null | undefined,
  size: SheetSize,
  settings: PackingSettings,
  overrides?: ProductOverrides | null,
): number {
  const manual = overrides?.shipWeightOz;
  if (typeof manual === 'number' && Number.isFinite(manual)) return manual;
  return itemOz(product, size, settings, overrides) + weightsFor(settings, size).mailer;
}

/** Stacked thickness of one unit in inches: empty mailer + its sheets. */
export function unitThicknessIn(
  product: CatalogProduct | null | undefined,
  size: SheetSize,
  settings: PackingSettings,
): number {
  const w = weightsFor(settings, size);
  return w.base_in + sheetsFor(product) * w.per_sheet_in;
}

/**
 * Usable stack height for a size, in inches.
 *
 * 8.5x11 units are packed two columns wide, so the carton's 10" of height is
 * worth 20" of stack for them.
 */
export function stackCapacityIn(settings: PackingSettings, size: SheetSize): number {
  return settings.boxStackIn * (weightsFor(settings, size).columns || 1);
}

/**
 * How many units of one SKU fill a carton — whichever cap binds first.
 *
 * The original wrote this formula three times: `casePackFor` (:1601), inline in
 * `detailBody` (:1371), and as `fullBox` inside `planBoxes` (:790). The three
 * disagreed: `planBoxes` measured against the *unit* weight it had just derived
 * from the sheet count, while `casePackFor` measured against the *ship* weight
 * including any manual override. This version takes the ship weight, so a
 * hand-corrected weight is respected everywhere.
 */
export function casePack(
  product: CatalogProduct | null | undefined,
  size: SheetSize,
  settings: PackingSettings,
  overrides?: ProductOverrides | null,
): number {
  const perUnitOz = shipOz(product, size, settings, overrides);
  const perUnitIn = unitThicknessIn(product, size, settings);

  const byWeight = perUnitOz > 0 ? Math.floor(settings.boxCapOz / perUnitOz) : Infinity;
  const byHeight = perUnitIn > 0 ? Math.floor(stackCapacityIn(settings, size) / perUnitIn) : Infinity;

  return Math.max(1, Math.min(byWeight, byHeight));
}

export interface PackVerdict {
  /** True once the quantity fills at least one full case. */
  ok: boolean;
  /** Units per full case. */
  casePackSize: number;
  fullCases: number;
  loose: number;
  /** How many more units would complete the next case. 0 when already full. */
  shortBy: number;
}

/** Whether a quantity makes up whole cases. Ported from `packVerdict` (:1604). */
export function packVerdict(qty: number, casePackSize: number): PackVerdict {
  const cp = Math.max(1, casePackSize);
  const fullCases = Math.floor(qty / cp);
  const loose = qty % cp;
  return {
    ok: fullCases >= 1,
    casePackSize: cp,
    fullCases,
    loose,
    shortBy: fullCases >= 1 ? 0 : cp - qty,
  };
}
