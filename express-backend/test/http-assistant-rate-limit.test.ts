// Assistant request limit (review fix 08a): 20 requests per authenticated
// HR user per 15 minutes on POST /api/v1/assistant/messages only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { AuthenticationError } from '../src/access/sessions.js';
import type { AuthService, Principal } from '../src/access/sessions.js';
import { ASSISTANT_REQUEST_LIMIT, ASSISTANT_REQUEST_WINDOW_MS } from '../src/http/rate-limit.js';
import { ClockedMemoryStore } from '../src/http/rate-limit.js';
import { FAKE_TOKEN, MEERA, buildTestApp, fakeAuth } from './support/http.js';

const ASSISTANT = '/api/v1/assistant/messages';
const ROHAN_TOKEN = 'fake.jwt.token-for-rohan';
const ROHAN: Principal = { ...MEERA, hrUserId: 2, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };
const RATE_LIMITED = { error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Try again later.' } };

/** Fake auth with two users; any other token fails. */
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

function setup() {
  let offsetMs = 0;
  // The store clock follows real time plus an offset (express-rate-limit compares with Date.now()).
  const clock = () => new Date(Date.now() + offsetMs);
  const store = new ClockedMemoryStore(clock);
  const built = buildTestApp({ auth: twoUserAuth(), clock, assistantRateLimitStore: store });
  return { ...built, store, advance: (ms: number) => { offsetMs += ms; } };
}

const ask = (app: ReturnType<typeof setup>['app'], token: string | null, content = 'leak-check-question') => {
  const call = request(app).post(ASSISTANT).send({ messages: [{ role: 'user', content }] });
  return token === null ? call : call.set('Authorization', `Bearer ${token}`);
};

describe('assistant request limit', () => {
  // Detects: no limit (uncontrolled OpenAI cost), or a limit off by one.
  test('allows 20 requests per HR user per window, then returns the standard 429', async () => {
    assert.equal(ASSISTANT_REQUEST_LIMIT, 20);
    assert.equal(ASSISTANT_REQUEST_WINDOW_MS, 15 * 60 * 1000);
    const { app } = setup();
    for (let i = 0; i < 20; i += 1) {
      const res = await ask(app, FAKE_TOKEN);
      // No model is configured in the test app, so allowed requests answer 503.
      assert.equal(res.status, 503, `request ${i + 1}`);
    }
    const limited = await ask(app, FAKE_TOKEN);
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, RATE_LIMITED);
  });

  // Detects: a shared key (IP or global) letting one user exhaust everyone's allowance.
  test('each HR user has a separate allowance', async () => {
    const { app } = setup();
    for (let i = 0; i < 20; i += 1) await ask(app, FAKE_TOKEN);
    assert.equal((await ask(app, FAKE_TOKEN)).status, 429);
    assert.equal((await ask(app, ROHAN_TOKEN)).status, 503);
  });

  // Detects: a window that never resets, or resets early.
  test('the allowance returns after the 15-minute window', async () => {
    const { app, advance } = setup();
    for (let i = 0; i < 20; i += 1) await ask(app, FAKE_TOKEN);
    advance(ASSISTANT_REQUEST_WINDOW_MS - 1000);
    assert.equal((await ask(app, FAKE_TOKEN)).status, 429);
    advance(1000);
    assert.equal((await ask(app, FAKE_TOKEN)).status, 503);
  });

  // Detects: limiting before authentication (unauthenticated callers burning a user's
  // allowance) or keys built from IP, email, JWT, or client input.
  test('authenticates before limiting and keys only by the verified HR user ID', async () => {
    const { app, store } = setup();
    for (let i = 0; i < 30; i += 1) assert.equal((await ask(app, i % 2 === 0 ? null : 'forged-token')).status, 401);
    assert.deepEqual(store.keys(), []);
    const res = await request(app).post(ASSISTANT).set('Authorization', `Bearer ${FAKE_TOKEN}`)
      .send({ messages: [{ role: 'user', content: 'x' }], hrUserId: 2 });
    assert.equal(res.status, 400);
    assert.deepEqual(store.keys(), ['hr-user:1']);
  });

  // Detects: the cost limit applied to normal HR routes or MCP.
  test('directory, auth, and MCP routes stay available when the assistant limit is reached', async () => {
    const { app } = setup();
    for (let i = 0; i < 21; i += 1) await ask(app, FAKE_TOKEN);
    assert.equal((await ask(app, FAKE_TOKEN)).status, 429);
    const auth = { Authorization: `Bearer ${FAKE_TOKEN}` };
    for (let i = 0; i < 25; i += 1) assert.equal((await request(app).get('/api/v1/employees').set(auth)).status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(auth)).status, 200);
    assert.equal((await request(app).get('/api/v1/employee-directory/options').set(auth)).status, 200);
    const mcp = await request(app).post('/api/v1/mcp').set(auth).set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-06-18').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.notEqual(mcp.status, 429);
    assert.equal(mcp.status, 200);
  });

  // Detects: chat text, email, or token reaching logs or limiter state.
  test('neither logs nor limiter keys contain chat, email, or token', async () => {
    const { app, logs, store } = setup();
    for (let i = 0; i < 21; i += 1) await ask(app, FAKE_TOKEN);
    const text = JSON.stringify(logs) + JSON.stringify(store.keys());
    for (const secret of ['leak-check-question', MEERA.email, FAKE_TOKEN, 'Bearer']) assert.ok(!text.includes(secret), `contains ${secret}`);
    assert.equal(logs.filter((l) => l.event === 'request' && l.status === 429).length, 1);
  });
});
