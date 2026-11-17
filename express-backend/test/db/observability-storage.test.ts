import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';

import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createObservabilityRepository, ConflictError } from '../../src/assistant/observability/repository.js';
import { PersistenceValidationError } from '../../src/assistant/observability/validation.js';
import { runRetention } from '../../src/assistant/observability/retention.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { selectRows } from '../support/db.js';

const DATABASE_URL = testDatabaseUrl();
const OLD = '2026-09-01 00:00:00.000';
const NEW = '2026-11-01 00:00:00.000';
const CUTOFF = '2026-10-01 00:00:00.000';
let pool: Pool;
let repo: ReturnType<typeof createObservabilityRepository>;
let actorId: number;

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 8 });
  const [user] = await pool.execute('INSERT INTO hr_users (email, display_name, password_hash, role, status) VALUES (?, ?, ?, ?, ?)', ['synthetic.observer@acme.test', 'Synthetic Observer', '$argon2id$test', 'ADMIN', 'ACTIVE']);
  actorId = (user as { insertId: number }).insertId;
  repo = createObservabilityRepository(pool);
});
after(async () => { await pool?.end(); });

test('migration creates all seven tables with foreign keys, unique sequences and search indexes', async () => {
  const tables = (await selectRows(pool, "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'ai_%' OR table_schema = DATABASE() AND table_name = 'mcp_tool_calls'")).map((r) => r.name).sort();
  assert.deepEqual(tables, ['ai_conversations', 'ai_messages', 'ai_model_calls', 'ai_tool_calls', 'ai_trace_reviews', 'ai_traces', 'mcp_tool_calls']);
  const tableList = "'ai_conversations','ai_messages','ai_traces','ai_model_calls','ai_tool_calls','mcp_tool_calls','ai_trace_reviews'";
  const fks = await selectRows(pool, `SELECT k.table_name AS t, k.constraint_name AS n, GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position) AS cols, k.referenced_table_name AS ref, GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position) AS ref_cols, r.delete_rule AS del FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name WHERE k.constraint_schema = DATABASE() AND k.table_name IN (${tableList}) GROUP BY k.table_name, k.constraint_name, k.referenced_table_name, r.delete_rule ORDER BY k.table_name, k.constraint_name`);
  assert.deepEqual(fks.map((r) => `${r.t}.${r.n}(${r.cols})->${r.ref}(${r.ref_cols}) ${r.del}`), [
    'ai_conversations.fk_ai_conversations_user(hr_user_id)->hr_users(id) RESTRICT',
    'ai_messages.fk_ai_messages_conversation(conversation_id)->ai_conversations(id) RESTRICT',
    'ai_messages.fk_ai_messages_trace(trace_id)->ai_traces(id) CASCADE',
    'ai_model_calls.fk_ai_model_calls_trace(trace_id)->ai_traces(id) CASCADE',
    'ai_tool_calls.fk_ai_tool_calls_model(model_call_id)->ai_model_calls(id) CASCADE',
    'ai_tool_calls.fk_ai_tool_calls_trace(trace_id)->ai_traces(id) CASCADE',
    'ai_trace_reviews.fk_ai_reviews_trace(trace_id)->ai_traces(id) CASCADE',
    'ai_trace_reviews.fk_ai_reviews_user(reviewer_hr_user_id)->hr_users(id) RESTRICT',
    'ai_traces.fk_ai_traces_conversation(conversation_id)->ai_conversations(id) RESTRICT',
    'ai_traces.fk_ai_traces_previous(previous_trace_id)->ai_traces(id) SET NULL',
    'ai_traces.fk_ai_traces_user(hr_user_id)->hr_users(id) RESTRICT',
    'mcp_tool_calls.fk_mcp_tool_user(hr_user_id)->hr_users(id) RESTRICT',
  ]);
  const indexes = await selectRows(pool, `SELECT table_name AS t, index_name AS n, non_unique AS nu, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN (${tableList}) GROUP BY table_name, index_name, non_unique ORDER BY table_name, index_name`);
  assert.deepEqual(indexes.map((r) => `${r.t}.${r.n}${Number(r.nu) === 0 ? ' UNIQUE' : ''} (${r.cols})`), [
    'ai_conversations.idx_ai_conversations_owner (hr_user_id,created_at)',
    'ai_conversations.PRIMARY UNIQUE (id)',
    'ai_messages.idx_ai_messages_created (created_at)',
    'ai_messages.idx_ai_messages_trace (trace_id)',
    'ai_messages.PRIMARY UNIQUE (id)',
    'ai_messages.uk_ai_messages_conversation_sequence UNIQUE (conversation_id,sequence)',
    'ai_model_calls.idx_ai_model_calls_started (started_at)',
    'ai_model_calls.PRIMARY UNIQUE (id)',
    'ai_model_calls.uk_ai_model_calls_trace_sequence UNIQUE (trace_id,sequence)',
    'ai_tool_calls.idx_ai_tool_model (model_call_id)',
    'ai_tool_calls.idx_ai_tool_name (tool_name,started_at)',
    'ai_tool_calls.idx_ai_tool_started (started_at)',
    'ai_tool_calls.PRIMARY UNIQUE (id)',
    'ai_tool_calls.uk_ai_tool_calls_trace_sequence UNIQUE (trace_id,sequence)',
    'ai_trace_reviews.idx_ai_reviews_reviewer (reviewer_hr_user_id,updated_at)',
    'ai_trace_reviews.PRIMARY UNIQUE (trace_id)',
    'ai_traces.idx_ai_traces_actor (hr_user_id,started_at)',
    'ai_traces.idx_ai_traces_error (error_category,started_at)',
    'ai_traces.idx_ai_traces_model (model,started_at)',
    'ai_traces.idx_ai_traces_previous (previous_trace_id)',
    'ai_traces.idx_ai_traces_started (started_at,id)',
    'ai_traces.idx_ai_traces_status (status,started_at)',
    'ai_traces.idx_ai_traces_summary (started_at,status,duration_ms,failure_stage,error_category,input_tokens,output_tokens,reasoning_tokens)',
    'ai_traces.PRIMARY UNIQUE (id)',
    'ai_traces.uk_ai_traces_conversation_sequence UNIQUE (conversation_id,sequence)',
    'ai_traces.uk_ai_traces_idempotency UNIQUE (conversation_id,idempotency_key)',
    'mcp_tool_calls.idx_mcp_actor (hr_user_id,started_at)',
    'mcp_tool_calls.idx_mcp_started (started_at,id)',
    'mcp_tool_calls.idx_mcp_tool (tool_name,started_at)',
    'mcp_tool_calls.PRIMARY UNIQUE (id)',
  ]);
  const checks = await selectRows(pool, `SELECT table_name AS t, constraint_name AS n FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK' AND table_name IN (${tableList}) ORDER BY table_name, constraint_name`);
  assert.deepEqual(checks.map((r) => `${r.t}.${r.n}`), [
    'ai_model_calls.chk_ai_model_calls_latency',
    'ai_tool_calls.chk_ai_tool_calls_duration',
    'ai_trace_reviews.chk_ai_reviews_version',
    'ai_traces.chk_ai_traces_actor_scope',
    'ai_traces.chk_ai_traces_duration',
    'ai_traces.chk_ai_traces_status_time',
    'mcp_tool_calls.chk_mcp_tool_duration',
  ]);
});

