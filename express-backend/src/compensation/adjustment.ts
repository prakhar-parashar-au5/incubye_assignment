// Pure salary-adjustment arithmetic on exact two-decimal strings.
//
// All money is BigInt minor units (cents). A percentage result is calculated
// exactly as a fraction and rounded once, half-up, to cents. JavaScript
// `number` is never used for an amount.
import { formatMoney, parseMoney } from '../money/decimal.js';

export const ADJUSTMENT_METHODS = Object.freeze([
  'PERCENTAGE_INCREASE',
  'PERCENTAGE_DECREASE',
  'FIXED_INCREASE',
  'FIXED_DECREASE',
  'REPLACEMENT',
] as const);
export type AdjustmentMethod = (typeof ADJUSTMENT_METHODS)[number];

/** Product-wide percentage limits; salary bands may narrow them. */
export const PERCENTAGE_LIMITS = Object.freeze({
  increase: { min: 1, max: 200 },
  decrease: { min: 1, max: 50 },
});

export type AdjustmentErrorReason =
  | 'PERCENTAGE_RANGE'
  | 'INVALID_AMOUNT'
  | 'NEGATIVE_RESULT'
  | 'NO_CHANGE'
  | 'ZERO_BONUS_PERCENTAGE'
  | 'BASE_NOT_POSITIVE'
  | 'SALARY_BAND';

export class AdjustmentError extends Error {
  readonly reason: AdjustmentErrorReason;

  constructor(reason: AdjustmentErrorReason, message: string) {
    super(message);
    this.name = 'AdjustmentError';
    this.reason = reason;
  }
}

export interface AdjustmentInput {
  currentAmount: string;
  method: AdjustmentMethod;
  value: string;
}

export interface AdjustmentResult {
  currentAmount: string;
  newAmount: string;
  /** Absolute difference; `direction` gives the sign. */
  changeAmount: string;
  direction: 'INCREASE' | 'DECREASE';
}

const PERCENTAGE = /^[1-9][0-9]{0,2}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/;

export const isPercentageMethod = (method: AdjustmentMethod): boolean =>
  method === 'PERCENTAGE_INCREASE' || method === 'PERCENTAGE_DECREASE';

/** Parses a percentage value: an integer without sign, decimals, or leading zero, inside the method's limits. */
export function parsePercentage(method: 'PERCENTAGE_INCREASE' | 'PERCENTAGE_DECREASE', value: string): bigint {
  const limits = method === 'PERCENTAGE_INCREASE' ? PERCENTAGE_LIMITS.increase : PERCENTAGE_LIMITS.decrease;
  if (!PERCENTAGE.test(value)) {
    throw new AdjustmentError('PERCENTAGE_RANGE', `Percentage must be a whole number from ${limits.min} to ${limits.max}.`);
  }
  const percent = BigInt(value);
  if (percent < BigInt(limits.min) || percent > BigInt(limits.max)) {
    throw new AdjustmentError('PERCENTAGE_RANGE', `Percentage must be a whole number from ${limits.min} to ${limits.max}.`);
  }
  return percent;
}

/** Parses an input amount with at most two decimals ("600.5" -> 60050n). */
export function parseAmountInput(value: string): bigint {
  if (!AMOUNT.test(value)) throw new AdjustmentError('INVALID_AMOUNT', 'Amount must be a non-negative number with at most two decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** Normalizes an input amount to a two-decimal string ("600.5" -> "600.50"). */
export const normalizeAmountInput = (value: string): string => formatMoney(parseAmountInput(value));

/** numerator / denominator rounded half-up; both non-negative. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}

function currentCents(amount: string): bigint {
  try {
    return parseMoney(amount);
  } catch {
    throw new AdjustmentError('INVALID_AMOUNT', 'Current amount must be a non-negative two-decimal string.');
  }
}

export function calculateAdjustment({ currentAmount, method, value }: AdjustmentInput): AdjustmentResult {
  const current = currentCents(currentAmount);
  let next: bigint;
  switch (method) {
    case 'PERCENTAGE_INCREASE':
      next = divideHalfUp(current * (100n + parsePercentage(method, value)), 100n);
      break;
    case 'PERCENTAGE_DECREASE':
      next = divideHalfUp(current * (100n - parsePercentage(method, value)), 100n);
      break;
    case 'FIXED_INCREASE':
    case 'FIXED_DECREASE': {
      const amount = parseAmountInput(value);
      if (amount === 0n) throw new AdjustmentError('INVALID_AMOUNT', 'A fixed adjustment must be greater than zero.');
      next = method === 'FIXED_INCREASE' ? current + amount : current - amount;
      break;
    }
    case 'REPLACEMENT':
      next = parseAmountInput(value);
      break;
  }
  if (next < 0n) throw new AdjustmentError('NEGATIVE_RESULT', 'The adjustment cannot produce a negative amount.');
  if (next === current) throw new AdjustmentError('NO_CHANGE', 'The adjustment does not change the amount.');
  return {
    currentAmount,
    newAmount: formatMoney(next),
    changeAmount: formatMoney(next > current ? next - current : current - next),
    direction: next > current ? 'INCREASE' : 'DECREASE',
  };
}

/**
 * Percentage change from `before` to `after`, rounded half-up to two
 * decimals and signed ("-5.00"). Null when `before` is zero.
 */
export function percentageChange(before: string, after: string): string | null {
  const from = parseMoney(before);
  const to = parseMoney(after);
  if (from === 0n) return null;
  const difference = to - from;
  const magnitude = divideHalfUp((difference < 0n ? -difference : difference) * 10_000n, from);
  return `${difference < 0n ? '-' : ''}${formatMoney(magnitude)}`;
}
