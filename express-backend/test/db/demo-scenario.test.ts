// demo:scenario against real MySQL (AI Task 06): guards, dry run, apply
// through the product services, idempotent re-run, an unchanged seed apart
// from the scenario rows, and the dashboard and request-list APIs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import { createObservabilityRepository } from '../../src/assistant/observability/repository.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import { createPreviewTokens } from '../../src/compensation/preview-token.js';
import { createSalaryAdjustmentService } from '../../src/compensation/salary-adjustment-service.js';
import { createDashboardService } from '../../src/dashboard/dashboard-service.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { CANCEL_REASON, DIRECT_ITEMS, REQUEST_ITEMS, SCENARIO_HR_USERS, runDemoScenario } from '../../src/evaluation/demo-scenario.js';
import type { ScenarioReport } from '../../src/evaluation/demo-scenario.js';
import { FixtureRefusedError, databaseNameOf } from '../../src/evaluation/fixture-guard.js';
import { prepareOracleFixtures } from '../../src/evaluation/oracle-fixtures.js';
import type { OracleManifest } from '../../src/evaluation/oracle-fixtures.js';
import { createApp } from '../../src/http/app.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { selectRows } from '../support/db.js';
import { fakeAdminObservability, fakeHrAccess, fakeInsights, fakeMcpStore } from '../support/http.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const DATABASE = databaseNameOf(DATABASE_URL) ?? '';
const PASSWORD = 'synthetic-shared-demo-password';
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';