test('observability checks and unsigned token columns reject invalid persisted states', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'checks', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  const model = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(model.id, { status: 'SUCCEEDED', latencyMs: 1, completedAt: NEW });
  const tool = await repo.startToolCall({ traceId: trace.id, modelCallId: model.id, toolName: 'lookup', arguments: {}, startedAt: NEW });
  const mcp = await repo.startMcpCall({ actorId, requestId: 'm-checks', toolName: 'lookup', arguments: {}, startedAt: NEW });
  await repo.upsertReview({ traceId: trace.id, reviewerId: actorId, verdict: 'CORRECT', note: '', nominated: false, expectedVersion: 0, now: NEW });
  for (const [sql, value] of [
    ['UPDATE ai_traces SET status = ? WHERE id = ?', 'COMPLETED'],
    ['UPDATE ai_traces SET duration_ms = ? WHERE id = ?', -1],
    ['UPDATE ai_traces SET input_tokens = ? WHERE id = ?', -1],
    ['UPDATE ai_model_calls SET latency_ms = ? WHERE id = ?', -1],
    ['UPDATE ai_model_calls SET output_tokens = ? WHERE id = ?', -1],
    ['UPDATE ai_tool_calls SET duration_ms = ? WHERE id = ?', -1],
    ['UPDATE mcp_tool_calls SET duration_ms = ? WHERE id = ?', -1],
    ['UPDATE ai_trace_reviews SET version = ? WHERE trace_id = ?', 0],
  ] as const) {
    const target = sql.includes('ai_model_calls') ? model.id : sql.includes('ai_tool_calls') ? tool.id : sql.includes('mcp_tool_calls') ? mcp.id : trace.id;
    await assert.rejects(pool.execute(sql, [value, target]), sql);
  }
});

