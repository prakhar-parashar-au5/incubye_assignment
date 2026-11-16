// Employee directory against real MySQL, real sessions, and the full
// 10,000-employee seed. Expected counts come from independent SQL; expected
// money values were computed with `bc` (see each test).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser, setHrUserStatus } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../../src/directory/exchange-rate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { selectRows } from '../support/db.js';
import { fakeDashboard, fakeSalaryAdjustments, noModelAssistant } from '../support/http.js';
import type { Row } from '../support/db.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();

// Synthetic test-only values.
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-demo-password';
const EMPLOYEES = '/api/v1/employees';
const OPTIONS = '/api/v1/employee-directory/options';

// Fixed test snapshot (same rate as the saved H.10 fixture).
const RATE: ExchangeRateSnapshot = {
  baseCurrency: 'USD',
  quoteCurrency: 'INR',
  rate: '93.9100',
  sourceName: 'test source',
  sourceUrl: 'https://example.test/rate',
  effectiveDate: '2026-11-06',
  retrievedAt: '2026-11-14T18:47:36Z',
};

let pool: Pool;
let dir: string;
let now: Date;
const clock = (): Date => now;
let logs: LogEntry[];
let meeraToken: string;
let rohanToken: string;
let meeraId: number;

const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const countOf = async (sql: string, params?: unknown[]): Promise<number> => Number(must((await query(sql, params))[0], 'count row').n);

function buildApp(exchangeRate: ExchangeRateSnapshot | null = RATE) {
  const tokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  const directory = createDirectoryService({ pool, exchangeRate, clock });
  return createApp({
    auth: createAuthService({ pool, tokens, clock }),
    directory,
    ...noModelAssistant(directory), salaryAdjustments: fakeSalaryAdjustments(), dashboard: fakeDashboard(),
    logger: (entry) => logs.push(entry),
    clientIpSource: 'socket',
  });
}
let app: ReturnType<typeof buildApp>;

async function tokenFor(email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.text);
  return String(res.body.token);
}
const get = (token: string, url: string, params: Record<string, string> = {}) =>
  request(app).get(url).query(params).set('Authorization', `Bearer ${token}`);
const list = async (token: string, params: Record<string, string> = {}) => {
  const res = await get(token, EMPLOYEES, params);
  assert.equal(res.status, 200, res.text);
  return res.body;
};
const codes = (body: { employees: { employeeCode: string }[] }): string[] => body.employees.map((e) => e.employeeCode);

