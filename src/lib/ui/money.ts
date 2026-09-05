/**
 * Dollars, formatted once.
 *
 * The legacy tool spelled this as `'$'+Number(x).toFixed(2)` at eleven sites,
 * and at four of them a missing price rendered as `$NaN`.
 */
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$9.50`, or null when there is no price — which is not the same as `$0.00`. */
export function usd(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? USD.format(value) : null;
}
