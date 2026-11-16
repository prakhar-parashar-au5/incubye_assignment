import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';

import { canAccessEmployee } from '../../src/access/access-policy.js';
import { ensureDemoUsers } from '../../src/access/demo-users.js';
import {
  bootstrapHrUser,
  createHrUser,
  setCountryScopes,
  setDepartmentScopes,
  setHrUserStatus,
} from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import type { AuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { execStatement, selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { must } from '../support/must.js';
import { thrown } from '../support/thrown.js';
import type { Pool, ResultSetHeader } from 'mysql2/promise';

// Refuses to run unless DATABASE_URL names a database ending in _test.
const DATABASE_URL = testDatabaseUrl();

// Synthetic test-only values.
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const ADMIN_PASSWORD = 'synthetic-admin-password-1';
const SCOPED_PASSWORD = 'synthetic-scoped-password-1';

let pool: Pool;
let now: Date;
const clock = (): Date => now;
const setNow = (iso: string): void => {
  now = new Date(iso);
};
let auth: AuthService;
let adminId: number;
let scopedId: number;

const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const exec = (sql: string, params?: unknown[]): Promise<ResultSetHeader> => execStatement(pool, sql, params);
const auditRows = async (targetId: number): Promise<Row[]> => query(
  'SELECT actor_hr_user_id AS actor, action, before_state AS before_, after_state AS after_ FROM access_audit_events WHERE target_hr_user_id = ? ORDER BY id',
  [targetId],
);
const statusOf = (state: unknown): string => String(Reflect.get(Object(state), 'status'));
const count = async (sql: string, params?: unknown[]): Promise<number> => Number(must((await query(sql, params))[0], 'a count row').n);

/** Asserts an authentication failure with a specific internal reason. */
async function assertAuthFails(promise: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const { code, message, reason: actualReason } = thrown(error);
    assert.equal(code, 'UNAUTHENTICATED', message);
    assert.equal(actualReason, reason);
    assert.equal(message, 'authentication required');
    return true;
  });
}

let emailSequence = 0;
const nextEmail = () => `hr.person${++emailSequence}@acme.com`;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  const connection = await pool.getConnection();
  try {
    await ensureReferenceData(connection);
    adminId = await bootstrapHrUser(connection, {
      email: 'admin.one@acme.com', displayName: 'Admin One', password: ADMIN_PASSWORD, role: 'ADMIN', countries: [], departments: [],
    });
    scopedId = await bootstrapHrUser(connection, {
      email: 'scoped.one@acme.com', displayName: 'Scoped One', password: SCOPED_PASSWORD, role: 'SCOPED',
      countries: ['IN'], departments: ['Tech', 'Support'],
    });
  } finally {
    connection.release();
  }
  setNow('2026-11-14T10:00:00.000Z');
  auth = createAuthService({ pool, tokens: createSessionTokens({ signingKey: SIGNING_KEY, clock }), clock });
});
after(async () => {
  await pool?.end();
});
beforeEach(() => setNow('2026-11-14T10:00:00.000Z'));

