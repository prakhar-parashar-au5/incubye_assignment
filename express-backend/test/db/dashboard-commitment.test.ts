// Review fix 11b: upcoming commitment for soon-to-join employees with an
// approved later future adjustment. Real MySQL, hand-calculated values.
//
// NOW = 2026-11-15T10:00:00Z, as-of date 2026-11-15.
//
// code       dept     country status        records (base / bonus, effective)
// ACME00501  Tech     IN      SOON_TO_JOIN  v1 1000000/0 2027-01-15 (import); v2 1100000/50000 2027-04-01 (increase, +150000)
// ACME00502  Support  IN      SOON_TO_JOIN  v1  900000/0 2027-02-01 (import); v2  850000/0     2027-03-01 (decrease, -50000)
// ACME00503  Tech     US      SOON_TO_JOIN  v1  120000/0 2027-01-04 (import); v2  126000/0     2027-02-01 (increase, +6000 USD)
// ACME00504  HR       IN      SOON_TO_JOIN  v1  700000/0 2027-01-10 (import); v2  750000/0     2027-01-10 (same day: v2 is the
//                                            selected compensation, so 750000 is the initial cash and there is no extra impact)
// ACME00505  Tech     IN      WORKING       v1 1000000/0 2020-01-01 (import); v2 1050000/0     2026-12-01 (+50000)
// ACME00506  Tech     IN      LEFT          v1  800000/0 2015-01-01 (import); v2  900000/0     2026-12-01 (must never count)
//
// Admin INR: joiners 501, 502, 504 = 1000000 + 900000 + 750000 = 2650000.00
//            impacts 501 +150000, 502 -50000, 505 +50000      =  150000.00 (3 changes)
//            total                                              = 2800000.00
// Admin USD: joiner 503 = 120000.00; impact +6000.00 (1 change); total 126000.00
// Rohan (IN x Tech, Support) INR: joiners 501, 502 = 1900000.00; impacts 501, 502, 505 = 150000.00; total 2050000.00
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import type { Principal } from '../../src/access/sessions.js';
import { createDashboardService } from '../../src/dashboard/dashboard-service.js';
import type { DashboardService } from '../../src/dashboard/dashboard-service.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { DashboardSummaryQuery } from '../../src/http/contract.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const NOW = new Date('2026-11-15T10:00:00.000Z');
const PASSWORD = 'synthetic-shared-demo-password';

let pool: Pool;
let service: DashboardService;
const session = { sessionId: 'n/a', sessionExpiresAt: NOW, status: 'ACTIVE' as const };
let admin: Principal;
let rohan: Principal;
const empIds: Record<string, number> = {};

