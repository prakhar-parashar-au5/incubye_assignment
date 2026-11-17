// Recorded assistant conversations over HTTP against real MySQL (AI Task 03):
// real auth, real tools and scope SQL, the real observability repository, and
// the fake model. Every expectation reads the stored rows back from MySQL.
//
// Employees: ACME00601 Asha Rao (IN Tech), ACME00602 Vikram Iyer (IN Support),
// ACME00603 Grace Miller (US Finance, outside Rohan's IN x Tech/Support scope).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import type { AssistantStore } from '../../src/assistant/assistant-store.js';
import { INVALID_JSON_ARGUMENTS } from '../../src/assistant/assistant-service.js';
import { WITHHELD_ANSWER } from '../../src/assistant/conversation-service.js';
import { createCompensationInsights } from '../../src/assistant/compensation-insights.js';
import { ModelFailure } from '../../src/assistant/model.js';
import type { ModelAdapter, ModelReply } from '../../src/assistant/model.js';
import { createObservabilityRepository } from '../../src/assistant/observability/repository.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import type { ToolRegistry } from '../../src/assistant/tools.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDashboardService } from '../../src/dashboard/dashboard-service.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../../src/directory/exchange-rate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { answer, callTool, rawCall, scriptedModel } from '../support/fake-model.js';
import type { FakeStep } from '../support/fake-model.js';
import { fakeHrAccess, fakeSalaryAdjustments, fakeAdminObservability, fakeMcpStore } from '../support/http.js';
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
const BASE = '/api/v1/assistant/conversations';

let pool: Pool;
let tools: ToolRegistry;
let logs: LogEntry[] = [];
let steps: FakeStep[] = [];
const tokens: Record<string, string> = {};
let counter = 0;
const newKey = () => `db-turn-key-${String(++counter).padStart(6, '0')}`;
const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);

/** A fake model whose script can change per test; each open() starts at step 0. */
const model: ModelAdapter & { opened: { messages: unknown }[] } = {
  provider: 'fake',
  model: 'fake-model',
  opened: [],
  open(request) {
    model.opened.push({ messages: request.messages });
    return scriptedModel(steps).open(request);
  },
};

function buildApp(store: AssistantStore = createObservabilityRepository(pool), registry: ToolRegistry = tools, assistantModel: ModelAdapter | null = model) {
  const sessionTokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  const directory = createDirectoryService({ pool, exchangeRate: RATE, clock });
  return createApp({
    auth: createAuthService({ pool, tokens: sessionTokens, clock }),
    directory,
    tools: registry,
    assistant: createAssistantService({ model: assistantModel, tools: registry, logger: (e) => logs.push(e), clock }),
    assistantStore: store,
    assistantClock: clock,
    salaryAdjustments: fakeSalaryAdjustments(),
    dashboard: createDashboardService({ pool, exchangeRate: RATE, clock }),
    hrAccess: fakeHrAccess(), adminObservability: fakeAdminObservability(), mcpStore: fakeMcpStore().store,
    logger: (e) => logs.push(e),
    clientIpSource: 'socket',
  });
}
let app: ReturnType<typeof buildApp>;

