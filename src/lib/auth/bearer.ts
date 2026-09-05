import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Comparing a bearer token, without leaking how nearly it matched.
 *
 * Kept free of `server-only` and of the environment so it can be unit tested;
 * `agent.ts` is the thin layer that knows which secret this app expects.
 */

const PREFIX = 'Bearer ';

/**
 * True when an `Authorization` header carries exactly `expected`.
 *
 * Fails closed on a missing or empty `expected`: a deployment that has not been
 * given a token should refuse every caller, not accept every caller.
 */
export function bearerMatches(header: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!header?.startsWith(PREFIX)) return false;

  const presented = header.slice(PREFIX.length).trim();
  if (!presented) return false;

  // Digests first so both sides are the same length — `timingSafeEqual` throws
  // on a length mismatch, and throwing would itself answer the question.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