async function employee(code: string, title: string, country: 'IN' | 'US', status: string, hire: string, end: string | null) {
  const [t] = await selectRows(pool, "SELECT id FROM job_titles WHERE name = ? AND level = 'MID'", [title]);
  const [result] = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date, employment_end_date)
     VALUES (?, 'Commit', ?, ?, ?, ?, ?, ?, ?)`,
    [code, code.slice(-3), `commit.${code.toLowerCase()}@acme.com`, must(t, title).id, country, status, hire, end],
  );
  empIds[code] = (result as { insertId: number }).insertId;
}
async function record(code: string, version: number, base: string, bonus: string, from: string, reason: string, country: 'IN' | 'US' = 'IN') {
  await pool.query('INSERT INTO compensation_records SET ?', [{
    employee_id: empIds[code], version, annual_base_salary: base, annual_bonus: bonus, currency: country === 'IN' ? 'INR' : 'USD',
    pay_frequency: country === 'IN' ? 'MONTHLY' : 'ANNUAL', effective_from: from, change_reason: reason,
    created_at: reason === 'INITIAL_IMPORT' ? '2026-01-01 00:00:00.000' : '2026-11-10 09:00:00.000',
  }]);
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  const connection = await openConnection(DATABASE_URL);
  try {
    await ensureReferenceData(connection);
  } finally {
    await connection.end();
  }
  const meeraId = await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  const rohanId = await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  admin = { ...session, hrUserId: meeraId, email: 'meera@acme.com', displayName: 'Meera Iyer', role: 'ADMIN', countries: [], departments: [] };
  rohan = { ...session, hrUserId: rohanId, email: 'rohan@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };

  await employee('ACME00501', 'Software Engineer', 'IN', 'SOON_TO_JOIN', '2027-01-15', null);
  await record('ACME00501', 1, '1000000.00', '0.00', '2027-01-15', 'INITIAL_IMPORT');
  await record('ACME00501', 2, '1100000.00', '50000.00', '2027-04-01', 'MARKET_ADJUSTMENT');
  await employee('ACME00502', 'Support Specialist', 'IN', 'SOON_TO_JOIN', '2027-02-01', null);
  await record('ACME00502', 1, '900000.00', '0.00', '2027-02-01', 'INITIAL_IMPORT');
  await record('ACME00502', 2, '850000.00', '0.00', '2027-03-01', 'MARKET_ADJUSTMENT');
  await employee('ACME00503', 'Software Engineer', 'US', 'SOON_TO_JOIN', '2027-01-04', null);
  await record('ACME00503', 1, '120000.00', '0.00', '2027-01-04', 'INITIAL_IMPORT', 'US');
  await record('ACME00503', 2, '126000.00', '0.00', '2027-02-01', 'MARKET_ADJUSTMENT', 'US');
  await employee('ACME00504', 'HR Generalist', 'IN', 'SOON_TO_JOIN', '2027-01-10', null);
  await record('ACME00504', 1, '700000.00', '0.00', '2027-01-10', 'INITIAL_IMPORT');
  await record('ACME00504', 2, '750000.00', '0.00', '2027-01-10', 'MARKET_ADJUSTMENT');
  await employee('ACME00505', 'Software Engineer', 'IN', 'CURRENTLY_WORKING', '2020-01-01', null);
  await record('ACME00505', 1, '1000000.00', '0.00', '2020-01-01', 'INITIAL_IMPORT');
  await record('ACME00505', 2, '1050000.00', '0.00', '2026-12-01', 'MARKET_ADJUSTMENT');
  await employee('ACME00506', 'Software Engineer', 'IN', 'LEFT', '2015-01-01', '2025-06-30');
  await record('ACME00506', 1, '800000.00', '0.00', '2015-01-01', 'INITIAL_IMPORT');
  await record('ACME00506', 2, '900000.00', '0.00', '2026-12-01', 'MARKET_ADJUSTMENT');

  service = createDashboardService({ pool, exchangeRate: null, clock: () => NOW });
});
after(async () => {
  await pool?.end();
});

async function commitment(principal: Principal, query: Record<string, string> = {}) {
  const res = await service.summary(principal, DashboardSummaryQuery.parse(query));
  const figures = must(res.figures, 'figures');
  return { figures, upcoming: figures.upcomingCommitment };
}

describe('upcoming commitment with soon-to-join adjustments', () => {
  // Detects: a joiner's approved later adjustment listed but left out of the total.
  test('Admin: initial joiner cash once, each signed impact once, per native currency', async () => {
    const { figures, upcoming } = await commitment(admin);
    assert.deepEqual([figures.headcount.soonToJoin, figures.headcount.currentlyWorking, figures.headcount.left], [4, 1, 1]);
    assert.deepEqual(upcoming.byCurrency, [
      {
        currency: 'INR', soonToJoinCount: 3, soonToJoinAnnualCashCompensation: '2650000.00',
        approvedFutureChangeCount: 3, approvedFutureChangeAnnualCashImpact: '150000.00', totalAnnualCashCommitment: '2800000.00',
      },
      {
        currency: 'USD', soonToJoinCount: 1, soonToJoinAnnualCashCompensation: '120000.00',
        approvedFutureChangeCount: 1, approvedFutureChangeAnnualCashImpact: '6000.00', totalAnnualCashCommitment: '126000.00',
      },
    ]);
    // Every approved future adjustment appears once; the LEFT employee's record never does.
    const codes = upcoming.upcomingChanges.items.map((i) => i.employee.employeeCode);
    assert.deepEqual([...codes].sort(), ['ACME00501', 'ACME00502', 'ACME00503', 'ACME00504', 'ACME00505']);
    assert.equal(upcoming.upcomingChanges.total, 5);
    const joiner = must(upcoming.upcomingChanges.items.find((i) => i.employee.employeeCode === 'ACME00501'), 'joiner item');
    assert.deepEqual([joiner.employee.employmentStatus, joiner.previous?.annualCashCompensation, joiner.scheduled.annualCashCompensation],
      ['SOON_TO_JOIN', '1000000.00', '1150000.00']);
    assert.match(upcoming.definition, /soon-to-join/i);
  });

  // Detects: scope or filters applied after aggregation.
  test('scope, currency, and status filters apply before aggregation; LEFT never contributes', async () => {
    assert.deepEqual((await commitment(rohan)).upcoming.byCurrency, [{
      currency: 'INR', soonToJoinCount: 2, soonToJoinAnnualCashCompensation: '1900000.00',
      approvedFutureChangeCount: 3, approvedFutureChangeAnnualCashImpact: '150000.00', totalAnnualCashCommitment: '2050000.00',
    }]);
    assert.deepEqual((await commitment(admin, { currency: 'USD' })).upcoming.byCurrency, [{
      currency: 'USD', soonToJoinCount: 1, soonToJoinAnnualCashCompensation: '120000.00',
      approvedFutureChangeCount: 1, approvedFutureChangeAnnualCashImpact: '6000.00', totalAnnualCashCommitment: '126000.00',
    }]);
    assert.deepEqual((await commitment(admin, { employmentStatus: 'SOON_TO_JOIN', currency: 'INR' })).upcoming.byCurrency, [{
      currency: 'INR', soonToJoinCount: 3, soonToJoinAnnualCashCompensation: '2650000.00',
      approvedFutureChangeCount: 2, approvedFutureChangeAnnualCashImpact: '100000.00', totalAnnualCashCommitment: '2750000.00',
    }]);
    assert.deepEqual((await commitment(admin, { department: 'Support' })).upcoming.byCurrency, [{
      currency: 'INR', soonToJoinCount: 1, soonToJoinAnnualCashCompensation: '900000.00',
      approvedFutureChangeCount: 1, approvedFutureChangeAnnualCashImpact: '-50000.00', totalAnnualCashCommitment: '850000.00',
    }]);
    const left = await commitment(admin, { employmentStatus: 'LEFT' });
    assert.deepEqual([left.upcoming.byCurrency, left.upcoming.upcomingChanges.total], [[], 0]);
  });
});