test('concurrent traces receive distinct conversation sequence numbers', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const created = await Promise.all(Array.from({ length: 8 }, (_, n) => repo.createTrace({ conversationId: conversation.id, actorId, requestId: `concurrent-${n}`, promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: `turn ${n}` }, modelMessages: [], startedAt: NEW })));
  assert.deepEqual(created.map((t) => t.sequence).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('owned conversations keep ordered messages and allocate concurrent sequences safely', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  await Promise.all(Array.from({ length: 12 }, (_, n) => repo.appendMessage({ conversationId: conversation.id, actorId, role: 'USER', content: { text: `message ${n}` }, createdAt: NEW })));
  const read = await repo.readOwnedConversation(conversation.id, actorId);
  assert.equal(read?.messages.length, 12);
  assert.deepEqual(read?.messages.map((m) => m.sequence), Array.from({ length: 12 }, (_, n) => n + 1));
  assert.equal(await repo.readOwnedConversation(conversation.id, actorId + 1), null);
  assert.ok((await repo.listConversations(actorId, 10, 0)).some((item) => item.id === conversation.id));
});

test('trace retains multiple model/tool calls, scrubbed rejected arguments, salary evidence and exact totals', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'r-1', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'salary' }, modelMessages: [{ role: 'user', content: 'salary' }], startedAt: NEW });
  const first = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [{ role: 'user', content: 'salary' }], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(first.id, { status: 'SUCCEEDED', output: { text: 'checking' }, decisions: [{ tool: 'lookup' }], inputTokens: 7, outputTokens: 3, reasoningTokens: 1, latencyMs: 5, completedAt: NEW });
  const tool = await repo.startToolCall({ traceId: trace.id, modelCallId: first.id, toolName: 'lookup', arguments: { employeeCode: 'ACME00001', authorization: 'secret', nested: [{ apiKey: 'secret' }] }, startedAt: NEW });
  await repo.finishToolCall(tool.id, { status: 'REJECTED', validation: { errors: ['bad argument'] }, durationMs: 2, completedAt: NEW });
  const successfulTool = await repo.startToolCall({ traceId: trace.id, modelCallId: first.id, toolName: 'get_employee_compensation', arguments: { employeeCode: 'ACME00001' }, startedAt: NEW });
  await repo.finishToolCall(successfulTool.id, { status: 'SUCCEEDED', result: { employeeCode: 'ACME00001', employeeName: 'Synthetic Person', salary: '100.00' }, durationMs: 2, completedAt: NEW });
  const second = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(second.id, { status: 'SUCCEEDED', output: { text: 'answer' }, decisions: [], inputTokens: 4, outputTokens: 2, reasoningTokens: 0, latencyMs: 6, completedAt: NEW });
  await repo.finishTrace(trace.id, { status: 'COMPLETED', finalResponse: { text: 'answer' }, durationMs: 13, completedAt: NEW });
  const detail = await repo.readTrace(trace.id);
  assert.equal(detail?.trace.inputTokens, 11);
  assert.equal(detail?.trace.outputTokens, 5);
  assert.equal(detail?.trace.modelCallCount, 2);
  assert.equal(detail?.trace.toolCallCount, 2);
  assert.deepEqual(detail?.modelCalls.map((m) => m.sequence), [1, 2]);
  assert.equal(detail?.modelCalls[0]?.latencyMs, 5);
  assert.equal(detail?.modelCalls[0]?.inputTokens, 7);
  assert.equal(detail?.modelCalls[0]?.reasoningTokens, 1);
  assert.equal(detail?.toolCalls[0]?.durationMs, 2);
  assert.deepEqual(detail?.toolCalls[0]?.validation, { errors: ['bad argument'] });
  assert.deepEqual(detail?.toolCalls[0]?.arguments, { employeeCode: 'ACME00001', authorization: '[REDACTED]', nested: [{ apiKey: '[REDACTED]' }] });
  assert.equal(detail?.toolCalls[0]?.result, null);
  assert.deepEqual(detail?.toolCalls[1]?.result, { employeeCode: 'ACME00001', employeeName: 'Synthetic Person', salary: '100.00' });
  assert.deepEqual((await repo.listTraces({ toolName: 'lookup', model: 'fake', status: 'COMPLETED' })).map((t) => t.id), [trace.id]);
  await assert.rejects(repo.finishTrace(trace.id, { status: 'FAILED', durationMs: 15, completedAt: NEW }), ConflictError);
});

