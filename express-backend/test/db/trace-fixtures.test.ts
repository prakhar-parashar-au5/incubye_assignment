// Guarded trace fixtures for the traces UI against real MySQL (AI Task 04a):
// guards, dry run, every shape through the Admin API, idempotent re-run, and
// no runtime import of src/evaluation/.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import { createAdminObservabilityRepository } from '../../src/assistant/observability/admin-repository.js';
import { createObservabilityRepository } from '../../src/assistant/observability/repository.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { FixtureRefusedError, databaseNameOf } from '../../src/evaluation/fixture-guard.js';
import { MCP_SHAPES, TRACE_SHAPES, prepareTraceFixtures } from '../../src/evaluation/trace-fixtures.js';
import type { TraceFixtureManifest } from '../../src/evaluation/trace-fixtures.js';
import { createApp } from '../../src/http/app.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import { fakeDashboard, fakeDirectory, fakeHrAccess, fakeInsights, fakeSalaryAdjustments } from '../support/http.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const DATABASE = databaseNameOf(DATABASE_URL) ?? '';
const NOW = new Date();
const PASSWORD = 'synthetic-shared-demo-password';
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const TRACES = '/api/v1/admin/ai-traces';

let pool: Pool;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const count = async (table: string) => Number((await selectRows(pool, `SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);
const counts = async () => ({ traces: await count('ai_traces'), models: await count('ai_model_calls'), tools: await count('ai_tool_calls'), messages: await count('ai_messages'), reviews: await count('ai_trace_reviews'), mcp: await count('mcp_tool_calls') });
const run = (apply: boolean, overrides: Partial<Parameters<typeof prepareTraceFixtures>[0]> = {}) =>
  prepareTraceFixtures({ pool, apply, clock: () => NOW, appEnv: 'test', databaseName: DATABASE, confirmDatabase: DATABASE, ...overrides });
const auth = (who = 'meera') => ({ Authorization: `Bearer ${tokens[who] ?? ''}` });

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  const connection = await openConnection(DATABASE_URL);
  try { await ensureReferenceData(connection); } finally { await connection.end(); }
  const directory = fakeDirectory();
  const tools = createToolRegistry({ directory, insights: fakeInsights(), exchangeRate: null });
  app = createApp({
    auth: createAuthService({ pool, tokens: createSessionTokens({ signingKey: SIGNING_KEY }) }),
    directory, tools,
    assistant: createAssistantService({ model: null, tools, logger: () => undefined }),
    assistantStore: createObservabilityRepository(pool), mcpStore: createObservabilityRepository(pool),
    salaryAdjustments: fakeSalaryAdjustments(), dashboard: fakeDashboard(), hrAccess: fakeHrAccess(),
    adminObservability: createAdminObservabilityRepository(pool),
    logger: () => undefined, clientIpSource: 'socket',
  });
});
after(async () => { await pool?.end(); });

describe('guards', () => {
  test('missing demo users, production, unsafe names, and mismatches are refused and write nothing', async () => {
    const before = await counts();
    await assert.rejects(run(true), /demo HR users do not exist/);
    for (const overrides of [
      { appEnv: 'production' }, { appEnv: 'staging' }, { databaseName: 'acme', confirmDatabase: 'acme' },
      { confirmDatabase: undefined }, { confirmDatabase: `${DATABASE}x` }, { databaseName: 'other_ui_test', confirmDatabase: 'other_ui_test' },
    ]) await assert.rejects(run(true, overrides), FixtureRefusedError, JSON.stringify(overrides));
    assert.deepEqual(await counts(), before);
  });
});

describe('fixtures', () => {
  let applied: TraceFixtureManifest;
  const idOf = (shape: string) => applied.traces.find((t) => t.shape === shape)?.traceId ?? '';

  before(async () => {
    await bootstrapHrUser(pool, { email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
    await bootstrapHrUser(pool, { email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
    for (const [who, email] of [['meera', 'meera.iyer@acme.com'], ['rohan', 'rohan.mehta@acme.com']] as const) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
      assert.equal(res.status, 200, res.text);
      tokens[who] = String(res.body.token);
    }
  });

  test('dry run writes nothing and lists every planned shape', async () => {
    const before = await counts();
    const plan = await run(false);
    assert.deepEqual(await counts(), before);
    assert.equal(plan.mode, 'DRY_RUN');
    assert.deepEqual(plan.traces.map((t) => [t.shape, t.traceId]), TRACE_SHAPES.map((s) => [s.shape, null]));
    assert.deepEqual(plan.mcpCalls.map((c) => [c.shape, c.mcpCallId]), MCP_SHAPES.map((s) => [s.shape, null]));
  });

  // Detects: a shape missing or malformed when the UI reads it through the real API.
  test('apply creates every shape, readable through the Admin list, detail, and summary', async () => {
    applied = await run(true);
    assert.ok(applied.traces.every((t) => t.created && t.traceId !== null) && applied.mcpCalls.every((c) => c.created && c.mcpCallId !== null));
    assert.deepEqual(new Set(applied.traces.map((t) => t.hrUser)), new Set(['Meera Iyer', 'Rohan Mehta']));
    const detail = async (shape: string, view = 'formatted') => {
      const res = await request(app).get(`${TRACES}/${idOf(shape)}?view=${view}`).set(auth());
      assert.equal(res.status, 200, `${shape}: ${res.text}`);
      return res.body;
    };

    assert.deepEqual([(await detail('completed-no-tool')).toolCalls.length, (await detail('completed-no-tool')).modelCalls.length], [0, 1]);
    assert.deepEqual((await detail('completed-one-tool')).toolCalls.map((c: { status: string }) => c.status), ['SUCCEEDED']);
    const multi = await detail('completed-multi-tool');
    assert.deepEqual(multi.toolCalls.map((c: { modelCallSequence: number; toolName: string }) => [c.modelCallSequence, c.toolName]), [[1, 'search_employees'], [2, 'get_employee_compensation']]);
    assert.equal(multi.modelCalls.length, 3);
    const rejected = (await detail('rejected-tool-argument', 'raw')).toolCalls[0];
    assert.deepEqual([rejected.status, rejected.validationStatus, rejected.requestedArguments.password, rejected.result], ['REJECTED', 'REJECTED', '[REDACTED]', null]);
    assert.deepEqual((await detail('tool-failed')).toolCalls.map((c: { status: string; errorCategory: string }) => [c.status, c.errorCategory]), [['FAILED', 'TOOL_FAILED']]);
    const timeout = await detail('provider-timeout');
    assert.deepEqual([timeout.trace.status, timeout.trace.failureStage, timeout.modelCalls[0].failureCategory, timeout.finalResponse], ['FAILED', 'MODEL_CALL', 'timeout', null]);
    const persistence = await detail('persistence-failure');
    assert.deepEqual([persistence.trace.failureStage, persistence.toolCalls[0].status, persistence.toolCalls[0].errorCategory], ['TOOL_TRACE_WRITE', 'FAILED', 'OUTCOME_NOT_RECORDED']);
    assert.equal((await detail('in-progress')).trace.status, 'STARTED');
    const reviewed = await detail('reviewed');
    assert.deepEqual([reviewed.review.version, reviewed.review.verdict, reviewed.review.reviewer.displayName], [1, 'PARTIAL', 'Meera Iyer']);
    const stale = await request(app).post(`${TRACES}/${idOf('reviewed')}/review`).set(auth()).send({ verdict: 'CORRECT', expectedVersion: 0 });
    assert.deepEqual([stale.status, stale.body.error.code], [409, 'STALE_VERSION']);
    const [firstTurn, secondTurn] = [await detail('two-turn-first'), await detail('two-turn-second')];
    assert.deepEqual([firstTurn.trace.nextTraceId, secondTurn.trace.previousTraceId, secondTurn.trace.conversationId, secondTurn.trace.turnSequence],
      [idOf('two-turn-second'), idOf('two-turn-first'), firstTurn.trace.conversationId, 2]);

    const listed = await request(app).get(`${TRACES}?pageSize=100`).set(auth());
    assert.equal(listed.body.page.totalRows, TRACE_SHAPES.length);
    assert.deepEqual((await request(app).get(`${TRACES}?status=STARTED`).set(auth())).body.traces.map((t: { traceId: string }) => t.traceId), [idOf('in-progress')]);
    const mcp = await request(app).get('/api/v1/admin/mcp-tool-calls').set(auth());
    assert.deepEqual(mcp.body.calls.map((c: { status: string }) => c.status).sort(), ['FAILED', 'REJECTED', 'SUCCEEDED']);

    const summary = async (window: string) => (await request(app).get(`${TRACES}/summary?window=${window}`).set(auth())).body;
    const [day, week, month] = [await summary('24h'), await summary('7d'), await summary('30d')];
    assert.ok(day.traces.total > 0 && day.traces.total < week.traces.total && week.traces.total < month.traces.total,
      JSON.stringify([day.traces.total, week.traces.total, month.traces.total]));
    assert.equal(month.traces.total, TRACE_SHAPES.length);
    assert.ok(month.durationMs.p50 !== null && month.durationMs.p50 < month.durationMs.p95! && month.durationMs.p95 <= month.durationMs.max!);
    assert.ok(month.toolCalls.some((t: { status: string }) => t.status === 'REJECTED') && month.mcpCalls.length === 3);
    assert.ok(!JSON.stringify(applied).match(/mysql:\/\/|acme_local|synthetic-fixture-password/));
  });

  test('re-running finds every fixture and writes nothing', async () => {
    const before = await counts();
    const again = await run(true);
    assert.deepEqual(await counts(), before);
    assert.ok(again.traces.every((t) => !t.created) && again.mcpCalls.every((c) => !c.created));
    assert.deepEqual(again.traces.map((t) => t.traceId), applied.traces.map((t) => t.traceId));
    assert.deepEqual(again.mcpCalls.map((c) => c.mcpCallId), applied.mcpCalls.map((c) => c.mcpCallId));
  });
});

describe('no runtime code path', () => {
  // Detects: the server reaching fixture code (and so a way to write fixtures in a deployment).
  test('nothing under src/ outside src/evaluation/ imports src/evaluation/', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'evaluation') await walk(full); continue; }
        if (entry.name.endsWith('.ts') && /from '[^']*evaluation\//.test(await readFile(full, 'utf8'))) offenders.push(path.relative(root, full));
      }
    };
    await walk(root);
    assert.deepEqual(offenders, []);
  });
});
