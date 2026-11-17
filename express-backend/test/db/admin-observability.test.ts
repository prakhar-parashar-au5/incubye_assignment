// Admin AI observability against real MySQL (AI Task 04): list filters and
// pagination, options, complete ordered detail, formatted redaction versus
// the warned raw view, review compare-and-set, controlled deletion, the
// monitoring summary, and the query plans. Real auth (Admin and Scoped HR);
// traces are written through the observability repository.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
import { createApp } from '../../src/http/app.js';
import { RAW_TRACE_WARNING } from '../../src/http/contract.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import { fakeDashboard, fakeDirectory, fakeHrAccess, fakeInsights, fakeSalaryAdjustments } from '../support/http.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-demo-password';
const REAL_NOW = new Date();
const TRACES = '/api/v1/admin/ai-traces';
const MCP = '/api/v1/admin/mcp-tool-calls';

let pool: Pool;
let repo: ReturnType<typeof createObservabilityRepository>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};
const logs: LogEntry[] = [];

function buildApp(clock: () => Date = () => REAL_NOW) {
  const sessionTokens = createSessionTokens({ signingKey: SIGNING_KEY, clock: () => REAL_NOW });
  const directory = fakeDirectory();
  const tools = createToolRegistry({ directory, insights: fakeInsights(), exchangeRate: null });
  return createApp({
    auth: createAuthService({ pool, tokens: sessionTokens, clock: () => REAL_NOW }),
    directory, tools,
    assistant: createAssistantService({ model: null, tools, logger: () => undefined }),
    assistantStore: createObservabilityRepository(pool),
    assistantClock: clock,
    salaryAdjustments: fakeSalaryAdjustments(), dashboard: fakeDashboard(), hrAccess: fakeHrAccess(),
    adminObservability: createAdminObservabilityRepository(pool),
    mcpStore: createObservabilityRepository(pool),
    logger: (e) => logs.push(e),
    clientIpSource: 'socket',
  });
}
let app: ReturnType<typeof buildApp>;
const auth = (who = 'meera') => ({ Authorization: `Bearer ${tokens[who] ?? ''}` });
const db = (iso: string) => iso.replace('T', ' ').replace('Z', '');
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

const PERSON = { employeeCode: 'ACME00601', name: 'Asha Rao', annualBaseSalary: { amount: '1500000.00', currency: 'INR' } };

