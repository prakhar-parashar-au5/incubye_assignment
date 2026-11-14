import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { canAccessEmployee } from '../../src/access/access-policy.js';
import {
  bootstrapHrUser,
  createHrUser,
  setCountryScopes,
  setDepartmentScopes,
  setHrUserStatus,
} from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { requireTestDatabaseUrl, resetTestDatabase } from '../support/test-database.js';

const DATABASE_URL = process.env.DATABASE_URL;
requireTestDatabaseUrl(DATABASE_URL);

// Review fix 04a rules, on a database that holds only the users created here,
// so "number of active admins" is fully controlled by this file.
let pool;
let adminA;
let adminB;
let emailSequence = 0;
const nextEmail = () => `rules.person${++emailSequence}@acme.com`;
const query = async (sql, params) => (await pool.query(sql, params))[0];

const activeAdminCount = async () =>
  Number((await query("SELECT COUNT(*) AS n FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE'"))[0].n);

/** Version and audit-event count for one HR user. */
async function snapshot(hrUserId) {
  const [{ version }] = await query('SELECT version FROM hr_users WHERE id = ?', [hrUserId]);
  const events = Number((await query('SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ?', [hrUserId]))[0].n);
  return { version, events };
}

/** Asserts a domain error code and that no SQL detail leaks into the message. */
function domainError(code) {
  return (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    assert.doesNotMatch(error.message, /ER_|SQL|SELECT|UPDATE|hr_users/);
    return true;
  };
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 6 });
  const connection = await pool.getConnection();
  try {
    await ensureReferenceData(connection);
  } finally {
    connection.release();
  }
  adminA = await bootstrapHrUser(pool, {
    email: 'rules.admin.a@acme.com', displayName: 'Rules Admin A', password: 'synthetic-admin-a-pw', role: 'ADMIN',
    countries: [], departments: [],
  });
  adminB = await bootstrapHrUser(pool, {
    email: 'rules.admin.b@acme.com', displayName: 'Rules Admin B', password: 'synthetic-admin-b-pw', role: 'ADMIN',
    countries: [], departments: [],
  });
});
after(async () => {
  await pool?.end();
});

describe('new HR user password length', () => {
  const create = (password) => createHrUser(pool, {
    actorHrUserId: adminA, email: nextEmail(), displayName: 'Password Rule', password, role: 'SCOPED', countries: [], departments: [],
  });

  // Detects: weak passwords accepted at creation.
  test('rejects an 11-character password', async () => {
    await assert.rejects(create('a'.repeat(11)), domainError('INVALID_INPUT'));
  });

  // Detects: an off-by-one that also rejects the minimum length.
  test('accepts a 12-character password', async () => {
    assert.ok((await create('a'.repeat(12))) > 0);
  });

  // Detects: an over-long password reaching the hasher (CPU) or failing with a non-domain error.
  test('rejects a password longer than 1,024 characters', async () => {
    assert.ok((await create('a'.repeat(1024))) > 0);
    await assert.rejects(create('a'.repeat(1025)), domainError('INVALID_INPUT'));
  });

  // Detects: the demo setup path bypassing the creation rule.
  test('applies the same rule to system-created users', async () => {
    await assert.rejects(
      bootstrapHrUser(pool, { email: nextEmail(), displayName: 'Bootstrap Short', password: 'a'.repeat(11), role: 'SCOPED', countries: [], departments: [] }),
      domainError('INVALID_INPUT'),
    );
  });
});

