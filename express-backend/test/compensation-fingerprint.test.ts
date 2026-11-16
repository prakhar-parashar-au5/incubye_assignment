import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { directCommandFingerprint } from '../src/compensation/fingerprint.js';
import type { DirectCommandIdentity } from '../src/compensation/fingerprint.js';
import { commandDigest } from '../src/compensation/preview-token.js';

const BASE: DirectCommandIdentity = {
  employeeCode: 'ACME00201',
  target: 'BASE_SALARY',
  method: 'PERCENTAGE_INCREASE',
  value: '10',
  effectiveFrom: '2026-11-15',
  reason: 'CORRECTION',
  note: 'leak-check-note-text',
  expectedCompensationVersion: 3,
  baseCompensationVersion: 2,
  confirmationMode: 'DIRECT_APPLY',
};

describe('direct command fingerprint', () => {
  test('is a 64-character SHA-256 hex string and deterministic', () => {
    const fingerprint = directCommandFingerprint(BASE);
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(directCommandFingerprint({ ...BASE }), fingerprint);
  });

  // Detects: a fingerprint that ignores a bound field, so a different command would replay.
  test('changes when any bound field changes, including methods with the same rounded outcome', () => {
    const variants: DirectCommandIdentity[] = [
      { ...BASE, employeeCode: 'ACME00202' },
      { ...BASE, target: 'ANNUAL_BONUS' },
      { ...BASE, method: 'FIXED_INCREASE', value: '150000.00' },
      { ...BASE, value: '11' },
      { ...BASE, effectiveFrom: '2026-11-16' },
      { ...BASE, reason: 'PROMOTION' },
      { ...BASE, note: 'other note' },
      { ...BASE, note: null },
      { ...BASE, expectedCompensationVersion: 4 },
      { ...BASE, baseCompensationVersion: 3 },
      { ...BASE, confirmationMode: 'SUBMIT_REQUEST' },
    ];
    const fingerprints = new Set(variants.map(directCommandFingerprint));
    assert.equal(fingerprints.size, variants.length);
    assert.ok(!fingerprints.has(directCommandFingerprint(BASE)));
  });

  // Detects: delimiter ambiguity ("a|b" + "c" equal to "a" + "b|c").
  test('field boundaries cannot be shifted between fields', () => {
    assert.notEqual(
      directCommandFingerprint({ ...BASE, reason: 'CORRECTION', note: 'x' }),
      directCommandFingerprint({ ...BASE, reason: 'CORRECTION","x', note: '' }),
    );
  });

  // Detects: salary, note, or other plain text stored in the fingerprint column.
  test('contains no plain-text command data', () => {
    const fingerprint = directCommandFingerprint({ ...BASE, method: 'REPLACEMENT', value: '1650000.00' });
    for (const text of ['1650000', 'leak-check', 'ACME', 'CORRECTION', 'REPLACEMENT', '2026']) assert.ok(!fingerprint.includes(text), text);
  });

  // Detects: the fingerprint colliding with the preview-token digest (domain separation).
  test('is domain-separated from the preview-token digest', () => {
    const digest = commandDigest({
      actorHrUserId: 1, sessionId: 's', employeeCode: BASE.employeeCode, confirmationMode: 'DIRECT_APPLY',
      expectedCompensationVersion: 3, baseCompensationVersion: 2,
      command: { target: BASE.target, method: BASE.method, value: BASE.value, effectiveFrom: BASE.effectiveFrom, reason: BASE.reason, note: BASE.note },
      proposed: { annualBaseSalary: '0.00', annualBonus: '0.00' },
    });
    assert.notEqual(directCommandFingerprint(BASE), digest);
  });
});
