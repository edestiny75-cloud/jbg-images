'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import {
  clearOverride,
  createQuote,
  deleteQuote,
  listOverrides,
  saveOverride,
  savePricesMany,
  type PriceBook,
} from '@/lib/db';

/**
 * The wholesale price book.
 *
 * The legacy sheet wrote to localStorage on every keystroke, so the shop's
 * prices lived on whichever iPad they were typed into and vanished with its
 * cache. These now go to `product_prices` and `product_overrides` — one
 * transaction for the whole edited batch, rather than a write per character.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Blank clears the value; a number sets it. Nothing else is accepted. */
const optionalMoney = z
  .union([z.literal(''), z.coerce.number().min(0).max(1_000_000)])
  .transform((v) => (v === '' ? null : v));

const optionalOunces = z
  .union([z.literal(''), z.coerce.number().min(0).max(10_000)])
  .transform((v) => (v === '' ? null : v));

const rowSchema = z.object({
  sku: z.string().min(1),
  wholesale: optionalMoney,
  cost: optionalMoney,
  costBulk: optionalMoney,
  msrp: optionalMoney,
  map: optionalMoney,
  weightOz: optionalOunces,
  shipWeightOz: optionalOunces,
});

const saveSchema = z.object({ rows: z.array(rowSchema).min(1).max(500) });

export async function savePriceBook(input: unknown): Promise<ActionResult<{ saved: number }>> {
  const session = await auth();
  if (!can.plan(session?.user.role)) return { ok: false, error: 'Only a manager can edit prices.' };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Some of those values are not usable.' };
  }

  const rows = parsed.data.rows;

  const prices: Array<[string, Partial<PriceBook>]> = rows.map((r) => [
    r.sku,
    { wholesale: r.wholesale, cost: r.cost, costBulk: r.costBulk, msrp: r.msrp, map: r.map },
  ]);
  await savePricesMany(prices);

  // Weights live on product_overrides alongside the size override, so the row
  // has to be preserved when only the weights are cleared.
  const existing = await listOverrides();
  for (const r of rows) {
    const current = existing.get(r.sku);
    const size = current?.size ?? null;
    if (r.weightOz == null && r.shipWeightOz == null && size == null) {
      if (current) await clearOverride(r.sku);
      continue;
    }
    if (
      current?.weightOz === r.weightOz &&
      current?.shipWeightOz === r.shipWeightOz
    ) {
      continue;
    }
    await saveOverride(r.sku, { weightOz: r.weightOz, shipWeightOz: r.shipWeightOz, size });
  }

  // Weights feed the planner, so anything that plans has to see the new figures.
  for (const path of ['/wholesale', '/catalog', '/boxes', '/intake', '/packer']) revalidatePath(path);
  return { ok: true, data: { saved: rows.length } };
}

// --- quotes ---------------------------------------------------------------

/**
 * Raising a quote.
 *
 * The legacy builder (`downloadQuoteMulti`, index.html:1477) wrote the quote
 * into localStorage keyed by SKU and then opened a pop-up window containing the
 * document. Nothing was shared, nothing was numbered, and the record lived on
 * one device. A quote is a row now, so it has a number, an author and a URL.
 */
const quoteLineSchema = z.object({
  productSku: z.string().min(1).max(128),
  title: z.string().max(300).nullish(),
  qty: z.coerce.number().int().min(1).max(100_000),
  unitPrice: z.coerce.number().min(0).max(1_000_000),
});

const quoteSchema = z.object({
  customer: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(quoteLineSchema).min(1).max(200),
});

export async function raiseQuote(input: unknown): Promise<ActionResult<{ id: string; number: number }>> {
  const session = await auth();
  if (!can.plan(session?.user.role)) return { ok: false, error: 'Only a manager can quote prices.' };

  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That quote is not complete.' };
  }

  const { customer, notes, lines } = parsed.data;

  const quote = await createQuote(
    {
      customer: customer || null,
      notes: notes || null,
      // Who raised it, so the shop can ask them about it later.
      createdBy: session?.user.name ?? null,
    },
    lines.map((l) => ({ productSku: l.productSku, title: l.title ?? null, qty: l.qty, unitPrice: l.unitPrice })),
  );

  revalidatePath('/wholesale');
  revalidatePath('/catalog');
  return { ok: true, data: quote };
}

export async function removeQuote(input: unknown): Promise<ActionResult> {
  const session = await auth();
  // Deleting a quote destroys the record of a price somebody was given, so it
  // sits with the other destructive actions rather than with editing.
  if (!can.deleteOrders(session?.user.role)) {
    return { ok: false, error: 'Only an admin can delete a quote.' };
  }

  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such quote.' };

  await deleteQuote(parsed.data.id);
  revalidatePath('/wholesale');
  revalidatePath('/catalog');
  return { ok: true };
}
