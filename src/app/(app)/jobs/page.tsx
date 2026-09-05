import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { countByStatus, listJobs } from '@/lib/db';
import { resolveOrderId } from '@/lib/orders/active';
import { JobsBoard } from './JobsBoard';

/**
 * Print Jobs. Ported from `viewJobs` (index.html:977).
 *
 * The legacy screen polled Supabase directly every six seconds from the browser
 * with the anon key. It refreshes on the server now, so the browser holds no
 * database credentials and a stale tab cannot keep hammering the table.
 */
export const metadata = { title: 'Print Jobs · JBG Fulfillment' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const [session, jobs, counts, batchId] = await Promise.all([
    auth(),
    listJobs({ limit: 300 }),
    countByStatus(),
    resolveOrderId((await searchParams).batch),
  ]);

  return (
    <JobsBoard
      jobs={jobs.map((j) => ({
        id: j.id,
        productSku: j.productSku,
        size: j.size,
        copies: j.copies,
        type: j.type,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        errorMessage: j.errorMessage,
        claimedBy: j.claimedBy,
        // Label sheets are opened and printed by hand, so the board needs the link.
        filePath: j.filePath,
      }))}
      counts={counts}
      batchId={batchId}
      canRetryInBulk={can.retryOthersJobs(session?.user.role)}
      canPack={can.pack(session?.user.role)}
    />
  );
}
