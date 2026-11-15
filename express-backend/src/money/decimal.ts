// Exact money arithmetic on two-decimal strings, using BigInt minor units
// (cents). JavaScript `number` is never used for a salary value.

const MONEY = /^(\d+)\.(\d{2})$/;
const RATE = /^(\d+)(?:\.(\d+))?$/;

/** Parses "1234.50" into 123450n. Rejects anything that is not an exact non-negative two-decimal string. */
export function parseMoney(value: string): bigint {
  const match = MONEY.exec(value);
  if (!match) throw new Error('money value must be a non-negative two-decimal string');
  return BigInt(`${match[1]}${match[2]}`);
}

/** Formats cents as a two-decimal string. */
export function formatMoney(cents: bigint): string {
  if (cents < 0n) throw new Error('money value must be non-negative');
  const text = cents.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

export function addMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a) + parseMoney(b));
}

/** a - b as a signed two-decimal string ("-300000.10" for a decrease). */
export function subtractMoney(a: string, b: string): string {
  const difference = parseMoney(a) - parseMoney(b);
  return difference < 0n ? `-${formatMoney(-difference)}` : formatMoney(difference);
}

/** total / count, rounded half-up to cents. */
export function averageMoney(total: string, count: number): string {
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error('average count must be a positive integer');
  const cents = parseMoney(total);
  const n = BigInt(count);
  const quotient = cents / n;
  return formatMoney((cents % n) * 2n >= n ? quotient + 1n : quotient);
}

/** A positive decimal rate as an integer numerator over 10^scale. */
function parseRate(rate: string): { numerator: bigint; scale: bigint } {
  const match = RATE.exec(rate);
  if (!match) throw new Error('exchange-rate value must be a decimal string');
  const fraction = match[2] ?? '';
  const numerator = BigInt(`${match[1]}${fraction}`);
  if (numerator === 0n) throw new Error('exchange-rate value must be positive');
  return { numerator, scale: 10n ** BigInt(fraction.length) };
}

export function isPositiveDecimal(rate: string): boolean {
  try {
    parseRate(rate);
    return true;
  } catch {
    return false;
  }
}

/** The rate snapshot fields conversion needs: 1 USD = `rate` INR. */
export interface UsdInrRate {
  baseCurrency: 'USD';
  quoteCurrency: 'INR';
  rate: string;
}

/**
 * USD equivalent for display, rounded half-up to cents.
 * USD uses rate 1. INR divides by the INR-per-USD rate.
 * Returns null when an INR amount has no rate.
 */
export function convertToUsd(amount: string, currency: 'INR' | 'USD', snapshot: UsdInrRate | null): string | null {
  const cents = parseMoney(amount);
  if (currency === 'USD') return formatMoney(cents);
  if (!snapshot) return null;
  const { numerator, scale } = parseRate(snapshot.rate);
  // usdCents = cents * scale / numerator, rounded half-up (all values non-negative).
  const scaled = cents * scale;
  const quotient = scaled / numerator;
  const remainder = scaled % numerator;
  return formatMoney(remainder * 2n >= numerator ? quotient + 1n : quotient);
}
