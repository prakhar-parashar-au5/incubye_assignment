import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, decodeJwt } from 'jose';

import { PREVIEW_TTL_SECONDS, PreviewTokenError, commandDigest, createPreviewTokens } from '../src/compensation/preview-token.js';
import type { PreviewBinding } from '../src/compensation/preview-token.js';
import { createSessionTokens } from '../src/access/session-tokens.js';

const KEY = 'test-only-signing-key-0123456789abcdef';
const T0 = new Date('2026-11-15T10:00:00.000Z');

const BINDING: PreviewBinding = {
  actorHrUserId: 7,
  sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10',
  employeeCode: 'ACME00001',
  confirmationMode: 'DIRECT_APPLY',
  expectedCompensationVersion: 3,
  baseCompensationVersion: 2,
  command: { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '5', effectiveFrom: '2026-11-15', reason: 'PERFORMANCE', note: null },
  proposed: { annualBaseSalary: '3178035.00', annualBonus: '531185.85' },
};

function tokens(now = T0) {
  let current = now;
  const service = createPreviewTokens({ signingKey: KEY, clock: () => current });
  return { service, setNow: (d: Date) => { current = d; } };
}

describe('preview token', () => {
  test('round-trips a binding and expires five minutes after signing', async () => {
    const { service } = tokens();
    const { token, expiresAt } = await service.sign(BINDING);
    assert.equal(PREVIEW_TTL_SECONDS, 300);
    assert.equal(expiresAt.toISOString(), '2026-11-15T10:05:00.000Z');
    assert.deepEqual(await service.verify(token, { actorHrUserId: 7, sessionId: BINDING.sessionId, employeeCode: 'ACME00001', confirmationMode: 'DIRECT_APPLY' }), {
      expectedCompensationVersion: 3,
      baseCompensationVersion: 2,
      digest: commandDigest(BINDING),
    });
  });

  // Detects: salary values, notes, or the command readable from the browser-held token.
  test('carries only identifiers, versions, mode, and a digest', async () => {
    const { token } = await tokens().service.sign({ ...BINDING, command: { ...BINDING.command, note: 'leak-check-note' } });
    const claims = decodeJwt(token);
    assert.deepEqual(Object.keys(claims).sort(), ['aud', 'bv', 'dig', 'emp', 'exp', 'iat', 'iss', 'mode', 'sid', 'sub', 'ver']);
    assert.doesNotMatch(token + JSON.stringify(claims), /3178035|531185|leak-check|PERFORMANCE/);
  });

  // Detects: a token accepted after its five minutes.
  test('rejects a token at and after expiry', async () => {
    const { service, setNow } = tokens();
    const { token } = await service.sign(BINDING);
    const expect = { actorHrUserId: 7, sessionId: BINDING.sessionId, employeeCode: 'ACME00001', confirmationMode: 'DIRECT_APPLY' as const };
    setNow(new Date('2026-11-15T10:04:59.000Z'));
    await service.verify(token, expect);
    setNow(new Date('2026-11-15T10:05:00.000Z'));
    await assert.rejects(service.verify(token, expect), (e: unknown) => e instanceof PreviewTokenError && e.reason === 'PREVIEW_EXPIRED');
  });

  // Detects: a token used by another HR user, another session, employee, or mode.
  test('belongs to one actor, session, employee, and confirmation mode', async () => {
    const { service } = tokens();
    const { token } = await service.sign(BINDING);
    const base = { actorHrUserId: 7, sessionId: BINDING.sessionId, employeeCode: 'ACME00001', confirmationMode: 'DIRECT_APPLY' as const };
    for (const wrong of [
      { ...base, actorHrUserId: 8 },
      { ...base, sessionId: '1b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10' },
      { ...base, employeeCode: 'ACME00002' },
      { ...base, confirmationMode: 'SUBMIT_REQUEST' as const },
    ]) {
      await assert.rejects(service.verify(token, wrong), (e: unknown) => e instanceof PreviewTokenError && e.reason === 'PREVIEW_INVALID', JSON.stringify(wrong));
    }
  });

  // Detects: a tampered, foreign-signed, or session-JWT token accepted as a preview.
  test('rejects tampered tokens, other keys, and session JWTs', async () => {
    const { service } = tokens();
    const { token } = await service.sign(BINDING);
    const expect = { actorHrUserId: 7, sessionId: BINDING.sessionId, employeeCode: 'ACME00001', confirmationMode: 'DIRECT_APPLY' as const };
    const [h, p, s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...decodeJwt(token), ver: 99 })).toString('base64url');
    const other = createPreviewTokens({ signingKey: 'test-only-other-signing-key-0123456789', clock: () => T0 });
    const session = await createSessionTokens({ signingKey: KEY, clock: () => T0 }).sign({ hrUserId: 7, sessionId: BINDING.sessionId, issuedAt: T0 });
    // Signed with the raw session key (not the derived preview key) and preview-shaped claims.
    const rawKeyToken = await new SignJWT({ ...decodeJwt(token) }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(KEY));
    for (const bad of [`${h}.${forgedPayload}.${s}`, `${h}.${p}.${s}x`, (await other.sign(BINDING)).token, session, rawKeyToken, 'not-a-token', '']) {
      await assert.rejects(service.verify(bad, expect), (e: unknown) => e instanceof PreviewTokenError && e.reason === 'PREVIEW_INVALID');
    }
  });

  // Detects: the replay check skipping signature or binding checks along with expiry.
  test('verifyIgnoringExpiry accepts only an authentic, bound token whose time has passed', async () => {
    const { service, setNow } = tokens();
    const { token } = await service.sign(BINDING);
    const expect = { actorHrUserId: 7, sessionId: BINDING.sessionId, employeeCode: 'ACME00001', confirmationMode: 'DIRECT_APPLY' as const };
    setNow(new Date('2026-11-16T10:00:00.000Z'));
    await assert.rejects(service.verify(token, expect), (e: unknown) => e instanceof PreviewTokenError && e.reason === 'PREVIEW_EXPIRED');
    assert.deepEqual(await service.verifyIgnoringExpiry(token, expect), { expectedCompensationVersion: 3, baseCompensationVersion: 2, digest: commandDigest(BINDING) });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), ver: 99 })).toString('base64url');
    for (const [bad, expected] of [[`${h}.${forged}.${s}`, expect], ['not-a-token', expect], [token, { ...expect, actorHrUserId: 8 }], [token, { ...expect, confirmationMode: 'SUBMIT_REQUEST' as const }]] as const) {
      await assert.rejects(service.verifyIgnoringExpiry(bad, expected), (e: unknown) => e instanceof PreviewTokenError && e.reason === 'PREVIEW_INVALID');
    }
  });

  // Detects: a digest that ignores a field, so a changed field would pass confirmation.
  test('the digest changes when any bound field changes', () => {
    const original = commandDigest(BINDING);
    const variants: PreviewBinding[] = [
      { ...BINDING, command: { ...BINDING.command, value: '6' } },
      { ...BINDING, command: { ...BINDING.command, method: 'FIXED_INCREASE' } },
      { ...BINDING, command: { ...BINDING.command, target: 'ANNUAL_BONUS' } },
      { ...BINDING, command: { ...BINDING.command, effectiveFrom: '2026-11-16' } },
      { ...BINDING, command: { ...BINDING.command, reason: 'PROMOTION' } },
      { ...BINDING, command: { ...BINDING.command, note: 'x' } },
      { ...BINDING, proposed: { ...BINDING.proposed, annualBaseSalary: '3178035.01' } },
      { ...BINDING, proposed: { ...BINDING.proposed, annualBonus: '0.00' } },
      { ...BINDING, expectedCompensationVersion: 4 },
      { ...BINDING, baseCompensationVersion: 3 },
      { ...BINDING, employeeCode: 'ACME00002' },
      { ...BINDING, actorHrUserId: 8 },
      { ...BINDING, confirmationMode: 'SUBMIT_REQUEST' },
    ];
    for (const variant of variants) assert.notEqual(commandDigest(variant), original, JSON.stringify(variant));
    assert.equal(commandDigest({ ...BINDING }), original);
  });
});