/** Inserts one synthetic employee with the given compensation records. */
async function insertEmployee(e: {
  code: string; first: string; last: string; title: string; level: string; country: 'IN' | 'US';
  status: string; hire: string; end?: string;
  records: { version: number; base: string; bonus: string; from: string }[];
}): Promise<void> {
  const [title] = await query('SELECT id FROM job_titles WHERE name = ? AND level = ?', [e.title, e.level]);
  const [result] = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date, employment_end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.code, e.first, e.last, `${e.first}.${e.last}.${e.code}@acme.com`.toLowerCase(), must(title, e.title).id, e.country, e.status, e.hire, e.end ?? null],
  );
  const employeeId = (result as { insertId: number }).insertId;
  for (const r of e.records) {
    await pool.query(
      `INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, r.version, r.base, r.bonus, e.country === 'IN' ? 'INR' : 'USD', e.country === 'IN' ? 'MONTHLY' : 'ANNUAL', r.from, r.version === 1 ? 'INITIAL_IMPORT' : 'PERFORMANCE'],
    );
  }
}

const MARKERS = 7;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  dir = await mkdtemp(path.join(tmpdir(), 'acme-directory-'));
  const workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  await seedDatabase({ databaseUrl: DATABASE_URL, workbookPath, replace: true, appEnv: 'test' });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });

  // As-of date for every test: 2026-11-14.
  // Selection markers (India, Tech: visible to Rohan).
  await insertEmployee({
    code: 'ACME90001', first: 'Zorvex', last: 'Current', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'CURRENTLY_WORKING', hire: '2024-01-01',
    records: [
      { version: 1, base: '1500000.00', bonus: '0.00', from: '2024-01-01' },
      { version: 3, base: '2000000.00', bonus: '0.00', from: '2027-01-01' }, // future: must not be current yet
      { version: 2, base: '1800000.00', bonus: '100000.00', from: '2026-06-01' },
    ],
  });
  await insertEmployee({
    code: 'ACME90002', first: 'Zorvex', last: 'Samedate', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'CURRENTLY_WORKING', hire: '2025-01-01',
    records: [
      { version: 1, base: '1600000.00', bonus: '0.00', from: '2025-01-01' },
      { version: 2, base: '1880000.00', bonus: '0.00', from: '2025-01-01' },
    ],
  });
  await insertEmployee({
    code: 'ACME90003', first: 'Zorvex', last: 'Upcoming', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'SOON_TO_JOIN', hire: '2027-01-15',
    records: [
      { version: 2, base: '1950000.00', bonus: '0.00', from: '2027-03-01' },
      { version: 1, base: '1250000.00', bonus: '0.00', from: '2027-01-15' },
    ],
  });
  await insertEmployee({
    code: 'ACME90004', first: 'Zorvex', last: 'Departed', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'LEFT', hire: '2015-01-01', end: '2020-06-30',
    records: [
      { version: 1, base: '800000.00', bonus: '0.00', from: '2015-01-01' },
      { version: 2, base: '2200000.00', bonus: '0.00', from: '2019-04-01' },
      { version: 3, base: '2000000.00', bonus: '0.00', from: '2021-01-01' }, // after the end date
    ],
  });
  // Cross-currency sort markers. bc (scale=10, amount / 93.9100):
  //   1600000.00 INR -> 17037.5891811308   1600000.50 INR -> 17037.5945053774
  //   1700000.00 INR -> 18102.4385049516
  await insertEmployee({
    code: 'ACME90005', first: 'Quillon', last: 'Sortcheck', title: 'Software Engineer', level: 'MID', country: 'US',
    status: 'CURRENTLY_WORKING', hire: '2020-01-01', records: [{ version: 1, base: '17037.59', bonus: '0.00', from: '2020-01-01' }],
  });
  await insertEmployee({
    code: 'ACME90006', first: 'Quillon', last: 'Sortcheck', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'CURRENTLY_WORKING', hire: '2020-01-01', records: [{ version: 1, base: '1600000.00', bonus: '100000.00', from: '2020-01-01' }],
  });
  await insertEmployee({
    code: 'ACME90007', first: 'Quillon', last: 'Sortcheck', title: 'Software Engineer', level: 'MID', country: 'IN',
    status: 'CURRENTLY_WORKING', hire: '2020-01-01', records: [{ version: 1, base: '1600000.50', bonus: '0.00', from: '2020-01-01' }],
  });

  meeraId = await bootstrapHrUser(pool, {
    email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [],
  });
  await bootstrapHrUser(pool, {
    email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'],
  });
  await bootstrapHrUser(pool, {
    email: 'empty.scope@acme.com', displayName: 'Empty Scope', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: [],
  });
});
after(async () => {
  await pool?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  now = new Date('2026-11-14T10:00:00.000Z');
  logs = [];
  app = buildApp();
  meeraToken ??= await tokenFor('meera.iyer@acme.com');
  rohanToken ??= await tokenFor('rohan.mehta@acme.com');
});

const ROHAN_SCOPE_SQL = `FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
                         WHERE e.country_code = 'IN' AND d.name IN ('Tech', 'Support')`;

describe('authorization and non-disclosure', () => {
  // Detects: an Admin restricted by an empty scope list.
  test('Admin sees every employee', async () => {
    const body = await list(meeraToken);
    assert.equal(body.page.totalRows, 10000 + MARKERS);
    assert.equal(body.page.totalPages, Math.ceil((10000 + MARKERS) / 25));
  });

  // Detects: scope applied after pagination, or one scope list ignored.
  test('Rohan sees only India employees in Tech or Support, and totals exclude hidden employees', async () => {
    const expected = await countOf(`SELECT COUNT(*) AS n ${ROHAN_SCOPE_SQL}`);
    assert.ok(expected > 0 && expected < 10000);
    const body = await list(rohanToken, { pageSize: '100' });
    assert.equal(body.page.totalRows, expected);
    for (const row of body.employees) {
      assert.equal(row.country, 'IN');
      assert.ok(['Tech', 'Support'].includes(row.department), row.department);
    }
    const last = await list(rohanToken, { pageSize: '100', page: String(Math.ceil(expected / 100)), direction: 'desc' });
    for (const row of last.employees) assert.ok(row.country === 'IN' && ['Tech', 'Support'].includes(row.department));
  });

  // Detects: an empty scope list read as "no restriction".
  test('an empty department scope returns no employees and no options', async () => {
    const token = await tokenFor('empty.scope@acme.com');
    const body = await list(token);
    assert.deepEqual({ rows: body.employees, total: body.page.totalRows, pages: body.page.totalPages }, { rows: [], total: 0, pages: 0 });
    const options = (await get(token, OPTIONS)).body;
    assert.deepEqual([options.departments, options.countries, options.currencies, options.levels, options.statuses], [[], [], [], [], []]);
  });

  // Detects: search that bypasses scope.
  test('Rohan cannot find an out-of-scope employee by code, name, or email', async () => {
    for (const q of ['ACME90005', 'Quillon', 'quillon.sortcheck.acme90005@acme.com']) {
      const body = await list(rohanToken, { q });
      assert.ok(!codes(body).includes('ACME90005'), q);
    }
    const byCode = await list(rohanToken, { q: 'ACME90005' });
    assert.deepEqual([byCode.employees, byCode.page.totalRows], [[], 0]);
  });

  // Detects: a filter that widens scope.
  test('a filter cannot widen the scope', async () => {
    for (const params of [{ country: 'US' }, { department: 'HR' }, { currency: 'USD' }] as Record<string, string>[]) {
      const body = await list(rohanToken, params);
      assert.equal(body.page.totalRows, 0, JSON.stringify(params));
    }
  });

  // Detects: a 403 or a different body that confirms the employee exists.
  test('out-of-scope, unknown, and malformed detail requests return identical 404 bodies', async () => {
    const responses = [
      await get(rohanToken, `${EMPLOYEES}/ACME90005`),
      await get(rohanToken, `${EMPLOYEES}/ACME99998`),
      await get(rohanToken, `${EMPLOYEES}/not-a-code`),
      await get(meeraToken, `${EMPLOYEES}/ACME99998`),
    ];
    for (const res of responses) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Employee not found.' } });
    }
    assert.equal(new Set(responses.map((r) => r.text)).size, 1);
    assert.equal((await get(meeraToken, `${EMPLOYEES}/ACME90005`)).status, 200);
  });

  // Detects: options listing departments or countries outside the scope.
  test('options contain only values inside the caller scope', async () => {
    const rohan = (await get(rohanToken, OPTIONS)).body;
    assert.deepEqual(rohan.departments, ['Support', 'Tech']);
    assert.deepEqual(rohan.countries, [{ code: 'IN', name: 'India' }]);
    assert.deepEqual(rohan.currencies, ['INR']);
    const levels = (await query(`SELECT DISTINCT jt.level ${ROHAN_SCOPE_SQL} ORDER BY jt.level`)).map((r) => r.level);
    const statuses = (await query(`SELECT DISTINCT e.employment_status ${ROHAN_SCOPE_SQL} ORDER BY e.employment_status`)).map((r) => r.employment_status);
    assert.deepEqual(rohan.levels, levels);
    assert.deepEqual(rohan.statuses, statuses);

    const meera = (await get(meeraToken, OPTIONS)).body;
    assert.deepEqual(meera, {
      departments: ['Finance', 'HR', 'Operations', 'Support', 'Tech'],
      countries: [{ code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }],
      currencies: ['INR', 'USD'],
      levels: ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER'],
      statuses: ['SOON_TO_JOIN', 'CURRENTLY_WORKING', 'LEFT'],
      sortFields: ['name', 'employeeCode', 'department', 'country', 'level', 'hireDate', 'annualBaseSalary', 'annualCashCompensation'],
      comparisonCurrencies: ['USD'],
    });
  });

  // Detects: a directory endpoint reachable without a current valid session.
  test('missing, invalid, revoked, expired, and inactive sessions are rejected on all three endpoints', async () => {
    const revoked = await tokenFor('meera.iyer@acme.com');
    assert.equal((await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${revoked}`)).status, 204);
    const expiring = await tokenFor('meera.iyer@acme.com');
    const inactiveId = await bootstrapHrUser(pool, {
      email: 'soon.inactive@acme.com', displayName: 'Soon Inactive', password: PASSWORD, role: 'ADMIN', countries: [], departments: [],
    });
    const inactive = await tokenFor('soon.inactive@acme.com');
    await setHrUserStatus(pool, { actorHrUserId: meeraId, targetHrUserId: inactiveId, status: 'INACTIVE' });

    const urls = [EMPLOYEES, `${EMPLOYEES}/ACME00001`, OPTIONS];
    const expect401 = async (token: string | null, label: string) => {
      for (const url of urls) {
        const call = request(app).get(url);
        const res = token === null ? await call : await call.set('Authorization', `Bearer ${token}`);
        assert.equal(res.status, 401, `${label} ${url}`);
        assert.deepEqual(res.body, { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      }
    };
    await expect401(null, 'missing');
    await expect401('not.a.jwt', 'invalid');
    await expect401(revoked, 'revoked');
    await expect401(inactive, 'inactive');
    now = new Date('2026-11-14T12:00:01.000Z');
    await expect401(expiring, 'expired');
  });
});

