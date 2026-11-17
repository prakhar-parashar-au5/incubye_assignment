// Migration 003: salary_bands, compensation_change_requests, and the approved
// compensation_records columns. No compensation audit table.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader } from 'mysql2/promise';

import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { execStatement, selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { thrown } from '../support/thrown.js';

const DATABASE_URL = testDatabaseUrl();
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

let employeeId: number;
let otherEmployeeId: number;
let titleId: number;
let hrUserId: number;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 2 });
  await exec("INSERT INTO countries (code, name, currency) VALUES ('IN', 'India', 'INR'), ('US', 'United States', 'USD')");
  const department = await exec("INSERT INTO departments (name) VALUES ('Tech')");
  titleId = (await exec("INSERT INTO job_titles (department_id, name, level) VALUES (?, 'Tech Lead', 'LEAD')", [department.insertId])).insertId;
  const insertEmployee = async (code: string) => (await exec(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date)
     VALUES (?, 'Test', 'Person', ?, ?, 'IN', 'CURRENTLY_WORKING', '2020-01-01')`,
    [code, `${code.toLowerCase()}@acme.com`, titleId],
  )).insertId;
  employeeId = await insertEmployee('ACME00001');
  otherEmployeeId = await insertEmployee('ACME00002');
  hrUserId = (await exec("INSERT INTO hr_users (email, display_name, password_hash, role) VALUES ('hr@acme.com', 'HR', ?, 'SCOPED')", [FAKE_HASH])).insertId;
});
after(async () => {
  await pool?.end();
});

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  public_id: crypto.randomUUID(),
  employee_id: employeeId,
  requested_by_hr_user_id: hrUserId,
  adjustment_target: 'BASE_SALARY',
  adjustment_method: 'PERCENTAGE_INCREASE',
  input_value: '5.00',
  currency: 'INR',
  previous_target_value: '3000000.00',
  proposed_target_value: '3150000.00',
  requested_against_version: 1,
  base_compensation_version: 1,
  effective_from: '2026-12-01',
  change_reason: 'PERFORMANCE',
  request_idempotency_key: `key-${crypto.randomUUID()}`,
  created_at: '2026-11-15 10:00:00.000',
  updated_at: '2026-11-15 10:00:00.000',
  ...overrides,
});
const insertRequest = (overrides: Record<string, unknown> = {}) => exec('INSERT INTO compensation_change_requests SET ?', [requestRow(overrides)]);

describe('salary adjustment schema', () => {
  // Detects: a separate compensation audit table, or a missing workflow table.
  test('adds exactly salary_bands and compensation_change_requests', async () => {
    const rows = await query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name");
    const tables = rows.map((r) => String(r.t));
    assert.ok(tables.includes('salary_bands') && tables.includes('compensation_change_requests'));
    assert.deepEqual(tables.filter((t) => /audit/i.test(t)), ['access_audit_events']);
    const repeat = await runMigrations({ databaseUrl: DATABASE_URL });
    assert.deepEqual(repeat, { applied: [], alreadyApplied: ['001_initial_schema.sql', '002_hr_access_control.sql', '003_salary_adjustments.sql', '004_hr_access_management.sql', '005_ai_observability.sql', '006_temporary_password_regeneration.sql', '007_ai_trace_actor_scope.sql', '008_ai_trace_summary_index.sql'] });
  });

  // Detects: missing approved columns on compensation_records.
  test('adds the approved compensation_records columns, all nullable for historical rows', async () => {
    const rows = await query(
      `SELECT column_name AS c, column_type AS t, is_nullable AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'compensation_records' AND ordinal_position > 10 ORDER BY ordinal_position`,
    );
    assert.deepEqual(rows.map((r) => `${r.c} ${r.t} ${r.n}`), [
      'previous_compensation_record_id bigint unsigned YES',
      'changed_by_hr_user_id int unsigned YES',
      'source_request_id bigint unsigned YES',
      'change_note varchar(2000) YES',
      'operation_idempotency_key varchar(128) YES',
      'operation_fingerprint char(64) YES',
    ]);
  });

  test('creates the approved keys', async () => {
    const rows = await query(
      `SELECT table_name AS t, index_name AS i, non_unique AS nu, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name IN ('salary_bands', 'compensation_change_requests', 'compensation_records')
       GROUP BY table_name, index_name, non_unique ORDER BY table_name, index_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.t}.${r.i}${Number(r.nu) === 0 ? ' UNIQUE' : ''} (${r.cols})`), [
      'compensation_change_requests.idx_ccr_employee_status (employee_id,status)',
      'compensation_change_requests.idx_ccr_status_created (status,created_at)',
      'compensation_change_requests.PRIMARY UNIQUE (id)',
      'compensation_change_requests.uk_ccr_decision_key UNIQUE (decided_by_hr_user_id,decision_idempotency_key)',
      'compensation_change_requests.uk_ccr_one_pending UNIQUE (pending_employee_id)',
      'compensation_change_requests.uk_ccr_public_id UNIQUE (public_id)',
      'compensation_change_requests.uk_ccr_request_key UNIQUE (requested_by_hr_user_id,request_idempotency_key)',
      'compensation_records.fk_compensation_previous (previous_compensation_record_id)',
      'compensation_records.idx_compensation_employee_effective (employee_id,effective_from,version)',
      'compensation_records.PRIMARY UNIQUE (id)',
      'compensation_records.uk_compensation_employee_version UNIQUE (employee_id,version)',
      'compensation_records.uk_compensation_operation_key UNIQUE (changed_by_hr_user_id,operation_idempotency_key)',
      'compensation_records.uk_compensation_source_request UNIQUE (source_request_id)',
      'salary_bands.fk_salary_bands_country (country_code)',
      'salary_bands.PRIMARY UNIQUE (id)',
      'salary_bands.uk_salary_bands_title_country_currency UNIQUE (job_title_id,country_code,currency)',
    ]);
  });

  // Detects: CASCADE or SET NULL that could erase compensation or request history.
  test('every new foreign key is RESTRICT', async () => {
    const rows = await query(
      `SELECT constraint_name AS n, table_name AS t, referenced_table_name AS r, update_rule AS u, delete_rule AS d
       FROM information_schema.referential_constraints
       WHERE constraint_schema = DATABASE() AND table_name IN ('salary_bands', 'compensation_change_requests', 'compensation_records')
       ORDER BY constraint_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.n}: ${r.t} -> ${r.r} ${r.u}/${r.d}`), [
      'fk_ccr_decided_by: compensation_change_requests -> hr_users RESTRICT/RESTRICT',
      'fk_ccr_employee: compensation_change_requests -> employees RESTRICT/RESTRICT',
      'fk_ccr_requested_by: compensation_change_requests -> hr_users RESTRICT/RESTRICT',
      'fk_compensation_changed_by: compensation_records -> hr_users RESTRICT/RESTRICT',
      'fk_compensation_employee: compensation_records -> employees RESTRICT/RESTRICT',
      'fk_compensation_previous: compensation_records -> compensation_records RESTRICT/RESTRICT',
      'fk_compensation_source_request: compensation_records -> compensation_change_requests RESTRICT/RESTRICT',
      'fk_salary_bands_country: salary_bands -> countries RESTRICT/RESTRICT',
      'fk_salary_bands_job_title: salary_bands -> job_titles RESTRICT/RESTRICT',
    ]);
  });
});

describe('salary_bands constraints', () => {
  const band = (overrides: Record<string, unknown> = {}) => ({
    job_title_id: titleId, country_code: 'IN', currency: 'INR',
    min_annual_base_salary: '3000000.00', max_annual_base_salary: '5500000.00', max_annual_bonus: '1000000.00',
    min_percentage_increase: 1, max_percentage_increase: 200, min_percentage_decrease: 1, max_percentage_decrease: 50,
    ...overrides,
  });

  test('accepts a valid band and rejects a duplicate', async () => {
    await exec('INSERT INTO salary_bands SET ?', [band()]);
    await assertRejects(exec('INSERT INTO salary_bands SET ?', [band()]), 'ER_DUP_ENTRY', 'uk_salary_bands_title_country_currency');
  });

  // Detects: inverted ranges or percentages beyond the product limits.
  test('rejects inverted ranges and out-of-policy percentages', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ country_code: 'US', currency: 'USD', min_annual_base_salary: '0.00' }, 'chk_salary_bands_base_range'],
      [{ country_code: 'US', currency: 'USD', min_annual_base_salary: '6000000.00' }, 'chk_salary_bands_base_range'],
      [{ country_code: 'US', currency: 'USD', max_annual_bonus: '-1.00' }, 'chk_salary_bands_bonus'],
      [{ country_code: 'US', currency: 'USD', max_percentage_increase: 201 }, 'chk_salary_bands_increase'],
      [{ country_code: 'US', currency: 'USD', min_percentage_increase: 0 }, 'chk_salary_bands_increase'],
      [{ country_code: 'US', currency: 'USD', max_percentage_decrease: 51 }, 'chk_salary_bands_decrease'],
      [{ country_code: 'US', currency: 'USD', min_percentage_decrease: 20, max_percentage_decrease: 10 }, 'chk_salary_bands_decrease'],
    ];
    for (const [overrides, constraint] of cases) {
      await assertRejects(exec('INSERT INTO salary_bands SET ?', [band(overrides)]), 'ER_CHECK_CONSTRAINT_VIOLATED', constraint);
    }
  });
});

describe('compensation_change_requests constraints', () => {
  // Detects: two pending requests for one employee (the rule is also checked under a lock).
  test('allows only one pending request per employee', async () => {
    await insertRequest();
    await assertRejects(insertRequest(), 'ER_DUP_ENTRY', 'uk_ccr_one_pending');
    await insertRequest({ employee_id: otherEmployeeId });
    await exec("UPDATE compensation_change_requests SET status = 'STALE', decision_note = 'Compensation changed after this request was created.', decided_at = '2026-11-15 11:00:00.000' WHERE employee_id = ?", [employeeId]);
    await insertRequest();
  });

  // Detects: a request idempotency key reused by one requester.
  test('a request idempotency key is unique per requester', async () => {
    await exec('DELETE FROM compensation_change_requests');
    await insertRequest({ request_idempotency_key: 'same-key-0001' });
    await assertRejects(insertRequest({ employee_id: otherEmployeeId, request_idempotency_key: 'same-key-0001' }), 'ER_DUP_ENTRY', 'uk_ccr_request_key');
  });

  // Detects: inconsistent workflow states reaching the table.
  test('rejects inconsistent states, missing notes, and no-change requests', async () => {
    await exec('DELETE FROM compensation_change_requests');
    const cases: [Record<string, unknown>, string][] = [
      [{ status: 'CANCELLED', decided_by_hr_user_id: hrUserId, decided_at: '2026-11-15 11:00:00.000', decision_idempotency_key: 'k-1-aaaaaaaa' }, 'chk_ccr_decision'],
      [{ status: 'APPROVED', decided_at: '2026-11-15 11:00:00.000' }, 'chk_ccr_decision'],
      [{ status: 'PENDING', decided_at: '2026-11-15 11:00:00.000' }, 'chk_ccr_decision'],
      [{ status: 'STALE' }, 'chk_ccr_decision'],
      [{ change_reason: 'CORRECTION' }, 'chk_ccr_correction_note'],
      [{ proposed_target_value: '3000000.00' }, 'chk_ccr_changes_value'],
      [{ previous_target_value: '-1.00' }, 'chk_ccr_values'],
    ];
    for (const [overrides, constraint] of cases) {
      await assertRejects(insertRequest(overrides), 'ER_CHECK_CONSTRAINT_VIOLATED', constraint);
    }
    await assertRejects(insertRequest({ change_reason: 'INITIAL_IMPORT' }), 'WARN_DATA_TRUNCATED');
  });

  // Detects: deleting an employee or HR user that has requests.
  test('restricts deletes of referenced employees and HR users', async () => {
    await insertRequest();
    await assertRejects(exec('DELETE FROM employees WHERE id = ?', [employeeId]), 'ER_ROW_IS_REFERENCED_2');
    await assertRejects(exec('DELETE FROM hr_users WHERE id = ?', [hrUserId]), 'ER_ROW_IS_REFERENCED_2');
  });
});

describe('compensation_records additions', () => {
  // Detects: one HR user reusing an operation idempotency key.
  test('an operation idempotency key is unique per HR user', async () => {
    const row = (version: number) => ({
      employee_id: otherEmployeeId, version, annual_base_salary: '3100000.00', annual_bonus: '0.00', currency: 'INR', pay_frequency: 'MONTHLY',
      effective_from: '2026-11-15', change_reason: 'PERFORMANCE', changed_by_hr_user_id: hrUserId, operation_idempotency_key: 'op-key-0001',
      operation_fingerprint: 'a'.repeat(64),
    });
    await exec('INSERT INTO compensation_records SET ?', [row(1)]);
    await assertRejects(exec('INSERT INTO compensation_records SET ?', [row(2)]), 'ER_DUP_ENTRY', 'uk_compensation_operation_key');
  });

  // Detects: an initial-import row claiming an actor or source request.
  test('an INITIAL_IMPORT record has no actor, source request, or previous record', async () => {
    await assertRejects(exec('INSERT INTO compensation_records SET ?', [{
      employee_id: otherEmployeeId, version: 5, annual_base_salary: '1.00', annual_bonus: '0.00', currency: 'INR', pay_frequency: 'MONTHLY',
      effective_from: '2026-11-15', change_reason: 'INITIAL_IMPORT', changed_by_hr_user_id: hrUserId,
      // A valid fingerprint, so only the initial-import rule is violated.
      operation_fingerprint: 'e'.repeat(64),
    }]), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_compensation_initial_import');
  });

  // Detects: a correction stored without its required note.
  test('a CORRECTION record written by an HR user requires a note', async () => {
    await assertRejects(exec('INSERT INTO compensation_records SET ?', [{
      employee_id: otherEmployeeId, version: 6, annual_base_salary: '1.00', annual_bonus: '0.00', currency: 'INR', pay_frequency: 'MONTHLY',
      effective_from: '2026-11-15', change_reason: 'CORRECTION', changed_by_hr_user_id: hrUserId, operation_idempotency_key: 'op-key-0002',
      operation_fingerprint: 'b'.repeat(64),
    }]), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_compensation_correction_note');
  });

  // Review fix 09a. Detects: a direct change without a fingerprint, a fingerprint that is not
  // a SHA-256 hex digest (for example plain text), or a fingerprint on an import or approval record.
  test('fingerprint rules: required on direct changes, hex SHA-256 only, absent on imports', async () => {
    const row = (version: number, overrides: Record<string, unknown>) => ({
      employee_id: otherEmployeeId, version, annual_base_salary: '1.00', annual_bonus: '0.00', currency: 'INR', pay_frequency: 'MONTHLY',
      effective_from: '2026-11-15', change_reason: 'PERFORMANCE', changed_by_hr_user_id: hrUserId, operation_idempotency_key: `op-key-fp-${version}`,
      ...overrides,
    });
    const cases: [Record<string, unknown>, string][] = [
      [{}, 'chk_compensation_direct_fingerprint'],
      [{ operation_fingerprint: 'PERFORMANCE 10% note text'.padEnd(64, 'x') }, 'chk_compensation_fingerprint_format'],
      [{ operation_fingerprint: 'A'.repeat(64) }, 'chk_compensation_fingerprint_format'],
      [{ change_reason: 'INITIAL_IMPORT', changed_by_hr_user_id: null, operation_idempotency_key: null, operation_fingerprint: 'c'.repeat(64) }, 'chk_compensation_initial_import'],
    ];
    let version = 20;
    for (const [overrides, constraint] of cases) {
      version += 1;
      await assertRejects(exec('INSERT INTO compensation_records SET ?', [row(version, overrides)]), 'ER_CHECK_CONSTRAINT_VIOLATED', constraint);
    }
    await exec('INSERT INTO compensation_records SET ?', [row(30, { operation_fingerprint: 'd'.repeat(64) })]);
  });
});
