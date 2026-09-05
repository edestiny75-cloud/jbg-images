'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { queueJobs } from '@/lib/db';
import { printPdfUrl } from '@/lib/assets';

/**
 * Queue print files for the Fiery.
 *
 * One action for one row and for a checked batch — the legacy tool had
 * `queueFiery`, `sendCheckedFiery` and `sendWholeQueue` doing the same work
 * three times, and only one of them reported what it had sent.
 */
const schema = z.object({
  batchId: z.coerce.number().int().positive().nullable(),
  jobs: z
    .array(
      z.object({
        sku: z.string().min(1),
        size: z.string().nullable().optional(),
        copies: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(500),
});

export type QueueResult = { ok: true; files: number; copies: number } | { ok: false; error: string };

export async function queuePrintJobs(input: unknown): Promise<QueueResult> {
  const session = await auth();
  if (!can.plan(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nothing valid to send.' };

  const { batchId, jobs } = parsed.data;
  const files = await queueJobs(
    jobs.map((j) => ({
      productSku: j.sku,
      // Derived here, once. `queueFiery` took a `file` argument and ignored it,
      // so a caller passing the database path had it silently discarded.
      filePath: printPdfUrl(j.sku),
      size: j.size ?? null,
      copies: j.copies,
      type: 'fiery' as const,
      batchId,
    })),
  );

  revalidatePath('/jobs');
  return { ok: true, files, copies: jobs.reduce((sum, j) => sum + j.copies, 0) };
}