test('Admin trace list returns complete typed summaries with distinct ordered tools and no raw content', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'summary', promptVersion: 'v1', promptHash: 'hash', model: 'summary-model', userContent: { text: 'private prompt' }, modelMessages: [], startedAt: NEW });
  const model = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'summary-model', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(model.id, { status: 'SUCCEEDED', output: { text: 'private output' }, inputTokens: 8, outputTokens: 3, reasoningTokens: 2, latencyMs: 4, completedAt: NEW });
  for (const name of ['summary_lookup', 'summary_calc', 'summary_lookup']) {
    const call = await repo.startToolCall({ traceId: trace.id, modelCallId: model.id, toolName: name, arguments: { privateArgument: 'x' }, startedAt: NEW });
    await repo.finishToolCall(call.id, { status: 'SUCCEEDED', result: { privateResult: 'y' }, durationMs: 1, completedAt: NEW });
  }
  await repo.finishTrace(trace.id, { status: 'FAILED', durationMs: 12, completedAt: NEW, failureStage: 'MODEL_CALL', errorCategory: 'timeout' });
  const found = await repo.listTraces({ model: 'summary-model', toolName: 'summary_lookup' });
  assert.deepEqual(found, [{ id: trace.id, startedAt: NEW, actorId, status: 'FAILED', model: 'summary-model', toolNames: ['summary_lookup', 'summary_calc'], durationMs: 12, inputTokens: 8, outputTokens: 3, reasoningTokens: 2, modelCallCount: 1, toolCallCount: 3, errorCategory: 'timeout', failureStage: 'MODEL_CALL' }]);
  assert.equal(JSON.stringify(found).includes('private'), false);
});

test('rejected assistant and MCP calls cannot retain an execution result', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'reject-result', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  const model = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(model.id, { status: 'SUCCEEDED', latencyMs: 1, completedAt: NEW });
  const tool = await repo.startToolCall({ traceId: trace.id, modelCallId: model.id, toolName: 'lookup', arguments: { token: 'secret' }, startedAt: NEW });
  await assert.rejects(repo.finishToolCall(tool.id, { status: 'REJECTED', validation: { errors: ['invalid'] }, result: { salary: '100.00' }, durationMs: 1, completedAt: NEW }), PersistenceValidationError);
  assert.equal((await repo.readTrace(trace.id))?.toolCalls[0]?.status, 'STARTED');
  await repo.finishToolCall(tool.id, { status: 'REJECTED', validation: { errors: ['invalid'] }, durationMs: 1, completedAt: NEW });
  assert.equal((await repo.readTrace(trace.id))?.toolCalls[0]?.result, null);

  const mcp = await repo.startMcpCall({ actorId, requestId: 'm-reject-result', toolName: 'lookup', arguments: { token: 'secret' }, startedAt: NEW });
  await assert.rejects(repo.finishMcpCall(mcp.id, { status: 'REJECTED', validation: { errors: ['invalid'] }, result: { salary: '100.00' }, durationMs: 1, completedAt: NEW }), PersistenceValidationError);
  assert.equal((await repo.readMcpCall(mcp.id))?.status, 'STARTED');
  await repo.finishMcpCall(mcp.id, { status: 'REJECTED', validation: { errors: ['invalid'] }, durationMs: 1, completedAt: NEW });
  assert.equal((await repo.readMcpCall(mcp.id))?.result, null);
});

