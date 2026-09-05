'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import {
  createOrder,
  deleteOrder,
  listAliases,
  listOverrides,
  listProducts,
  replaceOrderLines,
  saveAlias,
  saveOrderPlan,
  updateOrder,
  getSettings,
  type OrderLineInput,
} from '@/lib/db';
import { rememberOrderId } from '@/lib/orders/active';
import { loadOrder } from '@/lib/orders/loadOrder';
import {
  buildCatalogIndex,
  defaultNeedsLabels,
  planBoxes,
  PlanError,
  reflowPending,
  resolveSku,
  type ListLine,
  type OrderKind,
} from '@/lib/domain';
import { ListParseError, parseListFile } from '@/lib/intake/parseList';
import { saveOverride } from '@/lib/db/products.repo';
import { notifyQuietly } from '@/lib/notify/slack';

/**
 * Everything that creates or edits an order.
 *
 * All of it funnels through `createOrder` / `replaceOrderLines` and ends with
 * `rememberOrderId`, so the active order is set in exactly one way. The legacy
 * tool had eight functions each resetting the same nine globals by hand.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

const ORDER_KINDS = ['fba', 'wholesale', 'quick', 'pick'] as const;

async function requirePlanner() {
  const session = await auth();
  return can.plan(session?.user.role) ? session : null;
}

/** Resolve raw list SKUs against the catalog. Shared by upload and paste. */
async function toOrderLines(list: readonly ListLine[]): Promise<OrderLineInput[]> {
  const [catalog, aliases] = await Promise.all([listProducts(), listAliases()]);
  const index = buildCatalogIndex(catalog);

  return list.map((line, i) => {
    const resolved = resolveSku(index, line.sku, line.asin, aliases);
    return {
      lineNo: i + 1,
      listSku: line.sku,
      resolvedProductSku: resolved.product?.sku ?? null,
      asin: line.asin ?? resolved.product?.asin ?? null,
      title: line.title ?? resolved.product?.title ?? null,
      requestedQty: line.requested,
      size: resolved.product?.size ?? null,
      resolveStatus: resolved.status,
      notes: line.notes ?? null,
    };
  });
}

// --- creating an order ----------------------------------------------------

const uploadSchema = z.object({
  kind: z.enum(ORDER_KINDS).default('fba'),
  name: z.string().trim().max(200).optional(),
});

export async function uploadList(formData: FormData): Promise<ActionResult<{ batchId: number; lines: number; skipped: number }>> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a spreadsheet first.' };

  const parsedMeta = uploadSchema.safeParse({
    kind: formData.get('kind') ?? undefined,
    name: formData.get('name') ?? undefined,
  });
  if (!parsedMeta.success) return { ok: false, error: 'Pick an order type.' };

  let parsed;
  try {
    parsed = await parseListFile(await file.arrayBuffer(), file.name);
  } catch (err) {
    return { ok: false, error: err instanceof ListParseError ? err.message : 'Could not read that file.' };
  }

  const kind = parsedMeta.data.kind as OrderKind;
  const order = await createOrder(
    {
      name: parsedMeta.data.name || file.name,
      sourceFilename: file.name,
      kind,
      needsLabels: defaultNeedsLabels(kind),
      status: 'draft',
    },
    await toOrderLines(parsed.lines),
  );

  await rememberOrderId(order.id);
  revalidateOrderScreens();
  return { ok: true, data: { batchId: order.id, lines: parsed.lines.length, skipped: parsed.skipped } };
}

const manualSchema = z.object({
  kind: z.enum(ORDER_KINDS),
  name: z.string().trim().min(1).max(200),
  lines: z
    .array(z.object({ sku: z.string().min(1), requested: z.coerce.number().int().min(0).max(100000) }))
    .max(2000)
    .default([]),
});

/** Ported from `startManualOrder`, `createWholesaleOrder`, `newQuickBox` — one action. */
export async function createManualOrder(input: unknown): Promise<ActionResult<{ batchId: number }>> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Give the order a name.' };

  const { kind, name, lines } = parsed.data;
  const order = await createOrder(
    { name, sourceFilename: null, kind, needsLabels: defaultNeedsLabels(kind), status: 'draft' },
    await toOrderLines(lines.map((l) => ({ sku: l.sku, requested: l.requested }))),
  );

  await rememberOrderId(order.id);
  revalidateOrderScreens();
  return { ok: true, data: { batchId: order.id } };
}

// --- editing an order -----------------------------------------------------

const editSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        lineNo: z.coerce.number().int().positive(),
        listSku: z.string().min(1),
        resolvedProductSku: z.string().min(1).nullable(),
        asin: z.string().nullable(),
        title: z.string().nullable(),
        requestedQty: z.coerce.number().int().min(0).max(100000),
        size: z.string().nullable(),
        notes: z.string().nullable(),
      }),
    )
    .max(2000),
});