describe('sign-in and sessions', () => {
  // Detects: a wrong session length, or session times taken from another clock.
  test('valid credentials create a two-hour session', async () => {
    const { token, expiresAt } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    assert.deepEqual(expiresAt, new Date('2026-11-14T12:00:00.000Z'));
    const { sid } = decodeJwt(token);
    const [row] = await query('SELECT hr_user_id, created_at, expires_at, revoked_at FROM hr_sessions WHERE id = ?', [sid]);
    assert.deepEqual(row, {
      hr_user_id: scopedId, created_at: '2026-11-14 10:00:00.000', expires_at: '2026-11-14 12:00:00.000', revoked_at: null,
    });
  });

  // Detects: role or scopes in the token (stale authority after a change).
  test('the JWT contains only the approved claims', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    assert.deepEqual(Object.keys(decodeJwt(token)).sort(), ['exp', 'iat', 'sid', 'sub']);
    assert.equal(decodeJwt(token).sub, String(scopedId));
  });

  // Detects: sign-in errors that reveal whether an email exists or is inactive.
  test('sign-in uses one generic error for unknown email, wrong password, and inactive user', async () => {
    const inactiveId = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Inactive Person', password: 'synthetic-pw-inactive', role: 'SCOPED',
      countries: [], departments: [],
    });
    await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: inactiveId, status: 'INACTIVE' });
    const [{ email: inactiveEmail }] = await query('SELECT email FROM hr_users WHERE id = ?', [inactiveId]);
    const attempts = [
      ['nobody@acme.com', SCOPED_PASSWORD],
      ['scoped.one@acme.com', 'wrong-password'],
      [inactiveEmail, 'synthetic-pw-inactive'],
    ];
    for (const [email, password] of attempts) {
      await assert.rejects(auth.signIn(email, password), (error: unknown) => {
        assert.equal(thrown(error).code, 'INVALID_CREDENTIALS');
        assert.equal(thrown(error).message, 'invalid email or password');
        return true;
      });
    }
  });

  test('sign-in matches the email without case sensitivity', async () => {
    const { token } = await auth.signIn('  Scoped.One@ACME.com ', SCOPED_PASSWORD);
    assert.equal(decodeJwt(token).sub, String(scopedId));
  });

  test('a valid session authenticates to the current HR user and scopes', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    const principal = await auth.authenticate(token);
    assert.deepEqual(
      { ...principal, sessionId: undefined },
      {
        hrUserId: scopedId, email: 'scoped.one@acme.com', displayName: 'Scoped One', role: 'SCOPED', status: 'ACTIVE',
        countries: ['IN'], departments: ['Support', 'Tech'], sessionId: undefined,
        sessionExpiresAt: new Date('2026-11-14T12:00:00.000Z'),
      },
    );
  });

  test('an invalid signature fails', async () => {
    const other = createSessionTokens({ signingKey: 'test-only-other-signing-key-0123456789', clock });
    const forged = await other.sign({ hrUserId: adminId, sessionId: randomUUID(), issuedAt: now });
    await assertAuthFails(auth.authenticate(forged), 'INVALID_TOKEN');
  });

  // Detects: expiry not enforced when time passes (uses the injected clock).
  test('an expired JWT fails', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    setNow('2026-11-14T11:59:59.999Z');
    assert.ok(await auth.authenticate(token));
    setNow('2026-11-14T12:00:00.000Z');
    await assertAuthFails(auth.authenticate(token), 'INVALID_TOKEN');
  });

  // Detects: trusting a validly signed token without a database session.
  test('a missing database session fails', async () => {
    const tokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
    const orphan = await tokens.sign({ hrUserId: scopedId, sessionId: randomUUID(), issuedAt: now });
    await assertAuthFails(auth.authenticate(orphan), 'SESSION_NOT_FOUND');
  });

  // Detects: a session lookup by session ID only (one user's session reused as another's).
  test("a token naming another user's session fails", async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    const tokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
    const swapped = await tokens.sign({ hrUserId: adminId, sessionId: String(decodeJwt(token).sid), issuedAt: now });
    await assertAuthFails(auth.authenticate(swapped), 'SESSION_NOT_FOUND');
  });

  // Detects: the database expiry being ignored while the JWT is still valid.
  test('a session expired in the database fails', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    await exec("UPDATE hr_sessions SET expires_at = '2026-11-14 10:30:00.000' WHERE id = ?", [decodeJwt(token).sid]);
    setNow('2026-11-14T10:30:00.000Z');
    await assertAuthFails(auth.authenticate(token), 'SESSION_EXPIRED');
  });

  // Detects: sign-out that only clears the cookie and leaves the token usable.
  test('sign-out revokes the database session and the token stops working', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    setNow('2026-11-14T10:15:00.000Z');
    assert.deepEqual(await auth.signOut(token), { revoked: true });
    const [row] = await query('SELECT revoked_at FROM hr_sessions WHERE id = ?', [decodeJwt(token).sid]);
    assert.equal(row.revoked_at, '2026-11-14 10:15:00.000');
    await assertAuthFails(auth.authenticate(token), 'SESSION_REVOKED');
    assert.deepEqual(await auth.signOut(token), { revoked: false });
  });
});

