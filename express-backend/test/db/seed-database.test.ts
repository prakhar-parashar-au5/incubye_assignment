import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { ensureReferenceData, resolveJobTitleIds } from '../../src/seed/reference-data.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { execStatement, selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { must } from '../support/must.js';
import { thrown } from '../support/thrown.js';
import type { Connection, Pool, ResultSetHeader } from 'mysql2/promise';
import type { SeedResult } from '../../src/seed/seed-database.js';
import { writeTestWorkbook } from '../support/workbook-fixtures.js';

// Refuses to run unless DATABASE_URL names a database ending in _test.
const DATABASE_URL = testDatabaseUrl();

let pool: Pool;
let dir: string;
let workbookPath: string;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 2 });
  dir = await mkdtemp(path.join(tmpdir(), 'acme-seed-db-'));
  workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
});
after(async () => {
  await pool?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const exec = (sql: string, params?: unknown[]): Promise<ResultSetHeader> => execStatement(pool, sql, params);
const count = async (table: string): Promise<number> => Number(must((await query(`SELECT COUNT(*) AS n FROM ${table}`))[0], 'a count row').n);
const seed = () => seedDatabase({ databaseUrl: DATABASE_URL, workbookPath, replace: true, appEnv: 'test' });

/** Adds an employee that is not in the workbook, with one compensation record. */
async function insertMarkerEmployee() {
  const [{ id: titleId }] = await query("SELECT id FROM job_titles WHERE name = 'Tech Lead' AND level = 'LEAD'");
  const result = await exec(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code,
                            employment_status, hire_date)
     VALUES ('ACME99999', 'Marker', 'Only', 'marker.only.acme99999@acme.com', ?, 'IN', 'CURRENTLY_WORKING', '2020-01-01')`,
    [titleId],
  );
  await exec(
    `INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency,
                                       pay_frequency, effective_from, change_reason)
     VALUES (?, 1, '3500000.00', '0.00', 'INR', 'MONTHLY', '2020-01-01', 'INITIAL_IMPORT')`,
    [result.insertId],
  );
}

describe('reference data', () => {
  let connection: Connection;
  before(async () => {
    connection = await openConnection(DATABASE_URL);
  });
  after(() => connection.end());

  // Detects: missing or misspelled approved countries, departments, or titles.
  test('creates the approved countries, departments, and 44 job titles', async () => {
    const ids = await ensureReferenceData(connection);
    assert.equal(ids.size, 44);
    assert.deepEqual(await query('SELECT code, name, currency FROM countries ORDER BY code'), [
      { code: 'IN', name: 'India', currency: 'INR' },
      { code: 'US', name: 'United States', currency: 'USD' },
    ]);
    assert.deepEqual((await query('SELECT name FROM departments ORDER BY name')).map((r) => r.name), [
      'Finance', 'HR', 'Operations', 'Support', 'Tech',
    ]);
    const perDepartment = await query(
      `SELECT d.name AS department, COUNT(*) AS titles FROM job_titles jt
       JOIN departments d ON d.id = jt.department_id GROUP BY d.name ORDER BY d.name`,
    );
    assert.deepEqual(perDepartment.map((r) => `${r.department}:${r.titles}`), [
      'Finance:7', 'HR:9', 'Operations:7', 'Support:6', 'Tech:15',
    ]);
  });

  // Detects: duplicate reference rows on every seed.
  test('running reference-data setup again creates no duplicates', async () => {
    await ensureReferenceData(connection);
    assert.deepEqual([await count('countries'), await count('departments'), await count('job_titles')], [2, 5, 44]);
  });

  // Detects: "insert if missing" that silently accepts a wrong existing row.
  test('refuses an existing country with the wrong currency', async () => {
    await exec("UPDATE countries SET currency = 'USD' WHERE code = 'IN'");
    try {
      await assert.rejects(ensureReferenceData(connection), /country IN/);
    } finally {
      await exec("UPDATE countries SET currency = 'INR' WHERE code = 'IN'");
    }
  });

  // Detects: an unresolved title reaching the delete step.
  test('rejects an unresolved department, title, and level combination', () => {
    const ids = new Map([['Tech\u0000Tech Lead\u0000LEAD', 7]]);
    const rows = [
      { employee_code: 'ACME00001', department: 'Tech', job_title: 'Tech Lead', level: 'LEAD' },
      { employee_code: 'ACME00002', department: 'Tech', job_title: 'Tech Lead', level: 'MID' },
    ];
    assert.throws(() => resolveJobTitleIds(rows, ids), /ACME00002: Tech \/ Tech Lead \/ MID/);
  });
});

describe('seedDatabase', () => {
  let firstResult: SeedResult;
  before(async () => {
    firstResult = await seed();
  });

  // Detects: appends, skipped batches, or a wrong summary.
  test('inserts exactly 10,000 employees and 10,000 compensation records', async () => {
    assert.deepEqual(
      { employees: firstResult.employees, compensationRecords: firstResult.compensationRecords },
      { employees: 10000, compensationRecords: 10000 },
    );
    assert.equal(await count('employees'), 10000);
    assert.equal(await count('compensation_records'), 10000);
  });

  test('stores unique employee codes and email addresses', async () => {
    const [row] = await query('SELECT COUNT(DISTINCT employee_code) AS codes, COUNT(DISTINCT email) AS emails FROM employees');
    assert.deepEqual([Number(row.codes), Number(row.emails)], [10000, 10000]);
  });

  // Detects: compensation rows attached to the wrong or same employee.
  test('gives every employee exactly one compensation record', async () => {
    const rows = await query(
      `SELECT records, COUNT(*) AS employees FROM (
         SELECT e.id, COUNT(c.id) AS records FROM employees e
         LEFT JOIN compensation_records c ON c.employee_id = e.id GROUP BY e.id) per_employee
       GROUP BY records`,
    );
    assert.deepEqual(rows.map((r) => `${r.records}:${r.employees}`), ['1:10000']);
  });

  test('marks every compensation record as version 1 INITIAL_IMPORT', async () => {
    const rows = await query('SELECT version, change_reason, COUNT(*) AS n FROM compensation_records GROUP BY version, change_reason');
    assert.deepEqual(rows.map((r) => `${r.version}:${r.change_reason}:${r.n}`), ['1:INITIAL_IMPORT:10000']);
  });

  // Detects: wrong column mapping, rounding, date shifts, or a wrong job-title join.
  // Literal values from the approved generated workbook.
  test('matches selected workbook rows exactly', async () => {
    const rows = await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.email, d.name AS department, jt.name AS job_title,
              jt.level, e.country_code, c.currency, e.employment_status, e.hire_date, e.employment_end_date,
              c.annual_base_salary, c.pay_frequency, c.annual_bonus, c.effective_from
       FROM employees e
       JOIN job_titles jt ON jt.id = e.job_title_id
       JOIN departments d ON d.id = jt.department_id
       JOIN compensation_records c ON c.employee_id = e.id
       WHERE e.employee_code IN ('ACME00001', 'ACME00024', 'ACME00027')
       ORDER BY e.employee_code`,
    );
    assert.deepEqual(rows, [
      {
        employee_code: 'ACME00001', first_name: 'Sneha', last_name: 'Singh', email: 'sneha.singh.acme00001@acme.com',
        department: 'HR', job_title: 'Compensation Analyst', level: 'SENIOR', country_code: 'IN', currency: 'INR',
        employment_status: 'CURRENTLY_WORKING', hire_date: '2023-01-27', employment_end_date: null,
        annual_base_salary: '3026700.00', pay_frequency: 'MONTHLY', annual_bonus: '531185.85', effective_from: '2024-02-06',
      },
      {
        employee_code: 'ACME00024', first_name: 'Patricia', last_name: 'Martinez', email: 'patricia.martinez.acme00024@acme.com',
        department: 'Tech', job_title: 'Junior Software Engineer', level: 'JUNIOR', country_code: 'US', currency: 'USD',
        employment_status: 'SOON_TO_JOIN', hire_date: '2027-01-30', employment_end_date: null,
        annual_base_salary: '82200.00', pay_frequency: 'ANNUAL', annual_bonus: '2000.00', effective_from: '2027-01-30',
      },
      {
        employee_code: 'ACME00027', first_name: 'William', last_name: 'Martinez', email: 'william.martinez.acme00027@acme.com',
        department: 'Tech', job_title: 'Quality Engineer', level: 'MID', country_code: 'US', currency: 'USD',
        employment_status: 'LEFT', hire_date: '2013-08-15', employment_end_date: '2017-11-13',
        annual_base_salary: '82600.00', pay_frequency: 'ANNUAL', annual_bonus: '0.00', effective_from: '2017-01-09',
      },
    ]);
  });

  // Detects: distributions altered between workbook and database.
  test('matches the approved country, department, level, and status totals', async () => {
    const totals = async (sql: string): Promise<string[]> => (await query(sql)).map((r) => `${r.k}:${r.n}`);
    const base = `FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id`;
    assert.deepEqual(await totals(`SELECT e.country_code AS k, COUNT(*) AS n ${base} GROUP BY k ORDER BY k`), ['IN:7000', 'US:3000']);
    assert.deepEqual(await totals(`SELECT d.name AS k, COUNT(*) AS n ${base} GROUP BY k ORDER BY k`), [
      'Finance:800', 'HR:700', 'Operations:2000', 'Support:2500', 'Tech:4000',
    ]);
    assert.deepEqual(await totals(`SELECT CAST(jt.level AS CHAR) AS k, COUNT(*) AS n ${base} GROUP BY k ORDER BY k`), [
      'JUNIOR:2500', 'LEAD:800', 'MANAGER:700', 'MID:3500', 'SENIOR:2500',
    ]);
    assert.deepEqual(await totals(`SELECT CAST(e.employment_status AS CHAR) AS k, COUNT(*) AS n ${base} GROUP BY k ORDER BY k`), [
      'CURRENTLY_WORKING:8500', 'LEFT:1000', 'SOON_TO_JOIN:500',
    ]);
  });

  // Detects: deletion that starts before the complete workbook is validated.
  test('leaves existing data untouched when the workbook is invalid', async () => {
    const badPath = path.join(dir, 'one-row.xlsx');
    await writeTestWorkbook(badPath); // one valid row: fails the 10,000-row data set check
    const idsBefore = (await query('SELECT id FROM employees ORDER BY id')).map((r) => r.id);
    await assert.rejects(
      seedDatabase({ databaseUrl: DATABASE_URL, workbookPath: badPath, replace: true, appEnv: 'test' }),
      (error: unknown) => thrown(error).code === 'INVALID_WORKBOOK' && thrown(error).details.some((d) => /expected 10000 employees/.test(d)),
    );
    assert.deepEqual((await query('SELECT id FROM employees ORDER BY id')).map((r) => r.id), idsBefore);
    assert.equal(await count('compensation_records'), 10000);
  });

  // Detects: append or upsert behaviour instead of full replacement.
  test('replaces existing data on a second run instead of appending', async () => {
    await insertMarkerEmployee();
    assert.equal(await count('employees'), 10001);

    await seed();

    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM employees WHERE employee_code = 'ACME99999'"))[0].n), 0);
    assert.equal(await count('employees'), 10000);
    assert.equal(await count('compensation_records'), 10000);
    const [row] = await query(
      `SELECT e.email, c.annual_base_salary FROM employees e JOIN compensation_records c ON c.employee_id = e.id
       WHERE e.employee_code = 'ACME00001'`,
    );
    assert.deepEqual(row, { email: 'sneha.singh.acme00001@acme.com', annual_base_salary: '3026700.00' });
  });

  // Detects: deletes committed before the inserts (TRUNCATE, autocommit,
  // or a second connection), leaving an empty or partial table after a failure.
  test('rolls back the deletes and inserts when an insert fails inside the transaction', async () => {
    await insertMarkerEmployee();
    const idsBefore = (await query('SELECT id FROM employees ORDER BY id')).map((r) => r.id);
    const compensationIdsBefore = (await query('SELECT id FROM compensation_records ORDER BY id')).map((r) => r.id);

    // Test-only failure: a temporary CHECK that every existing row passes and
    // every new compensation row fails, so the first compensation insert fails
    // after both deletes and all 10,000 employee inserts. (A trigger would need
    // the SUPER privilege because binary logging is on.)
    const [{ cutoff }] = await query('SELECT UTC_TIMESTAMP(3) AS cutoff');
    await query('SELECT SLEEP(0.01)');
    await exec(`ALTER TABLE compensation_records ADD CONSTRAINT test_only_fail_seed CHECK (created_at <= '${cutoff}')`);
    try {
      await assert.rejects(seed(), (error: unknown) => {
        assert.equal(thrown(error).code, 'ER_CHECK_CONSTRAINT_VIOLATED');
        assert.match(thrown(error).message, /test_only_fail_seed/);
        return true;
      });
    } finally {
      await exec('ALTER TABLE compensation_records DROP CHECK test_only_fail_seed');
    }

    assert.deepEqual((await query('SELECT id FROM employees ORDER BY id')).map((r) => r.id), idsBefore);
    assert.deepEqual((await query('SELECT id FROM compensation_records ORDER BY id')).map((r) => r.id), compensationIdsBefore);
    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM employees WHERE employee_code = 'ACME99999'"))[0].n), 1);
  });

  // Detects: a seed that only works once (e.g. leftover state after rollback).
  test('a seed after the rolled-back run still produces 10,000 and 10,000', async () => {
    const result = await seed();
    assert.deepEqual([result.employees, result.compensationRecords], [10000, 10000]);
    assert.deepEqual([await count('employees'), await count('compensation_records')], [10000, 10000]);
  });
});
