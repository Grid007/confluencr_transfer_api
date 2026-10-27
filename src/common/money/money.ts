/**
 * Exact decimal helpers for two-decimal money held as strings.
 * All balance arithmetic happens in SQL; these helpers exist only for validation,
 * the insufficient-balance comparison, and the `shortfall` field. Floats are never used.
 */

const SCALE = 100n;

/** Largest accepted single amount: 1,000,000,000,000.00 (keeps JSON numbers exactly representable). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000n * SCALE;

/** Parses "12", "12.3" or "12.34" (already validated) into minor units (cents). */
export function toMinor(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '00').slice(0, 2));
}

export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** "50" -> "50.00", "50.5" -> "50.50", "50.00" -> "50.00". */
export function normalize(value: string): string {
  return fromMinor(toMinor(value));
}

/** True when a < b, comparing exact decimals. */
export function lt(a: string, b: string): boolean {
  return toMinor(a) < toMinor(b);
}

/** requested - balance, as a two-decimal string (used for the 422 context). */
export function shortfall(balance: string, requested: string): string {
  return fromMinor(toMinor(requested) - toMinor(balance));
}