describe('search', () => {
  // Detects: code search that is not exact or prefix.
  test('finds an employee by exact code and by code prefix, case-insensitively', async () => {
    assert.deepEqual(codes(await list(meeraToken, { q: 'ACME00001' })), ['ACME00001']);
    assert.deepEqual(codes(await list(meeraToken, { q: 'acme00001' })), ['ACME00001']);
    const prefix = await list(meeraToken, { q: 'ACME0000', sort: 'employeeCode' });
    assert.deepEqual(codes(prefix), ['ACME00001', 'ACME00002', 'ACME00003', 'ACME00004', 'ACME00005', 'ACME00006', 'ACME00007', 'ACME00008', 'ACME00009']);
  });

  // Detects: case-sensitive or full-match-only name search.
  test('finds employees by partial first, last, and full name without case sensitivity', async () => {
    for (const q of ['zorv', 'ZORVEX', 'departed', 'zorvex dep', 'Ex Depar']) {
      const body = await list(meeraToken, { q });
      assert.ok(codes(body).includes('ACME90004'), q);
    }
    assert.equal((await list(meeraToken, { q: 'zorvex' })).page.totalRows, 4);
    const sneha = await list(meeraToken, { q: 'sneha sin', pageSize: '100' });
    assert.ok(codes(sneha).includes('ACME00001'));
    for (const row of sneha.employees) assert.match(`${row.firstName} ${row.lastName}`, /sneha sin/i);
  });

  // Detects: email matched as a substring, or email matching that is case-sensitive.
  test('finds an employee by exact email without case sensitivity, but not by partial email', async () => {
    const email = String(must((await query("SELECT email FROM employees WHERE employee_code = 'ACME00001'"))[0], 'email').email);
    assert.deepEqual(codes(await list(meeraToken, { q: email.toUpperCase() })), ['ACME00001']);
    assert.equal((await list(meeraToken, { q: email.replace(/\.com$/, '') })).page.totalRows, 0);
    assert.equal((await list(meeraToken, { q: email.split('@')[0] ?? '' })).page.totalRows, 0);
  });

  // Detects: user wildcards acting as LIKE wildcards, or quotes breaking the SQL.
  test('wildcard and SQL control characters are searched literally', async () => {
    for (const q of ['%', '_', '\\', '%%', "' OR '1'='1", 'Zorvex%', 'Zorve_']) {
      const res = await get(meeraToken, EMPLOYEES, { q });
      assert.equal(res.status, 200, q);
      assert.equal(res.body.page.totalRows, 0, q);
    }
    // The seed has the surname D'Souza: a quote is ordinary search text.
    const quoted = await countOf("SELECT COUNT(*) AS n FROM employees WHERE last_name = 'D''Souza'");
    assert.ok(quoted > 0);
    assert.equal((await list(meeraToken, { q: "D'Souza" })).page.totalRows, quoted);
    const anyQuote = await countOf("SELECT COUNT(*) AS n FROM employees WHERE INSTR(first_name, '''') > 0 OR INSTR(last_name, '''') > 0");
    assert.ok(anyQuote >= quoted);
    assert.equal((await list(meeraToken, { q: "'" })).page.totalRows, anyQuote);
    assert.equal(await countOf('SELECT COUNT(*) AS n FROM employees'), 10000 + MARKERS);
  });
});