export async function saveOrderLines(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Some line is not valid.' };

  const [catalog, aliases] = await Promise.all([listProducts(), listAliases()]);
  const index = buildCatalogIndex(catalog);

  await replaceOrderLines(
    parsed.data.batchId,
    parsed.data.lines.map((l) => ({
      ...l,
      // Re-resolve so a hand-corrected SKU records how it was matched.
      resolveStatus: l.resolvedProductSku
        ? resolveSku(index, l.listSku, l.asin, aliases).status
        : 'unmapped',
    })),
  );

  revalidateOrderScreens();
  return { ok: true };
}

const mapSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  listSku: z.string().min(1),
  productSku: z.string().min(1),
  /** Remember it for next time, so the same misspelling is never asked about twice. */
  remember: z.boolean().default(true),
});

/** Confirm a fuzzy match. Ported from the picker's "map to" flow. */
export async function mapListSku(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = mapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a product to map to.' };

  const { batchId, listSku, productSku, remember } = parsed.data;
  const loaded = await loadOrder(batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };

  if (remember) await saveAlias(listSku, productSku);

  const lines: OrderLineInput[] = loaded.order.items.map((item) => ({
    lineNo: item.lineNo,
    listSku: item.listSku,
    resolvedProductSku: item.listSku === listSku ? productSku : item.resolvedProductSku,
    asin: item.asin,
    title: item.title,
    requestedQty: item.requestedQty,
    size: item.size,
    resolveStatus: item.listSku === listSku ? 'aliased' : item.resolveStatus,
    notes: item.notes,
  }));

  await replaceOrderLines(batchId, lines);
  revalidateOrderScreens();
  return { ok: true };
}

const sizeSchema = z.object({
  sku: z.string().min(1),
  size: z.enum(['11x17', '8.5x11']),
});

/** Ported from `toggleLineSize`: correct a size and remember the correction. */
export async function setProductSize(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = sizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a size we print.' };

  const overrides = await listOverrides();
  const current = overrides.get(parsed.data.sku);
  await saveOverride(parsed.data.sku, { ...current, size: parsed.data.size });

  revalidateOrderScreens();
  return { ok: true };
}

// --- planning -------------------------------------------------------------

const planSchema = z.object({ batchId: z.coerce.number().int().positive() });

/**
 * Plan the boxes and hand the order to the packer.
 *
 * Committed boxes — anything already being picked or packed — are frozen and
 * only the pending remainder is re-planned, which is what `reflowPending` is
 * for. The legacy `sendPlanToPacker` re-planned everything and silently
 * discarded work in progress.
 */
export async function planAndSend(input: unknown): Promise<ActionResult<{ boxes: number }>> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  const loaded = await loadOrder(parsed.data.batchId);
  if (!loaded) return { ok: false, error: 'That order no longer exists.' };

  const settings = await getSettings();

  let boxes;
  try {
    boxes = loaded.boxes.length
      ? reflowPending(loaded.lines, loaded.boxes, settings)
      : planBoxes(loaded.lines, settings);
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, error: err.message };
    throw err;
  }

  const lines: OrderLineInput[] = loaded.order.items.map((item) => ({
    lineNo: item.lineNo,
    listSku: item.listSku,
    resolvedProductSku: item.resolvedProductSku,
    asin: item.asin,
    title: item.title,
    requestedQty: item.requestedQty,
    size: item.size,
    resolveStatus: item.resolveStatus,
    notes: item.notes,
  }));

  await saveOrderPlan(parsed.data.batchId, lines, boxes, 'picking');

  // "Order is in" — the message the shop floor actually watches for.
  const units = boxes.reduce((sum, b) => sum + b.units, 0);
  await notifyQuietly(
    `\u{1F4E6} Pick order is in: *${loaded.order.name ?? `Order ${loaded.order.id}`}* — ` +
      `${boxes.length} box${boxes.length === 1 ? '' : 'es'}, ${units} units.`,
  );

  revalidateOrderScreens();
  return { ok: true, data: { boxes: boxes.length } };
}

// --- housekeeping ---------------------------------------------------------

export async function renameOrder(input: unknown): Promise<ActionResult> {
  if (!(await requirePlanner())) return { ok: false, error: 'Not allowed.' };
  const parsed = z
    .object({ batchId: z.coerce.number().int().positive(), name: z.string().trim().min(1).max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Give the order a name.' };

  await updateOrder(parsed.data.batchId, { name: parsed.data.name });
  revalidateOrderScreens();
  return { ok: true };
}

export async function discardOrder(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!can.deleteOrders(session?.user.role)) return { ok: false, error: 'Only an admin can delete an order.' };

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  await deleteOrder(parsed.data.batchId);
  await rememberOrderId(null);
  revalidateOrderScreens();
  return { ok: true };
}

function revalidateOrderScreens() {
  for (const path of ['/intake', '/print', '/boxes', '/packer', '/register']) revalidatePath(path);
}
