'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useToast } from '@/components/ui/Toast';
import { sendSlackTest } from './actions';

/**
 * Slack pick notifications.
 *
 * The legacy version kept the webhook URL in localStorage and posted to it from
 * the browser with `mode:'no-cors'` (index.html:1626), so it had to be pasted
 * into every device and every failure was invisible. It is a server env var now
 * — `SLACK_WEBHOOK_URL` — which is also why there is no field to edit here: a
 * webhook is a credential, and the browser has no business holding one.
 */
export function NotificationsPanel({ configured }: { configured: boolean }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-extrabold">Slack pick notifications</h2>
        {configured ? (
          <Chip tone="success">webhook set</Chip>
        ) : (
          <Chip tone="warn">not configured</Chip>
        )}
      </div>

      <p className="mt-2 text-sm text-muted">
        Every <b>Send to Packer</b> posts &ldquo;order is in&rdquo; to the channel, with the box and
        unit count. The webhook lives in the server environment as{' '}
        <code className="font-mono text-xs">SLACK_WEBHOOK_URL</code>, not on the device — set it
        once and every iPad is covered.
      </p>

      <div className="mt-4">
        <Button
          size="sm"
          tone="ghost"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await sendSlackTest();
              toast(result.ok ? 'Test posted to Slack.' : result.error, result.ok ? 'success' : 'danger');
            })
          }
        >
          Send test message
        </Button>
      </div>
    </Card>
  );
}
