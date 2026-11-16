import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planAdjustment } from '../src/compensation/plan.js';
import type { SalaryBand } from '../src/compensation/plan.js';

// India / SENIOR band from the approved synthetic ranges.
const BAND: SalaryBand = {
  currency: 'INR',
  minAnnualBaseSalary: '1800000.00',
  maxAnnualBaseSalary: '3800000.00',
  maxAnnualBonus: '1000000.00',
  minPercentageIncrease: 1,
  maxPercentageIncrease: 200,
  minPercentageDecrease: 1,
  maxPercentageDecrease: 50,
};
const CURRENT = { annualBaseSalary: '3026700.00', annualBonus: '531185.85', currency: 'INR' as const };

const plan = (target: 'BASE_SALARY' | 'ANNUAL_BONUS', method: string, value: string, overrides: { current?: typeof CURRENT; band?: SalaryBand } = {}) =>
  planAdjustment({ current: overrides.current ?? CURRENT, band: overrides.band ?? BAND, target, method: method as 'REPLACEMENT', value });
const rejects = (fn: () => unknown, reason: string) => assert.throws(fn, { name: 'AdjustmentError', reason });

describe('planAdjustment', () => {
  // Detects: a base adjustment that also changes the bonus, or cash computed with floats.
  test('a base-salary adjustment keeps the bonus unchanged and reports exact cash impact', () => {
    assert.deepEqual(plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '10'), {
      target: 'BASE_SALARY',
      method: 'PERCENTAGE_INCREASE',
      value: '10',
      currency: 'INR',
      previousTargetValue: '3026700.00',
      proposedTargetValue: '3329370.00',
      current: { annualBaseSalary: '3026700.00', annualBonus: '531185.85', annualCashCompensation: '3557885.85' },
      proposed: { annualBaseSalary: '3329370.00', annualBonus: '531185.85', annualCashCompensation: '3860555.85' },
      change: { amount: '302670.00', direction: 'INCREASE', percentage: '10.00', annualCashImpact: '302670.00' },
    });
  });

  // Detects: a bonus adjustment that changes base salary; negative impact sign lost.
  test('a bonus adjustment keeps base salary unchanged', () => {
    const result = plan('ANNUAL_BONUS', 'FIXED_DECREASE', '31185.85');
    assert.deepEqual(result.proposed, { annualBaseSalary: '3026700.00', annualBonus: '500000.00', annualCashCompensation: '3526700.00' });
    assert.deepEqual(result.change, { amount: '-31185.85', direction: 'DECREASE', percentage: '-5.87', annualCashImpact: '-31185.85' });
    assert.equal(result.value, '31185.85');
  });

  // Detects: zero bonus accepting a percentage (a silent no-op) or rejecting a fixed amount.
  test('zero bonus: fixed increase and replacement work, percentages are rejected', () => {
    const zero = { ...CURRENT, annualBonus: '0.00' };
    assert.equal(plan('ANNUAL_BONUS', 'FIXED_INCREASE', '1000', { current: zero }).proposedTargetValue, '1000.00');
    assert.equal(plan('ANNUAL_BONUS', 'REPLACEMENT', '2500.50', { current: zero }).proposedTargetValue, '2500.50');
    assert.equal(plan('ANNUAL_BONUS', 'FIXED_INCREASE', '1000', { current: zero }).change.percentage, null);
    rejects(() => plan('ANNUAL_BONUS', 'PERCENTAGE_INCREASE', '10', { current: zero }), 'ZERO_BONUS_PERCENTAGE');
    rejects(() => plan('ANNUAL_BONUS', 'PERCENTAGE_DECREASE', '10', { current: zero }), 'ZERO_BONUS_PERCENTAGE');
  });

  test('a bonus can be reduced to zero', () => {
    assert.equal(plan('ANNUAL_BONUS', 'REPLACEMENT', '0').proposedTargetValue, '0.00');
  });

  // Detects: a base salary of zero or below reaching the database.
  test('base salary must stay above zero', () => {
    rejects(() => plan('BASE_SALARY', 'REPLACEMENT', '0'), 'BASE_NOT_POSITIVE');
    rejects(() => plan('BASE_SALARY', 'FIXED_DECREASE', '3026700.00'), 'BASE_NOT_POSITIVE');
    rejects(() => plan('BASE_SALARY', 'FIXED_DECREASE', '3026700.01'), 'NEGATIVE_RESULT');
  });

  test('a replacement equal to the current value is rejected', () => {
    rejects(() => plan('BASE_SALARY', 'REPLACEMENT', '3026700'), 'NO_CHANGE');
    rejects(() => plan('ANNUAL_BONUS', 'REPLACEMENT', '531185.85'), 'NO_CHANGE');
  });

  // Detects: band limits enforced only by the frontend, or off-by-one band edges.
  test('rejects base salary outside the band and accepts both band edges', () => {
    assert.equal(plan('BASE_SALARY', 'REPLACEMENT', '3800000.00').proposedTargetValue, '3800000.00');
    assert.equal(plan('BASE_SALARY', 'REPLACEMENT', '1800000').proposedTargetValue, '1800000.00');
    rejects(() => plan('BASE_SALARY', 'REPLACEMENT', '3800000.01'), 'SALARY_BAND');
    rejects(() => plan('BASE_SALARY', 'REPLACEMENT', '1799999.99'), 'SALARY_BAND');
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '30'), 'SALARY_BAND');
  });

  test('rejects a bonus above the band maximum', () => {
    assert.equal(plan('ANNUAL_BONUS', 'REPLACEMENT', '1000000').proposedTargetValue, '1000000.00');
    rejects(() => plan('ANNUAL_BONUS', 'REPLACEMENT', '1000000.01'), 'SALARY_BAND');
  });

  // Detects: band percentage limits ignored.
  test('a band can narrow the percentage limits', () => {
    const narrow = { ...BAND, minPercentageIncrease: 2, maxPercentageIncrease: 15, minPercentageDecrease: 3, maxPercentageDecrease: 10 };
    assert.equal(plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '15', { band: narrow }).proposedTargetValue, '3480705.00');
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '16', { band: narrow }), 'PERCENTAGE_RANGE');
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '1', { band: narrow }), 'PERCENTAGE_RANGE');
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_DECREASE', '11', { band: narrow }), 'PERCENTAGE_RANGE');
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_DECREASE', '2', { band: narrow }), 'PERCENTAGE_RANGE');
  });

  // Detects: a USD band applied to INR compensation.
  test('a band in another currency is rejected', () => {
    rejects(() => plan('BASE_SALARY', 'PERCENTAGE_INCREASE', '5', { band: { ...BAND, currency: 'USD' } }), 'SALARY_BAND');
  });
});
