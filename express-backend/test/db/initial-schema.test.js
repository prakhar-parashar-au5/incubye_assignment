import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { requireTestDatabaseUrl, resetTestDatabase } from '../support/test-database.js';

const DATABASE_URL = process.env.DATABASE_URL;
requireTestDatabaseUrl(DATABASE_URL);

let pool;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 2 });
});
after(async () => {
  await pool?.end();
});

const query = async (sql, params) => (await pool.query(sql, params))[0];

/** Asserts a MySQL error code and, when given, the constraint name in the message. */
async function assertRejects(promise, code, constraint) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (constraint) assert.match(error.message, new RegExp(constraint), error.message);
    return true;
  });
}

// Tables owned by 001. Later migrations add tables; access-schema.test.js
// asserts the complete list after all migrations.
const MIGRATION_001_TABLES = ['compensation_records', 'countries', 'departments', 'employees', 'job_titles'];

describe('initial schema: tables and keys', () => {
  // Detects: the real migration failing or re-applying on a second run
  // (e.g. CREATE TABLE without a record, or a missing schema_migrations row).
  test('records 001_initial_schema.sql and applies nothing on a repeat run', async () => {
    const repeat = await runMigrations({ databaseUrl: DATABASE_URL });
    assert.deepEqual(repeat.applied, []);
    assert.equal(repeat.alreadyApplied[0], '001_initial_schema.sql');
  });
  // Detects: a missing 001 table.
  test('creates the approved 001 tables', async () => {
    const rows = await query(
      `SELECT table_name AS name, engine AS engine FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN (?) ORDER BY table_name`,
      [[...MIGRATION_001_TABLES, 'schema_migrations']],
    );
    assert.deepEqual(rows.map((r) => `${r.name}:${r.engine}`), [
      'compensation_records:InnoDB',
      'countries:InnoDB',
      'departments:InnoDB',
      'employees:InnoDB',
      'job_titles:InnoDB',
      'schema_migrations:InnoDB',
    ]);
  });

  // Detects: a missing or misnamed primary key, unique key, or index.
  test('creates the approved primary keys, unique constraints, and indexes', async () => {
    const rows = await query(
      `SELECT table_name AS t, index_name AS i, non_unique AS nu,
              GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name IN (?)
       GROUP BY table_name, index_name, non_unique
       ORDER BY table_name, index_name`,
      [MIGRATION_001_TABLES],
    );
    assert.deepEqual(rows.map((r) => `${r.t}.${r.i}${Number(r.nu) === 0 ? ' UNIQUE' : ''} (${r.cols})`), [
      'compensation_records.idx_compensation_employee_effective (employee_id,effective_from,version)',
      'compensation_records.PRIMARY UNIQUE (id)',
      'compensation_records.uk_compensation_employee_version UNIQUE (employee_id,version)',
      'countries.PRIMARY UNIQUE (code)',
      'countries.uk_countries_name UNIQUE (name)',
      'departments.PRIMARY UNIQUE (id)',
      'departments.uk_departments_name UNIQUE (name)',
      'employees.idx_employees_country (country_code)',
      'employees.idx_employees_job_title (job_title_id)',
      'employees.PRIMARY UNIQUE (id)',
      'employees.uk_employees_email UNIQUE (email)',
      'employees.uk_employees_employee_code UNIQUE (employee_code)',
      'job_titles.PRIMARY UNIQUE (id)',
      'job_titles.uk_job_titles_department_name_level UNIQUE (department_id,name,level)',
    ]);
  });

  // Detects: a missing foreign key, or CASCADE/SET NULL that could delete history.
  test('creates restrictive foreign keys', async () => {
    const rows = await query(
      `SELECT rc.constraint_name AS name, rc.table_name AS t, rc.referenced_table_name AS ref,
              rc.update_rule AS up, rc.delete_rule AS del
       FROM information_schema.referential_constraints rc
       WHERE rc.constraint_schema = DATABASE() AND rc.table_name IN (?) ORDER BY rc.constraint_name`,
      [MIGRATION_001_TABLES],
    );
    assert.deepEqual(rows.map((r) => `${r.name}: ${r.t} -> ${r.ref} update ${r.up} delete ${r.del}`), [
      'fk_compensation_employee: compensation_records -> employees update RESTRICT delete RESTRICT',
      'fk_employees_country: employees -> countries update RESTRICT delete RESTRICT',
      'fk_employees_job_title: employees -> job_titles update RESTRICT delete RESTRICT',
      'fk_job_titles_department: job_titles -> departments update RESTRICT delete RESTRICT',
    ]);
  });

  // Detects: money stored as FLOAT/DOUBLE, or a stored monthly or current salary column.
  test('stores money as DECIMAL(15,2) and stores no monthly salary', async () => {
    const rows = await query(
      `SELECT table_name AS t, column_name AS c, column_type AS type FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND (column_name LIKE '%salary%' OR column_name LIKE '%bonus%' OR column_name LIKE '%monthly%')
       ORDER BY table_name, column_name`,
    );
    assert.deepEqual(rows.map((r) => `${r.t}.${r.c} ${r.type}`), [
      'compensation_records.annual_base_salary decimal(15,2)',
      'compensation_records.annual_bonus decimal(15,2)',
    ]);
  });
});

