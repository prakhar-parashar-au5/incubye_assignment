import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { addMoney, addSignedMoney, averageMoney, convertToUsd, parseMoney, subtractMoney } from '../src/money/decimal.js';
import { loadExchangeRate, parseExchangeRateSnapshot } from '../src/directory/exchange-rate.js';
import type { ExchangeRateSnapshot } from '../src/directory/exchange-rate.js';

// Fixed test snapshot. The rate is the saved Federal Reserve H.10 value; the
// expected USD values below were computed independently with `bc`
// (scale=8, amount / 93.9100) and rounded half-up to cents by hand.
const RATE: ExchangeRateSnapshot = {
  baseCurrency: 'USD',
  quoteCurrency: 'INR',
  rate: '93.9100',
  sourceName: 'test source',
  sourceUrl: 'https://example.test/rate',
  effectiveDate: '2026-11-06',
  retrievedAt: '2026-11-14T18:47:36Z',
};

describe('exact money arithmetic', () => {
  // Detects: float addition (0.1 + 0.2 style errors) in annual cash compensation.
  test('adds two-decimal strings exactly', () => {
    assert.equal(addMoney('3026700.00', '531185.85'), '3557885.85');
    assert.equal(addMoney('0.10', '0.20'), '0.30');
    assert.equal(addMoney('9999999999999.99', '0.01'), '10000000000000.00');
    assert.equal(addMoney('82600.00', '0.00'), '82600.00');
  });

  // Detects: database values with a missing or extra decimal place accepted silently.
  test('accepts only exact two-decimal strings', () => {
    for (const bad of ['1', '1.0', '1.000', '-1.00', '1e3', ' 1.00', '', '1,000.00']) {
      assert.throws(() => parseMoney(bad), /two-decimal/, bad);
    }
    assert.equal(parseMoney('1000000.10'), 100000010n);
  });

  // Detects: wrong quote direction (multiplying instead of dividing) or float rounding.
  test('converts INR to USD by dividing by the INR-per-USD rate, half-up to cents', () => {
    assert.equal(convertToUsd('2200000.00', 'INR', RATE), '23426.69'); // bc: 23426.68512405
    assert.equal(convertToUsd('1250000.00', 'INR', RATE), '13310.62'); // bc: 13310.61654775
    assert.equal(convertToUsd('800000.00', 'INR', RATE), '8518.79'); // bc: 8518.79459056
    assert.equal(convertToUsd('0.00', 'INR', RATE), '0.00');
  });

  test('USD values use rate 1 and stay unchanged', () => {
    assert.equal(convertToUsd('82600.00', 'USD', RATE), '82600.00');
    assert.equal(convertToUsd('82600.00', 'USD', null), '82600.00');
  });

  // Detects: INR shown as a USD equivalent without a rate.
  test('INR without a rate has no USD equivalent', () => {
    assert.equal(convertToUsd('2200000.00', 'INR', null), null);
  });

  // Detects: a salary decrease formatted as an error, or float subtraction.
  test('subtracts exactly and keeps the sign', () => {
    assert.equal(subtractMoney('1800000.00', '1500000.00'), '300000.00');
    assert.equal(subtractMoney('1500000.00', '1800000.10'), '-300000.10');
    assert.equal(subtractMoney('0.30', '0.10'), '0.20');
    assert.equal(subtractMoney('5.00', '5.00'), '0.00');
  });

  // Detects: a signed impact (a scheduled decrease) breaking the commitment total.
  test('adds signed two-decimal strings exactly', () => {
    assert.equal(addSignedMoney('1000000.00', '110000.00'), '1110000.00');
    assert.equal(addSignedMoney('127000.00', '-127000.01'), '-0.01');
    assert.equal(addSignedMoney('-0.10', '-0.20'), '-0.30');
    assert.equal(addSignedMoney('0.00', '-0.00'), '0.00');
    assert.throws(() => addSignedMoney('1.0', '1.00'), /two-decimal/);
  });

  // Detects: averages computed with floats or truncated instead of rounded half-up.
  test('averages exactly, half-up to cents', () => {
    assert.equal(averageMoney('10.00', 3), '3.33'); // 3.333…
    assert.equal(averageMoney('0.05', 2), '0.03'); // 0.025 -> half-up
    assert.equal(averageMoney('3557885.85', 1), '3557885.85');
    assert.throws(() => averageMoney('1.00', 0), /count/);
  });
});

describe('exchange-rate snapshot', () => {
  // Detects: a fixture that drifted from the recorded official evidence.
  test('the saved fixture holds the recorded Federal Reserve H.10 values', async () => {
    const snapshot = await loadExchangeRate();
    assert.deepEqual(snapshot, {
      baseCurrency: 'USD',
      quoteCurrency: 'INR',
      rate: '93.9100',
      sourceName: 'Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates (noon buying rates in New York, certified by the Federal Reserve Bank of New York)',
      sourceUrl: 'https://www.federalreserve.gov/releases/h10/20261109/',
      effectiveDate: '2026-11-06',
      retrievedAt: '2026-11-14T18:47:36Z',
    });
  });

  // Detects: an inverted or ambiguous quote direction being accepted.
  test('rejects a snapshot whose direction is not USD base and INR quote', () => {
    const base = { ...RATE, meaning: 'x', evidence: 'x' };
    assert.throws(() => parseExchangeRateSnapshot({ ...base, baseCurrency: 'INR', quoteCurrency: 'USD' }), /exchange-rate/);
    assert.throws(() => parseExchangeRateSnapshot({ ...base, rate: 93.91 }), /exchange-rate/);
    assert.throws(() => parseExchangeRateSnapshot({ ...base, rate: '0' }), /exchange-rate/);
    assert.throws(() => parseExchangeRateSnapshot({ ...base, sourceUrl: 'http://example.test' }), /exchange-rate/);
    assert.throws(() => parseExchangeRateSnapshot({ ...base, effectiveDate: '2026-13-01' }), /exchange-rate/);
  });
});