const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who] ?? ''}` });
async function create(who = 'meera'): Promise<string> {
  const res = await request(app).post(BASE).set(auth(who)).send({});
  assert.equal(res.status, 201, res.text);
  return String(res.body.conversation.conversationId);
}
const send = (id: string, content: string, key = newKey(), who = 'meera', extra: Record<string, unknown> = {}, target = app) =>
  request(target).post(`${BASE}/${id}/messages`).set(auth(who)).set('Idempotency-Key', key).send({ content, ...extra });

async function employee(code: string, first: string, last: string, title: string, level: string, country: 'IN' | 'US', base: string) {
  const [t] = await query('SELECT id FROM job_titles WHERE name = ? AND level = ?', [title, level]);
  const [result] = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date)
     VALUES (?, ?, ?, ?, ?, ?, 'CURRENTLY_WORKING', '2020-01-01')`,
    [code, first, last, `${first.toLowerCase()}.${code.toLowerCase()}@acme.com`, must(t, title).id, country],
  );
  await pool.query('INSERT INTO compensation_records SET ?', [{
    employee_id: (result as { insertId: number }).insertId, version: 1, annual_base_salary: base, annual_bonus: '0.00',
    currency: country === 'IN' ? 'INR' : 'USD', pay_frequency: country === 'IN' ? 'MONTHLY' : 'ANNUAL', effective_from: '2020-01-01',
    change_reason: 'INITIAL_IMPORT', created_at: '2026-01-01 00:00:00.000',
  }]);
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 10 });
  const connection = await openConnection(DATABASE_URL);
  try {
    await ensureReferenceData(connection);
  } finally {
    await connection.end();
  }
  await employee('ACME00601', 'Asha', 'Rao', 'Software Engineer', 'MID', 'IN', '1500000.00');
  await employee('ACME00602', 'Vikram', 'Iyer', 'Support Specialist', 'MID', 'IN', '900000.00');
  await employee('ACME00603', 'Grace', 'Miller', 'Senior Accountant', 'SENIOR', 'US', '150000.00');
  await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  tools = createToolRegistry({
    directory: createDirectoryService({ pool, exchangeRate: RATE, clock }),
    insights: createCompensationInsights({ pool, exchangeRate: RATE }),
    exchangeRate: RATE,
  });
  app = buildApp();
  for (const who of ['meera', 'rohan']) {
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
  steps = [() => answer('Hello.')];
  app = buildApp();
});

const traceRows = (conversationId: string) => query('SELECT * FROM ai_traces WHERE conversation_id = ? ORDER BY sequence', [conversationId]);
const withTelemetry = (reply: ModelReply, requestId: string, usage: Record<string, number>): ModelReply => ({ ...reply, telemetry: { providerRequestId: requestId, usage } });

describe('owned conversations in MySQL', () => {
  // Detects: history that still depends on browser memory and disappears on reload.
  test('saved user and assistant messages come back in their original order after reload', async () => {
    const id = await create();
    let n = 0;
    steps = [() => answer(`Answer ${++n}`)];
    for (const q of ['First', 'Second']) assert.equal((await send(id, q)).status, 200);
    app = buildApp(); // a fresh app: nothing held in memory
    const res = await request(app).get(`${BASE}/${id}`).set(auth('meera'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.messages.map((m: Row) => [m.sequence, m.role, m.text]), [[1, 'user', 'First'], [2, 'assistant', 'Answer 1'], [3, 'user', 'Second'], [4, 'assistant', 'Answer 2']]);
    assert.deepEqual(res.body.turns.map((t: Row) => [t.sequence, t.status, t.userMessageSequence, t.assistantMessageSequence]), [[1, 'COMPLETED', 1, 2], [2, 'COMPLETED', 3, 4]]);
    assert.equal(res.body.turns[1].previousTraceId, res.body.turns[0].traceId);
    assert.deepEqual([res.body.conversation.messageCount, res.body.conversation.title], [4, 'First']);
  });

  // Detects: guessing an ID exposing another user's prompts and salary results.
  test('another HR user gets the same 404 as an unknown conversation, and no content', async () => {
    const id = await create('meera');
    await send(id, 'Private question about Asha Rao');
    for (const target of [id, '00000000-0000-4000-8000-000000000000']) {
      const read = await request(app).get(`${BASE}/${target}`).set(auth('rohan'));
      assert.deepEqual([read.status, read.body], [404, { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } }]);
      assert.equal((await send(target, 'continue', newKey(), 'rohan')).status, 404);
    }
    assert.equal((await traceRows(id)).length, 1, 'the rejected continuation wrote nothing');
  });

  test('the list is owner-only and server-paginated (default 25, maximum 100)', async () => {
    for (let i = 0; i < 3; i += 1) await create('rohan');
    const page = await request(app).get(BASE).query({ pageSize: '2', page: '2' }).set(auth('rohan'));
    assert.equal(page.status, 200);
    const total = Number(must((await query('SELECT COUNT(*) AS n FROM ai_conversations c JOIN hr_users u ON u.id = c.hr_user_id WHERE u.email = ?', ['rohan@acme.com']))[0], 'n').n);
    assert.deepEqual(page.body.page, { number: 2, size: 2, totalRows: total, totalPages: Math.ceil(total / 2) });
    assert.equal((await request(app).get(BASE).set(auth('rohan'))).body.page.size, 25);
    assert.equal((await request(app).get(BASE).query({ pageSize: '101' }).set(auth('rohan'))).status, 400);
  });
});

