import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';

import {
  SESSION_TTL_SECONDS,
  createSessionTokens,
  readSigningKey,
} from '../src/access/session-tokens.js';
import { thrown } from './support/thrown.js';

// Synthetic test keys (32+ bytes). Not used anywhere else.
const KEY = 'test-only-signing-key-0123456789abcdef';
const OTHER_KEY = 'test-only-other-signing-key-0123456789';
const T0 = new Date('2026-11-14T10:00:00.000Z');
const at = (iso: string) => () => new Date(iso);

const claims = { hrUserId: 7, sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10', issuedAt: T0 };

describe('session tokens', () => {
  // Detects: a different session length than the approved two hours.
  test('sessions last two hours', () => {
    assert.equal(SESSION_TTL_SECONDS, 7200);
  });

  // Detects: role, status, or scopes leaking into the token (stale authority).
  test('the JWT contains only sub, sid, iat, and exp', async () => {
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:00:00.000Z') });
    const token = await tokens.sign(claims);
    assert.deepEqual(decodeJwt(token), {
      sub: '7',
      sid: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10',
      iat: 1794650400,
      exp: 1794657600,
    });
    assert.deepEqual(decodeProtectedHeader(token), { alg: 'HS256' });
  });

  test('a valid token verifies to the HR user and session IDs', async () => {
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T11:59:59.000Z') });
    assert.deepEqual(await tokens.verify(await tokens.sign(claims)), {
      hrUserId: 7,
      sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10',
      expiresAt: new Date('2026-11-14T12:00:00.000Z'),
    });
  });

  // Detects: tokens accepted from any signer.
  test('an invalid signature fails', async () => {
    const forged = await createSessionTokens({ signingKey: OTHER_KEY, clock: at('2026-11-14T10:00:00.000Z') }).sign(claims);
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:30:00.000Z') });
    await assert.rejects(tokens.verify(forged), { code: 'INVALID_TOKEN' });
  });

  // Detects: expiry not checked, or checked against the computer clock.
  test('an expired token fails at and after exactly two hours', async () => {
    const token = await createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:00:00.000Z') }).sign(claims);
    for (const now of ['2026-11-14T12:00:00.000Z', '2026-11-15T10:00:00.000Z']) {
      await assert.rejects(createSessionTokens({ signingKey: KEY, clock: at(now) }).verify(token), { code: 'INVALID_TOKEN' }, now);
    }
  });

  // Detects: algorithm confusion, e.g. an unsigned "alg: none" token.
  test('an unsigned or differently signed token fails', async () => {
    const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const unsigned = `${encode({ alg: 'none' })}.${encode({ sub: '7', sid: claims.sessionId, iat: 1794650400, exp: 1794657600 })}.`;
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:30:00.000Z') });
    await assert.rejects(tokens.verify(unsigned), { code: 'INVALID_TOKEN' });
    const hs512 = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('7').setIssuedAt(1794650400).setExpirationTime(1794657600)
      .sign(new TextEncoder().encode(KEY));
    await assert.rejects(tokens.verify(hs512), { code: 'INVALID_TOKEN' });
  });

  // Detects: a correctly signed token carrying extra authority claims being trusted.
  test('a token with an extra or missing claim fails', async () => {
    const key = new TextEncoder().encode(KEY);
    const base = () => new SignJWT({ sid: claims.sessionId }).setProtectedHeader({ alg: 'HS256' })
      .setSubject('7').setIssuedAt(1794650400).setExpirationTime(1794657600);
    const withRole = await new SignJWT({ sid: claims.sessionId, role: 'ADMIN' }).setProtectedHeader({ alg: 'HS256' })
      .setSubject('7').setIssuedAt(1794650400).setExpirationTime(1794657600).sign(key);
    const noSid = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
      .setSubject('7').setIssuedAt(1794650400).setExpirationTime(1794657600).sign(key);
    const badSub = await new SignJWT({ sid: claims.sessionId }).setProtectedHeader({ alg: 'HS256' })
      .setSubject('seven').setIssuedAt(1794650400).setExpirationTime(1794657600).sign(key);
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:30:00.000Z') });
    assert.ok(await tokens.verify(await base().sign(key))); // control: the base token is valid
    for (const token of [withRole, noSid, badSub]) await assert.rejects(tokens.verify(token), { code: 'INVALID_TOKEN' });
  });

  // Detects: garbage input crashing instead of failing closed.
  test('a malformed token fails', async () => {
    const tokens = createSessionTokens({ signingKey: KEY, clock: at('2026-11-14T10:30:00.000Z') });
    for (const bad of ['', 'abc', 'a.b.c', null, undefined]) {
      await assert.rejects(tokens.verify(bad), { code: 'INVALID_TOKEN' }, String(bad));
    }
  });
});

describe('readSigningKey', () => {
  // Detects: a missing key silently replaced by a default in source code.
  test('reads JWT_SIGNING_KEY from the injected environment', () => {
    assert.equal(readSigningKey({ JWT_SIGNING_KEY: KEY }), KEY);
    assert.throws(() => readSigningKey({}), /JWT_SIGNING_KEY/);
  });

  // Detects: a weak, guessable key accepted.
  test('rejects a key shorter than 32 bytes without printing it', () => {
    assert.throws(() => readSigningKey({ JWT_SIGNING_KEY: 'short-key' }), (error: unknown) => {
      assert.match(thrown(error).message, /32 bytes/);
      assert.ok(!thrown(error).message.includes('short-key'));
      return true;
    });
    assert.throws(() => createSessionTokens({ signingKey: 'short-key' }), /32 bytes/);
  });
});