test('assistant and MCP execution failures retain safe errors; successful MCP keeps synthetic results', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'tool-failure', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  const model = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(model.id, { status: 'SUCCEEDED', latencyMs: 1, completedAt: NEW });
  const tool = await repo.startToolCall({ traceId: trace.id, modelCallId: model.id, toolName: 'lookup', arguments: {}, startedAt: NEW });
  await repo.finishToolCall(tool.id, { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { message: 'safe', token: 'secret' }, durationMs: 1, completedAt: NEW });
  const toolRows = await selectRows(pool, 'SELECT status, validation_status, result, error_category, safe_error FROM ai_tool_calls WHERE id = ?', [tool.id]);
  assert.deepEqual([toolRows[0]?.status, toolRows[0]?.validation_status, toolRows[0]?.result, toolRows[0]?.error_category, toolRows[0]?.safe_error], ['FAILED', 'VALID', null, 'TOOL_FAILED', { message: 'safe', token: '[REDACTED]' }]);

  const failedMcp = await repo.startMcpCall({ actorId, requestId: 'm-failure', toolName: 'lookup', arguments: {}, startedAt: NEW });
  await repo.finishMcpCall(failedMcp.id, { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { message: 'safe', token: 'secret' }, durationMs: 1, completedAt: NEW });
  const mcpRows = await selectRows(pool, 'SELECT status, validation_status, result, error_category, safe_error FROM mcp_tool_calls WHERE id = ?', [failedMcp.id]);
  assert.deepEqual([mcpRows[0]?.status, mcpRows[0]?.validation_status, mcpRows[0]?.result, mcpRows[0]?.error_category, mcpRows[0]?.safe_error], ['FAILED', 'VALID', null, 'TOOL_FAILED', { message: 'safe', token: '[REDACTED]' }]);

  const successfulMcp = await repo.startMcpCall({ actorId, requestId: 'm-success', toolName: 'lookup', arguments: {}, startedAt: NEW });
  await repo.finishMcpCall(successfulMcp.id, { status: 'SUCCEEDED', result: { employeeCode: 'ACME00001', employeeName: 'Synthetic Person', salary: '100.00' }, durationMs: 1, completedAt: NEW });
  assert.deepEqual((await repo.readMcpCall(successfulMcp.id))?.result, { employeeCode: 'ACME00001', employeeName: 'Synthetic Person', salary: '100.00' });
});

test('idempotency key and command hash must be a valid pair before trace creation', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const base = { conversationId: conversation.id, actorId, requestId: 'pair', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'same' }, modelMessages: [], startedAt: NEW };
  for (const invalid of [
    { idempotencyKey: 'key' },
    { commandHash: 'a'.repeat(64) },
    { idempotencyKey: '', commandHash: 'a'.repeat(64) },
    { idempotencyKey: 'key', commandHash: '' },
    { idempotencyKey: 'key', commandHash: 'A'.repeat(64) },
    { idempotencyKey: 'key', commandHash: 'a'.repeat(63) },
  ]) await assert.rejects(repo.createTrace({ ...base, ...invalid }), PersistenceValidationError);
  const records = await selectRows(pool, 'SELECT COUNT(*) AS n FROM ai_traces WHERE conversation_id = ?', [conversation.id]);
  assert.equal(Number(records[0]?.n), 0);
});

