'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { SHEET_SIZES, type PackingSettings, type SheetSize } from '@/lib/domain';
import { savePackingSettings } from './actions';

/**
 * The cartonisation caps and the per-size sheet weights.
 *
 * The legacy Settings screen rendered these as a read-only `<div class="kv">`
 * with the note "All fields editable in the live app; shown read-only in the
 * demo" (index.html:1164). They were only ever editable in the database.
 *
 * Fields hold text, not numbers, so a half-typed "1." survives a keystroke.
 * Parsing and range-checking happen once, in the server action.
 */

const WEIGHT_FIELDS = [
  { key: 'sheet', label: 'Sheet', unit: 'oz', hint: 'One printed sheet.' },
  { key: 'mailer', label: 'Mailer', unit: 'oz', hint: 'The empty mailer.' },
  { key: 'base_in', label: 'Base', unit: 'in', hint: 'Thickness of an empty mailer.' },
  { key: 'per_sheet_in', label: 'Per sheet', unit: 'in', hint: 'Added per sheet inside it.' },
  { key: 'columns', label: 'Columns', unit: '', hint: 'Stacks side by side in the carton.' },
] as const;

type WeightKey = (typeof WEIGHT_FIELDS)[number]['key'];

/** The whole form as strings, which is what an input can actually hold. */
type Draft = {
  boxCapOz: string;
  boxStackIn: string;
  weights: Record<SheetSize, Record<WeightKey, string>>;
};

function toDraft(settings: PackingSettings): Draft {
  const weights = {} as Draft['weights'];
  for (const size of SHEET_SIZES) {
    const w = settings.weights[size];
    weights[size] = {
      sheet: String(w.sheet),
      mailer: String(w.mailer),
      base_in: String(w.base_in),
      per_sheet_in: String(w.per_sheet_in),
      columns: String(w.columns),
    };
  }
  return { boxCapOz: String(settings.boxCapOz), boxStackIn: String(settings.boxStackIn), weights };
}

/** Digits with at most one dot. Rejects the minus sign a `type=number` allows. */
function cleanNumber(raw: string): string {
  return raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

export function PackingSettingsForm({ settings }: { settings: PackingSettings }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));

  const setWeight = (size: SheetSize, key: WeightKey, value: string) =>
    setDraft((d) => ({
      ...d,
      weights: { ...d.weights, [size]: { ...d.weights[size], [key]: cleanNumber(value) } },
    }));

  const save = () =>
    startTransition(async () => {
      const result = await savePackingSettings(draft);
      toast(result.ok ? 'Packing settings saved.' : result.error, result.ok ? 'success' : 'danger');
      if (result.ok) router.refresh();
    });

  const capLb = Number(draft.boxCapOz) / 16;

  return (
    <Card className="p-5">
      <h2 className="text-lg font-extrabold">Cartonisation</h2>
      <p className="mt-1 text-sm text-muted">
        What the box planner packs to. Changing these does not touch boxes that already exist —
        press Re-plan on the Box Planner to apply them to an open order.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Box weight cap"
          hint={Number.isFinite(capLb) && capLb > 0 ? `${capLb.toFixed(1)} lb gross` : 'In ounces.'}
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={draft.boxCapOz}
              onChange={(e) => setDraft((d) => ({ ...d, boxCapOz: cleanNumber(e.target.value) }))}
              className="text-right tabular-nums"
            />
          )}
        </Field>
        <Field label="Usable stack height" hint="Inches, inside the carton.">
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={draft.boxStackIn}
              onChange={(e) => setDraft((d) => ({ ...d, boxStackIn: cleanNumber(e.target.value) }))}
              className="text-right tabular-nums"
            />
          )}
        </Field>
      </div>

      <h3 className="mt-6 text-sm font-bold text-muted uppercase tracking-wide">Per sheet size</h3>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        {SHEET_SIZES.map((size) => (
          <div key={size} className="rounded-md border border-line bg-panel-2 p-4">
            <div className="text-base font-extrabold">{size}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {WEIGHT_FIELDS.map((f) => (
                <Field
                  key={f.key}
                  label={f.unit ? `${f.label} (${f.unit})` : f.label}
                  hint={f.hint}
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={draft.weights[size][f.key]}
                      onChange={(e) => setWeight(size, f.key, e.target.value)}
                      className="text-right tabular-nums"
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button pending={pending} onClick={save}>
          Save packing settings
        </Button>
        <Button tone="ghost" onClick={() => setDraft(toDraft(settings))} disabled={pending}>
          Reset
        </Button>
      </div>
    </Card>
  );
}
