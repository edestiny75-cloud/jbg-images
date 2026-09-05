import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { OrderKind, PlannedBox, ResolveStatus } from '@/lib/domain';
import { prisma } from './client';

/**
 * Orders (`batches`) and their lines (`batch_items`).
 *
 * Two legacy behaviours are corrected here:
 *
 *  1. `kind` and `needs_labels` were smuggled through `source_filename` as a
 *     `JBGMETA:{…}` JSON blob. They are real columns now; the blob is only read
 *     during backfill (see parseLegacyOrderMeta).
 *  2. Saving a shipment was a delete-then-reinsert loop with no transaction, so
 *     a mid-loop failure left a half-written order. Every write below is one
 *     transaction.
 */

export type BatchStatus = 'draft' | 'planned' | 'picking' | 'packed' | 'shipped';

export interface OrderLineInput {
  lineNo: number;
  listSku: string;
  resolvedProductSku?: string | null;
  asin?: string | null;
  title?: string | null;
  requestedQty: number;
  size?: string | null;
  resolveStatus?: ResolveStatus | null;
  notes?: string | null;
}

export interface OrderInput {
  name?: string | null;
  sourceFilename?: string | null;
  kind: OrderKind;
  needsLabels: boolean;
  status?: BatchStatus;
  shipmentNo?: number | null;
}

const ORDER_INCLUDE = {
  items: { orderBy: { lineNo: 'asc' } },
  boxes: {
    orderBy: { boxNo: 'asc' },
    include: { items: { orderBy: { id: 'asc' } } },
  },
} satisfies Prisma.BatchInclude;

export type Order = Prisma.BatchGetPayload<{ include: typeof ORDER_INCLUDE }>;
export type OrderLine = Order['items'][number];
export type OrderBox = Order['boxes'][number];

/** Summary row for the Register and the order picker. No items joined. */
export type OrderSummary = Prisma.BatchGetPayload<{
  select: {
    id: true;
    shipmentNo: true;
    name: true;
    sourceFilename: true;
    kind: true;
    needsLabels: true;
    status: true;
    createdAt: true;
    _count: { select: { items: true; boxes: true } };
  };
}>;

export async function listOrders(opts: { status?: BatchStatus; limit?: number } = {}): Promise<OrderSummary[]> {
  return prisma.batch.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
    select: {
      id: true,
      shipmentNo: true,
      name: true,
      sourceFilename: true,
      kind: true,
      needsLabels: true,
      status: true,
      createdAt: true,
      _count: { select: { items: true, boxes: true } },
    },
  });
}

export async function getOrder(id: number): Promise<Order | null> {
  return prisma.batch.findUnique({ where: { id }, include: ORDER_INCLUDE });
}

/**
 * Create an order and its lines atomically. This is the single entry point the
 * legacy tool never had — eight functions each reset the same nine globals by
 * hand, which is why the active order could drift out of sync with the database.
 */
export async function createOrder(order: OrderInput, lines: readonly OrderLineInput[] = []): Promise<Order> {
  return prisma.batch.create({
    data: {
      name: order.name ?? null,
      sourceFilename: order.sourceFilename ?? null,
      kind: order.kind,
      needsLabels: order.needsLabels,
      status: order.status ?? 'planned',
      shipmentNo: order.shipmentNo ?? null,
      items: { create: lines.map(toLineCreate) },
    },
    include: ORDER_INCLUDE,
  });
}

function toLineCreate(l: OrderLineInput): Prisma.BatchItemCreateWithoutBatchInput {
  return {
    lineNo: l.lineNo,
    listSku: l.listSku,
    resolvedProductSku: l.resolvedProductSku ?? null,
    asin: l.asin ?? null,
    title: l.title ?? null,
    requestedQty: l.requestedQty,
    size: l.size ?? null,
    resolveStatus: l.resolveStatus ?? null,
    notes: l.notes ?? null,
  };
}

export async function updateOrder(id: number, patch: Partial<OrderInput>): Promise<void> {
  await prisma.batch.update({
    where: { id },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.sourceFilename !== undefined && { sourceFilename: patch.sourceFilename }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.needsLabels !== undefined && { needsLabels: patch.needsLabels }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.shipmentNo !== undefined && { shipmentNo: patch.shipmentNo }),
    },
  });
}

/** Replace every line of an order. Atomic, unlike the legacy delete-then-loop. */
export async function replaceOrderLines(batchId: number, lines: readonly OrderLineInput[]): Promise<void> {
  await prisma.$transaction([
    prisma.batchItem.deleteMany({ where: { batchId } }),
    prisma.batchItem.createMany({ data: lines.map((l) => ({ batchId, ...toLineCreate(l) })) }),
  ]);
}

/**
 * Replace the planned boxes of an order, in one transaction.
 *
 * Cascade delete removes `box_items` with their box, so the whole plan swaps
 * atomically. Callers must have already excluded committed boxes — see
 * reflowPending in lib/domain/boxPlanner.
 */
export async function replaceOrderBoxes(batchId: number, boxes: readonly PlannedBox[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.box.deleteMany({ where: { batchId } });
    for (const box of boxes) {
      await tx.box.create({
        data: {
          batchId,
          boxNo: box.boxNo,
          size: box.size,
          weightOz: box.weightOz,
          thickIn: box.thickIn,
          unitCount: box.units,
          status: box.status,
          items: {
            create: box.items.map((i) => ({
              productSku: i.sku,
              asin: i.asin,
              title: i.title,
              qty: i.qty,
              actualQty: i.actual,
              thumbUrl: i.thumbUrl,
              fnskuPath: i.fnskuPath,
            })),
          },
        },
      });
    }
  });
}

/** Save lines and boxes together — what "send plan to packer" does. */
export async function saveOrderPlan(
  batchId: number,
  lines: readonly OrderLineInput[],
  boxes: readonly PlannedBox[],
  status: BatchStatus = 'picking',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.batchItem.deleteMany({ where: { batchId } });
    await tx.batchItem.createMany({ data: lines.map((l) => ({ batchId, ...toLineCreate(l) })) });
    await tx.box.deleteMany({ where: { batchId } });
    for (const box of boxes) {
      await tx.box.create({
        data: {
          batchId,
          boxNo: box.boxNo,
          size: box.size,
          weightOz: box.weightOz,
          thickIn: box.thickIn,
          unitCount: box.units,
          status: box.status,
          items: {
            create: box.items.map((i) => ({
              productSku: i.sku,
              asin: i.asin,
              title: i.title,
              qty: i.qty,
              actualQty: i.actual,
              thumbUrl: i.thumbUrl,
              fnskuPath: i.fnskuPath,
            })),
          },
        },
      });
    }
    await tx.batch.update({ where: { id: batchId }, data: { status } });
  });
}

export async function deleteOrder(id: number): Promise<void> {
  await prisma.batch.delete({ where: { id } });
}

/** Next shipment number. The legacy tool asked the user to type one. */
export async function nextShipmentNo(): Promise<number> {
  const max = await prisma.batch.aggregate({ _max: { shipmentNo: true } });
  return (max._max.shipmentNo ?? 0) + 1;
}
