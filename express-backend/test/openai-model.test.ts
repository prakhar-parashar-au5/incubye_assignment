// The OpenAI adapter with an injected `createResponse`. No network access:
// these tests check the request it builds and how it maps replies and errors.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import { ModelFailure } from '../src/assistant/model.js';
import type { ModelRequest } from '../src/assistant/model.js';
import { DEFAULT_OPENAI_MODEL, categorizeOpenAiError, createOpenAiModelAdapter } from '../src/assistant/openai-model.js';
import { TOOL_INPUT_SCHEMAS, strictFunctionParameters } from '../src/assistant/tool-schemas.js';

const REQUEST: ModelRequest = {
  instructions: 'test instructions',
  messages: [{ role: 'user', content: 'Who earns the most?' }],
  tools: [{ name: 'get_top_compensated_employees', description: 'top', parameters: strictFunctionParameters(TOOL_INPUT_SCHEMAS.get_top_compensated_employees) }],
};

/** The fields of a Response the adapter reads. The SDK adds output_text to real responses. */
function fakeResponse(output: unknown[], outputText = ''): Response {
  return { id: 'resp_test', object: 'response', output, output_text: outputText, error: null } as unknown as Response;
}

function recordingCreate(responses: (Response | Error)[]) {
  const bodies: ResponseCreateParamsNonStreaming[] = [];
  const options: { timeout: number; maxRetries: number }[] = [];
  return {
    bodies,
    options,
    create: async (body: ResponseCreateParamsNonStreaming, opts: { signal: AbortSignal; timeout: number; maxRetries: number }) => {
      // Deep copy: the adapter keeps appending to the same input array.
      bodies.push(structuredClone(body));
      options.push({ timeout: opts.timeout, maxRetries: opts.maxRetries });
      const next = responses.shift();
      if (next === undefined) throw new Error('no fake response left');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const signal = new AbortController().signal;

describe('OpenAI Responses adapter', () => {
  // Detects: a request that stores conversations, uses hosted tools, or non-strict schemas.
  test('sends a stateless Responses request with strict function tools only', async () => {
    const fake = recordingCreate([fakeResponse([], 'Hello.')]);
    const session = createOpenAiModelAdapter({ apiKey: 'test-only-not-a-key', createResponse: fake.create, callTimeoutMs: 1234 }).open(REQUEST);
    assert.deepEqual(await session.next([], signal), { kind: 'answer', text: 'Hello.' });
    const body = fake.bodies[0];
    assert.equal(body?.model, DEFAULT_OPENAI_MODEL);
    assert.equal(body?.store, false);
    assert.equal(body?.instructions, 'test instructions');
    assert.deepEqual(body?.input, [{ type: 'message', role: 'user', content: 'Who earns the most?' }]);
    assert.deepEqual(body?.tools?.map((t) => t.type), ['function']);
    const tool = body?.tools?.[0];
    assert.ok(tool && tool.type === 'function' && tool.strict === true && tool.name === 'get_top_compensated_employees');
    assert.deepEqual(fake.options, [{ timeout: 1234, maxRetries: 0 }]);
  });

  // Detects: tool outputs sent without call IDs, or model items not replayed (breaks reasoning models).
  test('maps function calls, then replays output items and sends tool outputs by call ID', async () => {
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_top_compensated_employees', arguments: '{"metric":"ANNUAL_CASH"}', status: 'completed' };
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
    const fake = recordingCreate([fakeResponse([reasoning, call]), fakeResponse([], 'Done.')]);
    const session = createOpenAiModelAdapter({ apiKey: 'test-only-not-a-key', createResponse: fake.create }).open(REQUEST);
    assert.deepEqual(await session.next([], signal), {
      kind: 'tool_calls',
      calls: [{ callId: 'call_1', name: 'get_top_compensated_employees', arguments: '{"metric":"ANNUAL_CASH"}' }],
    });
    await session.next([{ callId: 'call_1', output: '{"employees":[]}' }], signal);
    const input = fake.bodies[1]?.input;
    assert.ok(Array.isArray(input));
    assert.deepEqual(input.map((i) => (typeof i === 'object' && i !== null && 'type' in i ? i.type : 'message')), ['message', 'reasoning', 'function_call', 'function_call_output']);
    assert.deepEqual(input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{"employees":[]}' });
  });

  // Detects: an empty model reply treated as a valid answer.
  test('an empty reply is an invalid_response failure', async () => {
    const fake = recordingCreate([fakeResponse([], '   ')]);
    const session = createOpenAiModelAdapter({ apiKey: 'test-only-not-a-key', createResponse: fake.create }).open(REQUEST);
    await assert.rejects(session.next([], signal), (e: unknown) => e instanceof ModelFailure && e.category === 'invalid_response');
  });

  // Detects: provider failures surfacing with provider text, or the wrong category.
  test('SDK errors map to failure categories without provider text', async () => {
    const cases: [unknown, string][] = [
      [new APIConnectionTimeoutError(), 'timeout'],
      [new APIUserAbortError(), 'timeout'],
      [new RateLimitError(429, { message: 'leak-check-provider-text' }, 'leak-check-provider-text', new Headers()), 'rate_limited'],
      [new APIError(500, { message: 'leak-check-provider-text' }, 'leak-check-provider-text', new Headers()), 'provider_error'],
      [new TypeError('fetch failed'), 'provider_error'],
    ];
    for (const [error, category] of cases) {
      const failure = categorizeOpenAiError(error);
      assert.equal(failure.category, category);
      assert.ok(!failure.message.includes('leak-check'), failure.message);
    }
    const fake = recordingCreate([new RateLimitError(429, {}, 'x', new Headers())]);
    const session = createOpenAiModelAdapter({ apiKey: 'test-only-not-a-key', createResponse: fake.create }).open(REQUEST);
    await assert.rejects(session.next([], signal), (e: unknown) => e instanceof ModelFailure && e.category === 'rate_limited');
  });

  // Detects: constructing the adapter making a network call or requiring a real key.
  test('creating the real-SDK adapter and opening a session makes no request', () => {
    const adapter = createOpenAiModelAdapter({ apiKey: 'test-only-not-a-key' });
    assert.equal(typeof adapter.open(REQUEST).next, 'function');
  });
});