describe('current access on every request', () => {
  let personId: number;
  let token: string;
  before(async () => {
    const email = nextEmail();
    personId = await createHrUser(pool, {
      actorHrUserId: adminId, email, displayName: 'Changing Person', password: 'synthetic-pw-changing', role: 'SCOPED',
      countries: ['IN'], departments: ['Tech', 'Support'],
    });
    setNow('2026-11-14T10:00:00.000Z');
    ({ token } = await auth.signIn(email, 'synthetic-pw-changing'));
  });

  // Detects: scopes cached in the token or in memory after sign-in.
  test('a scope addition affects the next authorization check', async () => {
    const usTech = { country_code: 'US', department: 'Tech' };
    assert.equal(canAccessEmployee(await auth.authenticate(token), usTech), false);
    await setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: personId, countries: ['IN', 'US'] });
    assert.equal(canAccessEmployee(await auth.authenticate(token), usTech), true);
  });

  test('a scope removal affects the next authorization check', async () => {
    const inSupport = { country_code: 'IN', department: 'Support' };
    assert.equal(canAccessEmployee(await auth.authenticate(token), inSupport), true);
    await setDepartmentScopes(pool, { actorHrUserId: adminId, targetHrUserId: personId, departments: ['Tech'] });
    assert.equal(canAccessEmployee(await auth.authenticate(token), inSupport), false);
  });

  // Detects: authority read from the JWT instead of the database.
  test('a previously issued JWT does not preserve old scopes', async () => {
    const principal = await auth.authenticate(token);
    assert.deepEqual([principal.countries, principal.departments], [['IN', 'US'], ['Tech']]);
    assert.equal(decodeJwt(token).countries, undefined);
  });

  // Detects: deactivation that only takes effect at the next sign-in.
  test('changing an HR user to inactive blocks the next request', async () => {
    assert.ok(await auth.authenticate(token));
    await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: personId, status: 'INACTIVE' });
    await assertAuthFails(auth.authenticate(token), 'USER_INACTIVE');
  });
});