describe('initial schema: reference data', () => {
  before(async () => {
    await query("INSERT INTO countries (code, name, currency) VALUES ('IN', 'India', 'INR'), ('US', 'United States', 'USD')");
    await query("INSERT INTO departments (name) VALUES ('Tech'), ('HR')");
  });

  // Detects: a countries table that cannot hold the two approved countries.
  test('stores India with INR and the United States with USD', async () => {
    const rows = await query('SELECT code, name, currency FROM countries ORDER BY code');
    assert.deepEqual(rows, [
      { code: 'IN', name: 'India', currency: 'INR' },
      { code: 'US', name: 'United States', currency: 'USD' },
    ]);
  });

  test('rejects a duplicate country code', async () => {
    await assertRejects(query("INSERT INTO countries VALUES ('IN', 'India Two', 'INR')"), 'ER_DUP_ENTRY', 'PRIMARY');
  });

  test('rejects a duplicate country name', async () => {
    await assertRejects(query("INSERT INTO countries VALUES ('IX', 'India', 'INR')"), 'ER_DUP_ENTRY', 'uk_countries_name');
  });

  // Detects: lowercase or malformed codes that would break joins on country_code.
  test('rejects a country code that is not two uppercase letters', async () => {
    await assertRejects(
      query("INSERT INTO countries VALUES ('gb', 'Great Britain', 'INR')"),
      'ER_CHECK_CONSTRAINT_VIOLATED',
      'chk_countries_code',
    );
  });

  // Detects: a case-sensitive collation that allows "tech" next to "Tech".
  test('rejects a duplicate department name, including a case variant', async () => {
    await assertRejects(query("INSERT INTO departments (name) VALUES ('Tech')"), 'ER_DUP_ENTRY', 'uk_departments_name');
    await assertRejects(query("INSERT INTO departments (name) VALUES ('tech')"), 'ER_DUP_ENTRY', 'uk_departments_name');
  });

  test('rejects a job title for a missing department', async () => {
    await assertRejects(
      query("INSERT INTO job_titles (department_id, name, level) VALUES (9999, 'Ghost', 'MID')"),
      'ER_NO_REFERENCED_ROW_2',
      'fk_job_titles_department',
    );
  });

  test('rejects a duplicate department, title, and level combination', async () => {
    const [{ id }] = await query("SELECT id FROM departments WHERE name = 'Tech'");
    await query("INSERT INTO job_titles (department_id, name, level) VALUES (?, 'Software Engineer', 'MID')", [id]);
    await assertRejects(
      query("INSERT INTO job_titles (department_id, name, level) VALUES (?, 'Software Engineer', 'MID')", [id]),
      'ER_DUP_ENTRY',
      'uk_job_titles_department_name_level',
    );
  });

  // Detects: VARCHAR columns where ENUMs were approved, or a non-strict SQL mode
  // that stores '' instead of failing.
  test('rejects unsupported currency and level values', async () => {
    await assertRejects(query("INSERT INTO countries VALUES ('GB', 'Great Britain', 'GBP')"), 'WARN_DATA_TRUNCATED');
    const [{ id }] = await query("SELECT id FROM departments WHERE name = 'Tech'");
    await assertRejects(
      query("INSERT INTO job_titles (department_id, name, level) VALUES (?, 'Engineer', 'L3')", [id]),
      'WARN_DATA_TRUNCATED',
    );
  });
});

let employeeSequence = 100;
let techTitleId;

async function techTitle() {
  if (techTitleId) return techTitleId;
  const [{ id }] = await query("SELECT id FROM departments WHERE name = 'Tech'");
  const result = await query("INSERT INTO job_titles (department_id, name, level) VALUES (?, 'Tech Lead', 'LEAD')", [id]);
  techTitleId = result.insertId;
  return techTitleId;
}

