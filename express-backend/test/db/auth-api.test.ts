import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from 'jose';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser, setCountryScopes, setHrUserStatus } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import { fakeSalaryAdjustments, noModelAssistant } from '../support/http.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

// Refuses to run unless DATABASE_URL names a database ending in _test.
const DATABASE_URL = testDatabaseUrl();

// Synthetic test-only values. One shared demo-style password, as approved.
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const SHARED_PASSWORD = 'synthetic-shared-demo-password';
const LOGIN = '/api/v1/auth/login';
const ME = '/api/v1/auth/me';
const LOGOUT = '/api/v1/auth/logout';

let pool: Pool;
let now: Date;
const clock = (): Date => now;
let meeraId: number;
let rohanId: number;
let logs: LogEntry[];
let app: ReturnType<typeof createApp>;

const login = (email: string, password: string) => request(app).post(LOGIN).send({ email, password });
const me = (token: string) => request(app).get(ME).set('Authorization', `Bearer ${token}`);
const logout = (token: string) => request(app).post(LOGOUT).set('Authorization', `Bearer ${token}`);
async function tokenFor(email: string): Promise<string> {
  const res = await login(email, SHARED_PASSWORD);
  assert.equal(res.status, 200, res.text);
  return String(res.body.token);
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  const connection = await pool.getConnection();
  try {
    await ensureReferenceData(connection);
  } finally {
    connection.release();
  }
  meeraId = await bootstrapHrUser(pool, {
    email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: SHARED_PASSWORD, role: 'ADMIN', countries: [], departments: [],
  });
  rohanId = await bootstrapHrUser(pool, {
    email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: SHARED_PASSWORD, role: 'SCOPED',
    countries: ['IN'], departments: ['Tech', 'Support'],
  });
  const inactiveId = await bootstrapHrUser(pool, {
    email: 'inactive.person@acme.com', displayName: 'Inactive Person', password: SHARED_PASSWORD, role: 'SCOPED',
    countries: [], departments: [],
  });
  await setHrUserStatus(pool, { actorHrUserId: meeraId, targetHrUserId: inactiveId, status: 'INACTIVE' });
});
after(async () => {
  await pool?.end();
});
beforeEach(() => {
  now = new Date('2026-11-14T10:00:00.000Z');
  logs = [];
  const tokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  // The session clock is fixed; the rate-limit clock stays on real time
  // (express-rate-limit compares its reset time with Date.now()).
  const directory = createDirectoryService({ pool, exchangeRate: null, clock });
  app = createApp({
    auth: createAuthService({ pool, tokens, clock }),
    directory,
    ...noModelAssistant(directory), salaryAdjustments: fakeSalaryAdjustments(),
    logger: (entry) => logs.push(entry),
    clientIpSource: 'socket',
  });
});

describe('POST /api/v1/auth/login with real sessions', () => {
  // Detects: wrong expiry, wrong role, or missing user summary.
  test('Meera receives a token, a two-hour expiry, and an Admin summary', async () => {
    const res = await login('meera.iyer@acme.com', SHARED_PASSWORD);
    assert.equal(res.status, 200);
    assert.deepEqual({ ...res.body, token: typeof res.body.token }, {
      token: 'string',
      expiresAt: '2026-11-14T12:00:00.000Z',
      user: { id: meeraId, displayName: 'Meera Iyer', email: 'meera.iyer@acme.com', role: 'ADMIN' },
    });
    assert.equal(decodeJwt(String(res.body.token)).sub, String(meeraId));
  });

  test('Rohan receives a token and a Scoped summary', async () => {
    const res = await login('rohan.mehta@acme.com', SHARED_PASSWORD);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.user, { id: rohanId, displayName: 'Rohan Mehta', email: 'rohan.mehta@acme.com', role: 'SCOPED' });
  });

  // Detects: responses that differ between unknown email, wrong password, and inactive user.
  test('unknown email, wrong password, and inactive user return the identical public response', async () => {
    const responses = [
      await login('nobody@acme.com', SHARED_PASSWORD),
      await login('meera.iyer@acme.com', 'wrong-password-value'),
      await login('inactive.person@acme.com', SHARED_PASSWORD),
    ];
    for (const res of responses) {
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    }
    assert.equal(new Set(responses.map((r) => r.text)).size, 1);
  });

  // Detects: password hash, status internals, or scopes in the login response.
  test('the login response contains no hash, status, or scopes', async () => {
    const res = await login('rohan.mehta@acme.com', SHARED_PASSWORD);
    assert.doesNotMatch(res.text, /argon2|password|status|countries|departments|IN"|Tech/);
  });
});