describe('filters', () => {
  const FILTER_SQL: Record<string, string> = {
    department: 'd.name = ?',
    country: 'e.country_code = ?',
    currency: '(SELECT c.currency FROM compensation_records c WHERE c.employee_id = e.id ORDER BY c.version DESC LIMIT 1) = ?',
    level: 'jt.level = ?',
    status: 'e.employment_status = ?',
  };
  const BASE = 'SELECT COUNT(*) AS n FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id';
  const ROW_FIELD: Record<string, (row: Record<string, unknown>) => unknown> = {
    department: (r) => r.department,
    country: (r) => r.country,
    currency: (r) => (r.compensation as { currency: string } | null)?.currency,
    level: (r) => r.level,
    status: (r) => r.employmentStatus,
  };

  // Detects: a filter ignored, applied to the wrong column, or applied only to the page.
  test('each filter alone matches independent SQL counts', async () => {
    const cases: [string, string][] = [
      ['department', 'Finance'], ['country', 'US'], ['currency', 'INR'], ['level', 'LEAD'], ['status', 'SOON_TO_JOIN'],
    ];
    for (const [field, value] of cases) {
      const body = await list(meeraToken, { [field]: value, pageSize: '100' });
      assert.equal(body.page.totalRows, await countOf(`${BASE} WHERE ${FILTER_SQL[field]}`, [value]), field);
      for (const row of body.employees) assert.equal(must(ROW_FIELD[field], field)(row), value, field);
    }
  });

  test('combined filters match independent SQL counts', async () => {
    const params = { department: 'Tech', country: 'IN', currency: 'INR', level: 'SENIOR', status: 'CURRENTLY_WORKING' };
    const body = await list(meeraToken, params);
    const where = Object.keys(params).map((k) => must(FILTER_SQL[k], k)).join(' AND ');
    const expected = await countOf(`${BASE} WHERE ${where}`, Object.values(params));
    assert.ok(expected > 0);
    assert.equal(body.page.totalRows, expected);
  });

  // Detects: scope and filters combined with OR instead of AND.
  test('Rohan with department=Tech sees only India Tech employees', async () => {
    const body = await list(rohanToken, { department: 'Tech' });
    assert.equal(body.page.totalRows, await countOf(`SELECT COUNT(*) AS n ${ROHAN_SCOPE_SQL} AND d.name = 'Tech'`));
  });
});

