import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from './client';

/**
 * Boxes and their contents, as the Packer and Register screens see them.
 *
 * `qty` is what the planner intended; `actualQty` is what the picker put in.
 * The gap between them is the shortage the Register reports, so nothing here
 * ever writes one from the other.
 */

const BOX_INCLUDE = { items: { orderBy: { id: 'asc' } } } satisfies Prisma.BoxInclude;

export type BoxWithItems = Prisma.BoxGetPayload<{ include: typeof BOX_INCLUDE }>;
export type BoxStatus = BoxWithItems['status'];

export async function listBoxes(batchId: number): Promise<BoxWithItems[]> {
  return prisma.box.findMany({ where: { batchId }, orderBy: { boxNo: 'asc' }, include: BOX_INCLUDE });
}

export async function getBox(id: number): Promise<BoxWithItems | null> {
  return prisma.box.findUnique({ where: { id }, include: BOX_INCLUDE });
}

/**
 * Move a box along the pending -> picking -> packed -> shipped ladder.
 *
 * `shippedAt` is stamped here rather than by the caller so every path that
 * ships a box records it — the legacy tool set it in `shipBox` and `shipAll`
 * separately (index.html:1784-1785) and nowhere else.
 */
export async function setBoxStatus(id: number, status: BoxStatus): Promise<void> {
  await prisma.box.update({
    where: { id },
    data: { status, shippedAt: status === 'shipped' ? new Date() : null },
  });
}

export async function setBoxCarton(id: number, carton: string | null): Promise<void> {
  await prisma.box.update({ where: { id }, data: { carton } });
}

/**
 * Record what was actually packed for one line, and roll the box totals up.
 *
 * The legacy tool recomputed `unit_count` in the browser and wrote it back
 * alongside, so two clients packing the same shipment could each overwrite the
 * other's total. Doing it in one transaction from the stored rows removes that.
 */
export async function setPackedQty(boxItemId: number, actualQty: number): Promise<BoxWithItems> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.boxItem.update({
      where: { id: boxItemId },
      data: { actualQty, picked: true },
      select: { boxId: true },
    });
    return recount(tx, item.boxId);
  });
}

export async function setItemPicked(boxItemId: number, picked: boolean): Promise<void> {
  await prisma.boxItem.update({ where: { id: boxItemId }, data: { picked } });
}

export async function setLabelStatus(boxItemId: number, labelStatus: 'none' | 'queued' | 'printed'): Promise<void> {
  await prisma.boxItem.update({ where: { id: boxItemId }, data: { labelStatus } });
}

/**
 * Add a line to an existing box. Only legal for order kinds that allow free
 * adds — see allowsFreeAdd in lib/domain/orderPolicy; the caller enforces it.
 */
export async function addBoxItem(
  boxId: number,
  item: { productSku: string; title?: string | null; asin?: string | null; qty: number; thumbUrl?: string | null; fnskuPath?: string | null },
): Promise<BoxWithItems> {
  return prisma.$transaction(async (tx) => {
    await tx.boxItem.create({
      data: {
        boxId,
        productSku: item.productSku,
        title: item.title ?? null,
        asin: item.asin ?? null,
        qty: item.qty,
        actualQty: item.qty,
        thumbUrl: item.thumbUrl ?? null,
        fnskuPath: item.fnskuPath ?? null,
      },
    });
    return recount(tx, boxId);
  });
}

export async function removeBoxItem(boxItemId: number): Promise<BoxWithItems> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.boxItem.delete({ where: { id: boxItemId }, select: { boxId: true } });
    return recount(tx, item.boxId);
  });
}

/** An empty extra carton, for the order kinds that allow ad-hoc boxes. */
export async function addBox(batchId: number, size: string, carton: string | null = null): Promise<BoxWithItems> {
  const max = await prisma.box.aggregate({ where: { batchId }, _max: { boxNo: true } });
  return prisma.box.create({
    data: { batchId, boxNo: (max._max.boxNo ?? 0) + 1, size, carton },
    include: BOX_INCLUDE,
  });
}

export async function deleteBox(id: number): Promise<void> {
  await prisma.box.delete({ where: { id } });
}

/**
 * Recompute `unit_count` from the rows themselves. Weight is left alone: it is
 * the planned figure, and a short pick does not make the carton lighter until
 * someone reweighs it.
 */
async function recount(tx: Prisma.TransactionClient, boxId: number): Promise<BoxWithItems> {
  const totals = await tx.boxItem.aggregate({ where: { boxId }, _sum: { actualQty: true } });
  return tx.box.update({
    where: { id: boxId },
    data: { unitCount: totals._sum.actualQty ?? 0 },
    include: BOX_INCLUDE,
  });
}
