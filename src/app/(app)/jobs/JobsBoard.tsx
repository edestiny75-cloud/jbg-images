'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatCard, StatRow } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { useSelection } from '@/lib/hooks/useSelection';
import { markLabelSheetPrinted, retryOrderPrintJobs, retryPrintJobs } from './actions';

/**
 * Live view of what has been sent to the Fiery.
 *
 * `type='fnsku'` rows are shown as "waiting for the label printer" rather than
 * as ordinary queued work: the Fiery agent does not claim them, so calling them
 * "waiting" — as the legacy screen did — made it look like the agent was stuck.
 *
 * Nothing else claimed them either, so they stayed queued for good. The label
 * printer is a person at a printer, and this screen is where they say the sheet
 * came out: open the PDF, print it, tick it off.
 */

export interface JobRow {
  id: number;
  productSku: string | null;
  size: string | null;
  copies: number;
  type: 'fiery' | 'fnsku' | null;
  status: 'queued' | 'claimed' | 'done' | 'error';
  createdAt: string;
  errorMessage: string | null;
  claimedBy: string | null;
  filePath: string | null;
}

const REFRESH_MS = 6000;

const STATUS: Record<JobRow['status'], { tone: ChipTone; label: string }> = {
  queued: { tone: 'warn', label: '⏳ Waiting' },
  claimed: { tone: 'info', label: '⚙ Printing' },
  done: { tone: 'success', label: '✓ Sent to Fiery' },
  error: { tone: 'danger', label: '✕ Error' },
};

export function JobsBoard({
  jobs,
  counts,
  batchId,
  canRetryInBulk,
  canPack,
}: {
  jobs: readonly JobRow[];
  counts: Record<JobRow['status'], number>;
  batchId: number | null;
  canRetryInBulk: boolean;
  canPack: boolean;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(true);
  const selection = useSelection((j: JobRow) => String(j.id));

  // Server-side refresh on a timer, replacing the browser's direct 6s poll of
  // Supabase. Pausing it stops the requests entirely rather than throttling.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, router]);

  const failed = jobs.filter((j) => j.status === 'error');
  const checkedFailures = failed.filter((j) => selection.isSelected(j));

  const retry = (ids: readonly number[]) => {
    startTransition(async () => {
      const result = await retryPrintJobs({ ids: [...ids] });
      toast(result.ok ? `Requeued ${result.requeued} job(s).` : result.error, result.ok ? 'success' : 'danger');
      if (result.ok) {
        selection.clear();
        router.refresh();
      }
    });
  };

  const markPrinted = (id: number) => {
    startTransition(async () => {
      const result = await markLabelSheetPrinted({ id });
      toast(result.ok ? 'Label sheet ticked off.' : result.error, result.ok ? 'success' : 'danger');
      if (result.ok) router.refresh();
    });
  };

  const columns: ReadonlyArray<Column<JobRow>> = [
    {
      key: 'check',
      width: 'w-12',
      align: 'center',
      header: '',
      cell: (job) =>
        job.status === 'error' ? (
          <label className="flex min-h-touch items-center justify-center">
            <span className="sr-only">Select job {job.id}</span>
            <input
              type="checkbox"
              checked={selection.isSelected(job)}
              onChange={(e) => selection.set(job, e.target.checked)}
              className="size-5 accent-mint"
            />
          </label>
        ) : null,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (job) => {
        const s = STATUS[job.status];
        const waitingForLabels = isLabelWork(job);
        return (
          <span className="flex flex-col items-start gap-1">
            <Chip tone={waitingForLabels ? 'neutral' : s.tone}>
              {waitingForLabels ? '🏷️ Label printer' : s.label}
            </Chip>
            {job.errorMessage && <span className="text-xs text-danger-fg">{job.errorMessage}</span>}
          </span>
        );
      },
    },
    {
      key: 'product',
      header: 'Product',
      cell: (job) => (
        <span className="flex flex-col">
          <code className="font-mono text-xs">{job.productSku ?? '—'}</code>
          {job.type && job.type !== 'fiery' && (
            <span className="text-xs text-muted">{job.type.toUpperCase()}</span>
          )}
        </span>
      ),
    },
    { key: 'size', header: 'Size', align: 'center', width: 'w-24', cell: (job) => job.size ?? '—' },
    { key: 'copies', header: 'Copies', align: 'center', width: 'w-20', cell: (job) => `${job.copies}×` },
    {
      key: 'age',
      header: 'Sent',
      secondary: true,
      cell: (job) => (
        <span className="text-muted" title={new Date(job.createdAt).toLocaleString()}>
          {timeAgo(job.createdAt)}
          {job.claimedBy && <span className="block text-xs text-muted-dim">by {job.claimedBy}</span>}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      width: 'w-28',
      cell: (job) => {
        if (job.status === 'error') {
          return (
            <Button size="sm" pending={pending} onClick={() => retry([job.id])}>
              Retry
            </Button>
          );
        }
        if (isLabelWork(job) && canPack) {
          return (
            <span className="flex flex-col items-end gap-1">
              {job.filePath && (
                <a
                  href={job.filePath}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-mint underline underline-offset-2"
                >
                  Open sheet ↗
                </a>
              )}
              <Button size="sm" tone="ghost" pending={pending} onClick={() => markPrinted(job.id)}>
                Mark printed
              </Button>
            </span>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Print Jobs</h1>
        <p className="mt-1 text-sm text-muted">
          Everything sent to the Fiery. The agent on the shop PC picks up waiting jobs, drops them
          in the Held queue and flips them to sent. Refreshes every {REFRESH_MS / 1000} seconds.
        </p>
      </header>

      <StatRow>
        <StatCard value={counts.queued} label="waiting" tone="warn" />
        <StatCard value={counts.claimed} label="printing" tone="info" />
        <StatCard value={counts.done} label="sent" tone="good" />
        <StatCard value={counts.error} label="error" tone={counts.error > 0 ? 'bad' : 'neutral'} />
      </StatRow>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" tone="ghost" onClick={() => router.refresh()}>
          ↻ Refresh now
        </Button>
        <Button size="sm" tone="ghost" onClick={() => setAuto((v) => !v)}>
          {auto ? '⏸ Pause auto-refresh' : '▶ Resume auto-refresh'}
        </Button>
        {checkedFailures.length > 0 && (
          <Button size="sm" pending={pending} onClick={() => retry(checkedFailures.map((j) => j.id))}>
            Retry checked ({checkedFailures.length})
          </Button>
        )}
        {canRetryInBulk && batchId !== null && failed.length > 0 && (
          <Button
            size="sm"
            tone="ghost"
            pending={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await retryOrderPrintJobs({ batchId });
                toast(
                  result.ok ? `Requeued ${result.requeued} job(s) on this order.` : result.error,
                  result.ok ? 'success' : 'danger',
                );
                if (result.ok) router.refresh();
              })
            }
          >
            Retry every failure on this order
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={jobs}
        rowKey={(job) => job.id}
        rowTone={(job) => (job.status === 'error' ? 'danger' : undefined)}
        empty="No print jobs yet. Send something from the Print Queue and it will show up here."
      />
    </div>
  );
}

/** A label sheet nobody has printed yet. The Fiery never touches these. */
function isLabelWork(job: JobRow): boolean {
  return job.status === 'queued' && job.type === 'fnsku';
}

/** Ported from `jobAgo` (index.html:966). */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
