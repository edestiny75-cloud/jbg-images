/**
 * Filename helpers shared by the print screens and the agent contract.
 * Ported from `fileName` in index.html.
 */

/** The last path segment of a path or URL, decoded, without the query string. */
export function fileName(path: string | null | undefined): string {
  if (!path) return '';
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** True when a print file is a two-sided 11x17: side A colour, side B mono. */
export function isTwoSided(path: string | null | undefined): boolean {
  return /2[\s_-]?sided/i.test(path ?? '');
}
