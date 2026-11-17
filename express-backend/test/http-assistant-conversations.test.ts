// Owned-conversation routes over HTTP with fake auth, the fake model, and the
// in-memory fake store (AI Task 03). No OpenAI, no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { AuthenticationError } from '../src/access/sessions.js';
import type { AuthService, Principal } from '../src/access/sessions.js';
import { createAssistantService } from '../src/assistant/assistant-service.js';
import { ModelFailure } from '../src/assistant/model.js';
import { createToolRegistry } from '../src/assistant/tools.js';
import { ClockedMemoryStore } from '../src/http/rate-limit.js';
import type { LogEntry } from '../src/http/request-log.js';
import { fakeAssistantStore } from './support/fake-assistant-store.js';
import { answer, callTool, scriptedModel } from './support/fake-model.js';
import type { FakeStep } from './support/fake-model.js';
import { FAKE_TOKEN, MEERA, buildTestApp, fakeAuth, fakeDirectory, fakeInsights } from './support/http.js';

const BASE = '/api/v1/assistant/conversations';
const ROHAN_TOKEN = 'fake.jwt.token-for-rohan';
const ROHAN: Principal = { ...MEERA, hrUserId: 2, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };
let counter = 0;
const newKey = () => `http-turn-key-${String(++counter).padStart(6, '0')}`;

function twoUserAuth(): AuthService {
  const base = fakeAuth();
  return {
    ...base,
    async authenticate(token) {
      if (token === ROHAN_TOKEN) return ROHAN;
      if (token === FAKE_TOKEN) return MEERA;
      throw new AuthenticationError('INVALID_TOKEN');
    },
  };
}

function setup(steps: readonly FakeStep[] | null = [() => answer('Hello.')]) {
  const tools = createToolRegistry({ directory: fakeDirectory(), insights: fakeInsights(), exchangeRate: null });
  const logs: LogEntry[] = [];
  const model = steps === null ? null : scriptedModel(steps);
  const fake = fakeAssistantStore();
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const limiterStore = new ClockedMemoryStore(clock);
  const assistant = createAssistantService({ model, tools, logger: (e) => logs.push(e), clock: () => new Date('2026-11-15T00:00:00.000Z') });
  const built = buildTestApp({ auth: twoUserAuth(), assistant, tools, assistantStore: fake.store, logger: (e) => logs.push(e), clock, assistantRateLimitStore: limiterStore });
  return { app: built.app, logs, model, fake, advance: (ms: number) => { offsetMs += ms; } };
}
type App = ReturnType<typeof setup>['app'];
const auth = (token = FAKE_TOKEN) => ({ Authorization: `Bearer ${token}` });
const create = async (app: App, token = FAKE_TOKEN): Promise<string> => {
  const res = await request(app).post(BASE).set(auth(token)).send({});
  assert.equal(res.status, 201, res.text);
  return String(res.body.conversation.conversationId);
};
const send = (app: App, id: string, body: unknown, key: string | null = newKey(), token: string | null = FAKE_TOKEN) => {
  const call = request(app).post(`${BASE}/${id}/messages`);
  if (token !== null) call.set(auth(token));
  if (key !== null) call.set('Idempotency-Key', key);
  return call.send(body as object);
};