/** Inserts one valid employee, with overrides. Returns the new id. */
async function insertEmployee(overrides = {}) {
  employeeSequence += 1;
  const code = overrides.employee_code ?? `ACME${String(employeeSequence).padStart(5, '0')}`;
  const row = {
    employee_code: code,
    first_name: 'Aditi',
    last_name: 'Sharma',
    email: `aditi.sharma.${code.toLowerCase()}@acme.com`,
    job_title_id: await techTitle(),
    country_code: 'IN',
    employment_status: 'CURRENTLY_WORKING',
    hire_date: '2022-08-14',
    employment_end_date: null,
    ...overrides,
  };
  const result = await query('INSERT INTO employees SET ?', [row]);
  return result.insertId;
}

describe('initial schema: employees', () => {
  // Detects: a valid row rejected by an over-strict constraint; wrong defaults.
  test('accepts a valid employee and starts version at 1', async () => {
    const id = await insertEmployee({ first_name: 'José', employee_code: 'ACME00001', email: 'jose.sharma.acme00001@acme.com' });
    const [row] = await query('SELECT employee_code, first_name, version, hire_date, employment_end_date FROM employees WHERE id = ?', [id]);
    assert.deepEqual(row, {
      employee_code: 'ACME00001',
      first_name: 'José',
      version: 1,
      hire_date: '2022-08-14',
      employment_end_date: null,
    });
  });

  // Detects: created_at/updated_at defaults that follow a non-UTC session time zone.
  test('defaults created_at and updated_at to the current UTC time', async () => {
    const id = await insertEmployee();
    const [row] = await query(
      `SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(3))) AS created_drift,
              created_at = updated_at AS same
       FROM employees WHERE id = ?`,
      [id],
    );
    assert.ok(Number(row.created_drift) <= 5, `created_at drift ${row.created_drift}s`);
    assert.equal(Number(row.same), 1);
  });

  // Detects: updated_at that never changes after an update.
  test('moves updated_at forward on update', async () => {
    const id = await insertEmployee();
    await query('SELECT SLEEP(0.02)');
    await query("UPDATE employees SET last_name = 'Verma' WHERE id = ?", [id]);
    const [row] = await query('SELECT updated_at > created_at AS moved FROM employees WHERE id = ?', [id]);
    assert.equal(Number(row.moved), 1);
  });

  test('rejects a duplicate employee code', async () => {
    await insertEmployee({ employee_code: 'ACME00002', email: 'a.b.acme00002@acme.com' });
    await assertRejects(
      insertEmployee({ employee_code: 'ACME00002', email: 'other.acme00002@acme.com' }),
      'ER_DUP_ENTRY',
      'uk_employees_employee_code',
    );
  });

  // Detects: a binary collation on email that allows case-variant duplicates.
  test('rejects a duplicate email address, including a case variant', async () => {
    await insertEmployee({ email: 'dup.person@acme.com' });
    await assertRejects(insertEmployee({ email: 'dup.person@acme.com' }), 'ER_DUP_ENTRY', 'uk_employees_email');
    await assertRejects(insertEmployee({ email: 'Dup.Person@acme.com' }), 'ER_DUP_ENTRY', 'uk_employees_email');
  });

  // Detects: codes with the wrong prefix, digit count, or letter case.
  for (const code of ['ACME1234', 'EMP000001', 'acme00003', 'ACME0000X']) {
    test(`rejects employee code ${code}`, async () => {
      await assertRejects(
        insertEmployee({ employee_code: code, email: `${code.toLowerCase()}.x@acme.com` }),
        'ER_CHECK_CONSTRAINT_VIOLATED',
        'chk_employees_employee_code',
      );
    });
  }

  // Detects: a missing country foreign key, or a case-insensitive match on 'in'.
  test('rejects an unknown country, including a lowercase code', async () => {
    await assertRejects(insertEmployee({ country_code: 'GB' }), 'ER_NO_REFERENCED_ROW_2', 'fk_employees_country');
    await assertRejects(insertEmployee({ country_code: 'in' }), 'ER_NO_REFERENCED_ROW_2', 'fk_employees_country');
  });

  test('rejects an unknown job title', async () => {
    await assertRejects(insertEmployee({ job_title_id: 9999 }), 'ER_NO_REFERENCED_ROW_2', 'fk_employees_job_title');
  });

  test('rejects an unsupported employment status', async () => {
    await assertRejects(insertEmployee({ employment_status: 'ACTIVE' }), 'WARN_DATA_TRUNCATED');
  });

  // Detects: blank names stored when an application check is bypassed.
  test('rejects an empty or whitespace-only name', async () => {
    await assertRejects(insertEmployee({ first_name: '' }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_employees_first_name');
    await assertRejects(insertEmployee({ last_name: '   ' }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_employees_last_name');
  });

  test('rejects a LEFT employee without an employment end date', async () => {
    await assertRejects(
      insertEmployee({ employment_status: 'LEFT', employment_end_date: null }),
      'ER_CHECK_CONSTRAINT_VIOLATED',
      'chk_employees_end_date_status',
    );
  });

  test('rejects a CURRENTLY_WORKING employee with an employment end date', async () => {
    await assertRejects(
      insertEmployee({ employment_status: 'CURRENTLY_WORKING', employment_end_date: '2025-01-31' }),
      'ER_CHECK_CONSTRAINT_VIOLATED',
      'chk_employees_end_date_status',
    );
  });

  test('rejects a SOON_TO_JOIN employee with an employment end date', async () => {
    await assertRejects(
      insertEmployee({ employment_status: 'SOON_TO_JOIN', hire_date: '2026-12-01', employment_end_date: '2027-01-31' }),
      'ER_CHECK_CONSTRAINT_VIOLATED',
      'chk_employees_end_date_status',
    );
  });

  // Detects: "end >= hire" instead of the approved "end > hire".
  test('rejects an employment end date that is not after the hire date', async () => {
    for (const end of ['2022-08-14', '2022-08-13']) {
      await assertRejects(
        insertEmployee({ employment_status: 'LEFT', employment_end_date: end }),
        'ER_CHECK_CONSTRAINT_VIOLATED',
        'chk_employees_end_after_hire',
      );
    }
  });

  test('accepts a LEFT employee whose end date is after the hire date', async () => {
    const id = await insertEmployee({ employment_status: 'LEFT', employment_end_date: '2022-08-15' });
    assert.ok(id > 0);
  });

  // Detects: version 0, which would break optimistic concurrency later.
  test('rejects employee version 0', async () => {
    await assertRejects(insertEmployee({ version: 0 }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_employees_version');
  });
});

/** Inserts one compensation record, with overrides. */
function insertCompensation(employeeId, overrides = {}) {
  const row = {
    employee_id: employeeId,
    version: 1,
    annual_base_salary: '1500000.00',
    annual_bonus: '150000.00',
    currency: 'INR',
    pay_frequency: 'MONTHLY',
    effective_from: '2025-04-01',
    change_reason: 'INITIAL_IMPORT',
    ...overrides,
  };
  return query('INSERT INTO compensation_records SET ?', [row]);
}

// The approved as-of read rule from docs/05-initial-database-schema.md.
async function currentCompensation(employeeId, asOf) {
  const rows = await query(
    `SELECT version, annual_base_salary FROM compensation_records
     WHERE employee_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, version DESC
     LIMIT 1`,
    [employeeId, asOf],
  );
  return rows[0] ?? null;
}

describe('initial schema: compensation records', () => {
  // Detects: a valid initial-import record rejected, or wrong created_at default.
  test('accepts compensation version 1 for a valid employee', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId);
    const [row] = await query(
      `SELECT version, currency, pay_frequency, effective_from, change_reason,
              ABS(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(3))) <= 5 AS recent
       FROM compensation_records WHERE employee_id = ?`,
      [employeeId],
    );
    assert.deepEqual({ ...row, recent: Number(row.recent) }, {
      version: 1,
      currency: 'INR',
      pay_frequency: 'MONTHLY',
      effective_from: '2025-04-01',
      change_reason: 'INITIAL_IMPORT',
      recent: 1,
    });
  });

  // Detects: money converted to a JavaScript float (1000000.1 instead of "1000000.10").
  test('returns salary and bonus as exact decimal strings', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId, { annual_base_salary: '1000000.10', annual_bonus: '0.00' });
    const [row] = await query('SELECT annual_base_salary, annual_bonus FROM compensation_records WHERE employee_id = ?', [employeeId]);
    assert.deepEqual(row, { annual_base_salary: '1000000.10', annual_bonus: '0.00' });
  });

  // Documents a real MySQL limit: DECIMAL(15,2) rounds a third decimal place
  // with a note, even in strict mode. The database cannot reject it, so the
  // importer must validate first (the workbook validator already rejects it).
  test('rounds a third decimal place, so application validation is required', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId, { annual_base_salary: '1000000.105' });
    const [row] = await query('SELECT annual_base_salary FROM compensation_records WHERE employee_id = ?', [employeeId]);
    assert.equal(row.annual_base_salary, '1000000.11');
  });

  test('rejects compensation for an unknown employee', async () => {
    await assertRejects(insertCompensation(999999), 'ER_NO_REFERENCED_ROW_2', 'fk_compensation_employee');
  });

  test('rejects a zero or negative annual base salary', async () => {
    const employeeId = await insertEmployee();
    for (const salary of ['0.00', '-1.00']) {
      await assertRejects(
        insertCompensation(employeeId, { annual_base_salary: salary }),
        'ER_CHECK_CONSTRAINT_VIOLATED',
        'chk_compensation_salary_positive',
      );
    }
  });

  // Detects: a ">= 0" check missing, while zero must stay allowed.
  test('rejects a negative annual bonus and accepts zero', async () => {
    const employeeId = await insertEmployee();
    await assertRejects(
      insertCompensation(employeeId, { annual_bonus: '-0.01' }),
      'ER_CHECK_CONSTRAINT_VIOLATED',
      'chk_compensation_bonus_non_negative',
    );
    await insertCompensation(employeeId, { annual_bonus: '0.00' });
  });

  test('rejects an unsupported currency, pay frequency, or change reason', async () => {
    const employeeId = await insertEmployee();
    await assertRejects(insertCompensation(employeeId, { currency: 'EUR' }), 'WARN_DATA_TRUNCATED');
    await assertRejects(insertCompensation(employeeId, { pay_frequency: 'WEEKLY' }), 'WARN_DATA_TRUNCATED');
    await assertRejects(insertCompensation(employeeId, { change_reason: 'BONUS' }), 'WARN_DATA_TRUNCATED');
  });

  test('rejects compensation version 0', async () => {
    const employeeId = await insertEmployee();
    await assertRejects(insertCompensation(employeeId, { version: 0 }), 'ER_CHECK_CONSTRAINT_VIOLATED', 'chk_compensation_version');
  });

  // Detects: two writers both creating "version 2" for one employee.
  test('rejects a duplicate employee and version pair', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId);
    await assertRejects(
      insertCompensation(employeeId, { effective_from: '2025-05-01' }),
      'ER_DUP_ENTRY',
      'uk_compensation_employee_version',
    );
  });

  // Detects: a unique key on (employee_id, effective_from) that blocks same-day corrections.
  test('allows two versions with the same effective date; the higher version wins', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId, { version: 1, annual_base_salary: '1500000.00' });
    await insertCompensation(employeeId, { version: 2, annual_base_salary: '1600000.00', change_reason: 'CORRECTION' });
    assert.deepEqual(await currentCompensation(employeeId, '2025-04-01'), { version: 2, annual_base_salary: '1600000.00' });
  });

  // Detects: a future-dated raise treated as current before its effective date.
  test('does not make a future record current for an earlier as-of date', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId, { version: 1, effective_from: '2024-01-01', annual_base_salary: '1500000.00' });
    await insertCompensation(employeeId, {
      version: 2,
      effective_from: '2027-01-01',
      annual_base_salary: '1700000.00',
      change_reason: 'PERFORMANCE',
    });
    assert.deepEqual(await currentCompensation(employeeId, '2026-12-31'), { version: 1, annual_base_salary: '1500000.00' });
    assert.deepEqual(await currentCompensation(employeeId, '2027-01-01'), { version: 2, annual_base_salary: '1700000.00' });
    assert.equal(await currentCompensation(employeeId, '2023-12-31'), null);
  });
});

describe('initial schema: delete protection', () => {
  // Detects: ON DELETE CASCADE that would erase salary history.
  test('prevents deleting an employee who has compensation records', async () => {
    const employeeId = await insertEmployee();
    await insertCompensation(employeeId);
    await assertRejects(query('DELETE FROM employees WHERE id = ?', [employeeId]), 'ER_ROW_IS_REFERENCED_2', 'fk_compensation_employee');
  });

  test('prevents deleting a referenced country', async () => {
    await insertEmployee();
    await assertRejects(query("DELETE FROM countries WHERE code = 'IN'"), 'ER_ROW_IS_REFERENCED_2', 'fk_employees_country');
  });

  test('prevents deleting a referenced department', async () => {
    await techTitle();
    await assertRejects(query("DELETE FROM departments WHERE name = 'Tech'"), 'ER_ROW_IS_REFERENCED_2', 'fk_job_titles_department');
  });

  test('prevents deleting a referenced job title', async () => {
    await insertEmployee();
    await assertRejects(query('DELETE FROM job_titles WHERE id = ?', [await techTitle()]), 'ER_ROW_IS_REFERENCED_2', 'fk_employees_job_title');
  });
});
