'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import {
  getBox,
  queueJobs,
  setBoxStatus,
  setItemPicked,
  setLabelStatus,
  setPackedQty,
} from '@/lib/db';
import { fnskuPdfUrl } from '@/lib/assets';

/**
 * What a packer does to a box.
 *
 * `qty` (planned) and `actualQty` (packed) are kept apart deliberately: several
 * legacy paths wrote the packed figure over the planned one, which is how
 * shortages vanished from the Box Register.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function requirePacker() {
  const session = await auth();
  return can.pack(session?.user.role) ? session : null;
}

const boxSchema = z.object({ boxId: z.coerce.number().int().positive() });

/** Claim a box. Two packers can work different boxes; neither can take the other's. */
export async function startBox(input: unknown): Promise<ActionResult> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such box.' };

  const box = await getBox(parsed.data.boxId);
  if (!box) return { ok: false, error: 'No such box.' };
  if (box.status === 'packed' || box.status === 'shipped') {
    return { ok: false, error: `Box ${box.boxNo} is already ${box.status}.` };
  }

  await setBoxStatus(parsed.data.boxId, 'picking');
  revalidatePackerScreens();
  return { ok: true };
}

/** Put a box back in the pool. Ported from `releaseBox`. */
export async function releaseBox(input: unknown): Promise<ActionResult> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such box.' };

  const box = await getBox(parsed.data.boxId);
  if (!box) return { ok: false, error: 'No such box.' };
  if (box.status === 'packed' || box.status === 'shipped') {
    return { ok: false, error: `Box ${box.boxNo} is already ${box.status}; it cannot be released.` };
  }

  await setBoxStatus(parsed.data.boxId, 'pending');
  revalidatePackerScreens();
  return { ok: true };
}

/** Close a box out. Shortages are recorded, not corrected. */
export async function finishBox(input: unknown): Promise<ActionResult<{ short: number }>> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = boxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'No such box.' };

  const box = await getBox(parsed.data.boxId);
  if (!box) return { ok: false, error: 'No such box.' };
  if (box.items.length === 0) return { ok: false, error: 'That box is empty.' };

  const short = box.items.reduce((sum, i) => sum + Math.max(0, i.qty - i.actualQty), 0);
  await setBoxStatus(parsed.data.boxId, 'packed');
  revalidatePackerScreens();
  return { ok: true, data: { short } };
}

const qtySchema = z.object({
  boxItemId: z.coerce.number().int().positive(),
  actualQty: z.coerce.number().int().min(0).max(100000),
});

export async function recordPackedQty(input: unknown): Promise<ActionResult> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = qtySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid quantity.' };

  await setPackedQty(parsed.data.boxItemId, parsed.data.actualQty);
  revalidatePackerScreens();
  return { ok: true };
}

const pickedSchema = z.object({
  boxItemId: z.coerce.number().int().positive(),
  picked: z.boolean(),
});

export async function togglePicked(input: unknown): Promise<ActionResult> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = pickedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nothing to tick.' };

  await setItemPicked(parsed.data.boxItemId, parsed.data.picked);
  revalidatePackerScreens();
  return { ok: true };
}

const labelSchema = z.object({
  boxItemId: z.coerce.number().int().positive(),
  sku: z.string().min(1),
  batchId: z.coerce.number().int().positive(),
  copies: z.coerce.number().int().min(1).max(500),
});

/**
 * Queue the FNSKU sheet for the label printer.
 *
 * These rows go in as `type='fnsku'`, a queue the Fiery agent does not claim —
 * the sheets go to the label printer. The Print Jobs screen shows them as
 * waiting for that printer rather than as stuck Fiery work, and offers whoever
 * runs it a way to tick them off; before that they stayed queued for ever.
 */
export async function printFnskuLabels(input: unknown): Promise<ActionResult> {
  if (!(await requirePacker())) return { ok: false, error: 'Not allowed.' };

  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nothing to print.' };

  await queueJobs([
    {
      productSku: parsed.data.sku,
      filePath: fnskuPdfUrl(parsed.data.sku),
      copies: parsed.data.copies,
      type: 'fnsku',
      batchId: parsed.data.batchId,
    },
  ]);
  await setLabelStatus(parsed.data.boxItemId, 'queued');

  revalidatePath('/jobs');
  revalidatePackerScreens();
  return { ok: true };
}

function revalidatePackerScreens() {
  for (const path of ['/packer', '/boxes', '/register']) revalidatePath(path);
}
