import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fnskuPdfUrl, printPdfUrl } from '@/lib/assets';
import { isAgentRequest } from '@/lib/auth/agent';
import { claimJobs, completeJob, countQueued, requeueStaleClaims, type PrintJob } from '@/lib/db';
import { sizeFromSku } from '@/lib/domain/sizing';

/**
 * The print agent asks for work.
 *
 * This replaces the agent reading the database itself. It used to poll
 * PostgREST directly —
 *
 *   GET /rest/v1/print_jobs?status=eq.queued&or=(type.eq.fiery,type.is.null)
 *
 * — with the Supabase anon key, which is to say with full read/write on every
 * table, and the moment RLS goes on that call returns `[]` forever: no error, no
 * warning, just a printer that quietly stops printing. Moving it here is what
 * lets RLS be enabled at all.
 *
 * Two things change besides the transport, both of them fixes:
 *
 *  - **Jobs are claimed, not just read.** The old poll ran every 5 seconds and
 *    only marked a row `done` after the file had been downloaded and copied. A
 *    large PDF took longer than the poll interval, so the next tick found the
 *    same row still `queued` and printed it again. Claiming closes that window.
 *  - **The server resolves the file URL.** The agent carried its own copy of the
 *    GCS base and the Supabase prints prefix (`.ps1:59-60`, duplicated from
 *    `index.html:819-820`) and rebuilt URLs from the SKU whenever `file_path`
 *    was not a link. Those constants now live in one place and the agent is told
 *    the finished URL.
 */

const bodySchema = z.object({
  /** Which machine is asking, so a claim can be reported on by its owner. */
  agent: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  /** The Fiery claims posters; label sheets are a separate queue. */
  type: z.enum(['fiery', 'fnsku']).default('fiery'),
});

export interface ClaimedJob {
  id: number;
  sku: string | null;
  size: string;
  copies: number;
  type: 'fiery' | 'fnsku';
  /** Absolute and ready to download. The agent never builds this itself. */
  fileUrl: string;
}

/** An already-absolute `file_path` wins; otherwise it is derived from the SKU. */
function fileUrlFor(job: PrintJob): string | null {
  const stored = job.filePath?.trim();
  if (stored && /^https?:\/\//i.test(stored)) return stored;
  if (!job.productSku) return null;
  return job.type === 'fnsku' ? fnskuPdfUrl(job.productSku) : printPdfUrl(job.productSku);
}

/**
 * What would a claim get me?
 *
 * A read-only probe so the agent can verify its token at startup instead of
 * discovering a 401 as an endless run of empty polls. Nothing is claimed here,
 * which is the whole point — checking a token must not consume work.
 */
export async function GET(request: Request) {
  if (!isAgentRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const type = new URL(request.url).searchParams.get('type') === 'fnsku' ? 'fnsku' : 'fiery';
  return NextResponse.json(
    { ok: true, type, queued: await countQueued(type) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  if (!isAgentRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That is not a valid claim request.' }, { status: 400 });
  }

  const { agent, limit, type } = parsed.data;

  // An agent that crashed mid-print holds its claims until something releases
  // them. Doing it on the poll means recovery needs no separate scheduler.
  await requeueStaleClaims();

  const claimed = await claimJobs(agent, limit, type);

  const jobs: ClaimedJob[] = [];
  for (const job of claimed) {
    const fileUrl = fileUrlFor(job);
    if (!fileUrl) {
      // No file and no SKU: nothing could ever print this. The legacy agent
      // discovered that on the shop floor and set the row to error itself.
      await completeJob(job.id, agent, 'error', 'No file and no SKU — nothing to print.');
      continue;
    }
    jobs.push({
      id: job.id,
      sku: job.productSku,
      // The agent used to default a missing size to "11x17" on its own. The
      // catalog already knows the answer, so it is settled here instead.
      size: job.size ?? sizeFromSku(job.productSku),
      copies: Math.min(Math.max(job.copies, 1), 999),
      type: job.type ?? 'fiery',
      fileUrl,
    });
  }

  if (claimed.length > 0) revalidatePath('/jobs');

  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
}
