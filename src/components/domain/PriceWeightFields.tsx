'use client';

import { Field, MoneyInput, TextInput, cleanMoney, parseMoney } from '@/components/ui/Field';
import { casePack, itemOz, shipOz, type CatalogProduct, type PackingSettings, type ProductOverrides, type SheetSize } from '@/lib/domain';
import { cn } from '@/lib/ui/cn';

/**
 * The six price fields and two weight overrides, plus the case pack they imply.
 *
 * Replaces the same form rendered twice and independently: the wholesale sheet
 * (index.html:1311-1316) and the product modal's `pricingBlock` (:1402-1408).
 * Each carried its own inline recompute — the sheet called `wholeRecalc`, the
 * modal poked a `<span>` by id — and the two had already drifted apart on which
 * fields they showed.
 *
 * The case pack shown here is the same `casePack` the box planner uses, which
 * is the third copy of that formula in the legacy tool retired.
 */

/**
 * Editing state, so every field holds the text the user typed. Converting to
 * numbers happens once, on save, via parseMoney — not on every keystroke, which
 * is what stopped the legacy fields accepting a decimal point.
 */
export interface PriceBookValue {
  wholesale: string;
  cost: string;
  costBulk: string;
  msrp: string;
  map: string;
}

export interface WeightValue {
  /** Blank means "use the computed figure". */
  weightOz: string;
  shipWeightOz: string;
}

export interface PriceWeightFieldsProps {
  product: CatalogProduct;
  size: SheetSize;
  settings: PackingSettings;
  prices: PriceBookValue;
  weights: WeightValue;
  onPrices: (next: PriceBookValue) => void;
  onWeights: (next: WeightValue) => void;
  /** Horizontal on the wholesale sheet, stacked in the modal. */
  layout?: 'grid' | 'row';
  className?: string;
}

export function PriceWeightFields({
  product,
  size,
  settings,
  prices,
  weights,
  onPrices,
  onWeights,
  layout = 'grid',
  className,
}: PriceWeightFieldsProps) {
  const overrides: ProductOverrides = {
    weightOz: parseMoney(weights.weightOz),
    shipWeightOz: parseMoney(weights.shipWeightOz),
    size,
  };

  const computedItem = itemOz(product, size, settings);
  const computedShip = shipOz(product, size, settings);
  const effectiveShip = shipOz(product, size, settings, overrides);
  const pack = casePack(product, size, settings, overrides);

  const money = (key: keyof PriceBookValue) => ({
    value: prices[key],
    onValueChange: (v: string) => onPrices({ ...prices, [key]: v }),
  });

  return (
    <div
      className={cn(
        layout === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3' : 'flex flex-wrap items-end gap-3',
        className,
      )}
    >
      <Field label="Cost · Individual" hint="in a mailer">
        {(id) => <MoneyInput id={id} placeholder="0.00" {...money('cost')} />}
      </Field>
      <Field label="Cost · Bulk" hint="in a box">
        {(id) => <MoneyInput id={id} placeholder="0.00" {...money('costBulk')} />}
      </Field>
      <Field label="Wholesale price">
        {(id) => <MoneyInput id={id} placeholder="0.00" {...money('wholesale')} />}
      </Field>
      <Field label="MSRP">{(id) => <MoneyInput id={id} placeholder="0.00" {...money('msrp')} />}</Field>
      <Field label="Min allowed price" hint="MAP — do not sell below">
        {(id) => <MoneyInput id={id} placeholder="0.00" {...money('map')} />}
      </Field>

      <Field label="Item weight" hint={`oz · poster only · auto ${computedItem.toFixed(1)}`}>
        {(id) => (
          <TextInput
            id={id}
            inputMode="decimal"
            placeholder={computedItem.toFixed(1)}
            value={weights.weightOz}
            onChange={(e) => onWeights({ ...weights, weightOz: cleanMoney(e.target.value) })}
          />
        )}
      </Field>
      <Field label="B2C ship weight" hint={`oz · + envelope · auto ${computedShip.toFixed(1)}`}>
        {(id) => (
          <TextInput
            id={id}
            inputMode="decimal"
            placeholder={computedShip.toFixed(1)}
            value={weights.shipWeightOz}
            onChange={(e) => onWeights({ ...weights, shipWeightOz: cleanMoney(e.target.value) })}
          />
        )}
      </Field>

      <div className="flex flex-col justify-end gap-1.5">
        <span className="text-xs font-bold text-muted">Case pack</span>
        <span className="rounded-sm border border-line bg-panel-2 px-3 py-2.5 text-touch font-extrabold text-mint">
          {pack} <span className="text-xs font-bold text-muted">per case</span>
        </span>
        <span className="text-xs text-muted-dim">
          {((pack * effectiveShip) / 16).toFixed(1)} lb · 20×14×10
        </span>
      </div>
    </div>
  );
}
