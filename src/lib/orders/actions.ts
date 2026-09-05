'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { getOrder } from '@/lib/db';
import { rememberOrderId } from './active';

/**
 * The one entry point for "work on this order".
 *
 * Every screen that used to reset the nine globals by hand now calls this, so
 * there is exactly one place where the active order changes and exactly one
 * definition of what that means.
 */
const schema = z.object({ batchId: z.coerce.number().int().positive().nullable() });

export type SetActiveOrderResult = { ok: true } | { ok: false; error: string };

export async function setActiveOrder(input: unknown): Promise<SetActiveOrderResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  const { batchId } = parsed.data;
  if (batchId !== null) {
    const order = await getOrder(batchId);
    if (!order) return { ok: false, error: 'That order no longer exists.' };
  }

  await rememberOrderId(batchId);
  for (const path of ['/intake', '/print', '/boxes', '/packer', '/register']) revalidatePath(path);
  return { ok: true };
}
