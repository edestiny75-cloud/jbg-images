/**
 * Shared vocabulary for the domain layer.
 *
 * Everything under lib/domain is pure: no Prisma, no React, no `window`, no
 * module-level mutable state. That is what makes it testable, and it is the
 * single biggest departure from the legacy tool, where these same calculations
 * read from globals (`SETTINGS`, `byRaw`, `WT`, `SIZEOV`, `STATE`) at call time.
 */

/** The two sheet formats the shop prints. */
export type SheetSize = '11x17' | '8.5x11';

/** Planning order matters: 11x17 boxes are filled before 8.5x11 ones. */
export const SHEET_SIZES = ['11x17', '8.5x11'] as const satisfies readonly SheetSize[];

export function isSheetSize(v: unknown): v is SheetSize {
  return v === '11x17' || v === '8.5x11';
}

/** Physical properties of one sheet format, per the `settings.weights` jsonb. */
export interface SizeWeights {
  /** Ounces per printed sheet. */
  sheet: number;
  /** Ounces of the mailer the unit ships in. */
  mailer: number;
  /** Thickness in inches of an empty mailer. */
  base_in: number;
  /** Additional thickness in inches per sheet inside it. */
  per_sheet_in: number;
  /** How many stacks fit side by side in the carton. Multiplies the height cap. */
  columns: number;
}

/** Carton limits plus the per-size weights. Row `settings` id = 1. */
export interface PackingSettings {
  /** Maximum gross weight of one carton, in ounces. */
  boxCapOz: number;
  /** Usable stack height of one carton, in inches. */
  boxStackIn: number;
  weights: Record<SheetSize, SizeWeights>;
}

/**
 * Fallbacks matching the literal at index.html:668. The live values come from
 * the `settings` table; these only apply before it has loaded, or if the row is
 * missing.
 */
export const DEFAULT_SETTINGS: PackingSettings = {
  boxCapOz: 800,
  boxStackIn: 10,
  weights: {
    '11x17': { sheet: 1.8, mailer: 6.4, base_in: 0.105, per_sheet_in: 0.02, columns: 1 },
    '8.5x11': { sheet: 1.0, mailer: 3.4, base_in: 0.105, per_sheet_in: 0.02, columns: 2 },
  },
};

/**
 * Carton dimensions offered in the Box Planner. 20x14x10 is the working carton;
 * the rest are for sending samples.
 */
export const CARTONS = ['20×14×10', '12×12×8', '12×9×4', '9×6×4', '6×6×6'] as const;
export type Carton = (typeof CARTONS)[number];

/**
 * The catalog facts the domain layer needs. A structural subset of the Prisma
 * `Product` model, so a row can be passed straight in.
 */
export interface CatalogProduct {
  sku: string;
  title?: string | null;
  line?: string | null;
  size?: string | null;
  asin?: string | null;
  /** Authoritative sheet count. Beats anything inferred from the SKU string. */
  sheetsPerUnit?: number | null;
  pdfPath?: string | null;
  /** The separate 12x18 cut file. Only some SKUs have one. */
  pdf12x18Path?: string | null;
  fnskuPath?: string | null;
  fnskuCode?: string | null;
  thumbUrl?: string | null;
  /** Legacy display string, e.g. "Single · Funny Sign · 11x17 · $9.99". */
  meta?: string | null;
}

/** Per-SKU corrections that beat the catalog. Was three localStorage maps. */
export interface ProductOverrides {
  /** Bare item weight in ounces (posters only, no mailer). */
  weightOz?: number | null;
  /** Shipped weight in ounces (item + mailer). */
  shipWeightOz?: number | null;
  size?: SheetSize | null;
}

/** One line of a customer list, before resolution. */
export interface ListLine {
  sku: string;
  asin?: string | null;
  title?: string | null;
  requested: number;
  notes?: string | null;
}

/** Per-line edits made in the Intake screen for the current session only. */
export interface LineEdit {
  qty?: number;
  hold?: boolean;
  size?: SheetSize;
}
