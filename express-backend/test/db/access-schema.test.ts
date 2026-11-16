import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { execStatement, selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { thrown } from '../support/thrown.js';
import type { Pool, ResultSetHeader } from 'mysql2/promise';

// Refuses to run unless DATABASE_URL names a database ending in _test.
const DATABASE_URL = testDatabaseUrl();

// A syntactically valid Argon2id PHC string. Not derived from any real password.
const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let pool: Pool;
const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const exec = (sql: string, params?: unknown[]): Promise<ResultSetHeader> => execStatement(pool, sql, params);

async function assertRejects(promise: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const { code: actual, message } = thrown(error);
    assert.equal(actual, code, message);
    if (constraint) assert.match(message, new RegExp(constraint), message);
    return true;
  });
}

let userSequence = 0;
async function insertHrUser(overrides: Record<string, unknown> = {}): Promise<number> {
  userSequence += 1;
  const row = {
    email: `hr.user${userSequence}@acme.com`,
    display_name: `HR User ${userSequence}`,
    password_hash: FAKE_HASH,
    role: 'SCOPED',
    status: 'ACTIVE',
    ...overrides,
  };
  return (await exec('INSERT INTO hr_users SET ?', [row])).insertId;
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 2 });
  await exec("INSERT INTO countries (code, name, currency) VALUES ('IN', 'India', 'INR'), ('US', 'United States', 'USD')");
  await exec("INSERT INTO departments (name) VALUES ('Tech'), ('Support')");
});
after(async () => {
  await pool?.end();
});

describe('access schema: structure', () => {
  // Detects: a missing access table, or a later table added early.
  test('migration 002 creates the five approved access tables (003 adds two salary tables)', async () => {
    const rows = await query(
      `SELECT table_name AS name, engine AS engine FROM information_schema.tables
       WHERE table_schema = DATABASE() ORDER BY table_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.name}:${r.engine}`), [
      'access_audit_events:InnoDB',
      'compensation_change_requests:InnoDB',
      'compensation_records:InnoDB',
      'countries:InnoDB',
      'departments:InnoDB',
      'employees:InnoDB',
      'hr_sessions:InnoDB',
      'hr_user_country_scopes:InnoDB',
      'hr_user_department_scopes:InnoDB',
      'hr_users:InnoDB',
      'job_titles:InnoDB',
      'salary_bands:InnoDB',
      'schema_migrations:InnoDB',
    ]);
  });

  test('records every migration', async () => {
    const repeat = await runMigrations({ databaseUrl: DATABASE_URL });
    assert.deepEqual(repeat, { applied: [], alreadyApplied: ['001_initial_schema.sql', '002_hr_access_control.sql', '003_salary_adjustments.sql'] });
  });

  // Detects: missing composite primary keys or lookup indexes.
  test('creates the approved keys and indexes', async () => {
    const rows = await query(
      `SELECT table_name AS t, index_name AS i, non_unique AS nu,
              GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name IN ('hr_users', 'hr_user_country_scopes', 'hr_user_department_scopes', 'hr_sessions', 'access_audit_events')
       GROUP BY table_name, index_name, non_unique
       ORDER BY table_name, index_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.t}.${r.i}${Number(r.nu) === 0 ? ' UNIQUE' : ''} (${r.cols})`), [
      'access_audit_events.idx_access_audit_actor (actor_hr_user_id,created_at)',
      'access_audit_events.idx_access_audit_target (target_hr_user_id,created_at)',
      'access_audit_events.PRIMARY UNIQUE (id)',
      'hr_sessions.idx_hr_sessions_user (hr_user_id)',
      'hr_sessions.PRIMARY UNIQUE (id)',
      'hr_user_country_scopes.idx_hr_country_scopes_country (country_code)',
      'hr_user_country_scopes.PRIMARY UNIQUE (hr_user_id,country_code)',
      'hr_user_department_scopes.idx_hr_department_scopes_department (department_id)',
      'hr_user_department_scopes.PRIMARY UNIQUE (hr_user_id,department_id)',
      'hr_users.PRIMARY UNIQUE (id)',
      'hr_users.uk_hr_users_email UNIQUE (email)',
    ]);
  });

  // Detects: CASCADE deletes that would erase sessions, scopes, or audit history.
  test('creates restrictive foreign keys', async () => {
    const rows = await query(
      `SELECT constraint_name AS name, table_name AS t, referenced_table_name AS ref,
              update_rule AS up, delete_rule AS del
       FROM information_schema.referential_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name IN ('hr_user_country_scopes', 'hr_user_department_scopes', 'hr_sessions', 'access_audit_events')
       ORDER BY constraint_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.name}: ${r.t} -> ${r.ref} update ${r.up} delete ${r.del}`), [
      'fk_access_audit_actor: access_audit_events -> hr_users update RESTRICT delete RESTRICT',
      'fk_access_audit_target: access_audit_events -> hr_users update RESTRICT delete RESTRICT',
      'fk_hr_country_scopes_country: hr_user_country_scopes -> countries update RESTRICT delete RESTRICT',
      'fk_hr_country_scopes_user: hr_user_country_scopes -> hr_users update RESTRICT delete RESTRICT',
      'fk_hr_department_scopes_department: hr_user_department_scopes -> departments update RESTRICT delete RESTRICT',
      'fk_hr_department_scopes_user: hr_user_department_scopes -> hr_users update RESTRICT delete RESTRICT',
      'fk_hr_sessions_user: hr_sessions -> hr_users update RESTRICT delete RESTRICT',
    ]);
  });
});

