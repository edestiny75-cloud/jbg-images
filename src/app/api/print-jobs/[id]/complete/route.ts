import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isAgentRequest } from '@/lib/auth/agent';
import { completeJob } from '@/lib/db';

/**
 * The print agent reports back on a job it claimed.
 *
 * Replaces the agent's own `PATCH /rest/v1/print_jobs?id=eq.N` with the anon
 * key. Three outcomes rather than the legacy two, because the legacy script had
 * a third it expressed by saying nothing at all: when the Fiery hot folder was
 * missing it left the row `queued` and let the next poll retry. A claimed row is
 * not queued, so that case has to be said out loud — see `JobOutcome`.
 */

const bodySchema = z.object({
  agent: z.string().min(1).max(120),
  outcome: z.enum(['done', 'error', 'requeue']),
  /** Shown on the Print Jobs board, so it is written for the shop floor. */
  message: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: RouteContext<'/api/print-jobs/[id]/complete'>) {
  if (!isAgentRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'No such job.' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That is not a valid job report.' }, { status: 400 });
  }

  const { agent, outcome, message } = parsed.data;
  const applied = await completeJob(id, agent, outcome, message);

  if (!applied) {
    // The claim is gone: swept as stale and taken by another agent, or already
    // reported. Saying so is better than a 200 that changed nothing, because the
    // agent's log is the only place anybody would see it.
    return NextResponse.json(
      { error: 'That job is no longer claimed by this agent.' },
      { status: 409 },
    );
  }

  revalidatePath('/jobs');
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
