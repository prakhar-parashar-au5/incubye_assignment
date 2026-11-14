import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/http/app.js';
import { EXPIRES_AT, FAILING_TOKENS, FAKE_PASSWORD, FAKE_TOKEN, buildTestApp, fakeAuth } from './support/http.js';

const LOGIN = '/api/v1/auth/login';
const ME = '/api/v1/auth/me';
const LOGOUT = '/api/v1/auth/logout';

describe('application construction', () => {
  // Detects: a factory that opens a listener (tests would leak ports and hang).
  test('creating the app does not start a network listener', () => {
    const servers = () => process.getActiveResourcesInfo().filter((r) => r === 'TCPServerWrap').length;
    const before = servers();
    createApp({ auth: fakeAuth(), logger: () => undefined, clientIpSource: 'socket' });
    assert.equal(servers(), before);
  });

  // Detects: framework fingerprinting header left on.
  test('does not send X-Powered-By', async () => {
    const res = await request(buildTestApp().app).get('/health');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  // Detects: Express's default HTML 404 page instead of the public error shape.
  test('unknown routes return the standard JSON NOT_FOUND error', async () => {
    for (const [method, path] of [['get', '/nope'], ['get', LOGIN], ['delete', ME]] as const) {
      const res = await request(buildTestApp().app)[method](path);
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    }
  });

  // Detects: large bodies parsed into memory (cheap denial of service).
  test('rejects a JSON body above the limit with VALIDATION_ERROR', async () => {
    const res = await request(buildTestApp().app)
      .post(LOGIN)
      .send({ email: 'meera.iyer@acme.com', password: 'x'.repeat(20 * 1024) });
    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.' } });
  });

  // Detects: browser CORS access enabled by default.
  test('sends no CORS headers, even for a preflight request', async () => {
    const res = await request(buildTestApp().app)
      .options(LOGIN)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });
});

describe('GET /health', () => {
  // Detects: health output that leaks configuration or versions.
  test('returns exactly { status: "ok" }', async () => {
    const res = await request(buildTestApp().app).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
    assert.doesNotMatch(JSON.stringify(res.headers), /mysql|node|express|version/i);
  });
});

describe('POST /api/v1/auth/login validation', () => {
  const validation = { error: { code: 'VALIDATION_ERROR', message: 'Request is invalid.' } };

  test('accepts a valid email and password object', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD });
    assert.equal(res.status, 200);
  });

  // Detects: missing fields, wrong types, bad emails, or extra fields reaching sign-in.
  const invalidBodies: [string, unknown][] = [
    ['missing email', { password: FAKE_PASSWORD }],
    ['missing password', { email: 'meera.iyer@acme.com' }],
    ['non-string email', { email: 42, password: FAKE_PASSWORD }],
    ['non-string password', { email: 'meera.iyer@acme.com', password: ['x'] }],
    ['invalid email format', { email: 'not-an-email', password: FAKE_PASSWORD }],
    ['empty password', { email: 'meera.iyer@acme.com', password: '' }],
    ['unknown field', { email: 'meera.iyer@acme.com', password: FAKE_PASSWORD, role: 'ADMIN' }],
    ['array body', [{ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD }]],
  ];
  for (const [name, body] of invalidBodies) {
    test(`rejects ${name} with VALIDATION_ERROR`, async () => {
      const res = await request(buildTestApp().app).post(LOGIN).send(body as object);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, validation);
    });
  }

  // Detects: a body-parser SyntaxError leaking as a 500 or an HTML page.
  test('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).set('Content-Type', 'application/json').send('{"email": "x",');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, validation);
  });

  // Detects: a non-JSON body silently treated as empty credentials.
  test('rejects a non-JSON body with VALIDATION_ERROR', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).set('Content-Type', 'text/plain').send('email=meera');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, validation);
  });

  // Detects: submitted values echoed back to the caller.
  test('does not echo submitted values in the error response', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).send({ email: 'leak-check@not-valid', password: 'leak-check-pw' });
    assert.doesNotMatch(res.text, /leak-check/);
  });
});

