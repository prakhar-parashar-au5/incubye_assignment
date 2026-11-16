// Dashboard analytics against real MySQL with a small hand-built fixture.
// Every expected number below is calculated by hand from the fixture table.
//
// NOW = 2026-11-15T10:00:00Z, as-of date 2026-11-15.
//
// code       dept     country status        records (base / bonus, effective, created)
// ACME00301  Tech     IN      WORKING       v1 1000000/100000 2020-01-01 (import)
// ACME00302  Tech     IN      WORKING       v1 1200000/0 (import)
// ACME00303  Tech     IN      WORKING       v1 1400000/50000 (import); v2 1500000/50000 eff 2026-11-10, created 2026-11-01 09:00
// ACME00304  Tech     IN      WORKING       v1 1100000/0 (import); v2 1210000/0 eff 2026-12-01 (future), created 2026-11-14 08:00 by Meera
// ACME00305  Tech     IN      WORKING       v1 1300000/0 (import); v2 1350000/0 eff 2026-11-01, created 2026-05-01 12:00
// ACME00306  Support  IN      WORKING       v1 900000/20000 (import)
// ACME00307  Support  IN      SOON_TO_JOIN  v1 1000000/0 eff 2027-01-15 (import)
// ACME00308  Support  IN      LEFT          v1 800000/0 eff 2015-01-01 (import)
// ACME00309  Finance  US      WORKING       v1 150000/5000 (import)
// ACME00310  Finance  US      WORKING       v1 120000/0.01 (import); v2 130000/0.01 eff 2024-06-01, created 2025-06-01 12:00
// ACME00311  Finance  US      SOON_TO_JOIN  v1 125000/2000 eff 2027-02-01 (import)
// ACME00312  HR       IN      WORKING       v1 1000000/0 (import); v2 1050000/0 CORRECTION eff 2026-09-01, created 2026-09-01 12:00
//
// Rohan: IN AND (Tech OR Support). Empty: IN with no departments.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createDashboardService } from '../../src/dashboard/dashboard-service.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../../src/directory/exchange-rate.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import { fakeSalaryAdjustments, noModelAssistant } from '../support/http.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-demo-password';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const clock = (): Date => NOW;
const RATE: ExchangeRateSnapshot = {
  baseCurrency: 'USD', quoteCurrency: 'INR', rate: '93.9100', sourceName: 'test source',
  sourceUrl: 'https://example.test/rate', effectiveDate: '2026-11-06', retrievedAt: '2026-11-14T18:47:36Z',
};

let pool: Pool;
let logs: LogEntry[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};
const empIds: Record<string, number> = {};

function buildApp(exchangeRate: ExchangeRateSnapshot | null = RATE) {
  const sessionTokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  const directory = createDirectoryService({ pool, exchangeRate, clock });
  return createApp({
    auth: createAuthService({ pool, tokens: sessionTokens, clock }),
    directory,
    ...noModelAssistant(directory),
    salaryAdjustments: fakeSalaryAdjustments(),
    dashboard: createDashboardService({ pool, exchangeRate, clock }),
    logger: (entry) => logs.push(entry),
    clientIpSource: 'socket',
  });
}
let app: ReturnType<typeof buildApp>;

const get = (who: string, path: string, query: Record<string, string> = {}, target = app) =>
  request(target).get(`/api/v1/dashboard/${path}`).query(query).set('Authorization', `Bearer ${tokens[who] ?? ''}`);