// Detects (Task 03a): a malformed or Admin-with-rows scope snapshot, or a half-filled snapshot row.
test('the trace-time actor scope is validated, stored sorted, and all-or-nothing', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const base = { conversationId: conversation.id, actorId, requestId: 'scope', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW };
  for (const actorScope of [
    { role: 'OWNER', countries: [], departments: [] },
    { role: 'SCOPED', countries: 'IN', departments: [] },
    { role: 'ADMIN', countries: ['IN'], departments: [] },
  ]) await assert.rejects(repo.createTrace({ ...base, actorScope: actorScope as never }), PersistenceValidationError);
  const trace = await repo.createTrace({ ...base, actorScope: { role: 'SCOPED', countries: ['US', 'IN', 'IN'], departments: ['Tech', 'Support'] } });
  const [row] = await selectRows(pool, 'SELECT actor_role, actor_countries, actor_departments FROM ai_traces WHERE id = ?', [trace.id]);
  assert.deepEqual([row?.actor_role, row?.actor_countries, row?.actor_departments], ['SCOPED', ['IN', 'US'], ['Support', 'Tech']]);
  const legacy = await repo.createTrace({ ...base, requestId: 'legacy' });
  const [legacyRow] = await selectRows(pool, 'SELECT actor_role, actor_countries, actor_departments FROM ai_traces WHERE id = ?', [legacy.id]);
  assert.deepEqual([legacyRow?.actor_role, legacyRow?.actor_countries, legacyRow?.actor_departments], [null, null, null]);
  await assert.rejects(pool.query('UPDATE ai_traces SET actor_countries = NULL WHERE id = ?', [trace.id]), /chk_ai_traces_actor_scope/);
});

test('same-command idempotency replay returns original trace and sequence without new rows', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const base = { conversationId: conversation.id, actorId, requestId: 'replay', idempotencyKey: 'replay-key', commandHash: 'b'.repeat(64), promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'same' }, modelMessages: [], startedAt: NEW };
  const first = await repo.createTrace(base);
  const replay = await repo.createTrace(base);
  // Task 03: createTrace also reports the user-message sequence of a new trace (null for a replay).
  assert.deepEqual(replay, { id: first.id, sequence: first.sequence, reused: true, userMessageSequence: null });
  await assert.rejects(repo.createTrace({ ...base, commandHash: 'c'.repeat(64) }), ConflictError);
  const traces = await selectRows(pool, 'SELECT COUNT(*) AS n FROM ai_traces WHERE conversation_id = ?', [conversation.id]);
  const messages = await selectRows(pool, 'SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [conversation.id]);
  assert.equal(Number(traces[0]?.n), 1);
  assert.equal(Number(messages[0]?.n), 1);
});

test('tool calls start only after their parent model outcome was persisted as successful', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'model-order', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  const attempt = (modelCallId: string) => repo.startToolCall({ traceId: trace.id, modelCallId, toolName: 'lookup', arguments: {}, startedAt: NEW });
  const started = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await assert.rejects(attempt(started.id), ConflictError);
  await repo.finishModelCall(started.id, { status: 'FAILED', latencyMs: 1, completedAt: NEW, failureCategory: 'timeout' });
  await assert.rejects(attempt(started.id), ConflictError);
  const successful = await repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(successful.id, { status: 'SUCCEEDED', latencyMs: 1, completedAt: NEW });
  const tool = await attempt(successful.id);
  assert.equal(tool.sequence, 1);
  assert.equal((await repo.readTrace(trace.id))?.toolCalls.length, 1);
});

test('review compare-and-set rejects stale replacement', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'r-review', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  const first = await repo.upsertReview({ traceId: trace.id, reviewerId: actorId, verdict: 'CORRECT', note: 'ok', nominated: false, expectedVersion: 0, now: NEW });
  assert.equal(first.version, 1);
  await assert.rejects(repo.upsertReview({ traceId: trace.id, reviewerId: actorId, verdict: 'INCORRECT', note: 'stale', nominated: true, expectedVersion: 0, now: NEW }), ConflictError);
});