let pool: Pool;
let dir: string | undefined;
let oracle: OracleManifest;
const n = async (sql: string, params: unknown[] = []) => Number((await selectRows(pool, sql, params))[0]?.n);
const counts = async () => ({
  records: await n('SELECT COUNT(*) AS n FROM compensation_records'), requests: await n('SELECT COUNT(*) AS n FROM compensation_change_requests'),
  users: await n('SELECT COUNT(*) AS n FROM hr_users'), audit: await n('SELECT COUNT(*) AS n FROM access_audit_events'),
});
const run = (apply: boolean, overrides: Partial<Parameters<typeof runDemoScenario>[0]> = {}) =>
  runDemoScenario({ pool, apply, appEnv: 'demo', databaseName: DATABASE, confirmDatabase: DATABASE, ...overrides });

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  dir = await mkdtemp(path.join(tmpdir(), 'acme-demo-scenario-'));
  const workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  await seedDatabase({ databaseUrl: DATABASE_URL, workbookPath, replace: true, appEnv: 'test' });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
});
after(async () => {
  await pool?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('guards', () => {
  test('missing demo users, production, unsafe names, and mismatches are refused and write nothing', async () => {
    const before = await counts();
    await assert.rejects(run(true), /demo HR users/);
    for (const overrides of [
      { appEnv: 'production' }, { appEnv: 'staging' }, { databaseName: 'acme', confirmDatabase: 'acme' },
      { confirmDatabase: undefined }, { databaseName: 'other_lane_demo', confirmDatabase: 'other_lane_demo' },
    ]) await assert.rejects(run(true, overrides), FixtureRefusedError, JSON.stringify(overrides));
    assert.deepEqual(await counts(), before);
  });
});

describe('scenario', () => {
  let applied: ScenarioReport;
  before(async () => {
    await bootstrapHrUser(pool, { email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
    await bootstrapHrUser(pool, { email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] });
    oracle = await prepareOracleFixtures({ pool, apply: true, appEnv: 'test', databaseName: DATABASE, confirmDatabase: DATABASE });
  });

  test('dry run writes nothing and plans every item', async () => {
    const before = await counts();
    const plan = await run(false);
    assert.deepEqual(await counts(), before);
    assert.equal(plan.mode, 'DRY_RUN');
    assert.ok(plan.directAdjustments.every((d) => d.status === 'PLANNED' && d.employeeCode !== null));
    assert.ok(plan.requests.every((r) => r.status === 'PLANNED') && plan.hrUsers.every((u) => u.status === 'PLANNED'));
  });

  // Detects: scenario rows that bypass the services, touch the oracle employees, or miss a required type.
  test('apply creates every item through the services, away from the oracle-fixture employees', async () => {
    const before = await counts();
    applied = await run(true);
    assert.ok(applied.directAdjustments.every((d) => d.status === 'CREATED') && applied.requests.every((r) => r.status === 'CREATED') && applied.hrUsers.every((u) => u.status === 'CREATED'));
    const oracleCodes = oracle.fixtures.map((f) => f.employeeCode);
    const scenarioCodes = [...applied.directAdjustments.map((d) => d.employeeCode), ...applied.requests.map((r) => r.employeeCode)];
    assert.equal(new Set(scenarioCodes).size, scenarioCodes.length, 'one item per employee');
    assert.ok(scenarioCodes.every((c) => c !== null && !oracleCodes.includes(c)));

    const direct = await selectRows(pool, `SELECT e.country_code, d.name AS department, c.change_reason, c.changed_by_hr_user_id IS NOT NULL AS by_user, c.operation_idempotency_key IS NOT NULL AS keyed
      FROM compensation_records c JOIN employees e ON e.id = c.employee_id JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
      WHERE c.change_note LIKE 'DEMO-SCENARIO v1 direct-%'`);
    assert.equal(direct.length, DIRECT_ITEMS.length);
    assert.deepEqual(new Set(direct.map((r) => r.country_code)), new Set(['IN', 'US']));
    assert.ok(new Set(direct.map((r) => r.department)).size >= 2 && new Set(direct.map((r) => r.change_reason)).size >= 2);
    assert.ok(direct.every((r) => Number(r.by_user) === 1 && Number(r.keyed) === 1), 'written by the service: actor and idempotency key recorded');

    const requests = await selectRows(pool, `SELECT r.status, r.decision_note, u.email FROM compensation_change_requests r JOIN hr_users u ON u.id = r.requested_by_hr_user_id WHERE r.note LIKE 'DEMO-SCENARIO v1 %'`);
    const byStatus = (s: string) => requests.filter((r) => r.status === s).length;
    assert.deepEqual([requests.length, byStatus('PENDING'), byStatus('APPROVED'), byStatus('CANCELLED')], [REQUEST_ITEMS.length, 3, 2, 1]);
    assert.equal(requests.find((r) => r.status === 'CANCELLED')?.decision_note, CANCEL_REASON);
    assert.deepEqual(new Set(requests.map((r) => r.email)), new Set(['rohan.mehta@acme.com', SCENARIO_HR_USERS.priya.email]));

    const hr = await selectRows(pool, `SELECT u.email, u.status, GROUP_CONCAT(a.action ORDER BY a.id) AS actions FROM hr_users u JOIN access_audit_events a ON a.target_hr_user_id = u.id
      WHERE u.email LIKE '%.demo@acme.com' GROUP BY u.email, u.status ORDER BY u.email`);
    assert.deepEqual(hr.map((r) => [r.email, r.status, r.actions]), [
      [SCENARIO_HR_USERS.arjun.email, 'ACTIVE', 'HR_USER_CREATED,SCOPES_REPLACED'],
      [SCENARIO_HR_USERS.kavya.email, 'INACTIVE', 'HR_USER_CREATED,HR_USER_DEACTIVATED'],
      [SCENARIO_HR_USERS.priya.email, 'ACTIVE', 'HR_USER_CREATED'],
    ]);
    const after = await counts();
    assert.deepEqual([after.records - before.records, after.requests - before.requests, after.users - before.users], [DIRECT_ITEMS.length + 2, REQUEST_ITEMS.length, 3]);
    assert.ok(!JSON.stringify(applied).match(/temporaryPassword|password/i), 'no password in the report');
  });

  test('re-running writes nothing', async () => {
    const before = await counts();
    const again = await run(true);
    assert.deepEqual(await counts(), before);
    assert.ok([...again.directAdjustments, ...again.requests, ...again.hrUsers].every((x) => x.status === 'EXISTS'));
    assert.deepEqual(again.requests.map((r) => r.requestId), applied.requests.map((r) => r.requestId));
  });

  test('the seed is unchanged apart from the scenario and oracle rows', async () => {
    assert.equal(await n("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason = 'INITIAL_IMPORT'"), await n('SELECT COUNT(*) AS n FROM employees'));
    const extra = await n("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT'");
    const marked = await n("SELECT COUNT(*) AS n FROM compensation_records WHERE change_note LIKE 'DEMO-SCENARIO v1 %' OR change_note LIKE 'EVAL-ORACLE-FIXTURE v1 %' OR source_request_id IS NOT NULL");
    assert.deepEqual([extra, marked], [DIRECT_ITEMS.length + 2 + 2, DIRECT_ITEMS.length + 2 + 2]);
  });

  // Detects: a scenario the deployed dashboard or request queue would not show.
  test('the dashboard and the request list show the expected counts', async () => {
    const directory = createDirectoryService({ pool, exchangeRate: null });
    const tools = createToolRegistry({ directory, insights: fakeInsights(), exchangeRate: null });
    const app = createApp({
      auth: createAuthService({ pool, tokens: createSessionTokens({ signingKey: SIGNING_KEY }) }), directory, tools,
      assistant: createAssistantService({ model: null, tools, logger: () => undefined }), assistantStore: createObservabilityRepository(pool), mcpStore: fakeMcpStore().store,
      salaryAdjustments: createSalaryAdjustmentService({ pool, previewTokens: createPreviewTokens({ signingKey: SIGNING_KEY }) }),
      dashboard: createDashboardService({ pool, exchangeRate: null }), hrAccess: fakeHrAccess(), adminObservability: fakeAdminObservability(),
      logger: () => undefined, clientIpSource: 'socket',
    });
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'meera.iyer@acme.com', password: PASSWORD });
    const auth = { Authorization: `Bearer ${String(login.body.token)}` };
    const pending = await request(app).get('/api/v1/salary-adjustment-requests?status=PENDING').set(auth);
    assert.equal(pending.status, 200, pending.text);
    assert.equal(pending.body.page.totalRows, 3);
    const summary = await request(app).get('/api/v1/dashboard/summary').set(auth);
    assert.equal(summary.status, 200, summary.text);
    const figures = summary.body.figures;
    // Recorded in the last 30 days: 2 oracle + 8 direct + 2 approved requests. Upcoming: 1 oracle + 3 direct + 2 approved.
    assert.deepEqual([figures.requests.pending, figures.recentChanges.count, figures.upcomingCommitment.upcomingChanges.total], [3, 12, 6]);
  });
});