describe('recorded turns in MySQL', () => {
  // Detects: unbounded or browser-supplied history, or a model input not reconstructable.
  test('bounded server history is sent, and the exact model input is stored on the trace and model call', async () => {
    const id = await create();
    let n = 0;
    steps = [() => answer(`A${++n}`)];
    for (let i = 1; i <= 6; i += 1) await send(id, `Q${i}`);
    const res = await send(id, 'Q7');
    const expected = [3, 4, 5, 6].flatMap((i) => [{ role: 'user', content: `Q${i}` }, { role: 'assistant', content: `A${i}` }]).concat([{ role: 'user', content: 'Q7' }]);
    assert.deepEqual(model.opened.at(-1)?.messages, expected);
    const [trace] = await query('SELECT model_messages, user_content, prompt_version, prompt_hash, model FROM ai_traces WHERE id = ?', [res.body.traceId]);
    assert.deepEqual(trace?.model_messages, expected);
    assert.deepEqual(trace?.user_content, { text: 'Q7', retryOfTraceId: null });
    assert.deepEqual([trace?.prompt_version, trace?.model], ['assistant-instructions-v2', 'fake-model']);
    const [call] = await query('SELECT input_messages, prompt_hash FROM ai_model_calls WHERE trace_id = ?', [res.body.traceId]);
    assert.deepEqual((call?.input_messages as { messages: unknown }).messages, expected);
    assert.equal(call?.prompt_hash, trace?.prompt_hash);
  });

  // Detects: lost token or provider-request metadata, or totals that disagree with children.
  test('model-call telemetry is stored and the trace totals agree with the child rows', async () => {
    steps = [
      () => withTelemetry(callTool('search_employees', { query: 'Asha' }), 'req_db_1', { inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: 5 }),
      () => withTelemetry(answer('Found Asha.'), 'req_db_2', { inputTokens: 150, outputTokens: 10, reasoningTokens: 0 }),
    ];
    const res = await send(await create(), 'Find Asha');
    assert.equal(res.status, 200, res.text);
    const calls = await query('SELECT sequence, status, provider, model, provider_request_id, input_tokens, output_tokens, total_tokens, reasoning_tokens, latency_ms FROM ai_model_calls WHERE trace_id = ? ORDER BY sequence', [res.body.traceId]);
    assert.deepEqual(calls.map((c) => [c.sequence, c.status, c.provider, c.model, c.provider_request_id, c.input_tokens, c.output_tokens, c.total_tokens, c.reasoning_tokens]), [
      [1, 'SUCCEEDED', 'fake', 'fake-model', 'req_db_1', 100, 20, 120, 5],
      [2, 'SUCCEEDED', 'fake', 'fake-model', 'req_db_2', 150, 10, 160, 0],
    ]);
    for (const c of calls) assert.ok(Number(c.latency_ms) >= 0);
    const [trace] = await query('SELECT status, input_tokens, output_tokens, reasoning_tokens, model_call_count, tool_call_count, final_message_id, duration_ms FROM ai_traces WHERE id = ?', [res.body.traceId]);
    assert.deepEqual([trace?.status, trace?.input_tokens, trace?.output_tokens, trace?.reasoning_tokens, trace?.model_call_count, trace?.tool_call_count], ['COMPLETED', 250, 30, 5, 2, 1]);
    assert.ok(trace?.final_message_id !== null && Number(trace?.duration_ms) >= 0);
  });

  // Detects: rejected or failed calls missing from the timeline, or executed.
  test('succeeded, rejected, and failed tool calls are stored in order with their outcomes', async () => {
    const failing: ToolRegistry = {
      definitions: tools.definitions,
      run: (name, args, context) => (name === 'get_compensation_summary' ? Promise.resolve({ status: 'failed', errorName: 'Error' }) : tools.run(name, args, context)),
    };
    app = buildApp(undefined, failing);
    steps = [
      () => ({ kind: 'tool_calls', calls: [
        { callId: 'call_ok', name: 'search_employees', arguments: '{"query":"Asha"}' },
        { callId: 'call_unknown', name: 'run_sql', arguments: '{"sql":"DELETE FROM employees","password":"hunter2"}' },
        { callId: 'call_bad', name: 'search_employees', arguments: '{"query":' },
      ] }),
      () => callTool('get_compensation_summary', { groupBy: 'COUNTRY', metric: 'ANNUAL_BASE' }),
      () => answer('Partly done.'),
    ];
    const res = await send(await create(), 'Do several things');
    assert.equal(res.status, 200, res.text);
    const rows = await query(`SELECT sequence, provider_tool_call_id, tool_name, requested_arguments, validation_status, validation_errors, status, result, error_category
      FROM ai_tool_calls WHERE trace_id = ? ORDER BY sequence`, [res.body.traceId]);
    assert.deepEqual(rows.map((r) => [r.sequence, r.provider_tool_call_id, r.tool_name, r.validation_status, r.status, r.error_category]), [
      [1, 'call_ok', 'search_employees', 'VALID', 'SUCCEEDED', null],
      [2, 'call_unknown', 'run_sql', 'REJECTED', 'REJECTED', null],
      [3, 'call_bad', 'search_employees', 'REJECTED', 'REJECTED', null],
      [4, rows[3]?.provider_tool_call_id, 'get_compensation_summary', 'VALID', 'FAILED', 'TOOL_FAILED'],
    ]);
    assert.deepEqual(rows[1]?.requested_arguments, { sql: 'DELETE FROM employees', password: '[REDACTED]' });
    assert.deepEqual(rows[1]?.validation_errors, { reason: 'UNKNOWN_TOOL' });
    // Task 03a: argument text that is not JSON is stored as the fixed marker, never verbatim.
    assert.deepEqual([rows[2]?.requested_arguments, rows[2]?.validation_errors], [{ ...INVALID_JSON_ARGUMENTS }, { reason: 'INVALID_ARGUMENTS', detail: 'INVALID_JSON' }]);
    assert.equal(rows[3]?.result, null);
    assert.equal((rows[0]?.result as { cards: { employees: { employeeCode: string }[] }[] }).cards[0]?.employees[0]?.employeeCode, 'ACME00601');
    assert.equal(Number(must((await query('SELECT COUNT(*) AS n FROM employees'))[0], 'n').n), 3);
    assert.ok(!JSON.stringify(await query('SELECT * FROM ai_model_calls WHERE trace_id = ?', [res.body.traceId])).includes('hunter2'));
  });

  // Detects: trace work bypassing the database-backed employee scope.
  test('scope stays enforced in tool SQL; the stored result has no out-of-scope employee', async () => {
    steps = [() => callTool('get_top_compensated_employees', { metric: 'ANNUAL_CASH', limit: 10 }), () => answer('Here.')];
    const res = await send(await create('rohan'), 'Top earners?', newKey(), 'rohan');
    assert.equal(res.status, 200, res.text);
    const [row] = await query('SELECT result FROM ai_tool_calls WHERE trace_id = ?', [res.body.traceId]);
    const text = JSON.stringify(row?.result);
    assert.ok(text.includes('ACME00601') && text.includes('ACME00602'));
    for (const hidden of ['ACME00603', 'Grace', 'Miller', '150000.00']) assert.ok(!text.includes(hidden), hidden);
    assert.ok(!JSON.stringify(res.body).includes('ACME00603'));
  });

  // Detects (Task 03a, Option C): a saved answer outliving a narrowed scope, or a trace without its scope record.
  test('a saved answer is withheld once the current scope stops covering the trace-time scope; storage is unchanged', async () => {
    steps = [() => callTool('get_top_compensated_employees', { metric: 'ANNUAL_CASH', limit: 10 }), () => answer('Vikram Iyer (ACME00602) is listed.')];
    const id = await create('rohan');
    const res = await send(id, 'Top earners?', newKey(), 'rohan');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.withheld, false);
    const [trace] = await query('SELECT actor_role, actor_countries, actor_departments FROM ai_traces WHERE id = ?', [res.body.traceId]);
    assert.deepEqual([trace?.actor_role, trace?.actor_countries, trace?.actor_departments], ['SCOPED', ['IN'], ['Support', 'Tech']]);
    const read = async () => {
      const detail = await request(app).get(`${BASE}/${id}`).set(auth('rohan'));
      assert.equal(detail.status, 200, detail.text);
      return detail.body as { messages: { role: string; text: string; response: unknown; withheld: boolean }[] };
    };
    assert.equal((await read()).messages[1]?.text, 'Vikram Iyer (ACME00602) is listed.');

    const [rohan] = await query('SELECT id FROM hr_users WHERE email = ?', ['rohan@acme.com']);
    const [support] = await query('SELECT id FROM departments WHERE name = ?', ['Support']);
    await pool.query('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ? AND department_id = ?', [must(rohan, 'rohan').id, must(support, 'Support').id]);
    try {
      const narrowed = await read();
      assert.deepEqual(narrowed.messages.map((m) => [m.role, m.text, m.response === null, m.withheld]), [
        ['user', 'Top earners?', true, false],
        ['assistant', WITHHELD_ANSWER, true, true],
      ]);
      assert.ok(!JSON.stringify(narrowed).includes('ACME00602'));
      const [stored] = await query("SELECT content FROM ai_messages WHERE conversation_id = ? AND role = 'ASSISTANT'", [id]);
      assert.ok(JSON.stringify(stored?.content).includes('ACME00602'), 'the saved message itself is unchanged');
      // The withheld turn is not sent to the model again.
      steps = [() => answer('ok')];
      const next = await send(id, 'And now?', newKey(), 'rohan');
      assert.equal(next.status, 200, next.text);
      const [nextTrace] = await query('SELECT model_messages FROM ai_traces WHERE id = ?', [next.body.traceId]);
      assert.deepEqual(nextTrace?.model_messages, [{ role: 'user', content: 'And now?' }]);
    } finally {
      await pool.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES (?, ?)', [must(rohan, 'rohan').id, must(support, 'Support').id]);
    }
    // A trace from before migration 007 (no snapshot) fails closed for Scoped HR.
    await pool.query('UPDATE ai_traces SET actor_role = NULL, actor_countries = NULL, actor_departments = NULL WHERE id = ?', [res.body.traceId]);
    assert.equal((await read()).messages[1]?.text, WITHHELD_ANSWER);
  });

  // Detects (Task 03a): a submission with no model configured leaving no record, or calling a provider.
  test('with no model configured, the message and a FAILED turn are stored; replay and conflict still apply', async () => {
    const unconfigured = buildApp(createObservabilityRepository(pool), tools, null);
    const id = await create();
    const k = newKey();
    const first = await send(id, 'Anyone there?', k, 'meera', {}, unconfigured);
    assert.deepEqual([first.status, first.body.error?.reason], [503, 'MODEL_NOT_CONFIGURED']);
    const traces = await traceRows(id);
    assert.deepEqual(traces.map((t) => [t.status, t.failure_stage, t.error_category, t.model, t.final_response, t.model_call_count]),
      [['FAILED', 'MODEL_CALL', 'not_configured', 'not-configured', null, 0]]);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM ai_model_calls WHERE trace_id = ?', [traces[0]?.id]))[0]?.n), 0);
    assert.deepEqual((await query('SELECT role FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [id])).map((m) => m.role), ['USER']);
    const replay = await send(id, 'Anyone there?', k, 'meera', {}, unconfigured);
    assert.deepEqual([replay.status, replay.body.error?.reason, replay.headers['idempotency-replayed']], [503, 'MODEL_NOT_CONFIGURED', 'true']);
    const conflict = await send(id, 'Something else', k, 'meera', {}, unconfigured);
    assert.deepEqual([conflict.status, conflict.body.error?.code], [409, 'DUPLICATE_OPERATION']);
    assert.equal((await traceRows(id)).length, 1);
    const detail = await request(unconfigured).get(`${BASE}/${id}`).set(auth('meera'));
    assert.deepEqual(detail.body.turns.map((t: { status: string; error: { reason: string } | null }) => [t.status, t.error?.reason]), [['FAILED', 'MODEL_NOT_CONFIGURED']]);
    const legacy = await request(unconfigured).post('/api/v1/assistant/messages').set(auth('meera')).send({ messages: [{ role: 'user', content: 'legacy' }] });
    assert.deepEqual([legacy.status, legacy.body, legacy.headers.deprecation], [503, { error: { code: 'ASSISTANT_UNAVAILABLE', message: 'The assistant is unavailable. Other features are not affected.' } }, 'true']);
    const [legacyTrace] = await query("SELECT t.status, t.error_category FROM ai_traces t JOIN ai_messages m ON m.trace_id = t.id WHERE JSON_EXTRACT(m.content, '$.text') = 'legacy'");
    assert.deepEqual([legacyTrace?.status, legacyTrace?.error_category], ['FAILED', 'not_configured']);
  });

  // Detects (Task 03a): malformed argument text stored where key scrubbing cannot reach it.
  test('malformed tool arguments are stored as the invalid-JSON marker; their text is in no table', async () => {
    const secrets = ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', 'session=db-cookie-value', 'db-hunter2', 'mysql://acme:leak@db.internal/acme', 'reasoning-trace-xyz'];
    steps = [() => rawCall('search_employees', `{authorization: ${secrets[0]}, cookie: ${secrets[1]}, password: ${secrets[2]}, url: ${secrets[3]}, <thinking>${secrets[4]}</thinking>`), () => answer('Could not search.')];
    const res = await send(await create(), 'Find');
    assert.equal(res.status, 200, res.text);
    const [call] = await query('SELECT requested_arguments, status, validation_status, validation_errors, result FROM ai_tool_calls WHERE trace_id = ?', [res.body.traceId]);
    assert.deepEqual([call?.requested_arguments, call?.status, call?.validation_status, call?.validation_errors, call?.result],
      [{ ...INVALID_JSON_ARGUMENTS }, 'REJECTED', 'REJECTED', { reason: 'INVALID_ARGUMENTS', detail: 'INVALID_JSON' }, null]);
    const everything = JSON.stringify([
      await query('SELECT * FROM ai_traces WHERE id = ?', [res.body.traceId]),
      await query('SELECT * FROM ai_model_calls WHERE trace_id = ?', [res.body.traceId]),
      await query('SELECT * FROM ai_tool_calls WHERE trace_id = ?', [res.body.traceId]),
      await query('SELECT * FROM ai_messages WHERE trace_id = ?', [res.body.traceId]),
      res.body, logs,
    ]);
    for (const secret of secrets) assert.ok(!everything.includes(secret), secret);
  });

  // Detects (Task 05, eval-01 D1): a Scoped ranking or total stored or answered without its coverage statement.
  test('Scoped HR ranking and summary results carry the scope limitation in the stored result and the turn response', async () => {
    const LIMITATION = 'Covers only employees in your access: India; Support, Tech.';
    steps = [() => ({ kind: 'tool_calls', calls: [
      { callId: 'c_top', name: 'get_top_compensated_employees', arguments: '{"metric":"ANNUAL_BASE","limit":5}' },
      { callId: 'c_sum', name: 'get_compensation_summary', arguments: '{"groupBy":"CURRENCY","metric":"ANNUAL_BASE"}' },
    ] }), () => answer('Here.')];
    const res = await send(await create('rohan'), 'Top five company-wide, and the total?', newKey(), 'rohan');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.limitations[0], LIMITATION);
    const stored = await query('SELECT tool_name, result FROM ai_tool_calls WHERE trace_id = ? ORDER BY sequence', [res.body.traceId]);
    assert.deepEqual(stored.map((r) => [r.tool_name, (r.result as { limitations: string[] }).limitations[0]]),
      [['get_top_compensated_employees', LIMITATION], ['get_compensation_summary', LIMITATION]]);
    const [trace] = await query('SELECT prompt_version FROM ai_traces WHERE id = ?', [res.body.traceId]);
    assert.equal(trace?.prompt_version, 'assistant-instructions-v2');

    steps = [() => callTool('get_compensation_summary', { groupBy: 'CURRENCY', metric: 'ANNUAL_BASE' }), () => answer('Here.')];
    const admin = await send(await create(), 'Total by currency?');
    assert.equal(admin.status, 200, admin.text);
    assert.ok(!(admin.body.limitations as string[]).some((l) => l.startsWith('Covers only')), 'Admin HR gets no scope limitation');
  });

  // Detects: a timeout or provider error recorded as success or with a fabricated answer.
  test('provider failure and timeout leave a FAILED trace with no assistant message', async () => {
    for (const [step, reason, category] of [
      [() => { throw new ModelFailure('provider_error', { providerRequestId: 'req_err_db' }); }, 'MODEL_ERROR', 'provider_error'],
      [() => { throw new ModelFailure('timeout'); }, 'MODEL_TIMEOUT', 'timeout'],
    ] as const) {
      steps = [step];
      const id = await create();
      const res = await send(id, 'hi');
      assert.deepEqual([res.status, res.body.error.code, res.body.error.reason], [502, 'MODEL_PROVIDER_FAILED', reason]);
      const [trace] = await traceRows(id);
      assert.deepEqual([trace?.status, trace?.failure_stage, trace?.error_category, trace?.final_response, trace?.final_message_id], ['FAILED', 'MODEL_CALL', category, null, null]);
      const [call] = await query('SELECT status, failure_category, safe_error FROM ai_model_calls WHERE trace_id = ?', [trace?.id]);
      assert.deepEqual([call?.status, call?.failure_category, call?.safe_error], ['FAILED', category, { category }]);
      assert.deepEqual((await query('SELECT role FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [id])).map((m) => m.role), ['USER']);
    }
  });
});

describe('idempotency, retry, and concurrency in MySQL', () => {
  test('same key and command replays the stored result; other content is 409 and writes nothing', async () => {
    const id = await create();
    const key = newKey();
    const first = await send(id, 'Once', key);
    const again = await send(id, 'Once', key);
    assert.deepEqual([again.status, again.headers['idempotency-replayed']], [200, 'true']);
    assert.deepEqual(again.body, first.body);
    const conflict = await send(id, 'Twice', key);
    assert.deepEqual([conflict.status, conflict.body.error.code], [409, 'DUPLICATE_OPERATION']);
    assert.equal((await traceRows(id)).length, 1);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [id]))[0]?.n), 2);
  });

  test('concurrent submissions with one key create one trace', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    steps = [async () => { await gate; return answer('Done.'); }];
    const id = await create();
    const key = newKey();
    const pending = [send(id, 'Same', key), send(id, 'Same', key)];
    await new Promise((r) => setTimeout(r, 50));
    release();
    const results = await Promise.all(pending);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(' | '));
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'ASSISTANT_TURN_IN_PROGRESS');
    assert.equal((await traceRows(id)).length, 1);
    const replay = await send(id, 'Same', key);
    assert.equal(replay.body.answer, 'Done.');
  });

  // Detects: Retry overwriting a failed trace instead of creating a linked one.
  test('a user-selected Retry with a new key creates a new trace linked to the failed one', async () => {
    steps = [() => { throw new ModelFailure('provider_error'); }];
    const id = await create();
    assert.equal((await send(id, 'Retry me')).status, 502);
    const [failed] = await traceRows(id);
    steps = [() => answer('Worked.')];
    const retried = await send(id, 'Retry me', newKey(), 'meera', { retryOfTraceId: failed?.id });
    assert.equal(retried.status, 200, retried.text);
    const traces = await traceRows(id);
    assert.deepEqual(traces.map((t) => [t.sequence, t.status, t.previous_trace_id]), [[1, 'FAILED', null], [2, 'COMPLETED', failed?.id]]);
    assert.deepEqual(traces[1]?.user_content, { text: 'Retry me', retryOfTraceId: failed?.id });
    const detail = await request(app).get(`${BASE}/${id}`).set(auth('meera'));
    assert.deepEqual(detail.body.turns.map((t: Row) => [t.status, t.retryOfTraceId, (t.error as Row | null)?.code ?? null]), [['FAILED', null, 'MODEL_PROVIDER_FAILED'], ['COMPLETED', failed?.id, null]]);
  });

  // Detects: duplicate or interleaved sequence numbers under concurrent messages.
  test('concurrent messages to one conversation get unique, ordered sequences', async () => {
    let n = 0;
    steps = [async () => { await new Promise((r) => setTimeout(r, 5 + (n % 3) * 5)); return answer(`A${++n}`); }];
    const id = await create();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => send(id, `Parallel ${i}`)));
    assert.deepEqual(results.map((r) => r.status), Array(6).fill(200), JSON.stringify(logs.filter((l) => l.event !== 'request')));
    const traces = await traceRows(id);
    assert.deepEqual(traces.map((t) => t.sequence), [1, 2, 3, 4, 5, 6]);
    const messages = await query('SELECT sequence, role, trace_id FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [id]);
    assert.deepEqual(messages.map((m) => m.sequence), Array.from({ length: 12 }, (_, i) => i + 1));
    for (const t of traces) {
      const own = messages.filter((m) => m.trace_id === t.id);
      assert.deepEqual(own.map((m) => m.role), ['USER', 'ASSISTANT']);
      assert.ok(Number(own[0]?.sequence) < Number(own[1]?.sequence));
    }
  });
});