/** One trace written through the repository, as the recorded assistant would. */
async function seedTrace({ actor = 'meera', startedAt, status, durationMs = 100, model = 'fake-model', tool, failure, previousTraceId, conversationId, tokens: usage = { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 } }: {
  actor?: string; startedAt: string; status: 'STARTED' | 'COMPLETED' | 'FAILED'; durationMs?: number; model?: string;
  tool?: { name: string; outcome: 'SUCCEEDED' | 'FAILED' | 'REJECTED' }; failure?: { stage: string; category: string };
  previousTraceId?: string; conversationId?: string; tokens?: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}) {
  const actorId = must(ids[actor], actor);
  const conversation = conversationId ?? (await repo.createConversation(actorId, db(startedAt))).id;
  const trace = await repo.createTrace({
    conversationId: conversation, actorId, requestId: `req-${startedAt}`, promptVersion: 'v1', promptHash: 'a'.repeat(64), model,
    userContent: { text: 'How much does Asha Rao (ACME00601) earn?', retryOfTraceId: null },
    modelMessages: [{ role: 'user', content: 'How much does Asha Rao (ACME00601) earn?' }], startedAt: db(startedAt),
    ...(previousTraceId === undefined ? {} : { previousTraceId }),
    actorScope: { role: actor === 'meera' ? 'ADMIN' : 'SCOPED', countries: actor === 'meera' ? [] : ['IN'], departments: actor === 'meera' ? [] : ['Support', 'Tech'] },
  });
  if (status === 'STARTED') return { traceId: trace.id, conversationId: conversation };
  const first = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model, input: { messages: [] }, tools: [], promptVersion: 'v1', promptHash: 'a'.repeat(64), startedAt: db(startedAt) });
  if (tool) {
    await repo.finishModelCall(first.id, { status: 'SUCCEEDED', output: { text: null }, decisions: [{ callId: 'c1', name: tool.name, arguments: { employeeCode: 'ACME00601' } }], ...usage, latencyMs: 5, completedAt: db(startedAt) });
    const call = await repo.startToolCall({ traceId: trace.id, modelCallId: first.id, providerToolCallId: 'c1', toolName: tool.name, arguments: { employeeCode: 'ACME00601', authorization: 'Bearer leaked' }, startedAt: db(startedAt) });
    if (tool.outcome === 'SUCCEEDED') await repo.finishToolCall(call.id, { status: 'SUCCEEDED', result: { data: { employee: PERSON }, cards: [], limitations: [] }, durationMs: 3, completedAt: db(startedAt) });
    else if (tool.outcome === 'REJECTED') await repo.finishToolCall(call.id, { status: 'REJECTED', validation: { reason: 'INVALID_ARGUMENTS' }, durationMs: 1, completedAt: db(startedAt) });
    else await repo.finishToolCall(call.id, { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { errorName: 'Error' }, durationMs: 2, completedAt: db(startedAt) });
    if (status === 'COMPLETED') {
      const second = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model, input: { messages: [], exchanges: [{ outputs: [{ output: { employee: PERSON } }] }] }, tools: [], promptVersion: 'v1', promptHash: 'a'.repeat(64), startedAt: db(startedAt) });
      await repo.finishModelCall(second.id, { status: 'SUCCEEDED', output: { text: 'Asha Rao earns INR 1500000.00.' }, decisions: [], latencyMs: 7, completedAt: db(startedAt) });
    }
  } else if (status === 'COMPLETED') {
    await repo.finishModelCall(first.id, { status: 'SUCCEEDED', output: { text: 'Hello.' }, decisions: [], ...usage, latencyMs: 5, completedAt: db(startedAt) });
  } else {
    await repo.finishModelCall(first.id, { status: 'FAILED', failureCategory: failure?.category ?? 'timeout', safeError: { category: failure?.category ?? 'timeout' }, latencyMs: 5, completedAt: db(startedAt) });
  }
  const completedAt = db(plusMs(startedAt, durationMs));
  await repo.finishTrace(trace.id, status === 'COMPLETED'
    ? { status, durationMs, completedAt, finalResponse: { answer: 'Asha Rao earns INR 1500000.00.', toolCalls: [], cards: [], limitations: [], generatedAt: plusMs(startedAt, durationMs) } }
    : { status, durationMs, completedAt, failureStage: failure?.stage ?? 'MODEL_CALL', errorCategory: failure?.category ?? 'timeout' });
  return { traceId: trace.id, conversationId: conversation };
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 10 });
  const connection = await openConnection(DATABASE_URL);
  try { await ensureReferenceData(connection); } finally { await connection.end(); }
  await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  for (const row of await selectRows(pool, 'SELECT id, email FROM hr_users')) ids[String(row.email).split('@')[0] ?? ''] = Number(row.id);
  repo = createObservabilityRepository(pool);
  app = buildApp();
  for (const who of ['meera', 'rohan']) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: `${who}@acme.com`, password: PASSWORD });
    assert.equal(res.status, 200, res.text);
    tokens[who] = String(res.body.token);
  }
});
after(async () => { await pool?.end(); });