describe('pagination and sorting', () => {
  // Detects: no default limit, or wrong page metadata.
  test('returns 25 rows by default with page metadata', async () => {
    const body = await list(meeraToken);
    assert.equal(body.employees.length, 25);
    assert.deepEqual(body.page, { number: 1, size: 25, totalRows: 10000 + MARKERS, totalPages: 401 });
    assert.deepEqual(body.sort, { field: 'name', direction: 'asc', comparison: null });
  });

  test('returns no more than the requested page size', async () => {
    assert.equal((await list(meeraToken, { pageSize: '100' })).employees.length, 100);
    assert.equal((await list(meeraToken, { pageSize: '7' })).employees.length, 7);
  });

  // Detects: the final partial page or a page past the end handled incorrectly.
  test('the last page is partial and a page after it is empty with correct totals', async () => {
    const last = await list(meeraToken, { pageSize: '100', page: '101' });
    assert.equal(last.employees.length, MARKERS);
    const after = await list(meeraToken, { pageSize: '100', page: '102' });
    assert.deepEqual(after.employees, []);
    assert.deepEqual(after.page, { number: 102, size: 100, totalRows: 10000 + MARKERS, totalPages: 101 });
  });

  // Detects: unstable ordering that repeats or skips rows across pages.
  test('adjacent pages do not repeat rows for every sort', async () => {
    for (const sort of ['name', 'department', 'country', 'level', 'hireDate']) {
      const pages = [];
      for (const page of ['1', '2', '3']) pages.push(...codes(await list(meeraToken, { sort, page, pageSize: '100' })));
      assert.equal(new Set(pages).size, 300, sort);
    }
  });

  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const LEVEL_ORDER = ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER'];
  type DirRow = { employeeCode: string; firstName: string; lastName: string; department: string; country: string; level: string; hireDate: string };
  const KEY: Record<string, (a: DirRow, b: DirRow) => number> = {
    name: (a, b) => collator.compare(a.firstName, b.firstName) || collator.compare(a.lastName, b.lastName),
    employeeCode: (a, b) => a.employeeCode.localeCompare(b.employeeCode),
    department: (a, b) => collator.compare(a.department, b.department),
    country: (a, b) => a.country.localeCompare(b.country),
    level: (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
    hireDate: (a, b) => a.hireDate.localeCompare(b.hireDate),
  };

  // Detects: an ignored direction, a wrong sort column, or a missing tie-breaker.
  test('every non-salary sort orders ascending and descending with the employee-code tie-breaker', async () => {
    for (const [sort, compare] of Object.entries(KEY)) {
      for (const direction of ['asc', 'desc']) {
        const rows: DirRow[] = (await list(meeraToken, { sort, direction, pageSize: '100', page: '2' })).employees;
        for (let i = 1; i < rows.length; i += 1) {
          const a = must(rows[i - 1], 'row');
          const b = must(rows[i], 'row');
          const primary = direction === 'asc' ? compare(a, b) : compare(b, a);
          assert.ok(primary < 0 || (primary === 0 && a.employeeCode < b.employeeCode), `${sort} ${direction}: ${a.employeeCode} then ${b.employeeCode}`);
        }
      }
    }
  });
});

describe('compensation selection', () => {
  const detail = async (code: string) => {
    const res = await get(meeraToken, `${EMPLOYEES}/${code}`);
    assert.equal(res.status, 200, res.text);
    return res.body;
  };

  // Detects: a future raise shown as current, or the first record shown instead of the latest.
  test('CURRENTLY_WORKING selects the latest record on or before the as-of date', async () => {
    const { compensation } = await detail('ACME90001');
    assert.deepEqual(compensation, {
      state: 'CURRENT', version: 2, annualBaseSalary: '1800000.00', annualBonus: '100000.00', annualCashCompensation: '1900000.00',
      currency: 'INR', payFrequency: 'MONTHLY', effectiveFrom: '2026-06-01',
      // bc: 1800000/93.91 = 19167.28782877, 1900000/93.91 = 20232.13715259
      usdEquivalent: { annualBaseSalary: '19167.29', annualCashCompensation: '20232.14' },
    });
  });

  // Detects: an as-of date that is ignored (the future record becomes current on its date).
  test('a future record becomes current on its effective date', async () => {
    now = new Date('2027-01-01T00:00:00.000Z');
    app = buildApp();
    const token = await tokenFor('meera.iyer@acme.com');
    const res = await get(token, `${EMPLOYEES}/ACME90001`);
    assert.equal(res.body.compensation.version, 3);
    assert.equal(res.body.compensation.annualBaseSalary, '2000000.00');
  });

  // Detects: ties on one effective date resolved by insertion order.
  test('two records on one effective date use the higher version', async () => {
    const { compensation } = await detail('ACME90002');
    assert.equal(compensation.version, 2);
    assert.equal(compensation.annualBaseSalary, '1880000.00');
  });

  // Detects: SOON_TO_JOIN shown with the latest future record or labelled CURRENT.
  test('SOON_TO_JOIN selects the earliest future record as UPCOMING', async () => {
    const { compensation } = await detail('ACME90003');
    assert.equal(compensation.state, 'UPCOMING');
    assert.equal(compensation.version, 1);
    assert.equal(compensation.effectiveFrom, '2027-01-15');
  });

  // Detects: a record after the end date shown for a leaver, or LEFT labelled CURRENT.
  test('LEFT selects the latest record on or before the end date as HISTORICAL', async () => {
    const { compensation, employee } = await detail('ACME90004');
    assert.equal(employee.employmentEndDate, '2020-06-30');
    assert.equal(compensation.state, 'HISTORICAL');
    assert.equal(compensation.version, 2);
    assert.equal(compensation.annualBaseSalary, '2200000.00');
  });

  // Detects: the list and the detail selecting different records.
  test('directory rows use the same selection as detail', async () => {
    const body = await list(meeraToken, { q: 'zorvex', sort: 'employeeCode' });
    assert.deepEqual(body.employees.map((r: { compensation: { state: string; version: number } }) => [r.compensation.state, r.compensation.version]), [
      ['CURRENT', 2], ['CURRENT', 2], ['UPCOMING', 1], ['HISTORICAL', 2],
    ]);
  });

  // Detects: seeded values altered by float conversion or wrong selection on real data.
  test('seeded employees show exact decimal strings and the right state', async () => {
    const sneha = await detail('ACME00001');
    assert.deepEqual(
      { ...sneha.compensation, usdEquivalent: undefined },
      {
        state: 'CURRENT', version: 1, annualBaseSalary: '3026700.00', annualBonus: '531185.85', annualCashCompensation: '3557885.85',
        currency: 'INR', payFrequency: 'MONTHLY', effectiveFrom: '2024-02-06', usdEquivalent: undefined,
      },
    );
    // bc: 3026700/93.91 = 32229.7944840805, 3557885.85/93.91 = 37886.1234160366
    assert.deepEqual(sneha.compensation.usdEquivalent, { annualBaseSalary: '32229.79', annualCashCompensation: '37886.12' });
    assert.equal((await detail('ACME00024')).compensation.state, 'UPCOMING');
    const william = await detail('ACME00027');
    assert.deepEqual([william.compensation.state, william.compensation.annualCashCompensation, william.compensation.usdEquivalent],
      ['HISTORICAL', '82600.00', { annualBaseSalary: '82600.00', annualCashCompensation: '82600.00' }]);
  });
});

describe('employee detail', () => {
  // Detects: missing history, wrong order, or missing version.
  test('returns the employee version and every record in effective-date and version order', async () => {
    const body = (await get(meeraToken, `${EMPLOYEES}/ACME90001`)).body;
    assert.deepEqual(body.employee, {
      employeeCode: 'ACME90001', firstName: 'Zorvex', lastName: 'Current', email: 'zorvex.current.acme90001@acme.com',
      department: 'Tech', jobTitle: 'Software Engineer', level: 'MID', country: 'IN', employmentStatus: 'CURRENTLY_WORKING',
      hireDate: '2024-01-01', employmentEndDate: null, version: 1,
    });
    assert.deepEqual(body.compensationHistory.map((r: { version: number; effectiveFrom: string }) => [r.version, r.effectiveFrom]), [
      [1, '2024-01-01'], [2, '2026-06-01'], [3, '2027-01-01'],
    ]);
    assert.deepEqual(body.compensationHistory[1], {
      version: 2, annualBaseSalary: '1800000.00', annualBonus: '100000.00', annualCashCompensation: '1900000.00',
      currency: 'INR', payFrequency: 'MONTHLY', effectiveFrom: '2026-06-01', changeReason: 'PERFORMANCE',
    });
    assert.deepEqual(body.exchangeRate, RATE);
  });

  // Detects: internal database IDs in any response.
  test('responses contain no internal database IDs', async () => {
    const bodies = [
      (await get(meeraToken, `${EMPLOYEES}/ACME90001`)).body,
      await list(meeraToken),
      (await get(meeraToken, OPTIONS)).body,
    ];
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    bodies.forEach(walk);
    for (const key of keys) assert.doesNotMatch(key, /(^id$|Id$|_id$)/, key);
  });

  test('Rohan can open an in-scope employee', async () => {
    assert.equal((await get(rohanToken, `${EMPLOYEES}/ACME90001`)).status, 200);
  });
});

describe('cross-currency salary sorting', () => {
  const sortcheck = (sort: string, direction = 'asc') =>
    list(meeraToken, { q: 'Sortcheck', sort, direction, comparisonCurrency: 'USD' });

  // Detects: rounding before sorting (17037.59 USD would tie with 1600000.00 INR),
  // native sorting (INR would always sort after USD), or multiplying by the rate.
  test('base salary sorts by the unrounded USD value', async () => {
    assert.deepEqual(codes(await sortcheck('annualBaseSalary')), ['ACME90006', 'ACME90005', 'ACME90007']);
    assert.deepEqual(codes(await sortcheck('annualBaseSalary', 'desc')), ['ACME90007', 'ACME90005', 'ACME90006']);
  });

  // Detects: cash sorting that reuses base salary.
  test('annual cash compensation produces its own order', async () => {
    assert.deepEqual(codes(await sortcheck('annualCashCompensation')), ['ACME90005', 'ACME90007', 'ACME90006']);
  });

  // Detects: native values changed by conversion, or wrong display rounding.
  test('native values stay unchanged and USD equivalents round half-up for display', async () => {
    const body = await sortcheck('annualBaseSalary');
    const byCode = Object.fromEntries(body.employees.map((r: { employeeCode: string; compensation: unknown }) => [r.employeeCode, r.compensation]));
    assert.deepEqual(byCode.ACME90006.usdEquivalent, { annualBaseSalary: '17037.59', annualCashCompensation: '18102.44' });
    assert.deepEqual([byCode.ACME90006.annualBaseSalary, byCode.ACME90006.currency], ['1600000.00', 'INR']);
    assert.deepEqual(byCode.ACME90005.usdEquivalent, { annualBaseSalary: '17037.59', annualCashCompensation: '17037.59' });
    assert.deepEqual(body.sort, { field: 'annualBaseSalary', direction: 'asc', comparison: { currency: 'USD', exchangeRate: RATE } });
    assert.deepEqual(body.exchangeRate, RATE);
  });

  /** Integer key proportional to the exact USD value: USD cents x 9391, INR cents x 100. */
  const usdKey = (c: { annualBaseSalary: string; currency: string }): bigint => {
    const cents = BigInt(c.annualBaseSalary.replace('.', ''));
    return c.currency === 'USD' ? cents * 9391n : cents * 100n;
  };

  // Detects: sorting applied per page instead of before LIMIT/OFFSET.
  test('salary sort over all employees is ordered across page boundaries', async () => {
    const page1 = await list(meeraToken, { sort: 'annualBaseSalary', direction: 'desc', comparisonCurrency: 'USD', pageSize: '100' });
    const page2 = await list(meeraToken, { sort: 'annualBaseSalary', direction: 'desc', comparisonCurrency: 'USD', pageSize: '100', page: '2' });
    const keys = [...page1.employees, ...page2.employees].map((r: { compensation: { annualBaseSalary: string; currency: string } }) => usdKey(r.compensation));
    for (let i = 1; i < keys.length; i += 1) assert.ok(must(keys[i - 1], 'k') >= must(keys[i], 'k'), `position ${i}`);
    assert.equal(new Set([...codes(page1), ...codes(page2)]).size, 200);
  });

  // Detects: a fallback to native sorting when the rate is missing.
  test('a missing INR rate rejects salary sorting but not other requests', async () => {
    app = buildApp(null);
    for (const sort of ['annualBaseSalary', 'annualCashCompensation']) {
      const res = await get(meeraToken, EMPLOYEES, { sort, comparisonCurrency: 'USD' });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: { code: 'VALIDATION_ERROR', message: 'Salary sorting is unavailable: no saved INR exchange rate.' } });
    }
    // USD-only results need no rate.
    const usdOnly = await list(meeraToken, { q: 'Sortcheck', currency: 'USD', sort: 'annualBaseSalary', comparisonCurrency: 'USD' });
    assert.deepEqual(codes(usdOnly), ['ACME90005']);
    assert.deepEqual(usdOnly.sort.comparison, { currency: 'USD', exchangeRate: null });
    const plain = await list(meeraToken, { q: 'Sortcheck', sort: 'employeeCode' });
    assert.equal(plain.exchangeRate, null);
    assert.equal(plain.employees[1].compensation.usdEquivalent, null);
    assert.deepEqual(plain.employees[0].compensation.usdEquivalent, { annualBaseSalary: '17037.59', annualCashCompensation: '17037.59' });
    const options = (await get(meeraToken, OPTIONS)).body;
    assert.deepEqual(options.sortFields, ['name', 'employeeCode', 'department', 'country', 'level', 'hireDate']);
    assert.deepEqual(options.comparisonCurrencies, []);
  });

  // Detects: a stored per-employee converted salary.
  test('no converted salary column exists on employee or compensation tables', async () => {
    const columns = (await query(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('employees', 'compensation_records')",
    )).map((r) => String(r.c));
    for (const c of columns) assert.doesNotMatch(c, /usd|convert|exchange|rate/i, c);
  });
});

