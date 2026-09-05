'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { getBox, listBoxes, setBoxStatus, updateOrder } from '@/lib/db';

/** Shipping boxes out. The last state a box reaches. */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

const boxSchema = z.object({ boxId: z.coerce.number().int().positive() });

export async function shipBox(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such box.' };

  const box = await getBox(parsed.data.boxId);
  if (!box) return { ok: false, error: 'No such box.' };
  if (box.status !== 'packed') return { ok: false, error: `Box ${box.boxNo} is not packed yet.` };

  await setBoxStatus(parsed.data.boxId, 'shipped');
  revalidatePath('/register');
  return { ok: true };
}

const orderSchema = z.object({ batchId: z.coerce.number().int().positive() });

/** Ship everything packed on this order, and close the order out with it. */
export async function shipAll(input: unknown): Promise<ActionResult<{ shipped: number }>> {
  const session = await auth();
  if (!can.plan(session?.user.role)) return { ok: false, error: 'Only a manager can ship a whole order.' };

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  const boxes = await listBoxes(parsed.data.batchId);
  const packed = boxes.filter((b) => b.status === 'packed');
  if (packed.length === 0) return { ok: false, error: 'Nothing is packed and waiting to ship.' };

  for (const box of packed) await setBoxStatus(box.id, 'shipped');

  // The order is shipped once nothing is left behind it.
  const remaining = boxes.filter((b) => b.status !== 'packed' && b.status !== 'shipped');
  if (remaining.length === 0) await updateOrder(parsed.data.batchId, { status: 'shipped' });

  revalidatePath('/register');
  return { ok: true, data: { shipped: packed.length } };
}