describe('admin trace list and options', () => {
  const day = (d: string, hhmm = '10:00') => `2026-10-${d}T${hhmm}:00.000Z`;
  let seeded: Record<string, string> = {};
  before(async () => {
    seeded = {
      a: (await seedTrace({ startedAt: day('01'), status: 'COMPLETED', tool: { name: 'search_employees', outcome: 'SUCCEEDED' } })).traceId,
      b: (await seedTrace({ actor: 'rohan', startedAt: day('02'), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'timeout' }, model: 'other-model' })).traceId,
      c: (await seedTrace({ startedAt: day('02', '23:59'), status: 'STARTED' })).traceId,
      d: (await seedTrace({ startedAt: day('03'), status: 'COMPLETED', tool: { name: 'get_compensation_summary', outcome: 'REJECTED' } })).traceId,
    };
  });
  const list = async (query = '') => {
    const res = await request(app).get(`${TRACES}${query}`).set(auth());
    assert.equal(res.status, 200, res.text);
    return res.body as { traces: { traceId: string; hrUser: { displayName: string }; toolNames: string[]; status: string }[]; page: { totalRows: number; totalPages: number } };
  };
  const inOctober = 'from=2026-10-01&to=2026-10-31';

  // Detects: client-side filtering, wrong date bounds, or raw content in the list.
  test('filters run server-side; dates are inclusive UTC days on start time; newest first; with totals', async () => {
    const all = await list(`?${inOctober}`);
    assert.deepEqual(all.traces.map((t) => t.traceId), [seeded.d, seeded.c, seeded.b, seeded.a]);
    assert.equal(all.page.totalRows, 4);
    assert.deepEqual((await list(`?from=2026-10-02&to=2026-10-02`)).traces.map((t) => t.traceId), [seeded.c, seeded.b], 'both ends inclusive; 23:59 is still the 2nd');
    assert.deepEqual((await list(`?${inOctober}&status=STARTED`)).traces.map((t) => t.traceId), [seeded.c]);
    assert.deepEqual((await list(`?${inOctober}&hrUserId=${ids.rohan}`)).traces.map((t) => [t.traceId, t.hrUser.displayName]), [[seeded.b, 'Rohan Mehta']]);
    assert.deepEqual((await list(`?${inOctober}&model=other-model`)).traces.map((t) => t.traceId), [seeded.b]);
    assert.deepEqual((await list(`?${inOctober}&tool=search_employees`)).traces.map((t) => [t.traceId, t.toolNames]), [[seeded.a, ['search_employees']]]);
    assert.deepEqual((await list(`?${inOctober}&errorCategory=timeout`)).traces.map((t) => t.traceId), [seeded.b]);
    const paged = await list(`?${inOctober}&pageSize=3&page=2`);
    assert.deepEqual([paged.traces.map((t) => t.traceId), paged.page], [[seeded.a], { number: 2, size: 3, totalRows: 4, totalPages: 2 }]);
    const text = JSON.stringify(all);
    for (const content of ['Asha', 'ACME00601', 'earns', 'userContent', 'result', 'safeError', 'Bearer']) assert.ok(!text.includes(content), content);
  });

  test('options list stored values plus the closed enumerations', async () => {
    const res = await request(app).get(`${TRACES}/options`).set(auth());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.hrUsers.map((u: { displayName: string }) => u.displayName), ['Meera Iyer', 'Rohan Mehta']);
    assert.ok(res.body.models.includes('other-model') && res.body.toolNames.includes('search_employees') && res.body.errorCategories.includes('timeout'));
    assert.deepEqual(res.body.statuses, ['STARTED', 'COMPLETED', 'FAILED']);
    assert.ok(res.body.enums.toolCallStatuses.includes('REJECTED'));
  });
});

describe('admin trace detail', () => {
  // Detects: a timeline out of order, identities in the formatted view, or a raw view without its warning.
  test('formatted detail is complete, ordered, and uses placeholders; raw is exact with the warning', async () => {
    const first = await seedTrace({ startedAt: '2026-10-10T09:00:00.000Z', status: 'COMPLETED', tool: { name: 'get_employee_compensation', outcome: 'SUCCEEDED' } });
    const next = await seedTrace({ startedAt: '2026-10-10T09:05:00.000Z', status: 'COMPLETED', conversationId: first.conversationId, previousTraceId: first.traceId });
    const formatted = await request(app).get(`${TRACES}/${first.traceId}`).set(auth());
    assert.equal(formatted.status, 200, formatted.text);
    const body = formatted.body;
    assert.deepEqual([body.view, body.warning, body.redaction.identities], ['formatted', null, 'PLACEHOLDERS']);
    assert.deepEqual([body.trace.turnSequence, body.trace.previousTraceId, body.trace.nextTraceId, body.trace.hrUser.displayName], [1, null, next.traceId, 'Meera Iyer']);
    assert.deepEqual(body.modelCalls.map((c: { sequence: number; status: string }) => [c.sequence, c.status]), [[1, 'SUCCEEDED'], [2, 'SUCCEEDED']]);
    assert.deepEqual(body.toolCalls.map((c: { sequence: number; modelCallSequence: number; status: string; validationStatus: string }) => [c.sequence, c.modelCallSequence, c.status, c.validationStatus]), [[1, 1, 'SUCCEEDED', 'VALID']]);
    assert.deepEqual(body.messages.map((m: { sequence: number; role: string }) => [m.sequence, m.role]), [[1, 'USER'], [2, 'ASSISTANT']]);
    assert.deepEqual(body.toolCalls[0].result.data.employee, { employeeCode: 'EMPLOYEE-1', name: 'Employee 1', annualBaseSalary: { amount: '1500000.00', currency: 'INR' } });
    const text = JSON.stringify(body);
    assert.ok(!/ACME00601|Asha|Rao/.test(text), 'no identity anywhere in the formatted view');
    assert.ok(text.includes('1500000.00') && body.userContent.text === 'How much does Employee 1 (EMPLOYEE-1) earn?');
    assert.ok(!text.includes('Bearer leaked'), 'scrubbed at write time');

    const raw = await request(app).get(`${TRACES}/${first.traceId}?view=raw`).set(auth());
    assert.deepEqual([raw.body.view, raw.body.warning, raw.body.redaction.identities], ['raw', RAW_TRACE_WARNING, 'NONE']);
    assert.deepEqual(raw.body.toolCalls[0].result.data.employee, PERSON);
    assert.equal(raw.body.finalResponse.answer, 'Asha Rao earns INR 1500000.00.');
    assert.ok(!logs.some((l) => JSON.stringify(l).includes('Asha')), 'no trace content in logs');
  });

  test('unknown trace or MCP call is 404', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    assert.deepEqual([(await request(app).get(`${TRACES}/${id}`).set(auth())).status, (await request(app).get(`${MCP}/${id}`).set(auth())).status], [404, 404]);
  });
});