describe('access schema: hr_users', () => {
  // Detects: wrong defaults for a new HR user.
  test('starts HR user version at 1', async () => {
    const id = await insertHrUser();
    const [row] = await query('SELECT role, status, version FROM hr_users WHERE id = ?', [id]);
    assert.deepEqual(row, { role: 'SCOPED', status: 'ACTIVE', version: 1 });
  });

  // Detects: a binary collation allowing Meera@ and meera@ as two accounts.
  test('enforces a unique email without case sensitivity', async () => {
    await insertHrUser({ email: 'case.check@acme.com' });
    await assertRejects(insertHrUser({ email: 'Case.Check@ACME.com' }), 'ER_DUP_ENTRY', 'uk_hr_users_email');
  });

  test('rejects unsupported role and status values', async () => {
    await assertRejects(insertHrUser({ role: 'SUPERUSER' }), 'WARN_DATA_TRUNCATED');
    await assertRejects(insertHrUser({ status: 'SUSPENDED' }), 'WARN_DATA_TRUNCATED');
  });

  // Detects: a plain-text password stored when an application check is bypassed.
  test('rejects a password_hash that is not an Argon2id PHC string', async () => {
    await assertRejects(insertHrUser({ password_hash: 'plain-text-password' }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_hr_users_password_hash');
  });

  test('rejects an empty display name and version 0', async () => {
    await assertRejects(insertHrUser({ display_name: '  ' }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_hr_users_display_name');
    await assertRejects(insertHrUser({ version: 0 }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_hr_users_version');
  });
});

describe('access schema: scopes', () => {
  let userId: number;
  let techId: unknown;
  before(async () => {
    userId = await insertHrUser();
    [{ id: techId }] = await query("SELECT id FROM departments WHERE name = 'Tech'");
  });

  test('rejects a country scope for an unknown HR user', async () => {
    await assertRejects(
      exec("INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES (999999, 'IN')"),
      'ER_NO_REFERENCED_ROW_2', 'fk_hr_country_scopes_user',
    );
  });

  test('rejects a department scope for an unknown HR user', async () => {
    await assertRejects(
      exec('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (999999, ?)', [techId]),
      'ER_NO_REFERENCED_ROW_2', 'fk_hr_department_scopes_user',
    );
  });

  test('rejects unknown country and department assignments', async () => {
    await assertRejects(
      exec("INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES (?, 'GB')", [userId]),
      'ER_NO_REFERENCED_ROW_2', 'fk_hr_country_scopes_country',
    );
    await assertRejects(
      exec('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, 9999)', [userId]),
      'ER_NO_REFERENCED_ROW_2', 'fk_hr_department_scopes_department',
    );
  });

  test('rejects duplicate country or department scope rows', async () => {
    await exec("INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES (?, 'IN')", [userId]);
    await assertRejects(exec("INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES (?, 'IN')", [userId]), 'ER_DUP_ENTRY', 'PRIMARY');
    await exec('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, ?)', [userId, techId]);
    await assertRejects(
      exec('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, ?)', [userId, techId]),
      'ER_DUP_ENTRY', 'PRIMARY',
    );
  });

  // Detects: deleting a user or reference row silently dropping access rows.
  test('prevents deleting referenced HR users, countries, and departments', async () => {
    await assertRejects(exec('DELETE FROM hr_users WHERE id = ?', [userId]), 'ER_ROW_IS_REFERENCED_2', 'fk_hr_country_scopes_user');
    await assertRejects(exec("DELETE FROM countries WHERE code = 'IN'"), 'ER_ROW_IS_REFERENCED_2', 'fk_hr_country_scopes_country');
    await assertRejects(exec('DELETE FROM departments WHERE id = ?', [techId]), 'ER_ROW_IS_REFERENCED_2', 'fk_hr_department_scopes_department');
  });
});

describe('access schema: sessions and audit', () => {
  // Detects: lost millisecond precision, or revocation that cannot be recorded.
  test('stores session expiry and an optional revocation time', async () => {
    const userId = await insertHrUser();
    await exec(
      `INSERT INTO hr_sessions (id, hr_user_id, created_at, expires_at)
       VALUES ('0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10', ?, '2026-11-14 10:00:00.000', '2026-11-14 12:00:00.000')`,
      [userId],
    );
    await exec("UPDATE hr_sessions SET revoked_at = '2026-11-14 10:30:00.123' WHERE id = '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10'");
    const [row] = await query("SELECT created_at, expires_at, revoked_at FROM hr_sessions WHERE id = '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10'");
    assert.deepEqual(row, {
      created_at: '2026-11-14 10:00:00.000',
      expires_at: '2026-11-14 12:00:00.000',
      revoked_at: '2026-11-14 10:30:00.123',
    });
  });

  test('rejects a session that expires before it is created', async () => {
    const userId = await insertHrUser();
    await assertRejects(
      exec(
        `INSERT INTO hr_sessions (id, hr_user_id, created_at, expires_at)
         VALUES ('1b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10', ?, '2026-11-14 10:00:00.000', '2026-11-14 10:00:00.000')`,
        [userId],
      ),
      'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_hr_sessions_expiry',
    );
  });

  // Detects: audit states stored as free text that later readers cannot parse.
  test('stores audit before and after states as valid JSON and rejects invalid JSON', async () => {
    const target = await insertHrUser();
    await exec(
      `INSERT INTO access_audit_events (actor_hr_user_id, target_hr_user_id, action, before_state, after_state)
       VALUES (NULL, ?, 'HR_USER_CREATED', NULL, ?)`,
      [target, JSON.stringify({ role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'] })],
    );
    const [row] = await query('SELECT action, before_state, after_state FROM access_audit_events WHERE target_hr_user_id = ?', [target]);
    assert.deepEqual(row, {
      action: 'HR_USER_CREATED',
      before_state: null,
      after_state: { role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'] },
    });
    await assertRejects(
      exec(
        `INSERT INTO access_audit_events (target_hr_user_id, action, after_state) VALUES (?, 'HR_USER_CREATED', '{not json')`,
        [target],
      ),
      'ER_INVALID_JSON_TEXT',
    );
    await assertRejects(
      exec(`INSERT INTO access_audit_events (target_hr_user_id, action, after_state) VALUES (?, 'PASSWORD_VIEWED', '{}')`, [target]),
      'WARN_DATA_TRUNCATED',
    );
  });

  // Detects: deleting an HR user erasing their audit trail.
  test('prevents deleting an HR user referenced by sessions or audit events', async () => {
    const target = await insertHrUser();
    await exec(`INSERT INTO access_audit_events (target_hr_user_id, action, after_state) VALUES (?, 'HR_USER_CREATED', '{}')`, [target]);
    await assertRejects(exec('DELETE FROM hr_users WHERE id = ?', [target]), 'ER_ROW_IS_REFERENCED_2', 'fk_access_audit_target');
  });
});
