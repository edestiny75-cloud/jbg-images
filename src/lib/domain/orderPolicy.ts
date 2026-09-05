/**
 * What kind of order this is, and what that permits.
 *
 * In the legacy tool the answer lived in `source_filename`, smuggled through as
 * `JBGMETA:{"kind":…,"labels":…}` (written at :1752 and :1853, parsed at :1877),
 * and the resulting policy was re-derived as a bare `curKind() !== 'fba'` in
 * three unrelated places (:1075, :1548, :1658). Both are fixed: `kind` and
 * `needs_labels` are real columns, and the policy is these predicates.
 */

export type OrderKind = 'fba' | 'wholesale' | 'quick' | 'pick';

export const ORDER_KINDS = ['fba', 'wholesale', 'quick', 'pick'] as const;

export function isOrderKind(v: unknown): v is OrderKind {
  return typeof v === 'string' && (ORDER_KINDS as readonly string[]).includes(v);
}

const LABELS: Record<OrderKind, string> = {
  fba: '📦 Amazon FBA',
  wholesale: '🏷 Wholesale',
  quick: '⚡ Quick box',
  pick: '📤 Pick order',
};

export function orderKindLabel(kind: OrderKind): string {
  return LABELS[kind];
}

/**
 * Whether the order is bound to a customer list.
 *
 * An FBA shipment must match the list Amazon is expecting piece for piece, so
 * the packer may not add a SKU that is not on it, or exceed the requested
 * quantity. Wholesale, quick and pick orders are assembled freely.
 */
export function isBoundToList(kind: OrderKind): boolean {
  return kind === 'fba';
}

/** Whether the picker may add any catalog product, not just listed ones. */
export function allowsFreeAdd(kind: OrderKind): boolean {
  return !isBoundToList(kind);
}

/** Whether an empty plan should offer "add a box" instead of "start next box". */
export function allowsAdHocBoxes(kind: OrderKind): boolean {
  return !isBoundToList(kind);
}

/** Only FBA shipments need FNSKU labels printed. */
export function defaultNeedsLabels(kind: OrderKind): boolean {
  return kind === 'fba';
}

/**
 * Read the kind and label preference off a legacy `batches` row.
 *
 * Kept for the one-time backfill that populates the real columns; new rows
 * never go through here.
 */
export function parseLegacyOrderMeta(sourceFilename: string | null | undefined): {
  kind: OrderKind;
  needsLabels: boolean;
  sourceFilename: string | null;
} {
  const sf = sourceFilename ?? '';
  if (!sf.startsWith('JBGMETA:')) {
    return { kind: 'fba', needsLabels: true, sourceFilename: sf || null };
  }
  try {
    const parsed: unknown = JSON.parse(sf.slice('JBGMETA:'.length));
    const obj = (parsed ?? {}) as { kind?: unknown; labels?: unknown };
    return {
      kind: isOrderKind(obj.kind) ? obj.kind : 'fba',
      needsLabels: typeof obj.labels === 'boolean' ? obj.labels : true,
      sourceFilename: null,
    };
  } catch {
    return { kind: 'fba', needsLabels: true, sourceFilename: null };
  }
}