describe('review and deletion', () => {
  // Detects: one Admin silently overwriting another's review, or a review of an unfinished turn.
  test('review is compare-and-set; stale is 409 STALE_VERSION; an open trace is 409; unknown is 404', async () => {
    const { traceId } = await seedTrace({ startedAt: '2026-10-11T09:00:00.000Z', status: 'COMPLETED' });
    const post = (body: Record<string, unknown>, id = traceId) => request(app).post(`${TRACES}/${id}/review`).set(auth()).send(body);
    const first = await post({ verdict: 'PARTIAL', note: 'Missing the bonus.', nominated: true, expectedVersion: 0 });
    assert.equal(first.status, 200, first.text);
    assert.deepEqual([first.body.review.version, first.body.review.verdict, first.body.review.nominated, first.body.review.reviewer.displayName], [1, 'PARTIAL', true, 'Meera Iyer']);
    const stale = await post({ verdict: 'INCORRECT', expectedVersion: 0 });
    assert.deepEqual([stale.status, stale.body.error.code], [409, 'STALE_VERSION']);
    const second = await post({ verdict: 'CORRECT', expectedVersion: 1 });
    assert.deepEqual([second.status, second.body.review.version, second.body.review.note, second.body.review.nominated], [200, 2, '', false]);
    const detail = await request(app).get(`${TRACES}/${traceId}`).set(auth());
    assert.deepEqual([detail.body.review.version, detail.body.review.verdict], [2, 'CORRECT']);
    const open = await seedTrace({ startedAt: '2026-10-11T09:30:00.000Z', status: 'STARTED' });
    const inProgress = await post({ verdict: 'CORRECT', expectedVersion: 0 }, open.traceId);
    assert.deepEqual([inProgress.status, inProgress.body.error.code], [409, 'ASSISTANT_TURN_IN_PROGRESS']);
    assert.equal((await post({ verdict: 'CORRECT', expectedVersion: 0 }, '00000000-0000-4000-8000-000000000000')).status, 404);
    const scoped = await request(app).post(`${TRACES}/${traceId}/review`).set(auth('rohan')).send({ verdict: 'CORRECT', expectedVersion: 2 });
    assert.equal(scoped.status, 403);
    assert.equal(Number((await selectRows(pool, 'SELECT version FROM ai_trace_reviews WHERE trace_id = ?', [traceId]))[0]?.version), 2);
  });

  // Detects: deletion removing the whole conversation, or leaving dangling child rows.
  test('delete needs confirmation, removes one aggregate only, and a later trace stays readable', async () => {
    const first = await seedTrace({ startedAt: '2026-10-12T09:00:00.000Z', status: 'COMPLETED', tool: { name: 'search_employees', outcome: 'SUCCEEDED' } });
    const later = await seedTrace({ startedAt: '2026-10-12T09:05:00.000Z', status: 'COMPLETED', conversationId: first.conversationId, previousTraceId: first.traceId });
    await request(app).post(`${TRACES}/${first.traceId}/review`).set(auth()).send({ verdict: 'CORRECT', expectedVersion: 0 });
    assert.equal((await request(app).delete(`${TRACES}/${first.traceId}`).set(auth())).status, 400);
    assert.equal((await request(app).delete(`${TRACES}/${first.traceId}?confirm=${first.traceId}`).set(auth('rohan'))).status, 403);
    const res = await request(app).delete(`${TRACES}/${first.traceId}?confirm=${first.traceId}`).set(auth());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.deleted, { traceId: first.traceId, modelCalls: 2, toolCalls: 1, messages: 2, review: true });
    for (const table of ['ai_model_calls', 'ai_tool_calls', 'ai_messages', 'ai_trace_reviews']) {
      assert.equal(Number((await selectRows(pool, `SELECT COUNT(*) AS n FROM ${table} WHERE trace_id = ?`, [first.traceId]))[0]?.n), 0, table);
    }
    const remaining = await request(app).get(`${TRACES}/${later.traceId}`).set(auth());
    assert.deepEqual([remaining.status, remaining.body.trace.previousTraceId, remaining.body.messages.length], [200, null, 2]);
    assert.equal(Number((await selectRows(pool, 'SELECT COUNT(*) AS n FROM ai_conversations WHERE id = ?', [first.conversationId]))[0]?.n), 1);
    assert.equal((await request(app).delete(`${TRACES}/${first.traceId}?confirm=${first.traceId}`).set(auth())).status, 404, 'repeat is safe');
  });
});

