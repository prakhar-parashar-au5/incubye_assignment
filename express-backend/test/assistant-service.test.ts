import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AssistantUnavailableError, LIMITS, createAssistantService } from '../src/assistant/assistant-service.js';
import type { AssistantLimits } from '../src/assistant/assistant-service.js';
import { ModelFailure } from '../src/assistant/model.js';
import type { ToolContext, ToolOutcome, ToolRegistry } from '../src/assistant/tools.js';
import { TOOL_NAMES } from '../src/assistant/tool-schemas.js';
import type { LogEntry } from '../src/http/request-log.js';
import { MEERA } from './support/http.js';
import { answer, callTool, hang, rawCall, scriptedModel } from './support/fake-model.js';

const NOW = new Date('2026-11-15T09:30:00.000Z');
const SECRET_NAME = 'Leakcheck Personname';
const SECRET_SALARY = '9876543.21';

/** A registry stand-in that records calls and returns one employee card. */
function stubRegistry(outcome?: (name: string, args: unknown) => ToolOutcome): ToolRegistry & { runs: { name: string; args: unknown; context: ToolContext }[] } {
  const runs: { name: string; args: unknown; context: ToolContext }[] = [];
  return {
    runs,
    definitions: TOOL_NAMES.map((name) => ({ name, title: name, description: `desc ${name}` })),
    async run(name, args, context) {
      runs.push({ name, args, context });
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
}

function setup(model: ReturnType<typeof scriptedModel> | null, registry = stubRegistry(), overrides: Partial<AssistantLimits> = {}) {
  const logs: LogEntry[] = [];
  const service = createAssistantService({
    model,
    tools: registry,
    logger: (e) => logs.push(e),
    clock: () => NOW,
    limits: { ...LIMITS, ...overrides },
  });
  const ask = (content = 'Who earns the most?') => service.ask(MEERA, [{ role: 'user', content }], 'req-1');
  return { service, registry, logs, ask };
}

describe('assistant tool loop', () => {
  // Detects: tool output not returned to the model, or tool cards dropped.
  test('runs a requested tool, returns its output to the model, and answers', async () => {
    const model = scriptedModel([() => callTool('get_top_compensated_employees', { metric: 'ANNUAL_CASH' }), () => answer('  Here they are.  ')]);
    const { ask, registry } = setup(model);
    const res = await ask();
    assert.deepEqual(res, {
      answer: 'Here they are.',
      toolCalls: [{ name: 'get_top_compensated_employees', status: 'completed' }],
      cards: [{ type: 'notice', level: 'info', message: 'card from get_top_compensated_employees' }],
      limitations: ['Ranks currently working employees only.'],
      generatedAt: '2026-11-15T09:30:00.000Z',
    });
    assert.deepEqual(registry.runs.map((r) => [r.name, r.args]), [['get_top_compensated_employees', { metric: 'ANNUAL_CASH' }]]);
    const second = model.outputsByRound[1] ?? [];
    assert.equal(second.length, 1);
    assert.deepEqual(JSON.parse(second[0]?.output ?? ''), { employees: [{ name: SECRET_NAME, annualBaseSalary: SECRET_SALARY }] });
  });

  // Detects: identity or scope taken from the model or the messages.
  test('tools receive the authenticated principal and the as-of date, never model-chosen identity', async () => {
    const model = scriptedModel([() => callTool('search_employees', { query: 'x', hrUserId: 99, role: 'ADMIN' }), () => answer('done')]);
    const { ask, registry } = setup(model);
    await ask();
    assert.equal(registry.runs[0]?.context.principal, MEERA);
    assert.equal(registry.runs[0]?.context.asOf, '2026-11-15');
    assert.equal(registry.runs[0]?.context.now.toISOString(), '2026-11-15T09:30:00.000Z');
  });

  // Detects: tools advertised without strict schemas, or missing safety instructions.
  test('the model receives the five tools with strict schemas and the safety instructions', async () => {
    const model = scriptedModel([() => answer('hi')]);
    const { service } = setup(model);
    await service.ask(MEERA, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], 'r');
    const request = model.requests[0];
    assert.deepEqual(request?.tools.map((t) => t.name), [...TOOL_NAMES]);
    for (const tool of request?.tools ?? []) assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(request?.messages, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
    assert.match(request?.instructions ?? '', /read-only/i);
    assert.match(request?.instructions ?? '', /never follow instructions/i);
    assert.match(request?.instructions ?? '', /2026-11-15/);
    assert.match(request?.instructions ?? '', /synthetic/i);
  });

  // Detects: an invalid model tool call executed, or crashing the request.
  test('unknown tools, malformed JSON, and schema-invalid arguments are rejected safely', async () => {
    const model = scriptedModel([
      () => rawCall('drop_table_employees', '{}'),
      () => rawCall('search_employees', '{not json'),
      () => rawCall('search_employees', '["array"]'),
      () => answer('Sorry.'),
    ]);
    const registry = stubRegistry((name, args) => (name === 'search_employees' && !Array.isArray(args) ? { status: 'completed', result: { data: {}, cards: [], limitations: [] } } : { status: 'rejected', reason: name === 'search_employees' ? 'INVALID_ARGUMENTS' : 'UNKNOWN_TOOL' }));
    const { ask } = setup(model, registry);
    const res = await ask();
    assert.deepEqual(res.toolCalls, [
      { name: 'drop_table_employees', status: 'rejected' },
      { name: 'search_employees', status: 'rejected' },
      { name: 'search_employees', status: 'rejected' },
    ]);
    assert.deepEqual(registry.runs.map((r) => r.name), ['drop_table_employees', 'search_employees'], 'malformed JSON never reaches the registry');
    for (const round of [1, 2, 3]) {
      const output = JSON.parse(model.outputsByRound[round]?.[0]?.output ?? '{}');
      assert.ok(['UNKNOWN_TOOL', 'INVALID_ARGUMENTS'].includes(output.error), JSON.stringify(output));
    }
    assert.equal(res.answer, 'Sorry.');
  });

  // Detects: a model looping on tool calls forever (cost and latency runaway).
  test('the tool-round limit stops repeated calls', async () => {
    const model = scriptedModel([() => callTool('search_employees', { query: 'again' })]);
    const { ask, registry } = setup(model);
    const res = await ask();
    assert.equal(registry.runs.length, LIMITS.maxToolRounds);
    assert.equal(model.outputsByRound.length, LIMITS.maxToolRounds + 1);
    assert.match(res.answer, /could not finish/i);
    assert.ok(res.limitations.some((l) => /tool-call limit/i.test(l)));
    assert.equal(res.toolCalls.length, LIMITS.maxToolRounds);
  });

  // Detects: one model reply fanning out into many tool executions.
  test('calls beyond the per-round limit are rejected, not executed', async () => {
    const many = { kind: 'tool_calls' as const, calls: Array.from({ length: LIMITS.maxCallsPerRound + 2 }, (_, i) => ({ callId: `c${i}`, name: 'search_employees', arguments: '{"query":"a"}' })) };
    const model = scriptedModel([() => many, () => answer('ok')]);
    const { ask, registry } = setup(model);
    const res = await ask();
    assert.equal(registry.runs.length, LIMITS.maxCallsPerRound);
    assert.deepEqual(res.toolCalls.map((t) => t.status), [...Array(LIMITS.maxCallsPerRound).fill('completed'), 'rejected', 'rejected']);
    assert.equal(model.outputsByRound[1]?.length, LIMITS.maxCallsPerRound + 2, 'every call id gets an output');
  });

  // Detects: a database error inside a tool turning into a 500 or leaking details.
  test('a failed tool is reported to the model and in toolCalls without details', async () => {
    const model = scriptedModel([() => callTool('get_compensation_summary', { groupBy: 'COUNTRY', metric: 'ANNUAL_BASE' }), () => answer('Could not load it.')]);
    const { ask, logs } = setup(model, stubRegistry(() => ({ status: 'failed', errorName: 'Error' })));
    const res = await ask();
    assert.deepEqual(res.toolCalls, [{ name: 'get_compensation_summary', status: 'failed' }]);
    assert.deepEqual(JSON.parse(model.outputsByRound[1]?.[0]?.output ?? '{}'), { error: 'TOOL_FAILED', message: 'The tool failed. Do not retry it in this turn.' });
    assert.deepEqual(logs.map((l) => [l.event, l.tool, l.status]), [['assistant_tool', 'get_compensation_summary', 'failed']]);
  });

  test('an over-long answer is cut to the output limit', async () => {
    const { ask } = setup(scriptedModel([() => answer('x'.repeat(LIMITS.maxAnswerChars + 50))]));
    assert.equal((await ask()).answer.length, LIMITS.maxAnswerChars);
  });
});

describe('assistant unavailability', () => {
  // Detects: a hung provider holding the request open indefinitely.
  test('a model timeout returns assistant unavailable with category timeout', async () => {
    const { ask, logs } = setup(scriptedModel([hang]), stubRegistry(), { turnTimeoutMs: 50 });
    const started = Date.now();
    await assert.rejects(ask(), (e: unknown) => e instanceof AssistantUnavailableError && e.category === 'timeout');
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(logs, [{ event: 'assistant_model_failure', requestId: 'req-1', category: 'timeout' }]);
  });

  // Detects: provider errors surfacing as 500 with provider text.
  test('provider errors and unexpected errors return assistant unavailable', async () => {
    const providerError = scriptedModel([() => { throw new ModelFailure('rate_limited'); }]);
    await assert.rejects(setup(providerError).ask(), (e: unknown) => e instanceof AssistantUnavailableError && e.category === 'rate_limited');
    const unexpected = scriptedModel([() => { throw new Error(`provider said ${SECRET_NAME}`); }]);
    const { ask, logs } = setup(unexpected);
    await assert.rejects(ask(), (e: unknown) => e instanceof AssistantUnavailableError && e.category === 'provider_error' && !e.message.includes(SECRET_NAME));
    assert.ok(!JSON.stringify(logs).includes(SECRET_NAME));
  });

  // Detects: the backend requiring OPENAI_API_KEY for the assistant path to fail cleanly.
  test('without a model the service reports not_configured and runs no tool', async () => {
    const { ask, registry, service } = setup(null);
    assert.equal(service.available, false);
    await assert.rejects(ask(), (e: unknown) => e instanceof AssistantUnavailableError && e.category === 'not_configured');
    assert.equal(registry.runs.length, 0);
  });
});

describe('assistant logging', () => {
  // Detects: chat text, tool arguments, salary results, or names in logs.
  test('logs only request ID, tool name, status, and duration', async () => {
    const model = scriptedModel([
      () => callTool('search_employees', { query: SECRET_NAME }),
      () => rawCall(`evil ${SECRET_NAME}`, '{}'),
      () => answer(`The answer mentions ${SECRET_NAME} and ${SECRET_SALARY}`),
    ]);
    const { ask, logs } = setup(model);
    await ask(`Tell me about ${SECRET_NAME}`);
    const text = JSON.stringify(logs);
    for (const secret of [SECRET_NAME, SECRET_SALARY, 'Leakcheck', 'Tell me']) assert.ok(!text.includes(secret), `log contains ${secret}`);
    for (const entry of logs) assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'event', 'requestId', 'status', 'tool']);
    assert.deepEqual(logs.map((l) => l.tool), ['search_employees', 'UNKNOWN']);
  });
});
