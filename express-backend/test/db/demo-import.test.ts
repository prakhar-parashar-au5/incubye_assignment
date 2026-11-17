// demo:import-ai-data and demo:mcp-calls against real MySQL (AI Task 06).
// Source: the guarded _test database. Target: its sibling _demo database on the
// same server (see test/support/test-database.ts). Both are seeded with the
// same workbook; the source gets the trace fixtures, the oracle fixtures, and
// one trace by an HR user who does not exist on the target.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import { createAdminObservabilityRepository } from '../../src/assistant/observability/admin-repository.js';
import { createObservabilityRepository } from '../../src/assistant/observability/repository.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import { createCompensationInsights } from '../../src/assistant/compensation-insights.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { IMPORT_TABLES, importDemoAiData } from '../../src/evaluation/demo-import.js';
import { DemoMcpRefusedError, checkedApiBaseUrl, runDemoMcpCalls } from '../../src/evaluation/demo-mcp-calls.js';
import { FixtureRefusedError, databaseNameOf } from '../../src/evaluation/fixture-guard.js';
import { prepareOracleFixtures } from '../../src/evaluation/oracle-fixtures.js';
import { prepareTraceFixtures } from '../../src/evaluation/trace-fixtures.js';
import { seedTrace } from '../../src/evaluation/trace-seed.js';
import { createApp } from '../../src/http/app.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { selectRows } from '../support/db.js';
import { fakeDashboard, fakeHrAccess, fakeSalaryAdjustments } from '../support/http.js';
import { resetSiblingDemoDatabase, resetTestDatabase, siblingDemoDatabaseUrl, testDatabaseUrl } from '../support/test-database.js';

const SOURCE_URL = testDatabaseUrl();
const TARGET_URL = siblingDemoDatabaseUrl();
const SOURCE = databaseNameOf(SOURCE_URL) ?? '';
const TARGET = databaseNameOf(TARGET_URL) ?? '';
const PASSWORD = 'synthetic-shared-demo-password';
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const QA_EMAIL = 'qa.scoped.reviewer@example.test';