describe('administrator scopes', () => {
  // Detects: admin scopes silently stored and ignored.
  test('rejects creating an ADMIN with a country or department scope', async () => {
    const before = Number((await query('SELECT COUNT(*) AS n FROM hr_users'))[0].n);
    for (const scopes of [{ countries: ['IN'], departments: [] }, { countries: [], departments: ['Tech'] }]) {
      await assert.rejects(createHrUser(pool, {
        actorHrUserId: adminA, email: nextEmail(), displayName: 'Scoped Admin', password: 'synthetic-pw-admin-scope', role: 'ADMIN', ...scopes,
      }), domainError('INVALID_INPUT'));
    }
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM hr_users'))[0].n), before);
  });

  // Detects: scope assignment ignoring the target's role; rejected changes that still
  // bump the version or write an audit event.
  test('rejects assigning a country or department scope to an ADMIN without changing version or audit', async () => {
    const before = await snapshot(adminB);
    await assert.rejects(setCountryScopes(pool, { actorHrUserId: adminA, targetHrUserId: adminB, countries: ['IN'] }), domainError('INVALID_INPUT'));
    await assert.rejects(setDepartmentScopes(pool, { actorHrUserId: adminA, targetHrUserId: adminB, departments: ['Tech'] }), domainError('INVALID_INPUT'));
    assert.deepEqual(await snapshot(adminB), before);
    const rows = await query(
      `SELECT (SELECT COUNT(*) FROM hr_user_country_scopes WHERE hr_user_id = ?) AS c,
              (SELECT COUNT(*) FROM hr_user_department_scopes WHERE hr_user_id = ?) AS d`,
      [adminB, adminB],
    );
    assert.deepEqual([Number(rows[0].c), Number(rows[0].d)], [0, 0]);
  });

  // Detects: empty lists treated as invalid for SCOPED users, or as "all access".
  test('a SCOPED user with empty lists is valid and has no employee access', async () => {
    const email = nextEmail();
    const id = await createHrUser(pool, {
      actorHrUserId: adminA, email, displayName: 'Empty Scopes', password: 'synthetic-pw-empty-scopes', role: 'SCOPED', countries: [], departments: [],
    });
    const clock = () => new Date('2026-11-14T10:00:00.000Z');
    const auth = createAuthService({ pool, tokens: createSessionTokens({ signingKey: 'test-only-signing-key-0123456789abcdef', clock }), clock });
    const principal = await auth.authenticate((await auth.signIn(email, 'synthetic-pw-empty-scopes')).token);
    assert.deepEqual([principal.hrUserId, principal.role, principal.countries, principal.departments], [id, 'SCOPED', [], []]);
    for (const employee of [{ country_code: 'IN', department: 'Tech' }, { country_code: 'US', department: 'HR' }]) {
      assert.equal(canAccessEmployee(principal, employee), false);
    }
  });
});

describe('last active administrator', () => {
  // Detects: management lockout by deactivating the only remaining admin;
  // a rejected change that still bumps the version or writes an audit event.
  test('the last active administrator cannot be deactivated', async () => {
    await setHrUserStatus(pool, { actorHrUserId: adminA, targetHrUserId: adminB, status: 'INACTIVE' });
    assert.equal(await activeAdminCount(), 1);
    const before = await snapshot(adminA);
    await assert.rejects(setHrUserStatus(pool, { actorHrUserId: adminA, targetHrUserId: adminA, status: 'INACTIVE' }), domainError('LAST_ACTIVE_ADMIN'));
    assert.deepEqual(await snapshot(adminA), before);
    assert.equal(await activeAdminCount(), 1);
    await setHrUserStatus(pool, { actorHrUserId: adminA, targetHrUserId: adminB, status: 'ACTIVE' });
  });

  // Detects: a rule so strict that it blocks valid self-deactivation.
  test('an administrator can deactivate themselves when another active administrator exists', async () => {
    assert.equal(await activeAdminCount(), 2);
    assert.equal((await setHrUserStatus(pool, { actorHrUserId: adminB, targetHrUserId: adminB, status: 'INACTIVE' })).changed, true);
    assert.equal(await activeAdminCount(), 1);
    await setHrUserStatus(pool, { actorHrUserId: adminA, targetHrUserId: adminB, status: 'ACTIVE' });
  });

  // Detects: a check-then-update race where two transactions each see two
  // active admins and both commit, leaving zero. Repeated to make the race likely.
  test('two concurrent self-deactivations cannot leave zero active administrators', async () => {
    for (let round = 1; round <= 15; round += 1) {
      assert.equal(await activeAdminCount(), 2, `round ${round} start`);
      const results = await Promise.allSettled([
        setHrUserStatus(pool, { actorHrUserId: adminA, targetHrUserId: adminA, status: 'INACTIVE' }),
        setHrUserStatus(pool, { actorHrUserId: adminB, targetHrUserId: adminB, status: 'INACTIVE' }),
      ]);
      assert.equal(await activeAdminCount(), 1, `round ${round}: active admins`);
      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'], `round ${round}`);
      const rejected = results.find((r) => r.status === 'rejected').reason;
      assert.equal(rejected.code, 'LAST_ACTIVE_ADMIN', `round ${round}: ${rejected.code} ${rejected.message}`);
      const remaining = results[0].status === 'fulfilled' ? adminB : adminA;
      const deactivated = remaining === adminA ? adminB : adminA;
      await setHrUserStatus(pool, { actorHrUserId: remaining, targetHrUserId: deactivated, status: 'ACTIVE' });
    }
  });
});
