'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { getProduct, queueJobs } from '@/lib/db';
import { printPdfUrl } from '@/lib/assets';

/**
 * Queue a manual Fiery print. Ported from `openFieryPrompt` → `confirmFiery` →
 * `queueFiery` (index.html), collapsed into one server action.
 *
 * The legacy `queueFiery(sku, file, size, copies)` ignored its `file` argument
 * and always recomputed the GCS URL, so one of its five callers silently
 * discarded the database path it passed. The file is derived here, once.
 */
const schema = z.object({
  sku: z.string().min(1),
  copies: z.coerce.number().int().min(1).max(500),
});

export type QueueResult = { ok: true; queued: number } | { ok: false; error: string };

export async function queueFieryPrint(input: unknown): Promise<QueueResult> {
  const session = await auth();
  if (!can.pack(session?.user.role)) return { ok: false, error: 'Not allowed.' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a number of copies between 1 and 500.' };

  const product = await getProduct(parsed.data.sku);
  if (!product) return { ok: false, error: 'No such product.' };
  if (!product.pdfPath) return { ok: false, error: 'This product has no print file yet.' };

  const queued = await queueJobs([
    {
      productSku: product.sku,
      filePath: printPdfUrl(product.sku),
      size: product.size ?? null,
      copies: parsed.data.copies,
      type: 'fiery',
    },
  ]);

  revalidatePath('/jobs');
  revalidatePath('/print');
  return { ok: true, queued };
}
