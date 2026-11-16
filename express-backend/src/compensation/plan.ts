// Applies one adjustment to one target of a compensation record and checks
// the result against the employee's salary band. Pure: no I/O.
import { addMoney, parseMoney, subtractMoney } from '../money/decimal.js';
import type { Currency } from '../source-workbook/constants.js';
import {
  AdjustmentError,
  calculateAdjustment,
  isPercentageMethod,
  normalizeAmountInput,
  percentageChange,
} from './adjustment.js';
import type { AdjustmentMethod } from './adjustment.js';

export const ADJUSTMENT_TARGETS = Object.freeze(['BASE_SALARY', 'ANNUAL_BONUS'] as const);
export type AdjustmentTarget = (typeof ADJUSTMENT_TARGETS)[number];

export interface SalaryBand {
  currency: Currency;
  minAnnualBaseSalary: string;
  maxAnnualBaseSalary: string;
  maxAnnualBonus: string;
  minPercentageIncrease: number;
  maxPercentageIncrease: number;
  minPercentageDecrease: number;
  maxPercentageDecrease: number;
}

export interface CompensationValues {
  annualBaseSalary: string;
  annualBonus: string;
  currency: Currency;
}

export interface AdjustmentPlan {
  target: AdjustmentTarget;
  method: AdjustmentMethod;
  /** The input value, normalized: amounts to two decimals, percentages as given. */
  value: string;
  currency: Currency;
  previousTargetValue: string;
  proposedTargetValue: string;
  current: { annualBaseSalary: string; annualBonus: string; annualCashCompensation: string };
  proposed: { annualBaseSalary: string; annualBonus: string; annualCashCompensation: string };
  change: {
    /** Signed change of the target ("-31185.85" for a decrease). */
    amount: string;
    direction: 'INCREASE' | 'DECREASE';
    /** Signed, two decimals, half-up. Null when the previous value is zero. */
    percentage: string | null;
    /** Signed change in annual cash compensation (base + bonus). */
    annualCashImpact: string;
  };
}

const cash = (base: string, bonus: string): string => addMoney(base, bonus);

function checkBandPercentage(band: SalaryBand, method: AdjustmentMethod, value: string): void {
  if (!isPercentageMethod(method)) return;
  // The calculator has already enforced the product-wide limits and the format.
  const percent = Number(value);
  const [min, max] = method === 'PERCENTAGE_INCREASE'
    ? [band.minPercentageIncrease, band.maxPercentageIncrease]
    : [band.minPercentageDecrease, band.maxPercentageDecrease];
  if (percent < min || percent > max) {
    throw new AdjustmentError('PERCENTAGE_RANGE', `For this salary band the percentage must be from ${min} to ${max}.`);
  }
}

function checkBandAmounts(band: SalaryBand, proposed: { annualBaseSalary: string; annualBonus: string }, currency: Currency): void {
  if (band.currency !== currency) throw new AdjustmentError('SALARY_BAND', 'No salary band matches this compensation currency.');
  const base = parseMoney(proposed.annualBaseSalary);
  if (base < parseMoney(band.minAnnualBaseSalary) || base > parseMoney(band.maxAnnualBaseSalary)) {
    throw new AdjustmentError(
      'SALARY_BAND',
      `Annual base salary must be between ${band.minAnnualBaseSalary} and ${band.maxAnnualBaseSalary} ${currency} for this salary band.`,
    );
  }
  if (parseMoney(proposed.annualBonus) > parseMoney(band.maxAnnualBonus)) {
    throw new AdjustmentError('SALARY_BAND', `Annual bonus must not exceed ${band.maxAnnualBonus} ${currency} for this salary band.`);
  }
}

export function planAdjustment({ current, band, target, method, value }: {
  current: CompensationValues;
  band: SalaryBand;
  target: AdjustmentTarget;
  method: AdjustmentMethod;
  value: string;
}): AdjustmentPlan {
  const previousTargetValue = target === 'BASE_SALARY' ? current.annualBaseSalary : current.annualBonus;
  if (target === 'ANNUAL_BONUS' && isPercentageMethod(method) && parseMoney(previousTargetValue) === 0n) {
    throw new AdjustmentError('ZERO_BONUS_PERCENTAGE', 'A percentage bonus adjustment needs a current bonus above zero. Use a fixed increase or a replacement amount.');
  }
  checkBandPercentage(band, method, value);
  const result = calculateAdjustment({ currentAmount: previousTargetValue, method, value });
  if (target === 'BASE_SALARY' && parseMoney(result.newAmount) === 0n) {
    throw new AdjustmentError('BASE_NOT_POSITIVE', 'Annual base salary must remain greater than zero.');
  }
  const proposedBase = target === 'BASE_SALARY' ? result.newAmount : current.annualBaseSalary;
  const proposedBonus = target === 'ANNUAL_BONUS' ? result.newAmount : current.annualBonus;
  checkBandAmounts(band, { annualBaseSalary: proposedBase, annualBonus: proposedBonus }, current.currency);

  const currentCash = cash(current.annualBaseSalary, current.annualBonus);
  const proposedCash = cash(proposedBase, proposedBonus);
  return {
    target,
    method,
    value: isPercentageMethod(method) ? value : normalizeAmountInput(value),
    currency: current.currency,
    previousTargetValue,
    proposedTargetValue: result.newAmount,
    current: { annualBaseSalary: current.annualBaseSalary, annualBonus: current.annualBonus, annualCashCompensation: currentCash },
    proposed: { annualBaseSalary: proposedBase, annualBonus: proposedBonus, annualCashCompensation: proposedCash },
    change: {
      amount: subtractMoney(result.newAmount, previousTargetValue),
      direction: result.direction,
      percentage: percentageChange(previousTargetValue, result.newAmount),
      annualCashImpact: subtractMoney(proposedCash, currentCash),
    },
  };
}