async function ok(who: string, path: string, query: Record<string, string> = {}, target = app) {
  const res = await get(who, path, query, target);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function insertEmployee(code: string, title: string, level: string, country: 'IN' | 'US', status: string, hire: string, end: string | null) {
  const [t] = await selectRows(pool, 'SELECT id FROM job_titles WHERE name = ? AND level = ?', [title, level]);
  const [result] = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date, employment_end_date)
     VALUES (?, 'Dash', ?, ?, ?, ?, ?, ?, ?)`,
    [code, code.slice(-3), `dash.${code.toLowerCase()}@acme.com`, must(t, title).id, country, status, hire, end],
  );
  empIds[code] = (result as { insertId: number }).insertId;
}
async function insertRecord(code: string, version: number, base: string, bonus: string, from: string, reason: string, createdAt: string, extra: Record<string, unknown> = {}) {
  const country = code >= 'ACME00309' && code <= 'ACME00311' ? 'US' : 'IN';
  await pool.query('INSERT INTO compensation_records SET ?', [{
    employee_id: empIds[code], version, annual_base_salary: base, annual_bonus: bonus, currency: country === 'IN' ? 'INR' : 'USD',
    pay_frequency: country === 'IN' ? 'MONTHLY' : 'ANNUAL', effective_from: from, change_reason: reason, created_at: createdAt, ...extra,
  }]);
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 6 });
  const connection = await openConnection(DATABASE_URL);
  try {
    await ensureReferenceData(connection);
  } finally {
    await connection.end();
  }
  ids.meera = await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  ids.rohan = await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  ids.empty = await bootstrapHrUser(pool, { email: 'empty@acme.com', displayName: 'Empty Scope', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: [] });

  const imported = '2026-01-01 00:00:00.000';
  const fixture: [string, string, string, 'IN' | 'US', string, string, string | null, string, string, string][] = [
    ['ACME00301', 'Software Engineer', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1000000.00', '100000.00', '2020-01-01'],
    ['ACME00302', 'Software Engineer', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1200000.00', '0.00', '2020-01-01'],
    ['ACME00303', 'Software Engineer', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1400000.00', '50000.00', '2020-01-01'],
    ['ACME00304', 'Software Engineer', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1100000.00', '0.00', '2020-01-01'],
    ['ACME00305', 'Software Engineer', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1300000.00', '0.00', '2020-01-01'],
    ['ACME00306', 'Support Specialist', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '900000.00', '20000.00', '2020-01-01'],
    ['ACME00307', 'Support Specialist', 'MID', 'IN', 'SOON_TO_JOIN', '2027-01-15', null, '1000000.00', '0.00', '2027-01-15'],
    ['ACME00308', 'Support Specialist', 'MID', 'IN', 'LEFT', '2015-01-01', '2025-06-30', '800000.00', '0.00', '2015-01-01'],
    ['ACME00309', 'Senior Accountant', 'SENIOR', 'US', 'CURRENTLY_WORKING', '2020-01-01', null, '150000.00', '5000.00', '2020-01-01'],
    ['ACME00310', 'Senior Accountant', 'SENIOR', 'US', 'CURRENTLY_WORKING', '2020-01-01', null, '120000.00', '0.01', '2020-01-01'],
    ['ACME00311', 'Senior Accountant', 'SENIOR', 'US', 'SOON_TO_JOIN', '2027-02-01', null, '125000.00', '2000.00', '2027-02-01'],
    ['ACME00312', 'HR Generalist', 'MID', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null, '1000000.00', '0.00', '2020-01-01'],
  ];
  for (const [code, title, level, country, status, hire, end, base, bonus, from] of fixture) {
    await insertEmployee(code, title, level, country, status, hire, end);
    await insertRecord(code, 1, base, bonus, from, 'INITIAL_IMPORT', imported);
  }
  await insertRecord('ACME00303', 2, '1500000.00', '50000.00', '2026-11-10', 'PERFORMANCE', '2026-11-01 09:00:00.000');
  await insertRecord('ACME00304', 2, '1210000.00', '0.00', '2026-12-01', 'MARKET_ADJUSTMENT', '2026-11-14 08:00:00.000', { changed_by_hr_user_id: ids.meera, operation_idempotency_key: 'dash-fixture-0001', operation_fingerprint: 'a'.repeat(64) });
  await insertRecord('ACME00305', 2, '1350000.00', '0.00', '2026-11-01', 'PROMOTION', '2026-05-01 12:00:00.000');
  await insertRecord('ACME00310', 2, '130000.00', '0.01', '2024-06-01', 'PERFORMANCE', '2025-06-01 12:00:00.000');
  await insertRecord('ACME00312', 2, '1050000.00', '0.00', '2026-09-01', 'CORRECTION', '2026-09-01 12:00:00.000');

  // Requests: pending ACME00306 (in Rohan scope) and ACME00309 (US); stale ACME00301; cancelled ACME00302.
  const requestRow = (code: string, status: string, n: number, extra: Record<string, unknown> = {}) => ({
    public_id: `00000000-0000-4000-8000-00000000000${n}`, employee_id: empIds[code], requested_by_hr_user_id: ids.rohan,
    adjustment_target: 'BASE_SALARY', adjustment_method: 'PERCENTAGE_INCREASE', input_value: '5.00', currency: code === 'ACME00309' ? 'USD' : 'INR',
    previous_target_value: '100.00', proposed_target_value: '105.00', requested_against_version: 1, base_compensation_version: 1,
    effective_from: '2026-11-20', change_reason: 'PERFORMANCE', status, request_idempotency_key: `dash-req-key-000${n}`,
    created_at: '2026-11-12 10:00:00.000', updated_at: '2026-11-12 10:00:00.000', ...extra,
  });
  for (const row of [
    requestRow('ACME00306', 'PENDING', 1),
    requestRow('ACME00309', 'PENDING', 2),
    requestRow('ACME00301', 'STALE', 3, { decided_at: '2026-11-13 10:00:00.000', decision_note: 'Compensation changed after this request was created.' }),
    requestRow('ACME00302', 'CANCELLED', 4, { decided_by_hr_user_id: ids.meera, decided_at: '2026-11-13 10:00:00.000', decision_note: 'No budget.', decision_idempotency_key: 'dash-dec-key-0004' }),
  ]) await pool.query('INSERT INTO compensation_change_requests SET ?', [row]);

  app = buildApp();
  for (const who of ['meera', 'rohan', 'empty']) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: `${who}@acme.com`, password: PASSWORD });
    assert.equal(res.status, 200, res.text);
    tokens[who] = String(res.body.token);
  }
});
after(async () => {
  await pool?.end();
});
beforeEach(() => {
  logs = [];
  app = buildApp();
});

describe('summary', () => {
  // Detects: wrong status rules, currency mixing, or totals that include LEFT or SOON_TO_JOIN.
  test('Admin figures match the hand-calculated fixture', async () => {
    const body = await ok('meera', 'summary');
    assert.equal(body.asOf, '2026-11-15');
    assert.deepEqual(body.access, { hasEmployeeAccess: true, message: null, scope: { kind: 'ALL', countries: [], departments: [] } });
    const f = body.figures;
    assert.deepEqual(f.headcount, { currentlyWorking: 9, soonToJoin: 2, left: 1, notApplied: [] });
    // INR working: 301 1000000/100000, 302 1200000/0, 303 v2 1500000/50000, 304 v1 1100000/0 (v2 is future),
    // 305 v2 1350000/0, 306 900000/20000, 312 v2 1050000/0. USD working: 309 150000/5000, 310 v2 130000/0.01.
    assert.deepEqual(f.currentSpending.byCurrency.map((c: Record<string, unknown>) => ({ ...c, usdEquivalent: undefined })), [
      { currency: 'INR', employeeCount: 7, annualBaseSalary: '8100000.00', annualCashCompensation: '8270000.00', usdEquivalent: undefined },
      { currency: 'USD', employeeCount: 2, annualBaseSalary: '280000.00', annualCashCompensation: '285000.01', usdEquivalent: undefined },
    ]);
    // bc: 8100000/93.91 = 86252.795229..., 8270000/93.91 = 88063.038015...
    assert.deepEqual(f.currentSpending.byCurrency[0].usdEquivalent, { annualBaseSalary: '86252.80', annualCashCompensation: '88063.04' });
    assert.deepEqual(f.currentSpending.byCurrency[1].usdEquivalent, { annualBaseSalary: '280000.00', annualCashCompensation: '285000.01' });
    // Commitment: SOON_TO_JOIN INR 307 1000000; USD 311 127000. Approved future change 304: 1210000 - 1100000 = +110000 INR.
    assert.deepEqual(f.upcomingCommitment.byCurrency, [
      { currency: 'INR', soonToJoinCount: 1, soonToJoinAnnualCashCompensation: '1000000.00', approvedFutureChangeCount: 1, approvedFutureChangeAnnualCashImpact: '110000.00', totalAnnualCashCommitment: '1110000.00' },
      { currency: 'USD', soonToJoinCount: 1, soonToJoinAnnualCashCompensation: '127000.00', approvedFutureChangeCount: 0, approvedFutureChangeAnnualCashImpact: '0.00', totalAnnualCashCommitment: '127000.00' },
    ]);
    assert.equal(f.upcomingCommitment.upcomingChanges.total, 1);
    assert.deepEqual(f.upcomingCommitment.upcomingChanges.items[0], {
      employee: { employeeCode: 'ACME00304', name: 'Dash 304', department: 'Tech', country: 'IN', employmentStatus: 'CURRENTLY_WORKING' },
      currency: 'INR',
      previous: { annualBaseSalary: '1100000.00', annualBonus: '0.00', annualCashCompensation: '1100000.00' },
      scheduled: { annualBaseSalary: '1210000.00', annualBonus: '0.00', annualCashCompensation: '1210000.00' },
      effectiveFrom: '2026-12-01', changeReason: 'MARKET_ADJUSTMENT', approvedBy: { displayName: 'Meera Iyer' }, requestId: null,
    });
    // Pending: 306, 309. Stale: 301 (not pending). Cancelled 302 counts nowhere.
    assert.deepEqual(f.requests, { pending: 2, stale: 1, notApplied: [] });
    // Recorded in the last 30 days: 303 (11-01), 304 (11-14). 305 (created May, effective Nov) is excluded.
    assert.deepEqual(f.recentChanges, { periodDays: 30, count: 2, notApplied: [] });
    // Working with no non-import record created in the last 12 months: 301, 302, 306, 309, 310 (its change was recorded 2025-06-01).
    assert.deepEqual(f.withoutRecentAdjustment, { months: 12, definition: 'No recorded salary adjustment since import or during the selected period.', count: 5, notApplied: [] });
    assert.equal(f.usdComparison.available, true);
    assert.equal(f.usdComparison.quoteDescription, '1 USD = 93.9100 INR (INR per one US dollar)');
    assert.deepEqual(f.usdComparison.exchangeRate, RATE);
    // 86252.80 + 280000.00 and 88063.04 + 285000.01, summed from the rounded per-currency equivalents.
    assert.deepEqual(f.usdComparison.currentSpending, { annualBaseSalary: '366252.80', annualCashCompensation: '373063.05' });
  });

  // Detects: scope missing from any one metric.
  test('Rohan sees only India Tech and Support on every metric', async () => {
    const body = await ok('rohan', 'summary');
    assert.deepEqual(body.access.scope, { kind: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] });
    const f = body.figures;
    assert.deepEqual([f.headcount.currentlyWorking, f.headcount.soonToJoin, f.headcount.left], [6, 1, 1]);
    // 301+302+303+304+305+306 bases: 1000000+1200000+1500000+1100000+1350000+900000; cash adds 100000+50000+20000.
    assert.deepEqual(f.currentSpending.byCurrency.map((c: { currency: string; employeeCount: number; annualBaseSalary: string; annualCashCompensation: string }) => [c.currency, c.employeeCount, c.annualBaseSalary, c.annualCashCompensation]),
      [['INR', 6, '7050000.00', '7220000.00']]);
    assert.deepEqual(f.upcomingCommitment.byCurrency.map((c: { currency: string; totalAnnualCashCommitment: string }) => [c.currency, c.totalAnnualCashCommitment]), [['INR', '1110000.00']]);
    assert.deepEqual(f.requests, { pending: 1, stale: 1, notApplied: [] });
    assert.equal(f.recentChanges.count, 2);
    assert.equal(f.withoutRecentAdjustment.count, 3);
    // No hidden employee, department, or USD amount (the rate context names USD as its base currency).
    assert.doesNotMatch(JSON.stringify(body), /ACME0030[89]|ACME0031|Finance|"HR"|"currency":"USD"/);
  });

  // Detects: an empty scope read as "no restriction", or zeros that hint at hidden data.
  test('an empty scope returns no figures and the no-access message', async () => {
    for (const path of ['summary', 'breakdowns', 'recent-changes', 'without-recent-adjustment']) {
      const body = await ok('empty', path);
      assert.deepEqual(body.access, { hasEmployeeAccess: false, message: 'Your HR account has no employee access.', scope: { kind: 'SCOPED', countries: ['IN'], departments: [] } }, path);
      if (path === 'summary') assert.equal(body.figures, null);
      if (path === 'breakdowns') assert.deepEqual(body.groups, []);
      if (path === 'recent-changes') assert.deepEqual([body.changes, body.page.totalRows], [[], 0]);
      if (path === 'without-recent-adjustment') assert.deepEqual([body.employees, body.page.totalRows], [[], 0]);
    }
  });

  // Detects: a filter widening scope, or filters not narrowing every compatible metric.
  test('filters narrow every compatible metric and cannot widen scope', async () => {
    const tech = (await ok('meera', 'summary', { department: 'Tech' })).figures;
    assert.deepEqual([tech.headcount.currentlyWorking, tech.headcount.soonToJoin, tech.headcount.left], [5, 0, 0]);
    assert.deepEqual(tech.currentSpending.byCurrency.map((c: { annualBaseSalary: string }) => c.annualBaseSalary), ['6150000.00']);
    assert.deepEqual([tech.requests.pending, tech.requests.stale, tech.recentChanges.count, tech.withoutRecentAdjustment.count], [0, 1, 2, 2]);
    const usd = (await ok('meera', 'summary', { currency: 'USD' })).figures;
    assert.deepEqual([usd.headcount.currentlyWorking, usd.headcount.soonToJoin, usd.requests.pending, usd.recentChanges.count, usd.withoutRecentAdjustment.count], [2, 1, 1, 0, 2]);
    assert.deepEqual(usd.currentSpending.byCurrency.map((c: { currency: string }) => c.currency), ['USD']);
    for (const widen of [{ country: 'US' }, { department: 'Finance' }, { department: 'HR' }, { currency: 'USD' }] as Record<string, string>[]) {
      const f = (await ok('rohan', 'summary', widen)).figures;
      assert.deepEqual([f.headcount.currentlyWorking, f.headcount.soonToJoin, f.headcount.left, f.currentSpending.byCurrency.length, f.requests.pending, f.recentChanges.count, f.withoutRecentAdjustment.count], [0, 0, 0, 0, 0, 0, 0], JSON.stringify(widen));
    }
  });

  // Detects: a status filter silently ignored by the working-only sections.
  test('the employment-status filter is applied where meaningful and reported where not', async () => {
    const left = (await ok('meera', 'summary', { employmentStatus: 'LEFT' })).figures;
    assert.deepEqual([left.headcount.currentlyWorking, left.headcount.soonToJoin, left.headcount.left], [0, 0, 1]);
    const note = { filter: 'employmentStatus', reason: 'This section includes currently working employees only.' };
    assert.deepEqual(left.currentSpending.notApplied, [note]);
    assert.deepEqual(left.withoutRecentAdjustment.notApplied, [note]);
    assert.equal(left.currentSpending.byCurrency.length, 2, 'spending still shows working employees');
    assert.deepEqual(left.upcomingCommitment.byCurrency, []);
    const working = (await ok('meera', 'summary', { employmentStatus: 'CURRENTLY_WORKING' })).figures;
    assert.deepEqual([working.currentSpending.notApplied, working.headcount.soonToJoin], [[], 0]);
  });

  // Detects: the whole dashboard failing when only the optional conversion is missing.
  test('a missing exchange rate keeps native figures and marks USD comparison unavailable', async () => {
    const noRate = buildApp(null);
    const f = (await ok('meera', 'summary', {}, noRate)).figures;
    assert.deepEqual(f.currentSpending.byCurrency.map((c: { annualCashCompensation: string; usdEquivalent: unknown }) => [c.annualCashCompensation, c.usdEquivalent]), [['8270000.00', null], ['285000.01', { annualBaseSalary: '280000.00', annualCashCompensation: '285000.01' }]]);
    assert.deepEqual({ ...f.usdComparison, disclaimer: undefined }, {
      available: false, unavailableReason: 'USD comparison is unavailable: no saved exchange rate. Native totals are unaffected.',
      exchangeRate: null, quoteDescription: null, currentSpending: null, disclaimer: undefined,
    });
  });

  test('the periods change the time-based figures only', async () => {
    const seven = (await ok('meera', 'summary', { periodDays: '7' })).figures;
    const ninety = (await ok('meera', 'summary', { periodDays: '90' })).figures;
    assert.deepEqual([seven.recentChanges.count, ninety.recentChanges.count], [1, 3]);
    assert.equal(seven.headcount.currentlyWorking, 9);
    // 24 months (since 2024-11-15): 310's change recorded 2025-06-01 now counts, so 301, 302, 306, 309 remain.
    const two = (await ok('meera', 'summary', { noAdjustmentMonths: '24' })).figures;
    assert.equal(two.withoutRecentAdjustment.count, 4);
    const three = (await ok('meera', 'summary', { noAdjustmentMonths: '3' })).figures;
    // 3 months (since 2026-08-15): 301, 302, 305, 306, 309, 310 have no record created in the window.
    assert.equal(three.withoutRecentAdjustment.count, 6);
  });
});

describe('breakdowns', () => {
  type Group = Record<string, unknown>;
  const strip = (groups: Group[]) => groups.map(({ usdEquivalent: _u, ...g }) => g);

  // Detects: wrong average or median, rounding errors, and currency mixing within a group.
  test('department breakdown: exact sums, half-up average, odd and even medians', async () => {
    const body = await ok('meera', 'breakdowns', { breakdown: 'DEPARTMENT' });
    assert.equal(body.population, 'CURRENTLY_WORKING');
    assert.deepEqual(strip(body.groups), [
      // Finance USD: cash 155000.00 and 130000.01. Average and even median: 285000.01 / 2 = 142500.005 -> 142500.01.
      { group: 'Finance', label: 'Finance', currency: 'USD', basis: 'CURRENT_SPENDING', employeeCount: 2, annualBaseSalary: '280000.00', annualCashCompensation: '285000.01', averageAnnualCashCompensation: '142500.01', medianAnnualCashCompensation: '142500.01', minimumAnnualCashCompensation: '130000.01', maximumAnnualCashCompensation: '155000.00' },
      { group: 'HR', label: 'HR', currency: 'INR', basis: 'CURRENT_SPENDING', employeeCount: 1, annualBaseSalary: '1050000.00', annualCashCompensation: '1050000.00', averageAnnualCashCompensation: '1050000.00', medianAnnualCashCompensation: '1050000.00', minimumAnnualCashCompensation: '1050000.00', maximumAnnualCashCompensation: '1050000.00' },
      { group: 'Support', label: 'Support', currency: 'INR', basis: 'CURRENT_SPENDING', employeeCount: 1, annualBaseSalary: '900000.00', annualCashCompensation: '920000.00', averageAnnualCashCompensation: '920000.00', medianAnnualCashCompensation: '920000.00', minimumAnnualCashCompensation: '920000.00', maximumAnnualCashCompensation: '920000.00' },
      // Tech INR cash sorted: 1100000, 1100000, 1200000, 1350000, 1550000. Odd median: 1200000. Average 6300000 / 5.
      { group: 'Tech', label: 'Tech', currency: 'INR', basis: 'CURRENT_SPENDING', employeeCount: 5, annualBaseSalary: '6150000.00', annualCashCompensation: '6300000.00', averageAnnualCashCompensation: '1260000.00', medianAnnualCashCompensation: '1200000.00', minimumAnnualCashCompensation: '1100000.00', maximumAnnualCashCompensation: '1550000.00' },
    ]);
    assert.deepEqual(body.groups[0].usdEquivalent, { annualBaseSalary: '280000.00', annualCashCompensation: '285000.01' });
  });

  // Detects: an even median taken as the lower or upper middle value instead of their average.
  test('an even INR group averages the two middle values', async () => {
    // Rohan's scope has six working India employees: an even group.
    const body = await ok('rohan', 'breakdowns', { breakdown: 'COUNTRY' });
    // 920000, 1100000, 1100000, 1200000, 1350000, 1550000 -> (1100000 + 1200000) / 2 = 1150000.00. Average 7220000 / 6 = 1203333.333 -> 1203333.33.
    assert.deepEqual(strip(body.groups), [
      { group: 'IN', label: 'India', currency: 'INR', basis: 'CURRENT_SPENDING', employeeCount: 6, annualBaseSalary: '7050000.00', annualCashCompensation: '7220000.00', averageAnnualCashCompensation: '1203333.33', medianAnnualCashCompensation: '1150000.00', minimumAnnualCashCompensation: '920000.00', maximumAnnualCashCompensation: '1550000.00' },
    ]);
  });

  test('currency and level breakdowns keep native currencies separate', async () => {
    const currency = await ok('meera', 'breakdowns', { breakdown: 'CURRENCY' });
    assert.deepEqual(currency.groups.map((g: Group) => [g.group, g.currency, g.employeeCount, g.annualCashCompensation]), [['INR', 'INR', 7, '8270000.00'], ['USD', 'USD', 2, '285000.01']]);
    const level = await ok('meera', 'breakdowns', { breakdown: 'LEVEL' });
    assert.deepEqual(level.groups.map((g: Group) => [g.group, g.label, g.currency, g.employeeCount]), [['MID', 'Mid', 'INR', 7], ['SENIOR', 'Senior', 'USD', 2]]);
  });

  // Detects: LEFT employees contributing money, or SOON_TO_JOIN counted as current spending.
  test('employment-status breakdown: working spending, joiner commitment, left count only', async () => {
    const body = await ok('meera', 'breakdowns', { breakdown: 'EMPLOYMENT_STATUS' });
    assert.equal(body.population, 'ALL_STATUSES');
    assert.deepEqual(body.groups.map((g: Group) => [g.group, g.currency, g.basis, g.employeeCount, g.annualCashCompensation, g.medianAnnualCashCompensation]), [
      ['SOON_TO_JOIN', 'INR', 'FUTURE_COMMITMENT', 1, '1000000.00', '1000000.00'],
      ['SOON_TO_JOIN', 'USD', 'FUTURE_COMMITMENT', 1, '127000.00', '127000.00'],
      ['CURRENTLY_WORKING', 'INR', 'CURRENT_SPENDING', 7, '8270000.00', '1100000.00'],
      ['CURRENTLY_WORKING', 'USD', 'CURRENT_SPENDING', 2, '285000.01', '142500.01'],
      ['LEFT', 'INR', 'COUNT_ONLY', 1, null, null],
    ]);
    const leftGroup = body.groups.find((g: Group) => g.group === 'LEFT');
    assert.deepEqual([leftGroup.annualBaseSalary, leftGroup.averageAnnualCashCompensation, leftGroup.minimumAnnualCashCompensation, leftGroup.usdEquivalent], [null, null, null, null]);
  });

  test('a non-working status filter is reported on a spending breakdown', async () => {
    const body = await ok('meera', 'breakdowns', { breakdown: 'DEPARTMENT', employmentStatus: 'SOON_TO_JOIN' });
    assert.deepEqual(body.notApplied, [{ filter: 'employmentStatus', reason: 'This section includes currently working employees only.' }]);
    assert.equal(body.groups.length, 4);
  });
});

describe('recent changes', () => {
  type Change = { employee: { employeeCode: string }; recordedAt: string; effectiveFrom: string; effectiveInFuture: boolean };
  // Detects: selection by effective date, imports counted, or wrong order.
  test('default 30 days by creation time, newest first, with previous and new compensation', async () => {
    const body = await ok('meera', 'recent-changes');
    assert.equal(body.periodDays, 30);
    assert.equal(body.emptyMessage, 'No compensation changes were recorded in this period.');
    assert.deepEqual(body.changes.map((c: Change) => [c.employee.employeeCode, c.recordedAt, c.effectiveFrom, c.effectiveInFuture]), [
      ['ACME00304', '2026-11-14T08:00:00.000Z', '2026-12-01', true],
      ['ACME00303', '2026-11-01T09:00:00.000Z', '2026-11-10', false],
    ]);
    assert.deepEqual(body.changes[0], {
      employee: { employeeCode: 'ACME00304', name: 'Dash 304', department: 'Tech', country: 'IN' },
      currency: 'INR',
      previous: { annualBaseSalary: '1100000.00', annualBonus: '0.00', annualCashCompensation: '1100000.00' },
      new: { annualBaseSalary: '1210000.00', annualBonus: '0.00', annualCashCompensation: '1210000.00' },
      changeReason: 'MARKET_ADJUSTMENT', recordedAt: '2026-11-14T08:00:00.000Z', effectiveFrom: '2026-12-01', effectiveInFuture: true,
      changedBy: { displayName: 'Meera Iyer' }, requestId: null,
    });
    assert.deepEqual(body.page, { number: 1, size: 25, totalRows: 2, totalPages: 1 });
  });

  test('7 and 90 days; pagination; Rohan sees only permitted changes', async () => {
    assert.deepEqual((await ok('meera', 'recent-changes', { periodDays: '7' })).changes.map((c: Change) => c.employee.employeeCode), ['ACME00304']);
    const ninety = await ok('meera', 'recent-changes', { periodDays: '90' });
    assert.deepEqual(ninety.changes.map((c: Change) => c.employee.employeeCode), ['ACME00304', 'ACME00303', 'ACME00312']);
    const page2 = await ok('meera', 'recent-changes', { periodDays: '90', pageSize: '2', page: '2' });
    assert.deepEqual([page2.changes.map((c: Change) => c.employee.employeeCode), page2.page], [['ACME00312'], { number: 2, size: 2, totalRows: 3, totalPages: 2 }]);
    assert.deepEqual((await ok('rohan', 'recent-changes', { periodDays: '90' })).changes.map((c: Change) => c.employee.employeeCode), ['ACME00304', 'ACME00303']);
    const none = await ok('meera', 'recent-changes', { periodDays: '7', currency: 'USD' });
    assert.deepEqual([none.changes, none.page.totalRows], [[], 0]);
  });
});

describe('without recent adjustment', () => {
  type Row = { employee: { employeeCode: string }; lastRecordedAdjustmentAt: string | null; annualCashCompensation: string };
  // Detects: imports counted as adjustments, non-working employees listed, or count and list disagreeing.
  test('working employees only; count equals the list total; wording claims nothing before import', async () => {
    const body = await ok('meera', 'without-recent-adjustment');
    assert.equal(body.months, 12);
    assert.equal(body.definition, 'No recorded salary adjustment since import or during the selected period.');
    assert.deepEqual(body.employees.map((r: Row) => [r.employee.employeeCode, r.lastRecordedAdjustmentAt, r.annualCashCompensation]), [
      ['ACME00301', null, '1100000.00'],
      ['ACME00302', null, '1200000.00'],
      ['ACME00306', null, '920000.00'],
      ['ACME00309', null, '155000.00'],
      ['ACME00310', '2025-06-01T12:00:00.000Z', '130000.01'],
    ]);
    const summary = await ok('meera', 'summary');
    assert.equal(body.page.totalRows, summary.figures.withoutRecentAdjustment.count);
    assert.doesNotMatch(JSON.stringify(body), /never/i);
    const rohan = await ok('rohan', 'without-recent-adjustment', { pageSize: '2' });
    assert.deepEqual([rohan.employees.map((r: Row) => r.employee.employeeCode), rohan.page], [['ACME00301', 'ACME00302'], { number: 1, size: 2, totalRows: 3, totalPages: 2 }]);
  });
});

describe('validation, privacy, and logging', () => {
  // Detects: unknown, repeated, or unsupported values reaching SQL.
  test('strict query validation on every endpoint', async () => {
    const bad: [string, Record<string, string | string[]>][] = [
      ['summary', { periodDays: '14' }], ['summary', { breakdown: 'DEPARTMENT' }], ['summary', { status: 'LEFT' }], ['summary', { department: 'Legal' }],
      ['summary', { department: ['Tech', 'HR'] }], ['summary', { noAdjustmentMonths: '13' }], ['breakdowns', { breakdown: 'EMAIL' }],
      ['breakdowns', { breakdown: "DEPARTMENT; DROP TABLE employees" }], ['breakdowns', { page: '1' }], ['recent-changes', { pageSize: '101' }],
      ['recent-changes', { page: '0' }], ['without-recent-adjustment', { periodDays: '30' }], ['without-recent-adjustment', { level: 'CEO' }],
    ];
    for (const [path, query] of bad) {
      const res = await request(app).get(`/api/v1/dashboard/${path}`).query(query).set('Authorization', `Bearer ${tokens.meera ?? ''}`);
      assert.deepEqual([res.status, res.body.error?.code], [400, 'VALIDATION_ERROR'], `${path} ${JSON.stringify(query)}`);
    }
    for (const path of ['summary', 'breakdowns', 'recent-changes', 'without-recent-adjustment']) {
      assert.equal((await request(app).get(`/api/v1/dashboard/${path}`)).status, 401, path);
    }
  });

  // Detects: internal IDs, idempotency keys, or notes in responses.
  test('responses contain no internal IDs, keys, or notes', async () => {
    const bodies = [await ok('meera', 'summary'), await ok('meera', 'breakdowns'), await ok('meera', 'recent-changes', { periodDays: '90' }), await ok('meera', 'without-recent-adjustment')];
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    };
    bodies.forEach(walk);
    for (const k of keys) if (k !== 'requestId') assert.doesNotMatch(k, /(^id$|Id$|_id$|idempotency|fingerprint|note$)/i, k);
    assert.doesNotMatch(JSON.stringify(bodies), /dash-fixture|dash-req-key|No budget|aaaaaaaa/);
  });

  test('logs contain only route patterns: no codes, salaries, or tokens', async () => {
    await ok('meera', 'summary', { department: 'Tech' });
    await ok('meera', 'recent-changes');
    await ok('meera', 'without-recent-adjustment');
    const text = JSON.stringify(logs);
    for (const secret of ['ACME003', '1100000', 'Tech', tokens.meera ?? '', 'Bearer']) assert.ok(!text.includes(secret), secret);
    assert.deepEqual(logs.map((l) => l.path), ['/api/v1/dashboard/summary', '/api/v1/dashboard/recent-changes', '/api/v1/dashboard/without-recent-adjustment']);
  });

  // Detects: the dashboard computing aggregates in Node.js from loaded rows.
  test('the summary runs a bounded number of SQL statements and fetches no per-employee rows', async () => {
    const statements: string[] = [];
    const original = pool.query.bind(pool);
    const spy = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === 'query') {
          return (sql: unknown, ...rest: unknown[]) => {
            statements.push(String(sql));
            return (original as (...a: unknown[]) => unknown)(sql, ...rest);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const service = createDashboardService({ pool: spy, exchangeRate: RATE, clock });
    const principal = { hrUserId: ids.meera ?? 0, email: 'meera@acme.com', displayName: 'Meera Iyer', role: 'ADMIN' as const, status: 'ACTIVE' as const, countries: [], departments: [], sessionId: 'x', sessionExpiresAt: NOW };
    await service.summary(principal, { periodDays: 30, noAdjustmentMonths: 12 });
    assert.ok(statements.length <= 10, `${statements.length} statements`);
    for (const sql of statements) assert.match(sql, /COUNT\(|SUM\(|LIMIT/, sql.slice(0, 80));
  });
});
