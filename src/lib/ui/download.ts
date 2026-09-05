/**
 * Ask the server for a file and hand it to the browser's downloader.
 *
 * The alternative — a plain form POST — downloads just as well but navigates
 * away on failure, so a 403 arrives as a page of raw JSON. Going through
 * `fetch` keeps the error in the app, where it can be said out loud in a toast.
 */

export interface DownloadResult {
  ok: boolean;
  error?: string;
}

export async function downloadFile(url: string, body: unknown): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }

  if (!response.ok) {
    const message = await response
      .json()
      .then((j: unknown) => (j && typeof j === 'object' && 'error' in j ? String(j.error) : null))
      .catch(() => null);
    return { ok: false, error: message ?? `The export failed (${response.status}).` };
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filenameFrom(response.headers.get('Content-Disposition')) ?? 'download';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari cancels an in-flight download when its blob URL is revoked, so the
  // handle outlives the click by a wide margin rather than the usual next tick.
  setTimeout(() => URL.revokeObjectURL(href), 30_000);

  return { ok: true };
}

/** Pull the filename out of a Content-Disposition header, RFC 5987 form first. */
export function filenameFrom(header: string | null): string | null {
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}