test('delete removes one turn aggregate and nulls a later previous trace', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const make = (requestId: string, previousTraceId?: string) => repo.createTrace({ conversationId: conversation.id, actorId, requestId, previousTraceId, promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: requestId }, modelMessages: [], startedAt: NEW });
  const first = await make('delete-1');
  const second = await make('delete-2', first.id);
  const model = await repo.startModelCall({ traceId: first.id, provider: 'fake', model: 'fake', input: [], tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW });
  await repo.finishModelCall(model.id, { status: 'SUCCEEDED', latencyMs: 1, completedAt: NEW });
  await repo.startToolCall({ traceId: first.id, modelCallId: model.id, toolName: 'lookup', arguments: {}, startedAt: NEW });
  await repo.upsertReview({ traceId: first.id, reviewerId: actorId, verdict: 'CORRECT', note: 'ok', nominated: false, expectedVersion: 0, now: NEW });
  await repo.deleteTrace(first.id);
  assert.equal(await repo.readTrace(first.id), null);
  assert.equal((await repo.readTrace(second.id))?.trace.previousTraceId, null);
  assert.equal((await repo.readOwnedConversation(conversation.id, actorId))?.messages.length, 1);
  for (const table of ['ai_model_calls', 'ai_tool_calls', 'ai_trace_reviews']) {
    const matches = await selectRows(pool, `SELECT COUNT(*) AS n FROM ${table} WHERE trace_id = ?`, [first.id]);
    assert.equal(Number(matches[0]?.n), 0, table);
  }
});

test('retention dry-run preserves data then deletes old trace and MCP aggregates only', async () => {
  const conversation = await repo.createConversation(actorId, OLD);
  const old = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'old', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'old' }, modelMessages: [], startedAt: OLD });
  const fresh = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'fresh', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'fresh' }, modelMessages: [], startedAt: NEW });
  const mcpOld = await repo.startMcpCall({ actorId, requestId: 'm-old', toolName: 'lookup', arguments: {}, startedAt: OLD });
  await repo.finishMcpCall(mcpOld.id, { status: 'SUCCEEDED', result: { salary: '20.00' }, durationMs: 1, completedAt: OLD });
  const mcpFresh = await repo.startMcpCall({ actorId, requestId: 'm-fresh', toolName: 'lookup', arguments: {}, startedAt: NEW });
  const preview = await runRetention(repo, { days: 30, execute: false }, new Date('2026-10-31T00:00:00.000Z'));
  assert.equal(preview.cutoff, CUTOFF);
  const counts = preview.counts;
  assert.ok(counts.traces >= 1);
  assert.ok(counts.mcpCalls >= 1);
  assert.ok(await repo.readTrace(old.id));
  await runRetention(repo, { days: 30, execute: true }, new Date('2026-10-31T00:00:00.000Z'));
  assert.equal(await repo.readTrace(old.id), null);
  assert.ok(await repo.readTrace(fresh.id));
  assert.equal(await repo.readMcpCall(mcpOld.id), null);
  assert.ok(await repo.readMcpCall(mcpFresh.id));
});

test('oversized call payload fails before writing a partial row', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'large', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  await assert.rejects(repo.startModelCall({ traceId: trace.id, provider: 'fake', model: 'fake', input: { text: 'x'.repeat(200_000) }, tools: [], promptVersion: 'v1', promptHash: 'hash', startedAt: NEW }), PersistenceValidationError);
  assert.equal((await repo.readTrace(trace.id))?.modelCalls.length, 0);
});

test('a failed trace cannot store a fabricated final assistant answer', async () => {
  const conversation = await repo.createConversation(actorId, NEW);
  const trace = await repo.createTrace({ conversationId: conversation.id, actorId, requestId: 'failed-answer', promptVersion: 'v1', promptHash: 'hash', model: 'fake', userContent: { text: 'hi' }, modelMessages: [], startedAt: NEW });
  await assert.rejects(repo.finishTrace(trace.id, { status: 'FAILED', finalResponse: { text: 'fabricated' }, durationMs: 1, completedAt: NEW }), PersistenceValidationError);
  assert.equal((await repo.readTrace(trace.id))?.trace.status, 'STARTED');
});