describe('fail-closed recording in MySQL', () => {
  /** The real repository with one operation made to fail like an unavailable database. */
  function failingStore(operation: keyof AssistantStore, when: (input: unknown) => boolean = () => true): AssistantStore {
    const real = createObservabilityRepository(pool);
    return new Proxy(real, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (prop !== operation || typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (when(args.at(-1))) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), { code: 'ECONNREFUSED' }));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }

  // Detects: an answer returned whose outcome could not be saved, or a trace stuck open.
  test('a failed model-outcome write fails the trace, closes the open attempt, and returns no answer', async () => {
    steps = [() => answer('secret-unrecorded-answer')];
    app = buildApp(failingStore('finishModelCall', (input) => (input as { status?: string }).status === 'SUCCEEDED'));
    const id = await create();
    const res = await send(id, 'hi');
    assert.deepEqual([res.status, res.body.error.code, res.body.error.reason], [503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE']);
    assert.ok(!res.text.includes('secret-unrecorded-answer') && !res.text.includes('ECONNREFUSED'));
    const [trace] = await traceRows(id);
    assert.deepEqual([trace?.status, trace?.failure_stage, trace?.final_response, trace?.model_call_count], ['FAILED', 'MODEL_TRACE_WRITE', null, 1]);
    const [call] = await query('SELECT status, failure_category, output_content FROM ai_model_calls WHERE trace_id = ?', [trace?.id]);
    assert.deepEqual([call?.status, call?.failure_category, call?.output_content], ['FAILED', 'OUTCOME_NOT_RECORDED', null]);
    assert.ok(!JSON.stringify(await query('SELECT * FROM ai_messages WHERE conversation_id = ?', [id])).includes('secret-unrecorded-answer'));
    const failureLog = logs.find((l) => l.event === 'assistant_trace_failure');
    assert.deepEqual(failureLog, { event: 'assistant_trace_failure', requestId: failureLog?.requestId, traceId: trace?.id, stage: 'MODEL_TRACE_WRITE', category: 'persistence_unavailable' });
  });

  test('a failed trace creation makes no model call and writes no trace', async () => {
    app = buildApp(failingStore('createTrace'));
    const before = model.opened.length;
    const id = await create();
    const res = await send(id, 'hi');
    assert.deepEqual([res.status, res.body.error.reason], [503, 'TRACE_UNAVAILABLE']);
    assert.equal(model.opened.length, before);
    assert.deepEqual(await traceRows(id), []);
  });

  // Detects: AI observability becoming a shared application dependency.
  test('with AI storage unavailable, sign-in, directory, and dashboard still work', async () => {
    const broken: AssistantStore = new Proxy(createObservabilityRepository(pool), {
      get: () => () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    });
    app = buildApp(broken);
    assert.equal((await request(app).get(BASE).set(auth('meera'))).status, 503);
    assert.equal((await request(app).post(BASE).set(auth('meera')).send({})).status, 503);
    assert.equal((await request(app).post('/api/v1/auth/login').send({ email: 'rohan@acme.com', password: PASSWORD })).status, 200);
    for (const path of ['/api/v1/auth/me', '/api/v1/employees', '/api/v1/employees/ACME00601', '/api/v1/employee-directory/options', '/api/v1/dashboard/summary']) {
      assert.equal((await request(app).get(path).set(auth('meera'))).status, 200, path);
    }
  });
});