describe('HR user management authorization', () => {
  // Detects: a scoped HR user creating accounts or widening their own access.
  test('Scoped HR cannot manage HR users', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM hr_users');
    const auditBefore = await count('SELECT COUNT(*) AS n FROM access_audit_events');
    const forbidden = (error: unknown) => thrown(error).code === 'FORBIDDEN';
    await assert.rejects(createHrUser(pool, {
      actorHrUserId: scopedId, email: nextEmail(), displayName: 'Nope', password: 'synthetic-pw-nope', role: 'ADMIN', countries: [], departments: [],
    }), forbidden);
    await assert.rejects(setCountryScopes(pool, { actorHrUserId: scopedId, targetHrUserId: scopedId, countries: ['IN', 'US'] }), forbidden);
    await assert.rejects(setDepartmentScopes(pool, { actorHrUserId: scopedId, targetHrUserId: scopedId, departments: ['HR'] }), forbidden);
    await assert.rejects(setHrUserStatus(pool, { actorHrUserId: scopedId, targetHrUserId: adminId, status: 'INACTIVE' }), forbidden);
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users'), before);
    assert.equal(await count('SELECT COUNT(*) AS n FROM access_audit_events'), auditBefore);
  });

  test('Admin HR can manage HR users', async () => {
    const id = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Managed Person', password: 'synthetic-pw-managed', role: 'SCOPED',
      countries: ['US'], departments: ['HR'],
    });
    assert.ok(id > 0);
  });

  // Detects: an actor's authority read once and trusted after deactivation.
  test('an inactive admin cannot manage HR users', async () => {
    const otherAdmin = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Second Admin', password: 'synthetic-pw-admin2', role: 'ADMIN',
      countries: [], departments: [],
    });
    await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: otherAdmin, status: 'INACTIVE' });
    await assert.rejects(
      setCountryScopes(pool, { actorHrUserId: otherAdmin, targetHrUserId: scopedId, countries: ['US'] }),
      (error: unknown) => thrown(error).code === 'FORBIDDEN',
    );
  });

  // Detects: bad input reaching SQL, or duplicate accounts differing only by case.
  test('rejects invalid HR user input with value-free messages', async () => {
    const base = {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Valid Name', password: 'synthetic-pw-valid', role: 'SCOPED',
      countries: ['IN'], departments: ['Tech'],
    };
    const invalid = (error: unknown) => thrown(error).code === 'INVALID_INPUT' && !thrown(error).message.includes('synthetic-pw-valid');
    await assert.rejects(createHrUser(pool, { ...base, email: 'ADMIN.ONE@acme.com' }), (e: unknown) => thrown(e).code === 'EMAIL_TAKEN');
    await assert.rejects(createHrUser(pool, { ...base, email: 'not-an-email' }), invalid);
    await assert.rejects(createHrUser(pool, { ...base, role: 'SUPERUSER' }), invalid);
    await assert.rejects(createHrUser(pool, { ...base, displayName: ' ' }), invalid);
    await assert.rejects(createHrUser(pool, { ...base, countries: ['GB'] }), (e: unknown) => thrown(e).code === 'INVALID_INPUT' && /GB/.test(thrown(e).message));
    await assert.rejects(createHrUser(pool, { ...base, departments: ['Legal'] }), (e: unknown) => thrown(e).code === 'INVALID_INPUT' && /Legal/.test(thrown(e).message));
    await assert.rejects(createHrUser(pool, { ...base, countries: ['IN', 'IN'] }), invalid);
    await assert.rejects(createHrUser(pool, { ...base, password: '' }), invalid);
  });
});

