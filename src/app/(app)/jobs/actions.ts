'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { markLabelsPrinted, retryJobs, retryOrderJobs } from '@/lib/db';

/**
 * Requeue failed print jobs.
 *
 * Deliberately scoped. `retryAllErrors()` (index.html:975) ran an unscoped
 * `UPDATE print_jobs SET status='queued' WHERE status='error'`, so one person's
 * retry requeued every failure in the table — including other shipments', and
 * including jobs somebody had abandoned on purpose. Retrying more than your own
 * rows now needs the manager role.
 */
const idsSchema = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500) });
const orderSchema = z.object({ batchId: z.coerce.number().int().positive() });

export type RetryResult = { ok: true; requeued: number } | { ok: false; error: string };

export async function retryPrintJobs(input: unknown): Promise<RetryResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nothing to retry.' };

  if (parsed.data.ids.length > 1 && !can.retryOthersJobs(session?.user.role)) {
    return { ok: false, error: 'Only a manager can retry jobs in bulk.' };
  }

  const requeued = await retryJobs(parsed.data.ids);
  revalidatePath('/jobs');
  return { ok: true, requeued };
}

/** Requeue every failure of one order — the widest retry the UI offers. */
export async function retryOrderPrintJobs(input: unknown): Promise<RetryResult> {
  const session = await auth();
  if (!can.retryOthersJobs(session?.user.role)) return { ok: false, error: 'Only a manager can do that.' };

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid order.' };

  const requeued = await retryOrderJobs(parsed.data.batchId);
  revalidatePath('/jobs');
  return { ok: true, requeued };
}

/**
 * Confirm an FNSKU label sheet was printed.
 *
 * The Fiery agent never claims these rows (they go to the label printer, not the
 * Fiery), so without this they stayed `queued` for good — the board filled with
 * work that looked stuck and wasn't. A packer runs the label printer, so a
 * packer can tick them off.
 */
export type LabelResult = { ok: true } | { ok: false; error: string };

export async function markLabelSheetPrinted(input: unknown): Promise<LabelResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not a valid job.' };

  const marked = await markLabelsPrinted(parsed.data.id, session?.user.name ?? null);
  if (!marked) return { ok: false, error: 'That label sheet is no longer waiting.' };

  revalidatePath('/jobs');
  return { ok: true };
}
