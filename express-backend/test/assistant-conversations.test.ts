// Recorded assistant turns over the conversation service, with the fake model
// and the in-memory fake store (fault injection). No OpenAI, no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, createAssistantService } from '../src/assistant/assistant-service.js';
import type { AssistantLimits } from '../src/assistant/assistant-service.js';
import { AssistantApiError, HISTORY_POLICY, createConversationService, messageCommandHash, selectHistory } from '../src/assistant/conversation-service.js';
import { ModelFailure } from '../src/assistant/model.js';
import type { ModelReply } from '../src/assistant/model.js';
import type { ToolOutcome, ToolRegistry } from '../src/assistant/tools.js';
import { TOOL_NAMES } from '../src/assistant/tool-schemas.js';
import { PUBLIC_MESSAGES } from '../src/http/contract.js';
import type { AssistantCard } from '../src/http/contract.js';
import type { LogEntry } from '../src/http/request-log.js';
import { fakeAssistantStore } from './support/fake-assistant-store.js';
import type { StoreOperation } from './support/fake-assistant-store.js';
import { answer, callTool, hang, rawCall, scriptedModel } from './support/fake-model.js';
import type { FakeStep } from './support/fake-model.js';
import { MEERA } from './support/http.js';

const NOW = new Date('2026-11-15T09:30:00.000Z');
const ROHAN = { ...MEERA, hrUserId: 2, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED' as const, countries: ['IN'], departments: ['Support', 'Tech'], sessionId: '1b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e11' };
const SECRET_NAME = 'Leakcheck Personname';
const SECRET_SALARY = '9876543.21';
let keyCounter = 0;
const key = () => `turn-key-${String(++keyCounter).padStart(8, '0')}`;

function stubRegistry(outcome?: (name: string, args: unknown) => ToolOutcome | Promise<ToolOutcome>) {
  const runs: { name: string; args: unknown; principal: unknown }[] = [];
  const registry: ToolRegistry = {
    definitions: TOOL_NAMES.map((name) => ({ name, title: name, description: `desc ${name}` })),
    async run(name, args, context) {
      runs.push({ name, args, principal: context.principal });
      if (outcome) return outcome(name, args);
      if (!(TOOL_NAMES as readonly string[]).includes(name)) return { status: 'rejected', reason: 'UNKNOWN_TOOL' };
      return {
        status: 'completed',
        result: {
          data: { employees: [{ name: SECRET_NAME, annualBaseSalary: SECRET_SALARY }] },
          cards: [{ type: 'notice', level: 'info', message: `card from ${name}` }],
          limitations: ['Ranks currently working employees only.'],
        },
      };
    },
  };
  return { registry, runs };
}

function harness(steps: readonly FakeStep[] | null, { tools = stubRegistry(), limits = {} }: { tools?: ReturnType<typeof stubRegistry>; limits?: Partial<AssistantLimits> } = {}) {
  const logs: LogEntry[] = [];
  const model = steps === null ? null : scriptedModel(steps);
  const fake = fakeAssistantStore();
  const assistant = createAssistantService({ model, tools: tools.registry, logger: (e) => logs.push(e), clock: () => NOW, limits: { ...LIMITS, ...limits } });
  const service = createConversationService({ store: fake.store, assistant, logger: (e) => logs.push(e), clock: () => NOW });
  const conversation = async (principal = MEERA) => (await service.create(principal)).conversationId;
  const submit = (conversationId: string, content = 'Who earns the most?', idempotencyKey = key(), extra: { retryOfTraceId?: string } = {}, principal = MEERA) =>
    service.submit(principal, conversationId, { content, ...extra }, idempotencyKey, 'req-1');
  /** Provider calls actually made (the fake records one entry per next()). */
  const providerCalls = () => model?.outputsByRound.length ?? 0;
  return { service, fake, model, logs, tools, conversation, submit, providerCalls };
}

const withTelemetry = (reply: ModelReply, requestId: string, usage: Record<string, number>): ModelReply => ({ ...reply, telemetry: { providerRequestId: requestId, usage } });
const apiError = (status: number, code: string, reason?: string) => (error: unknown) => {
  assert.ok(error instanceof AssistantApiError, String(error));
  assert.deepEqual([error.status, error.code, error.reason], [status, code, reason]);
  return true;
};

describe('owned conversations', () => {
  // Detects: guessing an ID exposing another HR user's conversation.
  test('create, list, and read are owner-only; unknown, unowned, and malformed IDs give the same 404', async () => {
    const { service, conversation, submit } = harness([() => answer('Hello.')]);
    const mine = await conversation();
    await submit(mine, 'First question');
    const theirs = await conversation(ROHAN);
    const listed = await service.list(MEERA, { page: 1, pageSize: 25 });
    assert.deepEqual(listed.conversations.map((c) => [c.conversationId, c.messageCount, c.title]), [[mine, 2, 'First question']]);
    assert.deepEqual(listed.page, { number: 1, size: 25, totalRows: 1, totalPages: 1 });
    const detail = await service.read(MEERA, mine);
    assert.deepEqual(detail.messages.map((m) => [m.sequence, m.role, m.text]), [[1, 'user', 'First question'], [2, 'assistant', 'Hello.']]);
    for (const id of [theirs, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      await assert.rejects(service.read(MEERA, id), apiError(404, 'NOT_FOUND'));
      await assert.rejects(submit(id), apiError(404, 'NOT_FOUND'));
    }
  });
});

describe('recorded turns', () => {
  // Detects: a timeline that assumes a tool child, or lost token/request metadata.
  test('a no-tool turn records one model call with telemetry, then the final message', async () => {
    const h = harness([() => withTelemetry(answer('  Hello.  '), 'req_provider_1', { inputTokens: 120, outputTokens: 8, totalTokens: 128, reasoningTokens: 3 })]);
    const id = await h.conversation();
    const { value } = await h.submit(id, 'Hi');
    assert.equal(value.answer, 'Hello.');
    assert.deepEqual([value.userMessageSequence, value.assistantMessageSequence, value.previousTraceId], [1, 2, null]);
    assert.deepEqual(h.fake.events, ['createConversation', 'createTrace', 'startModelCall', 'finishModelCall:SUCCEEDED', 'finishTrace:COMPLETED']);
    const call = h.fake.modelCalls[0];
    assert.deepEqual(call?.start, {
      traceId: value.traceId, provider: 'fake', model: 'fake-model',
      input: { instructions: h.model?.requests[0]?.instructions, messages: [{ role: 'user', content: 'Hi' }], exchanges: [] },
      tools: (call?.start as { tools: unknown }).tools, promptVersion: 'assistant-instructions-v1',
      promptHash: h.fake.traces[0]?.promptHash, startedAt: '2026-11-15 09:30:00.000',
    });
    assert.deepEqual((call?.start as { tools: { name: string }[] }).tools.map((t) => t.name), [...TOOL_NAMES]);
    const finish = call?.finish as Record<string, unknown>;
    assert.deepEqual([finish.status, finish.output, finish.decisions, finish.inputTokens, finish.outputTokens, finish.totalTokens, finish.reasoningTokens, finish.providerRequestId],
      ['SUCCEEDED', { text: '  Hello.  ' }, [], 120, 8, 128, 3, 'req_provider_1']);
    const trace = h.fake.traces[0];
    assert.deepEqual([trace?.status, trace?.model, trace?.modelMessages], ['COMPLETED', 'fake-model', [{ role: 'user', content: 'Hi' }]]);
    assert.match(String(trace?.promptHash), /^[0-9a-f]{64}$/);
    assert.deepEqual(trace?.finalResponse, { answer: 'Hello.', toolCalls: [], cards: [], limitations: [], generatedAt: NOW.toISOString() });
  });

  // Detects: tools run with model-chosen identity, or steps recorded out of order.
  test('a one-tool turn records attempt and outcome around each step, with the server principal', async () => {
    const h = harness([() => callTool('get_top_compensated_employees', { metric: 'ANNUAL_CASH', hrUserId: 99, role: 'ADMIN' }), () => answer('Here they are.')]);
    const id = await h.conversation();
    const { value } = await h.submit(id);
    assert.deepEqual(h.fake.events.slice(1), [
      'createTrace', 'startModelCall', 'finishModelCall:SUCCEEDED', 'startToolCall', 'finishToolCall:SUCCEEDED',
      'startModelCall', 'finishModelCall:SUCCEEDED', 'finishTrace:COMPLETED',
    ]);
    assert.equal(h.tools.runs[0]?.principal, MEERA);
    const tool = h.fake.toolCalls[0];
    const start = tool?.start as Record<string, unknown>;
    assert.deepEqual([start.toolName, start.providerToolCallId, start.modelCallId, start.arguments],
      ['get_top_compensated_employees', (h.model?.outputsByRound[1]?.[0])?.callId, h.fake.modelCalls[0]?.id, { metric: 'ANNUAL_CASH', hrUserId: 99, role: 'ADMIN' }]);
    assert.deepEqual((tool?.finish as { result: unknown }).result, {
      data: { employees: [{ name: SECRET_NAME, annualBaseSalary: SECRET_SALARY }] },
      cards: [{ type: 'notice', level: 'info', message: 'card from get_top_compensated_employees' }],
      limitations: ['Ranks currently working employees only.'],
    });
    // The second model call's recorded input includes the first exchange exactly.
    const second = h.fake.modelCalls[1]?.start as { input: { exchanges: unknown[] } };
    assert.equal(second.input.exchanges.length, 1);
    assert.deepEqual(value.toolCalls, [{ name: 'get_top_compensated_employees', status: 'completed' }]);
    assert.equal(value.cards.length, 1);
  });

  // Detects: repeated loop iterations overwriting the first call or misleading totals.
  test('a multi-tool turn records every call once in execution order', async () => {
    const two: ModelReply = { kind: 'tool_calls', calls: [
      { callId: 'c-a', name: 'search_employees', arguments: '{"query":"a"}' },
      { callId: 'c-b', name: 'get_compensation_summary', arguments: '{"groupBy":"COUNTRY","metric":"ANNUAL_BASE"}' },
    ] };
    const h = harness([() => two, () => callTool('search_employees', { query: 'b' }), () => answer('Done.')]);
    const id = await h.conversation();
    await h.submit(id);
    assert.deepEqual(h.fake.modelCalls.map((c) => c.sequence), [1, 2, 3]);
    assert.deepEqual(h.fake.toolCalls.map((c) => [c.sequence, (c.start as { providerToolCallId: string }).providerToolCallId, c.modelCallId]),
      [[1, 'c-a', h.fake.modelCalls[0]?.id], [2, 'c-b', h.fake.modelCalls[0]?.id], [3, (h.fake.toolCalls[2]?.start as { providerToolCallId: string }).providerToolCallId, h.fake.modelCalls[1]?.id]]);
    assert.deepEqual(((h.fake.modelCalls[0]?.finish as { decisions: { callId: string }[] }).decisions).map((d) => d.callId), ['c-a', 'c-b']);
  });

  // Detects: rejected model behaviour disappearing, or reaching the tool.
  test('unknown tools and invalid arguments are recorded REJECTED with their arguments and are not executed', async () => {
    const tools = stubRegistry((name, args) => (name === 'search_employees' && !Array.isArray(args) ? { status: 'completed', result: { data: {}, cards: [], limitations: [] } } : { status: 'rejected', reason: name === 'search_employees' ? 'INVALID_ARGUMENTS' : 'UNKNOWN_TOOL' }));
    const h = harness([() => rawCall('drop_table_employees', '{"sql":"DROP"}'), () => rawCall('search_employees', '{not json'), () => rawCall('search_employees', '["array"]'), () => answer('Sorry.')], { tools });
    const id = await h.conversation();
    const { value } = await h.submit(id);
    assert.deepEqual(value.toolCalls.map((t) => t.status), ['rejected', 'rejected', 'rejected']);
    assert.deepEqual(h.fake.toolCalls.map((c) => [(c.start as { arguments: unknown }).arguments, c.status, (c.finish as { validation: unknown }).validation]), [
      [{ sql: 'DROP' }, 'REJECTED', { reason: 'UNKNOWN_TOOL' }],
      [{ invalidJson: true }, 'REJECTED', { reason: 'INVALID_ARGUMENTS', detail: 'INVALID_JSON' }],
      [['array'], 'REJECTED', { reason: 'INVALID_ARGUMENTS' }],
    ]);
    assert.deepEqual(tools.runs.map((r) => r.name), ['drop_table_employees', 'search_employees'], 'malformed JSON never reaches the registry');
  });

  // Detects: a tool failure misreported as a provider failure, or leaking details.
  test('a failed tool is recorded FAILED with a safe category and the turn continues', async () => {
    const h = harness([() => callTool('get_compensation_summary', { groupBy: 'COUNTRY', metric: 'ANNUAL_BASE' }), () => answer('Could not load it.')],
      { tools: stubRegistry(() => ({ status: 'failed', errorName: 'Error' })) });
    const id = await h.conversation();
    const { value } = await h.submit(id);
    assert.deepEqual(value.toolCalls, [{ name: 'get_compensation_summary', status: 'failed' }]);
    const finish = h.fake.toolCalls[0]?.finish as Record<string, unknown>;
    assert.deepEqual([finish.status, finish.errorCategory, finish.safeError, 'result' in finish], ['FAILED', 'TOOL_FAILED', { errorName: 'Error' }, false]);
    assert.equal(h.fake.traces[0]?.status, 'COMPLETED');
  });

  // Detects: a hung provider, or a timeout recorded as success or as a fabricated answer.
  test('a model timeout fails the trace at MODEL_CALL with no assistant message', async () => {
    const h = harness([hang], { limits: { turnTimeoutMs: 50 } });
    const id = await h.conversation();
    await assert.rejects(h.submit(id), apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_TIMEOUT'));
    assert.deepEqual([h.fake.modelCalls[0]?.status, (h.fake.modelCalls[0]?.finish as { failureCategory: string }).failureCategory], ['FAILED', 'timeout']);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage, h.fake.traces[0]?.errorCategory, h.fake.traces[0]?.finalResponse], ['FAILED', 'MODEL_CALL', 'timeout', null]);
    assert.deepEqual(h.fake.messages.map((m) => m.role), ['USER']);
  });

  test('a provider failure keeps its provider request ID and a safe category', async () => {
    const h = harness([() => { throw new ModelFailure('provider_error', { providerRequestId: 'req_failed_9' }); }]);
    const id = await h.conversation();
    await assert.rejects(h.submit(id), apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_ERROR'));
    const finish = h.fake.modelCalls[0]?.finish as Record<string, unknown>;
    assert.deepEqual([finish.providerRequestId, finish.failureCategory, finish.safeError], ['req_failed_9', 'provider_error', { category: 'provider_error' }]);
    for (const [category, reason] of [['rate_limited', 'MODEL_RATE_LIMITED'], ['invalid_response', 'MODEL_INVALID_RESPONSE']] as const) {
      const other = harness([() => { throw new ModelFailure(category); }]);
      await assert.rejects(other.submit(await other.conversation()), apiError(502, 'MODEL_PROVIDER_FAILED', reason));
    }
  });

  // Detects: a turn deadline during a tool left unrecorded or reported as a model failure.
  test('the turn deadline during a tool fails the tool call and the trace at TOOL_EXECUTION', async () => {
    const tools = stubRegistry(() => new Promise<ToolOutcome>(() => undefined));
    const h = harness([() => callTool('search_employees', { query: 'slow' })], { tools, limits: { turnTimeoutMs: 50 } });
    await assert.rejects(h.submit(await h.conversation()), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TURN_TIMEOUT'));
    assert.deepEqual([h.fake.toolCalls[0]?.status, (h.fake.toolCalls[0]?.finish as { errorCategory: string }).errorCategory], ['FAILED', 'turn_timeout']);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage], ['FAILED', 'TOOL_EXECUTION']);
  });
});

describe('fail-closed persistence', () => {
  const failing = (operation: StoreOperation, when: (input: unknown) => boolean = () => true) => (op: StoreOperation, input: unknown) => op === operation && when(input);
  const succeeded = (input: unknown) => (input as { status?: string }).status === 'SUCCEEDED';

  // Detects: an unrecorded provider call.
  test('trace creation failure prevents the provider call', async () => {
    const h = harness([() => answer('should not happen')]);
    const id = await h.conversation();
    h.fake.failOn(failing('createTrace'));
    await assert.rejects(h.submit(id), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.equal(h.providerCalls(), 0);
    assert.deepEqual(h.logs.filter((l) => l.event === 'assistant_trace_failure'), [{ event: 'assistant_trace_failure', requestId: 'req-1', traceId: null, stage: 'TRACE_CREATE', category: 'persistence_unavailable' }]);
  });

  test('model-attempt persistence failure prevents the provider call', async () => {
    const h = harness([() => answer('should not happen')]);
    const id = await h.conversation();
    h.fake.failOn(failing('startModelCall'));
    await assert.rejects(h.submit(id), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.equal(h.providerCalls(), 0);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage], ['FAILED', 'MODEL_TRACE_WRITE']);
  });

  // Detects: behaviour Admin cannot reconstruct reaching the user.
  test('model-outcome persistence failure prevents tool execution and returning provider text', async () => {
    for (const steps of [[() => answer(`secret answer ${SECRET_SALARY}`)], [() => callTool('search_employees', { query: 'x' }), () => answer('never')]]) {
      const h = harness(steps);
      const id = await h.conversation();
      h.fake.failOn(failing('finishModelCall', succeeded));
      const error = await h.submit(id).then(() => null, (e: unknown) => e);
      apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE')(error);
      assert.ok(!JSON.stringify(error).includes(SECRET_SALARY));
      assert.equal(h.tools.runs.length, 0);
      assert.equal(h.providerCalls(), 1);
      // The open attempt is closed as FAILED with the trace; no assistant message exists.
      assert.deepEqual([h.fake.modelCalls[0]?.status, h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage], ['FAILED', 'FAILED', 'MODEL_TRACE_WRITE']);
      assert.deepEqual(h.fake.messages.map((m) => m.role), ['USER']);
    }
  });

  test('tool-attempt persistence failure prevents tool execution', async () => {
    const h = harness([() => callTool('search_employees', { query: 'x' }), () => answer('never')]);
    const id = await h.conversation();
    h.fake.failOn(failing('startToolCall'));
    await assert.rejects(h.submit(id), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.equal(h.tools.runs.length, 0);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage], ['FAILED', 'TOOL_TRACE_WRITE']);
  });

  test('tool-outcome persistence failure prevents the next model call', async () => {
    const h = harness([() => callTool('search_employees', { query: 'x' }), () => answer('never')]);
    const id = await h.conversation();
    h.fake.failOn(failing('finishToolCall'));
    await assert.rejects(h.submit(id), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.equal(h.tools.runs.length, 1);
    assert.equal(h.providerCalls(), 1, 'the second model call never starts');
    assert.deepEqual([h.fake.toolCalls[0]?.status, h.fake.traces[0]?.failureStage], ['FAILED', 'TOOL_TRACE_WRITE']);
  });

  // Detects: an answer returned although its final message was not saved.
  test('final trace/message persistence failure prevents returning the answer', async () => {
    const h = harness([() => answer(`final ${SECRET_SALARY}`)]);
    const id = await h.conversation();
    h.fake.failOn(failing('finishTrace', (input) => (input as { status: string }).status === 'COMPLETED'));
    const error = await h.submit(id).then(() => null, (e: unknown) => e);
    apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE')(error);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.failureStage, h.fake.traces[0]?.finalResponse], ['FAILED', 'FINAL_TRACE_WRITE', null]);
    assert.deepEqual(h.fake.messages.map((m) => m.role), ['USER']);
    // If the failure write fails too, the trace stays STARTED and still nothing is returned.
    const both = harness([() => answer('x')]);
    const bothId = await both.conversation();
    both.fake.failOn(failing('finishTrace'));
    await assert.rejects(both.submit(bothId), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.equal(both.fake.traces[0]?.status, 'STARTED');
    assert.ok(both.logs.some((l) => l.event === 'assistant_trace_finalize_failed'));
  });

  // Detects: a stored payload beyond its limit silently truncated or crashing.
  test('an over-limit tool result fails the turn safely as payload_rejected', async () => {
    const big = { status: 'completed' as const, result: { data: { blob: 'x'.repeat(10) }, cards: [{ type: 'notice' as const, level: 'info' as const, message: 'x'.repeat(300 * 1024) }], limitations: [] } };
    const h = harness([() => callTool('search_employees', { query: 'x' }), () => answer('never')], { tools: stubRegistry(() => big) });
    await assert.rejects(h.submit(await h.conversation()), apiError(503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE'));
    assert.ok(h.logs.some((l) => l.event === 'assistant_trace_failure' && l.stage === 'TOOL_TRACE_WRITE' && l.category === 'payload_rejected'));
    assert.equal(h.providerCalls(), 1);
  });

  // Detects (Task 03a): a submission with no model configured leaving no record.
  test('no model configured: the user message and a FAILED turn are recorded, with no provider or tool call', async () => {
    const tools = stubRegistry();
    const h = harness(null, { tools });
    const id = await h.conversation();
    const k = key();
    await assert.rejects(h.submit(id, 'Anyone there?', k), apiError(503, 'ASSISTANT_UNAVAILABLE', 'MODEL_NOT_CONFIGURED'));
    assert.deepEqual(h.fake.traces.map((t) => [t.status, t.failureStage, t.errorCategory, t.finalResponse]), [['FAILED', 'MODEL_CALL', 'not_configured', null]]);
    assert.deepEqual(h.fake.traces[0]?.model, 'not-configured');
    assert.deepEqual([h.fake.modelCalls.length, h.fake.toolCalls.length, tools.runs.length], [0, 0, 0]);
    assert.deepEqual(h.fake.messages.map((m) => m.role), ['USER']);
    const detail = await h.service.read(MEERA, id);
    assert.deepEqual(detail.messages.map((m) => [m.role, m.text]), [['user', 'Anyone there?']]);
    assert.deepEqual(detail.turns.map((t) => [t.status, t.error?.reason]), [['FAILED', 'MODEL_NOT_CONFIGURED']]);
    // Same key and command: the recorded failure again, nothing new written.
    await assert.rejects(h.submit(id, 'Anyone there?', k), (e: unknown) => apiError(503, 'ASSISTANT_UNAVAILABLE', 'MODEL_NOT_CONFIGURED')(e) && (e as AssistantApiError).replayed);
    await assert.rejects(h.submit(id, 'Something else', k), apiError(409, 'DUPLICATE_OPERATION'));
    assert.deepEqual([h.fake.traces.length, h.fake.messages.length], [1, 1]);
  });

  test('no model configured on the deprecated route: a recorded FAILED turn in a new conversation', async () => {
    const h = harness(null);
    await assert.rejects(h.service.legacy(MEERA, 'Only this', 'req-legacy'), apiError(503, 'ASSISTANT_UNAVAILABLE', 'MODEL_NOT_CONFIGURED'));
    assert.equal(h.fake.conversations.size, 1);
    assert.deepEqual(h.fake.traces.map((t) => [t.status, t.failureStage, t.errorCategory]), [['FAILED', 'MODEL_CALL', 'not_configured']]);
    assert.deepEqual([h.fake.modelCalls.length, h.fake.messages.map((m) => m.role)], [0, ['USER']]);
  });
});

describe('bounded server history', () => {
  // Detects: browser-memory history, unbounded input, or split turns.
  test('sends the most recent complete turns within the bound and records that exact input', async () => {
    let round = 0;
    const h = harness([() => answer(`Answer ${++round}`)]);
    const id = await h.conversation();
    for (let i = 1; i <= 6; i += 1) await h.submit(id, `Question ${i}`);
    const { value } = await h.submit(id, 'Question 7');
    const expected = [3, 4, 5, 6].flatMap((n) => [{ role: 'user', content: `Question ${n}` }, { role: 'assistant', content: `Answer ${n}` }]).concat([{ role: 'user', content: 'Question 7' }]);
    assert.equal(HISTORY_POLICY.maxTurns, 4);
    assert.deepEqual(h.model?.requests.at(-1)?.messages, expected);
    const trace = h.fake.traces.find((t) => t.id === value.traceId);
    assert.deepEqual(trace?.modelMessages, expected);
    assert.deepEqual((h.fake.modelCalls.at(-1)?.start as { input: { messages: unknown } }).input.messages, expected);
    assert.equal(value.previousTraceId, h.fake.traces[5]?.id);
  });

  test('the character bound drops whole older turns; failed turns and the retried turn are excluded', () => {
    const turn = (n: number, status: 'COMPLETED' | 'FAILED', answerLength: number) => ({
      messages: [
        { traceId: `t${n}`, sequence: n * 2 - 1, role: 'USER' as const, content: { text: `Q${n}` }, createdAt: '' },
        ...(status === 'COMPLETED' ? [{ traceId: `t${n}`, sequence: n * 2, role: 'ASSISTANT' as const, content: { answer: 'a'.repeat(answerLength) }, createdAt: '' }] : []),
      ],
      turn: { id: `t${n}`, sequence: n, previousTraceId: null, status, failureStage: null, errorCategory: null, startedAt: '', userMessageSequence: n * 2 - 1, finalMessageSequence: status === 'COMPLETED' ? n * 2 : null },
    });
    const parts = [turn(1, 'COMPLETED', 10), turn(2, 'COMPLETED', 7_000), turn(3, 'FAILED', 0), turn(4, 'COMPLETED', 7_000), turn(5, 'COMPLETED', 1_000)];
    const conversation = { messages: parts.flatMap((p) => p.messages), turns: parts.map((p) => p.turn) };
    // 5 (1,002) + 4 (7,002) + 2 (7,002) = 15,006 <= 16,000; adding 1 still fits the turn limit and size.
    assert.deepEqual(selectHistory(conversation).filter((m) => m.role === 'user').map((m) => m.content), ['Q1', 'Q2', 'Q4', 'Q5']);
    // Without turn 5, turn 1 does not need dropping; with a larger turn 5, turn 2 and everything older stop the selection.
    const heavy = { ...conversation, messages: conversation.messages.map((m) => (m.traceId === 't5' && m.role === 'ASSISTANT' ? { ...m, content: { answer: 'a'.repeat(5_000) } } : m)) };
    assert.deepEqual(selectHistory(heavy).filter((m) => m.role === 'user').map((m) => m.content), ['Q4', 'Q5']);
    assert.deepEqual(selectHistory(conversation, { excludeTraceId: 't5' }).filter((m) => m.role === 'user').map((m) => m.content), ['Q1', 'Q2', 'Q4']);
  });
});

describe('idempotency and retry', () => {
  // Detects: a retry calling the model twice, or a reused key applying another message.
  test('the same key and command replays without a second model call; other content conflicts', async () => {
    const h = harness([() => answer('Once.')]);
    const id = await h.conversation();
    const k = key();
    const first = await h.submit(id, 'Hello', k);
    const again = await h.submit(id, 'Hello', k);
    assert.deepEqual([first.replayed, again.replayed], [false, true]);
    assert.deepEqual(again.value, first.value);
    assert.equal(h.providerCalls(), 1);
    assert.equal(h.fake.traces.length, 1);
    await assert.rejects(h.submit(id, 'Hello!', k), apiError(409, 'DUPLICATE_OPERATION'));
    assert.equal(h.fake.traces.length, 1);
    assert.equal(h.fake.traces[0]?.commandHash, messageCommandHash(id, 'Hello', null));
  });

  test('a replayed failed turn returns the same error; an in-progress turn returns 409', async () => {
    const failed = harness([() => { throw new ModelFailure('timeout'); }]);
    const id = await failed.conversation();
    const k = key();
    await assert.rejects(failed.submit(id, 'x', k), apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_TIMEOUT'));
    await assert.rejects(failed.submit(id, 'x', k), (e: unknown) => apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_TIMEOUT')(e) && (e as AssistantApiError).replayed);
    assert.equal(failed.providerCalls(), 1);

    let release: (reply: ModelReply) => void = () => undefined;
    const slow = harness([() => new Promise<ModelReply>((resolve) => { release = resolve; })]);
    const slowId = await slow.conversation();
    const k2 = key();
    const running = slow.submit(slowId, 'slow', k2);
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(slow.submit(slowId, 'slow', k2), apiError(409, 'ASSISTANT_TURN_IN_PROGRESS'));
    release(answer('done'));
    assert.equal((await running).value.answer, 'done');
  });

  // Detects: Retry overwriting the failed trace instead of creating a linked one.
  test('a user-selected Retry with a new key creates a new trace linked to the retried one', async () => {
    let attempt = 0;
    const h = harness([() => { attempt += 1; if (attempt === 1) throw new ModelFailure('provider_error'); return answer('Second time.'); }]);
    const id = await h.conversation();
    await assert.rejects(h.submit(id, 'Try me'), apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_ERROR'));
    const failedTrace = h.fake.traces[0]?.id ?? '';
    const { value } = await h.submit(id, 'Try me', key(), { retryOfTraceId: failedTrace });
    assert.equal(value.previousTraceId, failedTrace);
    assert.notEqual(value.traceId, failedTrace);
    assert.deepEqual(h.fake.traces.map((t) => [t.sequence, t.status]), [[1, 'FAILED'], [2, 'COMPLETED']]);
    assert.deepEqual(h.fake.traces[1]?.userContent, { text: 'Try me', retryOfTraceId: failedTrace });
    const detail = await h.service.read(MEERA, id);
    assert.deepEqual(detail.turns.map((t) => [t.status, t.retryOfTraceId, t.error?.code ?? null]), [['FAILED', null, 'MODEL_PROVIDER_FAILED'], ['COMPLETED', failedTrace, null]]);
    assert.deepEqual(detail.messages.map((m) => m.role), ['user', 'user', 'assistant']);
    await assert.rejects(h.submit(id, 'x', key(), { retryOfTraceId: '00000000-0000-4000-8000-000000000000' }), apiError(400, 'VALIDATION_ERROR'));
  });

  // Detects (Q-C10): a reloaded failed turn losing the safe reason the message endpoint returned.
  test('a failed turn in the detail carries the same code, message, and reason as the message endpoint', async () => {
    const h = harness([() => { throw new ModelFailure('timeout'); }]);
    const id = await h.conversation();
    await assert.rejects(h.submit(id, 'x'), apiError(502, 'MODEL_PROVIDER_FAILED', 'MODEL_TIMEOUT'));
    const [turn] = (await h.service.read(MEERA, id)).turns;
    assert.deepEqual(turn?.error, { code: 'MODEL_PROVIDER_FAILED', message: PUBLIC_MESSAGES.MODEL_PROVIDER_FAILED, reason: 'MODEL_TIMEOUT' });
  });
});

const cardEmployee = (employeeCode: string, country: 'IN' | 'US', department: 'Tech' | 'Support' | 'Finance') => ({
  employeeCode, name: `Person ${employeeCode}`, department, jobTitle: 'Engineer', level: 'MID' as const, country,
  employmentStatus: 'CURRENTLY_WORKING' as const, compensation: null,
});
const summaryGroup = (group: string) => ({
  group, currency: 'INR' as const, employeeCount: 1,
  total: { amount: '100.00', currency: 'INR' as const }, average: { amount: '100.00', currency: 'INR' as const },
  minimum: { amount: '100.00', currency: 'INR' as const }, maximum: { amount: '100.00', currency: 'INR' as const }, usdEquivalent: null,
});
const savedCards = (): AssistantCard[] => [
  { type: 'employee_list', title: 'Search results', exchangeRate: null, employees: [cardEmployee('ACME00601', 'IN', 'Tech'), cardEmployee('ACME00602', 'IN', 'Support')] },
  { type: 'compensation_summary', title: 'By department', groupBy: 'DEPARTMENT', metric: 'ANNUAL_BASE', population: 'CURRENTLY_WORKING', exchangeRate: null, groups: [summaryGroup('Tech'), summaryGroup('Support')] },
  { type: 'notice', level: 'info', message: 'kept' },
];

const WITHHELD = 'This answer is hidden because your access has changed since it was given.';
const SECRET_EMPLOYEE = 'ACME00602 Vikram Iyer';

describe('saved answers and trace-time scope (Task 03a, Option C)', () => {
  /** Rohan (IN x Support, Tech) completes one turn whose answer and cards name ACME00602. */
  async function savedTurn(k = key()) {
    const tools = stubRegistry(() => ({ status: 'completed', result: { data: {}, cards: savedCards(), limitations: ['Saved limitation.'] } }));
    const h = harness([() => callTool('search_employees', { query: 'ACME006', limit: null }), () => answer(`Found ${SECRET_EMPLOYEE}.`)], { tools });
    const id = await h.conversation(ROHAN);
    await h.submit(id, 'Find ACME006', k, {}, ROHAN);
    return { h, id, k };
  }
  const assistantMessage = async (h: Awaited<ReturnType<typeof savedTurn>>['h'], id: string, principal: typeof ROHAN) =>
    (await h.service.read(principal, id)).messages.find((m) => m.role === 'assistant');

  const visible: [string, typeof ROHAN][] = [
    ['unchanged scope', ROHAN],
    ['broader scope', { ...ROHAN, countries: ['IN', 'US'], departments: ['Finance', 'Support', 'Tech'] }],
    ['Scoped HR promoted to Admin', { ...ROHAN, role: 'ADMIN' as never, countries: [], departments: [] }],
  ];
  for (const [label, principal] of visible) {
    test(`${label}: the saved answer is returned unchanged`, async () => {
      const { h, id } = await savedTurn();
      const message = await assistantMessage(h, id, principal);
      assert.equal(message?.text, `Found ${SECRET_EMPLOYEE}.`);
      assert.deepEqual(message?.response?.cards, savedCards());
      assert.deepEqual(message?.response?.limitations, ['Saved limitation.']);
      assert.equal((message as { withheld?: boolean } | undefined)?.withheld, false);
    });
  }

  const hidden: [string, typeof ROHAN][] = [
    ['narrower scope', { ...ROHAN, departments: ['Tech'] }],
    ['sideways scope', { ...ROHAN, departments: ['Finance', 'Tech'] }],
    ['empty scope', { ...ROHAN, countries: [], departments: [] }],
  ];
  for (const [label, principal] of hidden) {
    // Detects: a saved answer (prose, cards, aggregates) outliving a narrowed scope.
    test(`${label}: the whole assistant answer is withheld; the user's message stays; storage is unchanged`, async () => {
      const { h, id } = await savedTurn();
      const detail = await h.service.read(principal, id);
      const user = detail.messages.find((m) => m.role === 'user');
      const message = detail.messages.find((m) => m.role === 'assistant');
      assert.equal(user?.text, 'Find ACME006');
      assert.deepEqual([message?.text, message?.response, (message as { withheld?: boolean } | undefined)?.withheld], [WITHHELD, null, true]);
      assert.ok(!JSON.stringify(detail).includes('ACME00602'), 'nothing from the answer leaks');
      assert.ok(JSON.stringify(h.fake.messages).includes('ACME00602'), 'stored evidence is unchanged');
      assert.ok(JSON.stringify(h.fake.traces[0]?.finalResponse).includes('ACME00602'));
    });
  }

  test('Admin HR demoted to Scoped HR: answers recorded with Admin authority are withheld', async () => {
    const h = harness([() => answer(`Found ${SECRET_EMPLOYEE}.`)]);
    const admin = { ...ROHAN, role: 'ADMIN' as never, countries: [], departments: [] };
    const id = await h.conversation(admin);
    await h.submit(id, 'Find', key(), {}, admin);
    const full = { ...ROHAN, countries: ['IN', 'US'], departments: ['Finance', 'HR', 'Operations', 'Support', 'Tech'] };
    assert.equal((await assistantMessage(h, id, full))?.text, WITHHELD);
    assert.equal((await assistantMessage(h, id, admin))?.text, `Found ${SECRET_EMPLOYEE}.`);
  });

  // Detects: a trace recorded before snapshots existed being trusted.
  test('a legacy trace without a snapshot is withheld for Scoped HR and visible to Admin HR', async () => {
    const { h, id } = await savedTurn();
    Object.assign(h.fake.traces[0] ?? {}, { actorScope: null });
    assert.equal((await assistantMessage(h, id, ROHAN))?.text, WITHHELD);
    assert.equal((await assistantMessage(h, id, { ...ROHAN, role: 'ADMIN' as never, countries: [], departments: [] }))?.text, `Found ${SECRET_EMPLOYEE}.`);
  });

  test('the trace records the actor role and sorted scope sets, never the session', async () => {
    const h = harness([() => answer('ok')]);
    const unsorted = { ...ROHAN, countries: ['US', 'IN'], departments: ['Tech', 'Support'] };
    await h.submit(await h.conversation(unsorted), 'x', key(), {}, unsorted);
    assert.deepEqual((h.fake.traces[0] as { actorScope?: unknown } | undefined)?.actorScope, { role: 'SCOPED', countries: ['IN', 'US'], departments: ['Support', 'Tech'] });
    assert.ok(!JSON.stringify(h.fake.traces[0]).includes(ROHAN.sessionId));
  });

  // Detects: a withheld answer still reaching the model as history.
  test('a withheld turn is excluded from the next turn\'s model history', async () => {
    const { h, id } = await savedTurn();
    const narrowed = { ...ROHAN, departments: ['Tech'] };
    await h.submit(id, 'Next question', key(), {}, narrowed);
    const sent = JSON.stringify(h.fake.traces[1]?.modelMessages);
    assert.ok(!sent.includes('ACME00602') && !sent.includes('Find ACME006'), sent);
    await h.submit(id, 'Third question', key(), {}, ROHAN);
    assert.ok(JSON.stringify(h.fake.traces[2]?.modelMessages).includes('ACME00602'), 'unchanged scope keeps the turn in history');
  });

  // Detects: an idempotent replay returning an answer the caller may no longer see.
  test('a replay after the scope narrows returns the withheld state, with no new trace or model call', async () => {
    const { h, id, k } = await savedTurn();
    const calls = h.providerCalls();
    const { value, replayed } = await h.submit(id, 'Find ACME006', k, {}, { ...ROHAN, countries: ['US'] });
    assert.equal(replayed, true);
    assert.deepEqual([value.answer, value.cards, value.toolCalls, value.limitations, (value as { withheld?: boolean }).withheld], [WITHHELD, [], [], [], true]);
    assert.deepEqual([h.providerCalls(), h.fake.traces.length], [calls, 1]);
    const again = await h.submit(id, 'Find ACME006', k, {}, ROHAN);
    assert.equal(again.value.answer, `Found ${SECRET_EMPLOYEE}.`);
  });
});

describe('secrets and logs at the live persistence boundary', () => {
  // Detects: credentials stored with an otherwise useful trace.
  test('forbidden fields in prompts, rejected arguments, and results are redacted before storage', async () => {
    const tools = stubRegistry(() => ({ status: 'completed', result: { data: { ok: true, sessionToken: 'tok-123', nested: { password: 'p@ss' } }, cards: [], limitations: [] } }));
    const h = harness([() => rawCall('search_employees', '{"query":"x","authorization":"Bearer abc.def","cookie":"sid=1"}'), () => answer('ok')], { tools });
    await h.submit(await h.conversation(), 'my api_key is sk-test-not-real');
    const stored = JSON.stringify([h.fake.toolCalls, h.fake.modelCalls, h.fake.traces]);
    for (const secret of ['Bearer abc.def', 'sid=1', 'tok-123', 'p@ss']) assert.ok(!stored.includes(secret), secret);
    assert.deepEqual((h.fake.toolCalls[0]?.start as { arguments: unknown }).arguments, { query: 'x', authorization: '[REDACTED]', cookie: '[REDACTED]' });
    // Free text is recorded as typed (synthetic-data policy); the notice tells users not to enter secrets.
    assert.ok(stored.includes('sk-test-not-real'));
  });

  // Detects (Task 03a): malformed argument text bypassing key-based scrubbing.
  test('malformed tool arguments are stored as a fixed marker; their text appears nowhere and the tool never runs', async () => {
    const secrets = [
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'session=s3cr3t-cookie', 'hunter2-password', 'tok_live_123456',
      'sk-proj-notarealkey000', 'mysql://acme:dbpass@db.internal:3306/acme', 'hidden-reasoning-chain',
    ];
    const malformed = `{"query": "x", authorization: ${secrets[0]}; cookie: ${secrets[1]}; password=${secrets[2]}; token=${secrets[3]}; `
      + `api_key=${secrets[4]}; url=${secrets[5]}; <reasoning>${secrets[6]}</reasoning>`;
    const tools = stubRegistry();
    const h = harness([() => rawCall('search_employees', malformed), () => answer('Could not search.')], { tools });
    const { value } = await h.submit(await h.conversation(), 'Find x');
    assert.deepEqual(value.toolCalls, [{ name: 'search_employees', status: 'rejected' }]);
    assert.equal(tools.runs.length, 0, 'the tool never executes');
    const call = h.fake.toolCalls[0];
    assert.deepEqual([(call?.start as { arguments: unknown }).arguments, call?.status, (call?.finish as { validation: unknown }).validation],
      [{ invalidJson: true }, 'REJECTED', { reason: 'INVALID_ARGUMENTS', detail: 'INVALID_JSON' }]);
    assert.deepEqual((h.fake.modelCalls[0]?.finish as { decisions: unknown }).decisions, [{ callId: call ? (call.start as { providerToolCallId: string }).providerToolCallId : '', name: 'search_employees', arguments: { invalidJson: true } }]);
    const everywhere = JSON.stringify([h.fake.toolCalls, h.fake.modelCalls, h.fake.traces, h.fake.messages, value, h.logs]);
    for (const secret of secrets) assert.ok(!everywhere.includes(secret), secret);
  });

  test('logs contain identifiers, stages, and categories only', async () => {
    const h = harness([() => callTool('search_employees', { query: SECRET_NAME }), () => { throw new ModelFailure('provider_error'); }]);
    await assert.rejects(h.submit(await h.conversation(), `Tell me about ${SECRET_NAME}`));
    const text = JSON.stringify(h.logs);
    for (const secret of [SECRET_NAME, SECRET_SALARY, 'Tell me']) assert.ok(!text.includes(secret), secret);
    assert.deepEqual(h.logs.map((l) => l.event), ['assistant_tool', 'assistant_model_failure', 'assistant_trace_failure']);
  });

  test('the deprecated single-call path records a new conversation using only the final message', async () => {
    const h = harness([() => answer('Legacy.')]);
    const reply = await h.service.legacy(MEERA, 'Only this', 'req-legacy');
    assert.equal(reply.answer, 'Legacy.');
    assert.deepEqual(Object.keys(reply).sort(), ['answer', 'cards', 'generatedAt', 'limitations', 'toolCalls']);
    assert.equal(h.fake.conversations.size, 1);
    assert.deepEqual([h.fake.traces[0]?.status, h.fake.traces[0]?.modelMessages], ['COMPLETED', [{ role: 'user', content: 'Only this' }]]);
  });
});