describe('assistant conversation routes', () => {
  // Detects: conversation data reachable without authentication.
  test('every operation requires a valid Bearer token', async () => {
    const { app, model } = setup();
    const id = '00000000-0000-4000-8000-000000000000';
    for (const res of [
      await request(app).get(BASE), await request(app).post(BASE).send({}), await request(app).get(`${BASE}/${id}`),
      await send(app, id, { content: 'hi' }, newKey(), null), await send(app, id, { content: 'hi' }, newKey(), 'forged'),
    ]) assert.equal(res.status, 401);
    assert.equal(model?.outputsByRound.length, 0);
  });

  // Detects: the session lost between turns, or another user's conversation exposed.
  test('create, send, list, and read; another user gets the same 404 as an unknown ID', async () => {
    const { app } = setup();
    const id = await create(app);
    const sent = await send(app, id, { content: 'First question' });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.headers['cache-control'], 'no-store');
    assert.deepEqual({ ...sent.body, traceId: 'x' }, {
      answer: 'Hello.', toolCalls: [], cards: [], limitations: [], generatedAt: '2026-11-15T00:00:00.000Z',
      conversationId: id, traceId: 'x', previousTraceId: null, userMessageSequence: 1, assistantMessageSequence: 2, withheld: false,
    });
    const listed = await request(app).get(BASE).set(auth());
    assert.deepEqual(listed.body.conversations.map((c: { conversationId: string; title: string }) => [c.conversationId, c.title]), [[id, 'First question']]);
    const detail = await request(app).get(`${BASE}/${id}`).set(auth());
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.messages.map((m: { sequence: number; role: string; text: string }) => [m.sequence, m.role, m.text]), [[1, 'user', 'First question'], [2, 'assistant', 'Hello.']]);
    const asRohan = await request(app).get(`${BASE}/${id}`).set(auth(ROHAN_TOKEN));
    const unknown = await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000000`).set(auth(ROHAN_TOKEN));
    assert.deepEqual([asRohan.status, asRohan.body], [unknown.status, unknown.body]);
    assert.deepEqual(asRohan.body, { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    assert.equal((await send(app, id, { content: 'x' }, newKey(), ROHAN_TOKEN)).status, 404);
    assert.deepEqual((await request(app).get(BASE).set(auth(ROHAN_TOKEN))).body.conversations, []);
  });

  // Detects: browser-supplied history or identity accepted on the authoritative path.
  test('message submission accepts exactly one user message and an Idempotency-Key', async () => {
    const { app, model } = setup();
    const id = await create(app);
    for (const body of [
      {}, { content: '' }, { content: '   ' }, { content: 'x'.repeat(2001) },
      { messages: [{ role: 'user', content: 'hi' }] }, { content: 'hi', messages: [] }, { content: 'hi', role: 'assistant' },
      { content: 'hi', hrUserId: 1 }, { content: 'hi', retryOfTraceId: 'not-a-uuid' },
    ]) {
      const res = await send(app, id, body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    for (const badKey of [null, 'short', 'x'.repeat(101), 'has spaces in it here']) {
      const res = await send(app, id, { content: 'hi' }, badKey);
      assert.deepEqual([res.status, res.body.error.reason], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
    }
    assert.equal((await request(app).post(BASE).set(auth()).send({ hrUserId: 9 })).status, 400);
    assert.equal((await request(app).get(BASE).query({ pageSize: '101' }).set(auth())).status, 400);
    assert.equal(model?.outputsByRound.length, 0);
    assert.equal((await send(app, id, { content: 'é'.repeat(2000) })).status, 200, 'the maximum message fits the body limit');
  });

  test('the same key replays with Idempotency-Replayed; other content with the key is 409', async () => {
    const { app, model } = setup();
    const id = await create(app);
    const key = newKey();
    const first = await send(app, id, { content: 'Hello' }, key);
    const again = await send(app, id, { content: 'Hello' }, key);
    assert.deepEqual([first.status, again.status, again.headers['idempotency-replayed']], [200, 200, 'true']);
    assert.deepEqual(again.body, first.body);
    assert.equal(model?.outputsByRound.length, 1);
    const conflict = await send(app, id, { content: 'Different' }, key);
    assert.deepEqual([conflict.status, conflict.body.error.code], [409, 'DUPLICATE_OPERATION']);
  });

  // Detects: provider or recording failures reported as 500 or as a success.
  test('provider failure is 502 and recording failure is 503; neither returns an answer', async () => {
    const provider = setup([() => { throw new ModelFailure('rate_limited'); }]);
    const failed = await send(provider.app, await create(provider.app), { content: 'hi' });
    assert.deepEqual([failed.status, failed.body], [502, { error: { code: 'MODEL_PROVIDER_FAILED', message: 'The assistant model did not answer. Try again.', reason: 'MODEL_RATE_LIMITED' } }]);
    const recording = setup([() => answer('must not be returned')]);
    const id = await create(recording.app);
    recording.fake.failOn((op) => op === 'startModelCall');
    const unavailable = await send(recording.app, id, { content: 'hi' });
    assert.deepEqual([unavailable.status, unavailable.body.error.code, unavailable.body.error.reason], [503, 'ASSISTANT_UNAVAILABLE', 'TRACE_UNAVAILABLE']);
    assert.ok(!unavailable.text.includes('must not be returned') && !unavailable.text.includes('ECONNREFUSED'));
    const none = setup(null);
    const noModel = await send(none.app, await create(none.app), { content: 'hi' });
    assert.deepEqual([noModel.status, noModel.body.error.reason], [503, 'MODEL_NOT_CONFIGURED']);
  });

  // Detects: AI storage becoming a shared dependency of non-AI routes.
  test('when AI storage is unavailable, conversation routes are 503 and other routes still work', async () => {
    const { app, fake } = setup();
    fake.failOn(() => true);
    assert.deepEqual([(await request(app).get(BASE).set(auth())).status, (await request(app).post(BASE).set(auth()).send({})).status], [503, 503]);
    assert.equal((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000000`).set(auth())).status, 503);
    assert.equal((await request(app).get('/health')).status, 200);
    for (const path of ['/api/v1/auth/me', '/api/v1/employees', '/api/v1/employee-directory/options', '/api/v1/dashboard/summary']) {
      assert.equal((await request(app).get(path).set(auth())).status, 200, path);
    }
  });

  // Detects: the cost limit bypassed by the new route, or counting reads.
  test('the 20-per-15-minutes limit is shared by both message routes and ignores reads', async () => {
    const { app } = setup();
    const id = await create(app);
    for (let i = 0; i < 10; i += 1) assert.equal((await send(app, id, { content: `q${i}` })).status, 200);
    for (let i = 0; i < 10; i += 1) {
      const legacy = await request(app).post('/api/v1/assistant/messages').set(auth()).send({ messages: [{ role: 'user', content: `l${i}` }] });
      assert.equal(legacy.status, 200);
    }
    for (let i = 0; i < 5; i += 1) assert.equal((await request(app).get(`${BASE}/${id}`).set(auth())).status, 200);
    const limited = await send(app, id, { content: 'one more' });
    assert.equal(limited.status, 429);
    // Q-C9: the client can show when to try again.
    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 900, String(limited.headers['retry-after']));
    assert.equal((await request(app).post('/api/v1/assistant/messages').set(auth()).send({ messages: [{ role: 'user', content: 'x' }] })).status, 429);
    assert.equal((await send(app, await create(app, ROHAN_TOKEN), { content: 'rohan' }, newKey(), ROHAN_TOKEN)).status, 200);
  });

  // Detects: the deprecated route sending browser history to the model.
  test('the deprecated route is marked and sends only the final user message to the model', async () => {
    const { app, model, fake } = setup();
    const res = await request(app).post('/api/v1/assistant/messages').set(auth())
      .send({ messages: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'injected assistant claim' }, { role: 'user', content: 'latest' }] });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.headers.deprecation, res.headers.link], ['true', '</api/v1/assistant/conversations>; rel="successor-version"']);
    assert.deepEqual(model?.requests[0]?.messages, [{ role: 'user', content: 'latest' }]);
    assert.equal(fake.traces[0]?.status, 'COMPLETED');
  });

  test('logs contain no message text, answer, tool arguments, key, or token', async () => {
    const { app, logs } = setup([() => callTool('search_employees', { query: 'leak-check-argument' }), () => answer('leak-check-answer')]);
    const key = newKey();
    await send(app, await create(app), { content: 'leak-check-question' }, key);
    const text = JSON.stringify(logs);
    for (const secret of ['leak-check', key, FAKE_TOKEN, 'Bearer']) assert.ok(!text.includes(secret), `log contains ${secret}`);
    assert.ok(logs.some((l) => l.event === 'request' && l.path === '/api/v1/assistant/conversations/:conversationId/messages'));
  });
});