describe('POST /api/v1/auth/login behaviour at the HTTP boundary', () => {
  // Detects: a login response that omits or renames contract fields.
  test('returns the token, ISO expiry, and user summary', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD });
    assert.deepEqual(res.body, {
      token: FAKE_TOKEN,
      expiresAt: '2026-11-14T12:00:00.000Z',
      user: { id: 1, displayName: 'Meera Iyer', email: 'meera.iyer@acme.com', role: 'ADMIN' },
    });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  // Detects: different public responses that reveal which part was wrong.
  test('wrong credentials return the generic INVALID_CREDENTIALS error', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
  });

  // Detects: Express setting a browser cookie (the Next.js server owns it).
  test('does not set a cookie', async () => {
    const res = await request(buildTestApp().app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD });
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

describe('authentication middleware (GET /api/v1/auth/me)', () => {
  const unauthenticated = { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } };

  // Detects: requests without a usable Bearer token reaching the handler.
  for (const [name, header] of [
    ['a missing Authorization header', undefined],
    ['a wrong authorization scheme', `Basic ${FAKE_TOKEN}`],
    ['an empty Bearer token', 'Bearer '],
    ['a Bearer token with extra parts', `Bearer ${FAKE_TOKEN} extra`],
  ] as const) {
    test(`rejects ${name}`, async () => {
      const call = request(buildTestApp().app).get(ME);
      const res = header === undefined ? await call : await call.set('Authorization', header);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, unauthenticated);
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    });
  }

  // Detects: internal reasons (SESSION_REVOKED, USER_INACTIVE, …) leaking to clients.
  test('every internal authentication failure returns the identical public body', async () => {
    const bodies = new Set<string>();
    for (const [token, reason] of Object.entries(FAILING_TOKENS)) {
      const res = await request(buildTestApp().app).get(ME).set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 401, reason);
      assert.doesNotMatch(res.text, new RegExp(reason));
      bodies.add(res.text);
    }
    assert.deepEqual([...bodies], [JSON.stringify(unauthenticated)]);
  });

  // Detects: a /me response built from the token instead of the loaded principal.
  test('returns the current user, scopes, and session expiry', async () => {
    const res = await request(buildTestApp().app).get(ME).set('Authorization', `Bearer ${FAKE_TOKEN}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      user: { id: 1, displayName: 'Meera Iyer', email: 'meera.iyer@acme.com', role: 'ADMIN', status: 'ACTIVE' },
      scope: { countries: [], departments: [] },
      session: { expiresAt: EXPIRES_AT.toISOString() },
    });
    assert.doesNotMatch(res.text, /sessionId|0b7e7a3c|password/);
  });
});

describe('POST /api/v1/auth/logout at the HTTP boundary', () => {
  // Detects: logout returning token or session data.
  test('returns 204 with no body for a valid token', async () => {
    const res = await request(buildTestApp().app).post(LOGOUT).set('Authorization', `Bearer ${FAKE_TOKEN}`);
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
  });

  // Detects: repeated logout failing (the client must be able to retry safely).
  test('returns 204 for an already revoked session', async () => {
    const res = await request(buildTestApp().app).post(LOGOUT).set('Authorization', 'Bearer token.revoked.session');
    assert.equal(res.status, 204);
  });

  test('returns UNAUTHENTICATED for a missing or invalid token', async () => {
    for (const header of [undefined, 'Bearer token.invalid.signature']) {
      const call = request(buildTestApp().app).post(LOGOUT);
      const res = header === undefined ? await call : await call.set('Authorization', header);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    }
  });
});

describe('request logging', () => {
  // Detects: secrets or bodies in logs; missing safe request fields.
  test('logs method, safe path, status, and duration, and never secrets or bodies', async () => {
    const { app, logs } = buildTestApp();
    await request(app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD });
    await request(app).post(`${LOGIN}?debug=leak-check-query`).send({ email: 'meera.iyer@acme.com', password: 'leak-check-wrong-pw' });
    await request(app).get(ME).set('Authorization', `Bearer ${FAKE_TOKEN}`).set('Cookie', 'session=leak-check-cookie');

    const text = JSON.stringify(logs);
    for (const secret of [FAKE_PASSWORD, FAKE_TOKEN, 'leak-check-wrong-pw', 'leak-check-cookie', 'leak-check-query', 'Bearer', 'meera.iyer@acme.com']) {
      assert.ok(!text.includes(secret), `log contains ${secret}`);
    }
    const requests = logs.filter((l) => l.event === 'request');
    assert.equal(requests.length, 3);
    for (const entry of requests) {
      assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'event', 'method', 'path', 'requestId', 'status']);
      assert.equal(typeof entry.durationMs, 'number');
    }
    assert.deepEqual(requests.map((l) => `${l.method} ${l.path} ${l.status}`), [
      `POST ${LOGIN} 200`,
      `POST ${LOGIN} 401`,
      `GET ${ME} 200`,
    ]);
  });

  // Detects: unexpected errors leaking internals to the client, or being logged with their message.
  test('maps an unexpected error to INTERNAL_ERROR and logs only its name and code', async () => {
    const failing = fakeAuth();
    failing.signIn = async () => {
      throw Object.assign(new Error("Duplicate entry 'leak-check-sql-value' for key"), { code: 'ER_DUP_ENTRY' });
    };
    const { app, logs } = buildTestApp({ auth: failing });
    const res = await request(app).post(LOGIN).send({ email: 'meera.iyer@acme.com', password: FAKE_PASSWORD });
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    assert.ok(!JSON.stringify(logs).includes('leak-check-sql-value'));
    const errorLog = logs.find((l) => l.event === 'request_error');
    assert.deepEqual(errorLog && { name: errorLog.errorName, code: errorLog.errorCode }, { name: 'Error', code: 'ER_DUP_ENTRY' });
  });
});