describe('access audit', () => {
  // Detects: user creation without an audit event, or a wrong actor.
  test('creating an HR user writes one audit event', async () => {
    const id = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Audited Person', password: 'synthetic-pw-audited', role: 'SCOPED',
      countries: ['US', 'IN'], departments: ['Tech'],
    });
    assert.deepEqual(await auditRows(id), [{
      actor: adminId, action: 'HR_USER_CREATED', before_: null,
      after_: { displayName: 'Audited Person', role: 'SCOPED', status: 'ACTIVE', countries: ['IN', 'US'], departments: ['Tech'] },
    }]);
  });

  // Detects: audit rows missing the previous state ("from what to what").
  test('changing country and department scopes writes old and new states', async () => {
    const id = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Scope Change', password: 'synthetic-pw-scope', role: 'SCOPED',
      countries: ['IN'], departments: ['Tech'],
    });
    await setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: id, countries: ['US'] });
    await setDepartmentScopes(pool, { actorHrUserId: adminId, targetHrUserId: id, departments: ['Support', 'Finance'] });
    const rows = await auditRows(id);
    assert.deepEqual(rows.slice(1), [
      {
        actor: adminId, action: 'COUNTRY_SCOPES_CHANGED',
        before_: { displayName: 'Scope Change', role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'] },
        after_: { displayName: 'Scope Change', role: 'SCOPED', status: 'ACTIVE', countries: ['US'], departments: ['Tech'] },
      },
      {
        actor: adminId, action: 'DEPARTMENT_SCOPES_CHANGED',
        before_: { displayName: 'Scope Change', role: 'SCOPED', status: 'ACTIVE', countries: ['US'], departments: ['Tech'] },
        after_: { displayName: 'Scope Change', role: 'SCOPED', status: 'ACTIVE', countries: ['US'], departments: ['Finance', 'Support'] },
      },
    ]);
    const [{ version }] = await query('SELECT version FROM hr_users WHERE id = ?', [id]);
    assert.equal(version, 3);
  });

  test('deactivation and activation write audit events', async () => {
    const id = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'Status Change', password: 'synthetic-pw-status', role: 'SCOPED',
      countries: [], departments: [],
    });
    await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: id, status: 'INACTIVE' });
    await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: id, status: 'ACTIVE' });
    const rows = await auditRows(id);
    assert.deepEqual(rows.slice(1).map((r) => `${String(r.action)}:${statusOf(r.before_)}->${statusOf(r.after_)}`), [
      'HR_USER_DEACTIVATED:ACTIVE->INACTIVE',
      'HR_USER_ACTIVATED:INACTIVE->ACTIVE',
    ]);
  });

  // Detects: no-op changes producing noise in the audit log.
  test('an unchanged value writes no audit event', async () => {
    const id = await createHrUser(pool, {
      actorHrUserId: adminId, email: nextEmail(), displayName: 'No Op', password: 'synthetic-pw-noop', role: 'SCOPED',
      countries: ['IN'], departments: ['Tech'],
    });
    assert.deepEqual(await setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: id, countries: ['IN'] }), { changed: false });
    assert.deepEqual(await setHrUserStatus(pool, { actorHrUserId: adminId, targetHrUserId: id, status: 'ACTIVE' }), { changed: false });
    assert.equal((await auditRows(id)).length, 1);
  });

  // Detects: secrets copied into audit JSON.
  test('audit state never contains a password hash, JWT, or session ID', async () => {
    const { token } = await auth.signIn('scoped.one@acme.com', SCOPED_PASSWORD);
    const rows = await query('SELECT CAST(before_state AS CHAR) AS b, CAST(after_state AS CHAR) AS a FROM access_audit_events');
    const sessionIds = (await query('SELECT id FROM hr_sessions')).map((r) => r.id);
    for (const { a, b } of rows) {
      for (const text of [a, b].filter((v): v is string => typeof v === 'string' && v !== '')) {
        assert.doesNotMatch(text, /argon2|password|token/i);
        assert.ok(!text.includes(token));
        for (const sid of sessionIds) assert.ok(!text.includes(String(sid)));
        const keys = Object.keys(JSON.parse(text)).sort();
        assert.deepEqual(keys, ['countries', 'departments', 'displayName', 'role', 'status']);
      }
    }
  });

  // Detects: the HR change committing even though its audit event failed.
  test('a forced audit insert failure rolls back the HR user or scope change', async () => {
    const email = nextEmail();
    const [{ cutoff }] = await query('SELECT UTC_TIMESTAMP(3) AS cutoff');
    await query('SELECT SLEEP(0.01)');
    await exec(`ALTER TABLE access_audit_events ADD CONSTRAINT test_only_fail_audit CHECK (created_at <= '${cutoff}')`);
    try {
      await assert.rejects(createHrUser(pool, {
        actorHrUserId: adminId, email, displayName: 'Rolled Back', password: 'synthetic-pw-rollback', role: 'SCOPED',
        countries: ['IN'], departments: ['Tech'],
      }), (error: unknown) => thrown(error).code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      await assert.rejects(
        setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: scopedId, countries: ['IN', 'US'] }),
        (error: unknown) => thrown(error).code === 'ER_CHECK_CONSTRAINT_VIOLATED',
      );
    } finally {
      await exec('ALTER TABLE access_audit_events DROP CHECK test_only_fail_audit');
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [email]), 0);
    const countries = (await query('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ? ORDER BY country_code', [scopedId]))
      .map((r) => r.country_code);
    assert.deepEqual(countries, ['IN']);
    const [{ version }] = await query('SELECT version FROM hr_users WHERE id = ?', [scopedId]);
    assert.equal(version, 1);
  });
});

