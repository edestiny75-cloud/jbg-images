'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import {
  addBox,
  addBoxItem,
  deleteBox,
  getSettings,
  removeBoxItem,
  replaceOrderBoxes,
  setBoxCarton,
} from '@/lib/db';
import { loadOrder } from '@/lib/orders/loadOrder';
import {
  allowsAdHocBoxes,
  allowsFreeAdd,
  CARTONS,
  freeAvailable,
  isCommitted,
  PlanError,
  recomputeBox,
  reflowPending,
  renumber,
  SHEET_SIZES,
} from '@/lib/domain';

/** Editing a plan: quantities, extra cartons, and the re-flow that follows. */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function requirePlanner() {
  const session = await auth();
  return can.plan(session?.user.role) ? session : null;
}

const replanSchema = z.object({ batchId: z.coerce.number().int().positive() });

/**
 * Re-plan the pending boxes around whatever is already committed.
 *
 * The legacy "replan" rebuilt every box from scratch, including ones a packer
 * was mid-way through — see `reflowPending` for what is frozen and why.
 */
export async function replanBoxes(input: unknown): Promise<ActionResult<{ boxes: number }>> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = replanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  const loaded = await loadOrder(parsed.data.batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };

  const settings = await getSettings();
  try {
    const boxes = reflowPending(loaded.lines, loaded.boxes, settings);
    await replaceOrderBoxes(parsed.data.batchId, boxes);
    revalidateBoxScreens();
    return { ok: true, data: { boxes: boxes.length } };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, error: err.message };
    throw err;
  }
}

const editItemSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  boxNo: z.coerce.number().int().positive(),
  sku: z.string().min(1),
  qty: z.coerce.number().int().min(0).max(100000),
});

/** Change the planned quantity of one line inside one box. */
export async function editPlannedQty(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = editItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid quantity.' };

  const { batchId, boxNo, sku, qty } = parsed.data;
  const loaded = await loadOrder(batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };

  const box = loaded.boxes.find((b) => b.boxNo === boxNo);
  if (!box) return { ok: false, error: 'No such box.' };
  if (isCommitted(box)) return { ok: false, error: `Box ${boxNo} is already being packed.` };

  const settings = await getSettings();
  const next = loaded.boxes.map((b) => {
    if (b.boxNo !== boxNo) return b;
    const items = b.items
      .map((i) => (i.sku === sku ? { ...i, qty, actual: Math.min(i.actual, qty) } : i))
      .filter((i) => i.qty > 0);
    return recomputeBox({ ...b, items }, settings);
  });

  await replaceOrderBoxes(batchId, renumber(next.filter((b) => b.items.length > 0 || isCommitted(b))));
  revalidateBoxScreens();
  return { ok: true };
}

const cartonSchema = z.object({
  boxId: z.coerce.number().int().positive(),
  carton: z.enum(CARTONS),
});

/**
 * Record which carton a box goes in.
 *
 * This existed only in JS state before and was silently lost on reload, so a
 * packer who chose a smaller carton for samples found it back at 20×14×10 the
 * next morning.
 */
export async function setCarton(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = cartonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a carton we stock.' };

  await setBoxCarton(parsed.data.boxId, parsed.data.carton);
  revalidateBoxScreens();
  return { ok: true };
}

const addBoxSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  size: z.enum(SHEET_SIZES),
  carton: z.enum(CARTONS).nullable().default(null),
});

/** An extra empty carton. Only for order kinds that are not bound to a list. */
export async function addEmptyBox(input: unknown): Promise<ActionResult<{ boxNo: number }>> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = addBoxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a size for the box.' };

  const loaded = await loadOrder(parsed.data.batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };
  if (!allowsAdHocBoxes(loaded.order.kind)) {
    return { ok: false, error: 'An FBA order only ships the boxes its list plans.' };
  }

  const box = await addBox(parsed.data.batchId, parsed.data.size, parsed.data.carton);
  revalidateBoxScreens();
  return { ok: true, data: { boxNo: box.boxNo } };
}

const addItemSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  boxId: z.coerce.number().int().positive(),
  sku: z.string().min(1),
  qty: z.coerce.number().int().min(1).max(100000),
});

/**
 * Put a product into a box by hand.
 *
 * On an FBA order this is bounded by the customer's list: you cannot ship more
 * of a SKU than was requested, which is what `freeAvailable` measures. The
 * legacy tool showed that number but did not enforce it.
 */
export async function addItemIntoBox(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a product and a quantity.' };

  const { batchId, boxId, sku, qty } = parsed.data;
  const loaded = await loadOrder(batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };

  const product = loaded.products.get(sku) ?? null;

  if (!allowsFreeAdd(loaded.order.kind)) {
    const free = freeAvailable(sku, loaded.lines, loaded.boxes);
    if (free <= 0) return { ok: false, error: `${sku} is not on this order's list.` };
    if (qty > free) return { ok: false, error: `Only ${free} of ${sku} are still unpacked.` };
  }

  await addBoxItem(boxId, {
    productSku: sku,
    title: product?.title ?? null,
    asin: product?.asin ?? null,
    qty,
    thumbUrl: product?.thumbUrl ?? null,
    fnskuPath: product?.fnskuPath ?? null,
  });

  revalidateBoxScreens();
  return { ok: true };
}

const boxItemSchema = z.object({ boxItemId: z.coerce.number().int().positive() });

export async function removeItemFromBox(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = boxItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nothing to remove.' };

  await removeBoxItem(parsed.data.boxItemId);
  revalidateBoxScreens();
  return { ok: true };
}

const boxSchema = z.object({ boxId: z.coerce.number().int().positive() });

export async function removeBox(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such box.' };

  await deleteBox(parsed.data.boxId);
  revalidateBoxScreens();
  return { ok: true };
}

function revalidateBoxScreens() {
  for (const path of ['/boxes', '/packer', '/register']) revalidatePath(path);
}