describe('logging', () => {
  // Detects: search text, employee identity, or salaries reaching the log.
  test('logs contain no search text, employee codes, names, emails, salaries, or tokens', async () => {
    await get(meeraToken, EMPLOYEES, { q: 'Zorvex' });
    await get(meeraToken, EMPLOYEES, { q: 'zorvex.current.acme90001@acme.com' });
    await get(meeraToken, `${EMPLOYEES}/ACME90001`);
    await get(rohanToken, `${EMPLOYEES}/ACME90005`);
    await get(meeraToken, `${EMPLOYEES}/ACME90001/extra`);
    await get(meeraToken, EMPLOYEES, { sort: 'annualBaseSalary', comparisonCurrency: 'USD' });
    const text = JSON.stringify(logs);
    for (const forbidden of ['Zorvex', 'zorvex', 'ACME9000', 'acme9000', '1800000', '19167', meeraToken, rohanToken, 'Bearer', 'SELECT']) {
      assert.ok(!text.includes(forbidden), `log contains ${forbidden}`);
    }
    assert.deepEqual(logs.map((l) => `${String(l.path)} ${String(l.status)}`), [
      `${EMPLOYEES} 200`, `${EMPLOYEES} 200`, `${EMPLOYEES}/:employeeCode 200`, `${EMPLOYEES}/:employeeCode 404`, 'UNMATCHED 404', `${EMPLOYEES} 200`,
    ]);
  });
});