describe('GET /api/v1/auth/me with real sessions', () => {
  test('the Admin response has the current role and empty scope lists', async () => {
    const res = await me(await tokenFor('meera.iyer@acme.com'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      user: { id: meeraId, displayName: 'Meera Iyer', email: 'meera.iyer@acme.com', role: 'ADMIN', status: 'ACTIVE' },
      scope: { countries: [], departments: [] },
      session: { expiresAt: '2026-11-14T12:00:00.000Z' },
    });
  });

  test('the Scoped response has the current country and department lists', async () => {
    const res = await me(await tokenFor('rohan.mehta@acme.com'));
    assert.deepEqual(res.body.scope, { countries: ['IN'], departments: ['Support', 'Tech'] });
  });

  // Detects: scopes cached in the token or the app.
  test('a scope change appears on the next /me request with the same JWT', async () => {
    const token = await tokenFor('rohan.mehta@acme.com');
    await setCountryScopes(pool, { actorHrUserId: meeraId, targetHrUserId: rohanId, countries: ['IN', 'US'] });
    try {
      assert.deepEqual((await me(token)).body.scope.countries, ['IN', 'US']);
    } finally {
      await setCountryScopes(pool, { actorHrUserId: meeraId, targetHrUserId: rohanId, countries: ['IN'] });
    }
  });

  // Detects: deactivation that waits for the token to expire.
  test('HR deactivation blocks the next /me request', async () => {
    const token = await tokenFor('rohan.mehta@acme.com');
    assert.equal((await me(token)).status, 200);
    await setHrUserStatus(pool, { actorHrUserId: meeraId, targetHrUserId: rohanId, status: 'INACTIVE' });
    try {
      const res = await me(token);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    } finally {
      await setHrUserStatus(pool, { actorHrUserId: meeraId, targetHrUserId: rohanId, status: 'ACTIVE' });
    }
  });

  // Detects: secrets or internals in the /me response.
  test('the response contains no hash, JWT, session ID, or audit data', async () => {
    const token = await tokenFor('meera.iyer@acme.com');
    const res = await me(token);
    const sid = String(decodeJwt(token).sid);
    for (const forbidden of [token, sid, 'argon2', 'password', 'audit', 'HR_USER_CREATED']) {
      assert.ok(!res.text.includes(forbidden), `response contains ${forbidden}`);
    }
  });

  // Detects: every real internal failure reason leaking or producing different bodies.
  test('invalid signature, expiry, missing, revoked, and inactive sessions return one identical body', async () => {
    const otherSigner = createSessionTokens({ signingKey: 'test-only-other-signing-key-0123456789', clock });
    const forged = await otherSigner.sign({ hrUserId: meeraId, sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10', issuedAt: now });
    const realSigner = createSessionTokens({ signingKey: SIGNING_KEY, clock });
    const orphan = await realSigner.sign({ hrUserId: meeraId, sessionId: '1b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10', issuedAt: now });
    const revoked = await tokenFor('meera.iyer@acme.com');
    assert.equal((await logout(revoked)).status, 204);
    const expiring = await tokenFor('meera.iyer@acme.com');

    const bodies: string[] = [];
    for (const token of [forged, orphan, revoked]) bodies.push((await me(token)).text);
    now = new Date('2026-11-14T12:00:00.000Z');
    bodies.push((await me(expiring)).text);
    assert.deepEqual([...new Set(bodies)], [JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } })]);
    assert.doesNotMatch(bodies.join(''), /INVALID_TOKEN|SESSION_|USER_INACTIVE/);
  });
});

describe('POST /api/v1/auth/logout with real sessions', () => {
  // Detects: logout that does not revoke the database session.
  test('revokes the matching database session, and the token then fails on /me', async () => {
    const token = await tokenFor('meera.iyer@acme.com');
    now = new Date('2026-11-14T10:20:00.000Z');
    const res = await logout(token);
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
    const [row] = await selectRows(pool, 'SELECT revoked_at FROM hr_sessions WHERE id = ?', [String(decodeJwt(token).sid)]);
    assert.equal(must(row, 'the session row').revoked_at, '2026-11-14 10:20:00.000');
    assert.equal((await me(token)).status, 401);
  });

  // Detects: a retry after a network failure being reported as an error.
  test('repeated logout returns success while the JWT is still valid', async () => {
    const token = await tokenFor('meera.iyer@acme.com');
    assert.equal((await logout(token)).status, 204);
    assert.equal((await logout(token)).status, 204);
  });

  // Detects: a user revoking someone else's session with a crafted token.
  test("cannot revoke another user's session", async () => {
    const meeraToken = await tokenFor('meera.iyer@acme.com');
    const signer = createSessionTokens({ signingKey: SIGNING_KEY, clock });
    const crafted = await signer.sign({ hrUserId: rohanId, sessionId: String(decodeJwt(meeraToken).sid), issuedAt: now });
    assert.equal((await logout(crafted)).status, 204);
    assert.equal((await me(meeraToken)).status, 200);
  });
});

describe('logs with real sessions', () => {
  // Detects: credentials or tokens reaching the log during real sign-in.
  test('logs contain no password, hash, token, or database URL', async () => {
    const token = await tokenFor('meera.iyer@acme.com');
    await me(token);
    await logout(token);
    await login('meera.iyer@acme.com', 'wrong-password-value');
    const text = JSON.stringify(logs);
    for (const secret of [SHARED_PASSWORD, 'wrong-password-value', token, 'argon2', DATABASE_URL, 'acme_local']) {
      assert.ok(!text.includes(secret), 'log contains a secret value');
    }
    assert.deepEqual(logs.map((l) => `${String(l.method)} ${String(l.status)}`), ['POST 200', 'GET 200', 'POST 204', 'POST 401']);
  });
});