describe('MCP list and detail', () => {
  test('newest first, filterable, no content in the list; detail has formatted and raw views', async () => {
    const started = '2026-10-15 08:00:00.000';
    const ok = await repo.startMcpCall({ actorId: must(ids.rohan, 'rohan'), requestId: 'mcp-1', toolName: 'search_employees', arguments: { query: 'Asha' }, startedAt: started });
    await repo.finishMcpCall(ok.id, { status: 'SUCCEEDED', result: { data: { employees: [PERSON] }, cards: [], limitations: [] }, durationMs: 4, completedAt: started });
    const bad = await repo.startMcpCall({ actorId: must(ids.meera, 'meera'), requestId: 'mcp-2', toolName: 'get_employee_compensation', arguments: { employeeCode: 7 }, startedAt: '2026-10-15 09:00:00.000' });
    await repo.finishMcpCall(bad.id, { status: 'REJECTED', validation: { reason: 'INVALID_ARGUMENTS' }, durationMs: 1, completedAt: '2026-10-15 09:00:00.000' });
    const list = await request(app).get(`${MCP}?from=2026-10-15&to=2026-10-15`).set(auth());
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.body.calls.map((c: { mcpCallId: string; status: string; hrUser: { displayName: string } }) => [c.mcpCallId, c.status, c.hrUser.displayName]), [[bad.id, 'REJECTED', 'Meera Iyer'], [ok.id, 'SUCCEEDED', 'Rohan Mehta']]);
    assert.ok(!JSON.stringify(list.body).includes('Asha'));
    assert.deepEqual((await request(app).get(`${MCP}?from=2026-10-15&to=2026-10-15&status=REJECTED`).set(auth())).body.calls.length, 1);
    const formatted = await request(app).get(`${MCP}/${ok.id}`).set(auth());
    assert.deepEqual([formatted.body.redaction.identities, formatted.body.call.result.data.employees[0].name], ['PLACEHOLDERS', 'Employee 1']);
    assert.equal(formatted.body.call.requestedArguments.query, 'Asha', 'a first name alone is a documented limit of the placeholder pass');
    const raw = await request(app).get(`${MCP}/${ok.id}?view=raw`).set(auth());
    assert.deepEqual([raw.body.warning, raw.body.call.result.data.employees[0].employeeCode], [RAW_TRACE_WARNING, 'ACME00601']);
    assert.equal((await request(app).get(`${MCP}/${ok.id}`).set(auth('rohan'))).status, 403);
  });
});

