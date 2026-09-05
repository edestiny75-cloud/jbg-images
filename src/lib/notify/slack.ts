import 'server-only';
import { env } from '@/lib/env';

/**
 * Slack pick notifications. Ported from `slackNotify` (index.html:1626).
 *
 * The legacy version POSTed from the browser with `mode:'no-cors'`, which makes
 * the response opaque: a revoked webhook, a 404 and a rate-limit all looked
 * exactly like success. It also read the URL from localStorage, so the shop had
 * to paste it into every iPad separately and it vanished with the cache.
 *
 * It is a server-side fetch against `SLACK_WEBHOOK_URL` now, and the result is
 * returned rather than swallowed.
 */

export type SlackResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'failed'; detail?: string };

export function slackConfigured(): boolean {
  return Boolean(env.SLACK_WEBHOOK_URL);
}

export async function slackNotify(text: string): Promise<SlackResult> {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, reason: 'unconfigured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      // A wedged webhook must not hold a server action open.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, reason: 'failed', detail: `${res.status} ${await res.text()}`.trim().slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fire-and-forget: a notification must never fail the shipment it is announcing.
 * Failures are logged rather than surfaced, which is what the "Send test" button
 * in Settings is for.
 */
export async function notifyQuietly(text: string): Promise<void> {
  const result = await slackNotify(text);
  if (!result.ok && result.reason === 'failed') {
    console.error('[slack] notification failed:', result.detail);
  }
}
