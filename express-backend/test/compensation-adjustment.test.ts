import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { calculateAdjustment } from '../src/compensation/adjustment.js';

// The first test is Prakhar's original candidate test, kept as written
// (reformatted to the project style). The rest extend the same intent.

describe('calculateAdjustment', () => {
  test('rounds a percentage increase half-up to the nearest minor unit', () => {
    const result = calculateAdjustment({
      currentAmount: '1000.10',
      method: 'PERCENTAGE_INCREASE',
      value: '5',
    });

    assert.deepEqual(result, {
      currentAmount: '1000.10',
      newAmount: '1050.11',
      changeAmount: '50.01',
      direction: 'INCREASE',
    });
  });

  // Detects: binary floating point (1.15 * 50 / 100 = 0.57499999… in a double).
  test('rounds an exact half cent up where floating point rounds down', () => {
    assert.deepEqual(calculateAdjustment({ currentAmount: '1.15', method: 'PERCENTAGE_INCREASE', value: '50' }), {
      currentAmount: '1.15', newAmount: '1.73', changeAmount: '0.58', direction: 'INCREASE',
    });
    assert.deepEqual(calculateAdjustment({ currentAmount: '0.15', method: 'PERCENTAGE_INCREASE', value: '10' }), {
      currentAmount: '0.15', newAmount: '0.17', changeAmount: '0.02', direction: 'INCREASE',
    });
  });

  // Detects: String(50) producing '50' instead of a two-decimal money string.
  test('returns two-decimal money strings', () => {
    assert.deepEqual(calculateAdjustment({ currentAmount: '1000.00', method: 'PERCENTAGE_INCREASE', value: '5' }), {
      currentAmount: '1000.00', newAmount: '1050.00', changeAmount: '50.00', direction: 'INCREASE',
    });
  });

  // Detects: precision loss above 2^53 minor units (a double holds about 15–16 digits).
  test('stays exact for the largest DECIMAL(15,2) amounts', () => {
    assert.deepEqual(calculateAdjustment({ currentAmount: '4999999999999.99', method: 'PERCENTAGE_INCREASE', value: '100' }), {
      currentAmount: '4999999999999.99', newAmount: '9999999999999.98', changeAmount: '4999999999999.99', direction: 'INCREASE',
    });
  });

  // Detects: rounding the change instead of the result ("round once, after the exact result").
  test('a percentage decrease rounds the new amount half-up', () => {
    // 1000.10 x 95% = 950.095 exactly -> 950.10; the change is 50.00.
    assert.deepEqual(calculateAdjustment({ currentAmount: '1000.10', method: 'PERCENTAGE_DECREASE', value: '5' }), {
      currentAmount: '1000.10', newAmount: '950.10', changeAmount: '50.00', direction: 'DECREASE',
    });
    assert.deepEqual(calculateAdjustment({ currentAmount: '2000000.00', method: 'PERCENTAGE_DECREASE', value: '50' }), {
      currentAmount: '2000000.00', newAmount: '1000000.00', changeAmount: '1000000.00', direction: 'DECREASE',
    });
  });

  test('fixed increase and decrease keep exact two-decimal money', () => {
    assert.deepEqual(calculateAdjustment({ currentAmount: '0.10', method: 'FIXED_INCREASE', value: '0.20' }), {
      currentAmount: '0.10', newAmount: '0.30', changeAmount: '0.20', direction: 'INCREASE',
    });
    assert.deepEqual(calculateAdjustment({ currentAmount: '82600.00', method: 'FIXED_DECREASE', value: '600.5' }), {
      currentAmount: '82600.00', newAmount: '81999.50', changeAmount: '600.50', direction: 'DECREASE',
    });
    assert.deepEqual(calculateAdjustment({ currentAmount: '0.00', method: 'FIXED_INCREASE', value: '2000' }), {
      currentAmount: '0.00', newAmount: '2000.00', changeAmount: '2000.00', direction: 'INCREASE',
    });
  });

  test('replacement sets the amount and reports the direction', () => {
    assert.deepEqual(calculateAdjustment({ currentAmount: '82600.00', method: 'REPLACEMENT', value: '90000' }), {
      currentAmount: '82600.00', newAmount: '90000.00', changeAmount: '7400.00', direction: 'INCREASE',
    });
    assert.deepEqual(calculateAdjustment({ currentAmount: '531185.85', method: 'REPLACEMENT', value: '0' }), {
      currentAmount: '531185.85', newAmount: '0.00', changeAmount: '531185.85', direction: 'DECREASE',
    });
  });

  // Detects: off-by-one percentage limits.
  test('accepts the percentage boundaries 1..200 for increases and 1..50 for decreases', () => {
    for (const [method, value] of [['PERCENTAGE_INCREASE', '1'], ['PERCENTAGE_INCREASE', '200'], ['PERCENTAGE_DECREASE', '1'], ['PERCENTAGE_DECREASE', '50']] as const) {
      assert.equal(calculateAdjustment({ currentAmount: '1000.00', method, value }).currentAmount, '1000.00', `${method} ${value}`);
    }
  });

  test('rejects percentages outside the limits or with decimals', () => {
    const bad: [string, string][] = [
      ['PERCENTAGE_INCREASE', '0'], ['PERCENTAGE_INCREASE', '201'], ['PERCENTAGE_DECREASE', '51'], ['PERCENTAGE_DECREASE', '0'],
      ['PERCENTAGE_INCREASE', '5.5'], ['PERCENTAGE_INCREASE', '-5'], ['PERCENTAGE_INCREASE', '05'], ['PERCENTAGE_INCREASE', '1e2'], ['PERCENTAGE_INCREASE', ''],
    ];
    for (const [method, value] of bad) {
      assert.throws(() => calculateAdjustment({ currentAmount: '1000.00', method: method as 'PERCENTAGE_INCREASE', value }), { name: 'AdjustmentError', reason: 'PERCENTAGE_RANGE' }, `${method} ${value}`);
    }
  });

  test('rejects amounts with more than two decimals, signs, or exponents', () => {
    for (const value of ['1.001', '-1', '+1', '1e3', '', ' 1', '1,000', '0', '0.00']) {
      assert.throws(() => calculateAdjustment({ currentAmount: '1000.00', method: 'FIXED_INCREASE', value }), { name: 'AdjustmentError', reason: 'INVALID_AMOUNT' }, value);
    }
    assert.throws(() => calculateAdjustment({ currentAmount: '1000.0', method: 'FIXED_INCREASE', value: '1' }), { name: 'AdjustmentError', reason: 'INVALID_AMOUNT' });
  });

  // Detects: a decrease that goes below zero.
  test('a fixed decrease cannot produce a negative amount', () => {
    assert.throws(() => calculateAdjustment({ currentAmount: '100.00', method: 'FIXED_DECREASE', value: '100.01' }), { name: 'AdjustmentError', reason: 'NEGATIVE_RESULT' });
  });

  // Detects: a no-op change written as a new compensation version.
  test('rejects a result equal to the current amount', () => {
    assert.throws(() => calculateAdjustment({ currentAmount: '82600.00', method: 'REPLACEMENT', value: '82600' }), { name: 'AdjustmentError', reason: 'NO_CHANGE' });
    // 1% of 0.10 is 0.001, which rounds to no change.
    assert.throws(() => calculateAdjustment({ currentAmount: '0.10', method: 'PERCENTAGE_INCREASE', value: '1' }), { name: 'AdjustmentError', reason: 'NO_CHANGE' });
  });
});