describe('monitoring summary', () => {
  // The summary app's clock is far from the other tests' data, so each window holds only what is seeded here.
  const NOW = new Date('2027-03-01T12:00:00.000Z');
  const summaryApp = () => buildApp(() => NOW);
  const get = async (window: string) => {
    const res = await request(summaryApp()).get(`${TRACES}/summary?window=${window}`).set(auth());
    assert.equal(res.status, 200, res.text);
    return res.body;
  };

  test('an empty window returns zeros, null percentiles, and zero-filled buckets', async () => {
    const body = await get('24h');
    assert.deepEqual(body.traces, { total: 0, completed: 0, failed: 0, started: 0 });
    assert.deepEqual(body.durationMs, { completedCount: 0, p50: null, p95: null, max: null });
    assert.deepEqual([body.from, body.to, body.generatedAt], ['2027-02-28T12:00:00.000Z', NOW.toISOString(), NOW.toISOString()]);
    assert.equal(body.series.points.length, 25);
    assert.ok(body.series.points.every((p: { traces: number }) => p.traces === 0));
    assert.equal((await request(summaryApp()).get(`${TRACES}/summary`).set(auth('rohan'))).status, 403);
  });

  // Detects: wrong percentiles, mixed-status leakage into durations, or off-by-one window edges.
  test('mixed statuses, exact percentiles, tokens, tools, MCP, reviews, series, and inclusive window edges', async () => {
    const at = (offsetMinutes: number) => new Date(NOW.getTime() - offsetMinutes * 60_000).toISOString();
    // 20 completed traces, durations 10..200 ms in shuffled order.
    const durations = [70, 10, 200, 30, 150, 90, 20, 110, 60, 180, 40, 130, 80, 190, 50, 100, 170, 120, 160, 140];
    for (const [i, ms] of durations.entries()) await seedTrace({ startedAt: at(30 + i), status: 'COMPLETED', durationMs: ms });
    const tooled = await seedTrace({ startedAt: at(90), status: 'COMPLETED', durationMs: 5000, tool: { name: 'search_employees', outcome: 'SUCCEEDED' }, model: 'model-b' });
    await seedTrace({ startedAt: at(100), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'timeout' } });
    await seedTrace({ startedAt: at(110), status: 'FAILED', tool: { name: 'get_compensation_summary', outcome: 'FAILED' }, failure: { stage: 'TOOL_EXECUTION', category: 'turn_timeout' } });
    await seedTrace({ startedAt: at(120), status: 'STARTED' });
    // Edges: exactly at from and at to are inside; just outside is not.
    await seedTrace({ startedAt: at(24 * 60), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'provider_error' } });
    await seedTrace({ startedAt: at(0), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'provider_error' } });
    await seedTrace({ startedAt: new Date(NOW.getTime() - 24 * 60 * 60_000 - 1).toISOString(), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'rate_limited' } });
    await seedTrace({ startedAt: new Date(NOW.getTime() + 1).toISOString(), status: 'FAILED', failure: { stage: 'MODEL_CALL', category: 'rate_limited' } });
    await request(summaryApp()).post(`${TRACES}/${tooled.traceId}/review`).set(auth()).send({ verdict: 'INCORRECT', expectedVersion: 0 });
    const mcp = await repo.startMcpCall({ actorId: must(ids.rohan, 'rohan'), requestId: 'mcp-sum', toolName: 'search_employees', arguments: {}, startedAt: db(at(15)) });
    await repo.finishMcpCall(mcp.id, { status: 'REJECTED', validation: { reason: 'INVALID_ARGUMENTS' }, durationMs: 1, completedAt: db(at(15)) });

    const body = await get('24h');
    assert.deepEqual(body.traces, { total: 26, completed: 21, failed: 4, started: 1 });
    assert.deepEqual(body.failures, [
      { failureStage: 'MODEL_CALL', errorCategory: 'provider_error', count: 2 },
      { failureStage: 'MODEL_CALL', errorCategory: 'timeout', count: 1 },
      { failureStage: 'TOOL_EXECUTION', errorCategory: 'turn_timeout', count: 1 },
    ]);
    // 21 completed: 10..200 plus 5000. Nearest rank: p50 = 11th = 110, p95 = 20th = 200, max = 5000.
    assert.deepEqual(body.durationMs, { completedCount: 21, p50: 110, p95: 200, max: 5000 });
    // Tokens are reported by successful model outcomes: the 20 plain turns and the two tooled turns (failed calls report none).
    assert.equal(body.tokens.input, 22 * 10);
    assert.equal(body.tokens.total, body.tokens.input + body.tokens.output);
    assert.equal(body.modelCalls.total, 25 + 1, 'one call each, plus the second call of the tooled turn');
    assert.ok(body.modelCalls.byModel.some((m: { model: string; count: number }) => m.model === 'model-b' && m.count === 2));
    assert.deepEqual(body.toolCalls, [
      { toolName: 'get_compensation_summary', status: 'FAILED', count: 1 },
      { toolName: 'search_employees', status: 'SUCCEEDED', count: 1 },
    ]);
    assert.deepEqual(body.mcpCalls, [{ toolName: 'search_employees', status: 'REJECTED', count: 1 }]);
    assert.deepEqual(body.reviews, { byVerdict: [{ verdict: 'INCORRECT', count: 1 }], unreviewed: 24 });
    const series = body.series.points as { start: string; traces: number; failures: number }[];
    assert.equal(series.reduce((s, p) => s + p.traces, 0), 26);
    assert.equal(series.reduce((s, p) => s + p.failures, 0), 4);
    assert.deepEqual([series[0], series.at(-1)], [{ start: '2027-02-28T12:00:00.000Z', traces: 1, failures: 1 }, { start: '2027-03-01T12:00:00.000Z', traces: 1, failures: 1 }]);
    assert.ok(!JSON.stringify(body).match(/Asha|ACME|Meera|Rohan|How much/), 'counts only');

    const week = await get('7d');
    assert.deepEqual([week.series.bucket, week.series.points.length, week.traces.total], ['DAY', 8, 27]);
  });

  // Plans need realistic volume: on a few rows MySQL scans whole tables whatever the indexes.
  test('query plans with 10,000 traces over 90 days (recorded in the response)', async () => {
    const [conversation] = await selectRows(pool, 'SELECT UUID() AS id');
    const conversationId = String(conversation?.id);
    await pool.query('INSERT INTO ai_conversations (id, hr_user_id, created_at) VALUES (?, ?, ?)', [conversationId, ids.meera, '2026-06-01 00:00:00.000']);
    const digits = '(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
    await pool.query(`INSERT INTO ai_traces (id, conversation_id, hr_user_id, actor_role, actor_countries, actor_departments, sequence, request_id, status, model, prompt_version, prompt_hash,
        user_content, model_messages, started_at, completed_at, duration_ms)
      SELECT UUID(), ?, ?, 'ADMIN', JSON_ARRAY(), JSON_ARRAY(), n + 1, CONCAT('bulk-', n), 'COMPLETED', 'bulk-model', 'v1', REPEAT('a', 64), JSON_OBJECT('text', 'x'), JSON_ARRAY(),
        TIMESTAMPADD(SECOND, n * 777, '2026-06-01 00:00:00.000'), TIMESTAMPADD(SECOND, n * 777 + 1, '2026-06-01 00:00:00.000'), 1000
      FROM (SELECT a.d + b.d * 10 + c.d * 100 + e.d * 1000 AS n FROM ${digits} a, ${digits} b, ${digits} c, ${digits} e) numbers`, [conversationId, ids.meera]);
    await pool.query(`INSERT INTO ai_model_calls (trace_id, sequence, provider, model, input_messages, tool_schemas, prompt_version, prompt_hash, status, started_at, completed_at)
      SELECT id, 1, 'bulk', 'bulk-model', JSON_ARRAY(), JSON_ARRAY(), 'v1', REPEAT('a', 64), 'SUCCEEDED', started_at, completed_at FROM ai_traces WHERE conversation_id = ?`, [conversationId]);
    await pool.query(`INSERT INTO ai_tool_calls (trace_id, model_call_id, sequence, tool_name, requested_arguments, validation_status, status, started_at, completed_at)
      SELECT mc.trace_id, mc.id, 1, 'search_employees', JSON_OBJECT(), 'VALID', 'SUCCEEDED', mc.started_at, mc.completed_at FROM ai_model_calls mc JOIN ai_traces t ON t.id = mc.trace_id WHERE t.conversation_id = ?`, [conversationId]);
    await pool.query('ANALYZE TABLE ai_traces, ai_model_calls, ai_tool_calls, mcp_tool_calls');
    const plan = async (sql: string, from: string, to: string) => (await selectRows(pool, `EXPLAIN ${sql}`, [from, to]))
      .map((r) => `${String(r.table)}:${String(r.type)}:${String(r.key)}`);
    const queries = {
      statuses: 'SELECT t.status, COUNT(*) FROM ai_traces t WHERE t.started_at >= ? AND t.started_at <= ? GROUP BY t.status',
      percentiles: "SELECT t.duration_ms, ROW_NUMBER() OVER (ORDER BY t.duration_ms, t.id) FROM ai_traces t WHERE t.started_at >= ? AND t.started_at <= ? AND t.status = 'COMPLETED'",
      toolCalls: 'SELECT tc.tool_name, tc.status, COUNT(*) FROM ai_traces t JOIN ai_tool_calls tc ON tc.trace_id = t.id WHERE t.started_at >= ? AND t.started_at <= ? GROUP BY tc.tool_name, tc.status',
      modelCalls: 'SELECT mc.model, COUNT(*) FROM ai_traces t JOIN ai_model_calls mc ON mc.trace_id = t.id WHERE t.started_at >= ? AND t.started_at <= ? GROUP BY mc.model',
      mcp: 'SELECT m.tool_name, m.status, COUNT(*) FROM mcp_tool_calls m WHERE m.started_at >= ? AND m.started_at <= ? GROUP BY m.tool_name, m.status',
      failures: "SELECT t.failure_stage, t.error_category, COUNT(*) FROM ai_traces t WHERE t.started_at >= ? AND t.started_at <= ? AND t.status = 'FAILED' GROUP BY t.failure_stage, t.error_category",
      tokens: 'SELECT SUM(t.input_tokens), SUM(t.output_tokens), SUM(t.reasoning_tokens) FROM ai_traces t WHERE t.started_at >= ? AND t.started_at <= ?',
      series: "SELECT DATE_FORMAT(t.started_at, '%Y-%m-%d 00:00:00.000') AS bucket, COUNT(*), SUM(t.status = 'FAILED') FROM ai_traces t WHERE t.started_at >= ? AND t.started_at <= ? GROUP BY bucket",
      unreviewed: "SELECT COUNT(*) FROM ai_traces t LEFT JOIN ai_trace_reviews r ON r.trace_id = t.id WHERE t.started_at >= ? AND t.started_at <= ? AND t.status <> 'STARTED' AND r.trace_id IS NULL",
    };
    const plans: Record<string, Record<string, string[]>> = {};
    for (const [label, [from, to]] of Object.entries({ '24h': ['2026-07-15 00:00:00.000', '2026-07-16 00:00:00.000'], '30d': ['2026-07-01 00:00:00.000', '2026-07-31 00:00:00.000'] })) {
      plans[label] = {};
      for (const [name, sql] of Object.entries(queries)) (plans[label] as Record<string, string[]>)[name] = await plan(sql, from, to);
    }
    console.log('EXPLAIN', JSON.stringify(plans));
    for (const label of ['24h', '30d']) {
      // Single-table aggregates: an index range (started_at-leading, or status then started_at), never a scan.
      for (const name of ['statuses', 'percentiles', 'failures', 'tokens', 'series', 'unreviewed']) {
        const tracePlan = plans[label]?.[name]?.find((p) => p.startsWith('t:')) ?? '';
        assert.match(tracePlan, /^t:range:idx_ai_traces_(started|summary|status)$/, `${label} ${name}: ${JSON.stringify(plans[label]?.[name])}`);
      }
      // Child-table joins: MySQL either ranges ai_traces and joins children by the trace key, or (when the
      // window covers much of the table, as 30 of 90 days here) reads the child table and looks each trace up
      // by primary key. Both were observed across runs; ai_traces itself is never fully scanned.
      for (const [name, child] of [['toolCalls', 'tc'], ['modelCalls', 'mc']] as const) {
        const rows = plans[label]?.[name] ?? [];
        const traceDriven = rows.includes('t:range:idx_ai_traces_started') && rows.some((p) => p.startsWith(`${child}:ref:`));
        const childDriven = rows.includes('t:eq_ref:PRIMARY') && rows.some((p) => p.startsWith(`${child}:`));
        assert.ok(traceDriven || childDriven, `${label} ${name}: ${JSON.stringify(rows)}`);
      }
    }
    await pool.query('DELETE FROM ai_traces WHERE conversation_id = ?', [conversationId]);
  });
});
