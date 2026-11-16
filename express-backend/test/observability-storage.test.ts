import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scrubSecrets, boundedJson, PersistenceValidationError, validateTraceTransition, validateReview } from '../src/assistant/observability/validation.js';
import { parseRetentionArgs, retentionCutoff } from '../src/assistant/observability/retention.js';

test('scrubs forbidden keys recursively without changing input or salary evidence', () => {
  const input = { employeeCode: 'ACME00001', salary: '100.00', nested: [{ authorization: 'Bearer fake', passwordHash: 'fake', api_key: 'fake', dbUrl: 'mysql://fake', databaseCredentials: 'fake', sessionToken: 'fake', cookie: 'fake', token: 'fake', encryptedReasoning: 'fake', name: 'Synthetic Person' }] };
  const copy = structuredClone(input);
  const scrubbed = scrubSecrets(input) as Record<string, unknown>;
  assert.deepEqual(input, copy);
  assert.equal(scrubbed.employeeCode, 'ACME00001');
  assert.equal(scrubbed.salary, '100.00');
  assert.deepEqual(scrubbed.nested, [{ authorization: '[REDACTED]', passwordHash: '[REDACTED]', api_key: '[REDACTED]', dbUrl: '[REDACTED]', databaseCredentials: '[REDACTED]', sessionToken: '[REDACTED]', cookie: '[REDACTED]', token: '[REDACTED]', encryptedReasoning: '[REDACTED]', name: 'Synthetic Person' }]);
});

test('bounded JSON rejects oversize and unsupported objects without truncation', () => {
  assert.throws(() => boundedJson({ value: 'x'.repeat(50) }, 20), PersistenceValidationError);
  assert.throws(() => boundedJson(new Error('do not serialize'), 100), PersistenceValidationError);
  assert.equal(boundedJson({ value: 'ok' }, 100), '{"value":"ok"}');
});

test('trace transition permits one terminal change only', () => {
  validateTraceTransition('STARTED', 'COMPLETED');
  validateTraceTransition('STARTED', 'FAILED');
  assert.throws(() => validateTraceTransition('COMPLETED', 'FAILED'), PersistenceValidationError);
  assert.throws(() => validateTraceTransition('STARTED', 'STARTED'), PersistenceValidationError);
});

test('review accepts only approved verdict and bounded note', () => {
  validateReview('CORRECT', 'ok');
  assert.throws(() => validateReview('OTHER', 'ok'), PersistenceValidationError);
  assert.throws(() => validateReview('PARTIAL', 'x'.repeat(2001)), PersistenceValidationError);
});

test('retention arguments default dry-run and guard destructive execution', () => {
  assert.deepEqual(parseRetentionArgs(['--retention-days', '30'], false), { days: 30, execute: false });
  assert.throws(() => parseRetentionArgs([], false), PersistenceValidationError);
  assert.throws(() => parseRetentionArgs(['--retention-days', '29', '--execute'], false), PersistenceValidationError);
  assert.deepEqual(parseRetentionArgs(['--retention-days', '29', '--allow-short-retention', '--execute'], false), { days: 29, execute: true });
  assert.throws(() => parseRetentionArgs(['--retention-days', '30', '--execute'], true), PersistenceValidationError);
  assert.deepEqual(parseRetentionArgs(['--retention-days', '30', '--execute', '--acknowledge-production'], true), { days: 30, execute: true });
});

test('retention cutoff uses an injected clock and whole days', () => {
  assert.equal(retentionCutoff(30, new Date('2026-11-16T12:00:00.000Z')), '2026-10-17 12:00:00.000');
});
