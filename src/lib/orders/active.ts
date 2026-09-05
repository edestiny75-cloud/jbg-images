import 'server-only';
import { cookies } from 'next/headers';

/**
 * Which order the shop is currently working on.
 *
 * The legacy tool held this in nine module-level variables (`CURRENT_LIST`,
 * `EDITS`, `CURRENT_BATCH`, `SHIPMENT`, `STATE.batch`, `STATE.boxes`,
 * `_orderKind`, `_orderLabels`, `_srcName`) which eight different functions each
 * reset by hand. There was no single entry point, and no two of the eight set
 * exactly the same fields — the #1 correctness risk in this port.
 *
 * Now there is one identifier, the batch id, and everything else is derived
 * from the database. A URL parameter beats the cookie so a deep link works;
 * the cookie only remembers where someone was between tabs.
 */

const COOKIE = 'jbg_order';
/** A working day and a bit. Long enough to survive a shift, short enough to expire. */
const MAX_AGE_SECONDS = 60 * 60 * 30;

export async function getActiveOrderId(): Promise<number | null> {
  const store = await cookies();
  return parseId(store.get(COOKIE)?.value);
}

/** URL wins over the remembered order, so a shared link always opens what it names. */
export async function resolveOrderId(fromUrl?: string | string[]): Promise<number | null> {
  const url = parseId(Array.isArray(fromUrl) ? fromUrl[0] : fromUrl);
  return url ?? (await getActiveOrderId());
}

export async function rememberOrderId(batchId: number | null): Promise<void> {
  const store = await cookies();
  if (batchId == null) store.delete(COOKIE);
  else store.set(COOKIE, String(batchId), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE_SECONDS });
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
