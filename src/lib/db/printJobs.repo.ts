import 'server-only';
import type { PrintJob } from '@/generated/prisma/client';
import { prisma } from './client';

/**
 * The print queue — and the contract with agent/JBG_Fiery_Agent.ps1.
 *
 * The agent used to poll Supabase PostgREST directly with the anon key and flip
 * rows to done/error itself. It now goes through /api/print-jobs, and the two
 * functions below are the server side of that: `claimJobs` hands out work under
 * a transaction so two agents cannot take the same job, and `completeJob`
 * records what became of a claim.
 */

export type PrintJobStatus = 'queued' | 'claimed' | 'done' | 'error';
export type PrintJobType = 'fiery' | 'fnsku';

export type { PrintJob };

export interface QueueJobInput {
  productSku: string;
  filePath: string;
  size?: string | null;
  copies?: number;
  type?: PrintJobType;
  batchId?: number | null;
}

export async function queueJobs(jobs: readonly QueueJobInput[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const result = await prisma.printJob.createMany({
    data: jobs.map((j) => ({
      productSku: j.productSku,
      filePath: j.filePath,
      size: j.size ?? null,
      copies: j.copies ?? 1,
      type: j.type ?? 'fiery',
      batchId: j.batchId ?? null,
    })),
  });
  return result.count;
}

export async function listJobs(opts: { status?: PrintJobStatus; limit?: number } = {}): Promise<PrintJob[]> {
  return prisma.printJob.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 200,
  });
}

export async function countByStatus(): Promise<Record<PrintJobStatus, number>> {
  const rows = await prisma.printJob.groupBy({ by: ['status'], _count: { _all: true } });
  const out: Record<PrintJobStatus, number> = { queued: 0, claimed: 0, done: 0, error: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

/**
 * Hand out queued work to one agent.
 *
 * One statement, because two were not enough. The obvious version — select the
 * queued ids, then `updateMany` them to `claimed` — looks safe and is not:
 * under Postgres' default Read Committed isolation every concurrent poller
 * selects the *same* ids, and while only the first update actually lands, a
 * follow-up read by id happily returns rows somebody else claimed. Six agents
 * polling at once were each told they owned the same ten jobs, which is the
 * duplicate printing this endpoint exists to prevent.
 *
 * `FOR UPDATE SKIP LOCKED` is the fix and the reason this is raw SQL: each
 * caller locks the rows it selects and steps over rows another caller already
 * holds, so concurrent agents get disjoint batches instead of the same one.
 * `RETURNING` then reports only what this statement actually claimed.
 */
export async function claimJobs(agent: string, limit = 25, type: PrintJobType = 'fiery'): Promise<PrintJob[]> {
  return prisma.$queryRaw<PrintJob[]>`
    UPDATE print_jobs
       SET status = 'claimed', claimed_at = NOW(), claimed_by = ${agent}
     WHERE id IN (
       SELECT id
         FROM print_jobs
        WHERE status = 'queued'
          AND type = ${type}::print_job_type
        ORDER BY created_at ASC
        LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
     )
    RETURNING id,
              batch_id      AS "batchId",
              product_sku   AS "productSku",
              file_path     AS "filePath",
              size,
              copies,
              type,
              status,
              created_at    AS "createdAt",
              error_message AS "errorMessage",
              claimed_at    AS "claimedAt",
              claimed_by    AS "claimedBy"
  `;
}

/** How much work is waiting, without taking any of it. Used by the agent's
 * startup probe, which has to be able to check its token without claiming. */
export async function countQueued(type: PrintJobType = 'fiery'): Promise<number> {
  return prisma.printJob.count({ where: { status: 'queued', type } });
}

/**
 * How an agent finished with a claim.
 *
 * `requeue` is not a failure. The agent's hot folder can be missing — the Fiery
 * Hot Folders console not open yet, a machine still booting — and the legacy
 * script handled that by simply leaving the row `queued` so the next poll would
 * pick it up again. Under a claim model that row is no longer queued, so the
 * agent has to be able to hand it back explicitly or the job would sit in
 * `claimed` until the stale sweep noticed. This is the single silent-breakage
 * risk in moving the agent off PostgREST, so it gets a first-class outcome.
 */
export type JobOutcome = 'done' | 'error' | 'requeue';

/**
 * Record what an agent did with a job it claimed.
 *
 * Scoped to the claim: `id` alone is not enough, because a stale claim may have
 * been swept back to `queued` and picked up by a second agent while the first
 * was still downloading. Without `claimedBy` in the where-clause, the slow
 * agent's late "done" would close out somebody else's live job.
 *
 * Returns false when the claim was no longer the agent's to report on, so the
 * route can answer 409 rather than pretend.
 */
export async function completeJob(
  id: number,
  agent: string,
  outcome: JobOutcome,
  errorMessage?: string | null,
): Promise<boolean> {
  const data =
    outcome === 'requeue'
      ? { status: 'queued' as const, claimedAt: null, claimedBy: null, errorMessage: null }
      : {
          status: outcome,
          errorMessage: outcome === 'error' ? (errorMessage ?? 'Agent reported a failure') : null,
        };

  const result = await prisma.printJob.updateMany({
    where: { id, status: 'claimed', claimedBy: agent },
    data,
  });
  return result.count === 1;
}

/**
 * Tick off a label sheet that somebody printed.
 *
 * FNSKU rows are queued by `printFnskuLabels` but the Fiery agent will not claim
 * them — they belong to the label printer, which is a person with a printer, not
 * a service. Nothing ever moved them off `queued`, so they accumulated on the
 * Print Jobs board forever, showing as work in progress that nobody was doing.
 * The label printer is the consumer; this is how they say so.
 *
 * Narrow on purpose: only an unclaimed label job, never a Fiery job, so this
 * cannot be used to mark poster work done that never printed.
 */
export async function markLabelsPrinted(id: number, by: string | null): Promise<boolean> {
  const result = await prisma.printJob.updateMany({
    where: { id, type: 'fnsku', status: 'queued' },
    data: { status: 'done', claimedAt: new Date(), claimedBy: by },
  });
  return result.count === 1;
}

/**
 * Requeue failures.
 *
 * Scoped on purpose. The legacy retryAllErrors() ran an unscoped
 * `UPDATE print_jobs SET status='queued' WHERE status='error'`, so one person's
 * retry requeued everybody's failures across every shipment.
 */
export async function retryJobs(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.printJob.updateMany({
    where: { id: { in: [...ids] }, status: 'error' },
    data: { status: 'queued', errorMessage: null, claimedAt: null, claimedBy: null },
  });
  return result.count;
}

/** Requeue every failure of one order. The widest retry the UI offers. */
export async function retryOrderJobs(batchId: number): Promise<number> {
  const result = await prisma.printJob.updateMany({
    where: { batchId, status: 'error' },
    data: { status: 'queued', errorMessage: null, claimedAt: null, claimedBy: null },
  });
  return result.count;
}

/**
 * Return jobs an agent claimed but never reported on — a crash mid-print, or a
 * machine that went home for the night.
 */
export async function requeueStaleClaims(olderThanMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.printJob.updateMany({
    where: { status: 'claimed', claimedAt: { lt: cutoff } },
    data: { status: 'queued', claimedAt: null, claimedBy: null },
  });
  return result.count;
}

export async function deleteJobs(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.printJob.deleteMany({ where: { id: { in: [...ids] } } });
  return result.count;
}
