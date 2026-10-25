/**
 * Exact arithmetic helpers. Money and weights are converted to integers in units of 1/10,000
 * (four decimal places) and compared with BigInt, so boundary checks like "within 1%" are exact.
 */
export const SCALE = 10_000n;

export function toUnits(x: number): bigint {
  if (!Number.isFinite(x)) throw new RangeError("non-finite number");
  return BigInt(Math.round(x * 10_000));
}

export function unitsToNumber(u: bigint): number {
  return Number(u) / 10_000;
}

/** ceil(a / b) for non-negative bigint a and positive b. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** a / b as a number rounded to `dp` decimals (display only). */
export function ratio(a: bigint, b: bigint, dp = 2): number {
  if (b === 0n) return NaN;
  const f = 10n ** BigInt(dp);
  const neg = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * f * 2n + absB) / (absB * 2n); // round half up
  return (neg ? -1 : 1) * (Number(q) / Number(f));
}

const gbpFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbpWhole = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const gbpPrecise = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** £5,400 for whole pounds, £5.25 otherwise, up to 4 dp when needed (e.g. £0.0125). */
export function formatGBP(x: number): string {
  if (Number.isInteger(x)) return gbpWhole.format(x);
  const twoDp = Math.round(x * 100) / 100;
  return twoDp === x ? gbpFmt.format(x) : gbpPrecise.format(x);
}

export function formatNumber(x: number, maxDp = 2): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: maxDp }).format(x);
}

export function formatKg(x: number): string {
  return `${formatNumber(x, 2)} kg`;
}