let source: Pool;
let target: Pool;
let dir: string | undefined;
const count = async (pool: Pool, table: string) => Number((await selectRows(pool, `SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);
const counts = async (pool: Pool) => Object.fromEntries(await Promise.all([...IMPORT_TABLES, 'hr_users', 'access_audit_events', 'compensation_records'].map(async (t) => [t, await count(pool, t)] as const)));
const run = (apply: boolean, overrides: Partial<Parameters<typeof importDemoAiData>[0]> = {}) => importDemoAiData({
  source, target, apply, appEnv: 'demo', sourceDatabase: SOURCE, targetDatabase: TARGET, confirmSourceDatabase: SOURCE, confirmTargetDatabase: TARGET, ...overrides,
});
const users = async (pool: Pool, email: string, role: 'ADMIN' | 'SCOPED', countries: string[], departments: string[], displayName: string) =>
  bootstrapHrUser(pool, { email, displayName, password: PASSWORD, role, countries, departments });

function appOn(pool: Pool) {
  const directory = createDirectoryService({ pool, exchangeRate: null });
  const tools = createToolRegistry({ directory, insights: createCompensationInsights({ pool, exchangeRate: null }), exchangeRate: null });
  return createApp({
    auth: createAuthService({ pool, tokens: createSessionTokens({ signingKey: SIGNING_KEY }) }),
    directory, tools,
    assistant: createAssistantService({ model: null, tools, logger: () => undefined }),
    assistantStore: createObservabilityRepository(pool), mcpStore: createObservabilityRepository(pool),
    salaryAdjustments: fakeSalaryAdjustments(), dashboard: fakeDashboard(), hrAccess: fakeHrAccess(),
    adminObservability: createAdminObservabilityRepository(pool), logger: () => undefined, clientIpSource: 'socket',
  });
}

before(async () => {
  await resetTestDatabase(SOURCE_URL);
  await resetSiblingDemoDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'acme-demo-import-'));
  const workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  for (const url of [SOURCE_URL, TARGET_URL]) {
    await runMigrations({ databaseUrl: url });
    await seedDatabase({ databaseUrl: url, workbookPath, replace: true, appEnv: 'test' });
  }
  source = createPool(SOURCE_URL, { connectionLimit: 4 });
  target = createPool(TARGET_URL, { connectionLimit: 4 });
  // Different creation order, so the same email has a different ID on each side.
  await users(source, 'meera.iyer@acme.com', 'ADMIN', [], [], 'Meera Iyer');
  await users(source, 'rohan.mehta@acme.com', 'SCOPED', ['IN'], ['Support', 'Tech'], 'Rohan Mehta');
  const qaId = await users(source, QA_EMAIL, 'SCOPED', ['IN'], ['Support'], 'QA Scoped Reviewer');
  await users(target, 'someone.else@acme.com', 'SCOPED', ['US'], ['Finance'], 'Someone Else');
  await users(target, 'rohan.mehta@acme.com', 'SCOPED', ['IN'], ['Support', 'Tech'], 'Rohan Mehta');
  await users(target, 'meera.iyer@acme.com', 'ADMIN', [], [], 'Meera Iyer');
  await prepareOracleFixtures({ pool: source, apply: true, appEnv: 'test', databaseName: SOURCE, confirmDatabase: SOURCE });
  await prepareTraceFixtures({ pool: source, apply: true, appEnv: 'test', databaseName: SOURCE, confirmDatabase: SOURCE });
  await seedTrace(createObservabilityRepository(source), {
    actorId: qaId, actorScope: { role: 'SCOPED', countries: ['IN'], departments: ['Support'] }, startedAt: new Date().toISOString(), status: 'COMPLETED', requestId: 'qa-reviewer-turn',
  });
});
after(async () => {
  await source?.end();
  await target?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('guards and preconditions', () => {
  // Detects: an import aimed at production, a non-demo target, or the wrong connected database.
  test('every refusal case writes nothing', async () => {
    const before = await counts(target);
    for (const overrides of [
      { appEnv: 'production' }, { appEnv: 'staging' },
      { sourceDatabase: 'acme_x_demo', confirmSourceDatabase: 'acme_x_demo' },
      { targetDatabase: 'acme_x_test', confirmTargetDatabase: 'acme_x_test' },
      { confirmSourceDatabase: undefined }, { confirmTargetDatabase: `${TARGET}x` },
      { sourceDatabase: 'other_lane_test', confirmSourceDatabase: 'other_lane_test' },
      { targetDatabase: 'other_lane_demo', confirmTargetDatabase: 'other_lane_demo' },
    ]) await assert.rejects(run(true, overrides), FixtureRefusedError, JSON.stringify(overrides));
    assert.deepEqual(await counts(target), before);
  });

  // Detects: copying into a schema or employee set that does not match the recorded answers.
  test('a missing migration or a different employee set stops the run before any write', async () => {
    const before = await counts(target);
    await target.query("DELETE FROM schema_migrations WHERE name = '008_ai_trace_summary_index.sql'");
    try {
      await assert.rejects(run(true), /missing migrations 008_ai_trace_summary_index\.sql/);
    } finally {
      await target.query("INSERT INTO schema_migrations (name) VALUES ('008_ai_trace_summary_index.sql')");
    }
    await target.query("UPDATE employees SET employee_code = 'ACME99999' WHERE employee_code = 'ACME10000'");
    try {
      await assert.rejects(run(true), /employee set differs/);
    } finally {
      await target.query("UPDATE employees SET employee_code = 'ACME10000' WHERE employee_code = 'ACME99999'");
    }
    assert.deepEqual(await counts(target), before);
  });
});

describe('import', () => {
  test('dry run writes nothing, reports the source counts, and warns that the oracle fixtures are missing', async () => {
    const before = await counts(target);
    const report = await run(false);
    assert.deepEqual(await counts(target), before);
    assert.equal(report.mode, 'DRY_RUN');
    for (const table of IMPORT_TABLES) assert.deepEqual(report.tables[table], { copied: await count(source, table), skipped: 0 }, table);
    assert.deepEqual(report.hrUsersCreated.map((u) => u.email), [QA_EMAIL]);
    assert.ok(report.warnings.some((w) => w.includes('no evaluator oracle fixtures')));
  });

  // Detects: lost or duplicated rows, IDs mapped by number instead of email, or broken message links.
  test('apply copies exact counts, maps HR users by email, creates the missing one inactive, and keeps UUIDs and snapshots', async () => {
    await prepareOracleFixtures({ pool: target, apply: true, appEnv: 'demo', databaseName: TARGET, confirmDatabase: TARGET });
    const report = await run(true);
    assert.deepEqual(report.warnings, [], 'oracle fixtures now match');
    for (const table of IMPORT_TABLES) {
      assert.equal(report.tables[table].copied, await count(source, table), table);
      assert.equal(await count(target, table), await count(source, table), table);
    }
    const sourceTraces = await selectRows(source, `SELECT t.id, u.email, t.actor_role, t.actor_countries, t.actor_departments, t.started_at, um.sequence AS user_seq, fm.sequence AS final_seq
      FROM ai_traces t JOIN hr_users u ON u.id = t.hr_user_id LEFT JOIN ai_messages um ON um.id = t.user_message_id LEFT JOIN ai_messages fm ON fm.id = t.final_message_id ORDER BY t.id`);
    const targetTraces = await selectRows(target, `SELECT t.id, u.email, t.actor_role, t.actor_countries, t.actor_departments, t.started_at, um.sequence AS user_seq, fm.sequence AS final_seq
      FROM ai_traces t JOIN hr_users u ON u.id = t.hr_user_id LEFT JOIN ai_messages um ON um.id = t.user_message_id LEFT JOIN ai_messages fm ON fm.id = t.final_message_id ORDER BY t.id`);
    assert.deepEqual(targetTraces, sourceTraces, 'same UUIDs, owners by email, snapshots, times, and message links');
    const toolParents = async (pool: Pool) => selectRows(pool, 'SELECT tc.trace_id, tc.sequence, mc.sequence AS model_seq FROM ai_tool_calls tc JOIN ai_model_calls mc ON mc.id = tc.model_call_id ORDER BY tc.trace_id, tc.sequence');
    assert.deepEqual(await toolParents(target), await toolParents(source));
    const [qa] = await selectRows(target, 'SELECT id, role, status, password_hash FROM hr_users WHERE email = ?', [QA_EMAIL]);
    assert.deepEqual([qa?.role, qa?.status, String(qa?.password_hash).startsWith('$argon2id$')], ['SCOPED', 'INACTIVE', true]);
    const scope = await selectRows(target, `SELECT (SELECT GROUP_CONCAT(country_code) FROM hr_user_country_scopes WHERE hr_user_id = ?) AS c,
      (SELECT GROUP_CONCAT(d.name) FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ?) AS d`, [qa?.id, qa?.id]);
    assert.deepEqual([scope[0]?.c, scope[0]?.d], ['IN', 'Support']);
    const [audit] = await selectRows(target, "SELECT action, reason, actor_hr_user_id FROM access_audit_events WHERE target_hr_user_id = ?", [qa?.id]);
    assert.deepEqual([audit?.action, audit?.actor_hr_user_id], ['HR_USER_CREATED', null]);
    assert.match(String(audit?.reason), /^Imported with recorded AI data from /);
    assert.equal(await count(target, 'compensation_records'), await count(source, 'compensation_records'), 'salary data is never copied (both have the same seed and oracle fixtures)');
    assert.ok(!JSON.stringify(report).match(/mysql:\/\/|acme_local|synthetic-/), 'no credentials or content in the report');
  });

  test('a second apply writes nothing and reports every row skipped', async () => {
    const before = await counts(target);
    const report = await run(true);
    assert.deepEqual(await counts(target), before);
    for (const table of IMPORT_TABLES) assert.deepEqual(report.tables[table], { copied: 0, skipped: await count(source, table) }, table);
    assert.deepEqual(report.hrUsersCreated, []);
  });

  // Detects: imported Scoped answers shown after the viewer's scope narrows (Option C on imported rows).
  test('imported Rohan traces follow the trace-time scope rule through the conversation API', async () => {
    const app = appOn(target);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'rohan.mehta@acme.com', password: PASSWORD });
    assert.equal(login.status, 200, login.text);
    const auth = { Authorization: `Bearer ${String(login.body.token)}` };
    const [traceRow] = await selectRows(target, "SELECT conversation_id FROM ai_traces WHERE request_id = 'trace-fixture:v1:completed-one-tool'");
    const read = async () => (await request(app).get(`/api/v1/assistant/conversations/${String(traceRow?.conversation_id)}`).set(auth)).body as { messages: { role: string; withheld: boolean }[] };
    assert.deepEqual((await read()).messages.map((m) => [m.role, m.withheld]), [['user', false], ['assistant', false]]);
    const [rohan] = await selectRows(target, "SELECT id FROM hr_users WHERE email = 'rohan.mehta@acme.com'");
    const [support] = await selectRows(target, "SELECT id FROM departments WHERE name = 'Support'");
    await target.query('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ? AND department_id = ?', [rohan?.id, support?.id]);
    try {
      assert.deepEqual((await read()).messages.map((m) => [m.role, m.withheld]), [['user', false], ['assistant', true]]);
    } finally {
      await target.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, ?)', [rohan?.id, support?.id]);
    }
  });
});

describe('demo:mcp-calls', () => {
  test('only https or loopback http base URLs without credentials are accepted', () => {
    for (const ok of ['https://acme.example.app', 'http://127.0.0.1:8080', 'http://localhost:4000/base']) assert.ok(checkedApiBaseUrl(ok));
    for (const bad of ['http://example.com', 'http://localhost.evil.example', 'ftp://127.0.0.1', 'https://user:pw@acme.example.app', '', undefined, 'not a url']) {
      assert.throws(() => checkedApiBaseUrl(bad), DemoMcpRefusedError, String(bad));
    }
  });

  // Detects: a demo command that cannot produce real recorded MCP rows.
  test('against a local backend it records one SUCCEEDED and two REJECTED calls, and prints no secrets', async () => {
    const server: Server = appOn(source).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const before = await selectRows(source, 'SELECT id FROM mcp_tool_calls');
      const results = await runDemoMcpCalls({ apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, email: 'meera.iyer@acme.com', password: PASSWORD });
      assert.deepEqual(results.map((r) => [r.tool, r.outcome]), [['search_employees', 'ok'], ['get_employee_compensation', 'error'], ['delete_employee', 'error']]);
      const known = new Set(before.map((r) => String(r.id)));
      const rows = (await selectRows(source, 'SELECT id, tool_name, status, validation_errors FROM mcp_tool_calls ORDER BY started_at, id')).filter((r) => !known.has(String(r.id)));
      assert.deepEqual(rows.map((r) => [r.tool_name, r.status, (r.validation_errors as { reason?: string } | null)?.reason ?? null]).sort(), [
        ['delete_employee', 'REJECTED', 'UNKNOWN_TOOL'], ['get_employee_compensation', 'REJECTED', 'INVALID_ARGUMENTS'], ['search_employees', 'SUCCEEDED', null],
      ]);
      assert.ok(!JSON.stringify(results).includes(PASSWORD));
      await assert.rejects(runDemoMcpCalls({ apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, email: 'meera.iyer@acme.com', password: 'wrong-password' }), /sign-in failed with HTTP 401/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