describe('demo HR users', () => {
  const passwords = { meera: 'synthetic-demo-meera-pw', rohan: 'synthetic-demo-rohan-pw' };

  // Detects: wrong demo roles or scopes, or plain-text demo passwords.
  test('creates Meera (ADMIN) and Rohan (SCOPED, IN, Tech and Support) with hashed passwords', async () => {
    const result = await ensureDemoUsers(pool, { appEnv: 'test', passwords });
    assert.deepEqual(result, [
      { email: 'meera.iyer@acme.com', result: 'created' },
      { email: 'rohan.mehta@acme.com', result: 'created' },
    ]);
    const meera = await auth.authenticate((await auth.signIn('meera.iyer@acme.com', passwords.meera)).token);
    const rohan = await auth.authenticate((await auth.signIn('rohan.mehta@acme.com', passwords.rohan)).token);
    assert.deepEqual([meera.displayName, meera.role, meera.countries, meera.departments], ['Meera Iyer', 'ADMIN', [], []]);
    assert.deepEqual([rohan.displayName, rohan.role, rohan.countries, rohan.departments], ['Rohan Mehta', 'SCOPED', ['IN'], ['Support', 'Tech']]);
    const hashes = await query("SELECT password_hash FROM hr_users WHERE email IN ('meera.iyer@acme.com', 'rohan.mehta@acme.com')");
    for (const { password_hash: hash } of hashes) {
      assert.match(String(hash), /^\$argon2id\$/);
      assert.ok(!String(hash).includes(passwords.meera) && !String(hash).includes(passwords.rohan));
    }
    const events = await query(
      `SELECT a.actor_hr_user_id AS actor, a.action FROM access_audit_events a JOIN hr_users u ON u.id = a.target_hr_user_id
       WHERE u.email IN ('meera.iyer@acme.com', 'rohan.mehta@acme.com') ORDER BY a.id`,
    );
    assert.deepEqual(events, [{ actor: null, action: 'HR_USER_CREATED' }, { actor: null, action: 'HR_USER_CREATED' }]);
  });

  // Detects: duplicate demo accounts, or a rerun silently resetting passwords.
  test('a second run creates nothing and keeps the existing password hashes', async () => {
    const before = await query("SELECT id, password_hash FROM hr_users WHERE email LIKE '%.%@acme.com' AND display_name IN ('Meera Iyer', 'Rohan Mehta') ORDER BY id");
    const result = await ensureDemoUsers(pool, { appEnv: 'test', passwords: { meera: 'another-demo-pw-123', rohan: 'another-demo-pw-456' } });
    assert.deepEqual(result.map((r) => r.result), ['already present', 'already present']);
    const afterRows = await query("SELECT id, password_hash FROM hr_users WHERE email LIKE '%.%@acme.com' AND display_name IN ('Meera Iyer', 'Rohan Mehta') ORDER BY id");
    assert.deepEqual(afterRows, before);
  });

  // Detects: an existing demo user with drifted role or scopes being trusted.
  test('refuses an existing demo user whose role or scopes differ', async () => {
    const [{ id: rohanId }] = await query("SELECT id FROM hr_users WHERE email = 'rohan.mehta@acme.com'");
    const id = Number(rohanId);
    await setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: id, countries: ['IN', 'US'] });
    try {
      await assert.rejects(ensureDemoUsers(pool, { appEnv: 'test', passwords }), /rohan\.mehta@acme\.com/);
    } finally {
      await setCountryScopes(pool, { actorHrUserId: adminId, targetHrUserId: id, countries: ['IN'] });
    }
  });

  // Detects: demo accounts with known passwords created in production.
  test('refuses production, a missing APP_ENV, and short passwords', async () => {
    await assert.rejects(ensureDemoUsers(pool, { appEnv: 'production', passwords }), /APP_ENV/);
    await assert.rejects(ensureDemoUsers(pool, { appEnv: undefined, passwords }), /APP_ENV/);
    await assert.rejects(ensureDemoUsers(pool, { appEnv: 'demo', passwords: { meera: 'short', rohan: passwords.rohan } }), /at least 12/);
  });
});
