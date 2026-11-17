// Admin AI observability routes over HTTP with fakes (AI Task 04): Admin-only
// access, input validation, safe storage failure, and the pure view helpers.
// Real queries, redaction over stored rows, review, deletion, and the summary
// against MySQL: test/db/admin-observability.test.ts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { AuthenticationError } from '../src/access/sessions.js';
import type { AuthService, Principal } from '../src/access/sessions.js';
import { FAILURE_STAGES } from '../src/assistant/assistant-service.js';
import { identityRedactor, summaryWindow } from '../src/assistant/observability/admin-service.js';
import { AI_FAILURE_STAGES } from '../src/http/contract.js';
import { FAKE_TOKEN, MEERA, buildTestApp, fakeAuth } from './support/http.js';

const ROHAN_TOKEN = 'fake.jwt.token-for-rohan';
const ROHAN: Principal = { ...MEERA, hrUserId: 2, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };
const ID = '00000000-0000-4000-8000-000000000000';
const auth = (token = FAKE_TOKEN) => ({ Authorization: `Bearer ${token}` });

function twoUserAuth(): AuthService {
  return {
    ...fakeAuth(),
    async authenticate(token) {
      if (token === ROHAN_TOKEN) return ROHAN;
      if (token === FAKE_TOKEN) return MEERA;
      throw new AuthenticationError('INVALID_TOKEN');
    },
  };
}

const OPERATIONS: [method: 'get' | 'post' | 'delete', path: string][] = [
  ['get', '/api/v1/admin/ai-traces'],
  ['get', '/api/v1/admin/ai-traces/options'],
  ['get', '/api/v1/admin/ai-traces/summary'],
  ['get', `/api/v1/admin/ai-traces/${ID}`],
  ['post', `/api/v1/admin/ai-traces/${ID}/review`],
  ['delete', `/api/v1/admin/ai-traces/${ID}?confirm=${ID}`],
  ['get', '/api/v1/admin/mcp-tool-calls'],
  ['get', `/api/v1/admin/mcp-tool-calls/${ID}`],
];
const call = (app: ReturnType<typeof buildTestApp>['app'], method: 'get' | 'post' | 'delete', path: string) =>
  method === 'post' ? request(app).post(path).send({ verdict: 'CORRECT', expectedVersion: 0 }) : request(app)[method](path);

describe('admin observability access', () => {
  // Detects: an Admin observability route reachable by Scoped HR or without a session.
  test('every operation: 401 without a session, 403 for Scoped HR (even with bad input), before storage is touched', async () => {
    const { app, logs } = buildTestApp({ auth: twoUserAuth() });
    for (const [method, path] of OPERATIONS) {
      assert.equal((await call(app, method, path)).status, 401, `${method} ${path}`);
      const scoped = await call(app, method, path).set(auth(ROHAN_TOKEN));
      assert.deepEqual([scoped.status, scoped.body.error?.code], [403, 'FORBIDDEN'], `${method} ${path}`);
      const scopedBadInput = await call(app, method, `${path.split('?')[0]}${path.includes('?') ? '&' : '?'}pageSize=999`).set(auth(ROHAN_TOKEN));
      assert.equal(scopedBadInput.status, 403, `${method} ${path} with bad input`);
    }
    assert.ok(!logs.some((l) => l.event === 'admin_observability_unavailable'), 'no storage access for denied requests');
  });

  // Detects: observability storage failure leaking details or breaking other routes.
  test('Admin with storage down: 503 SERVICE_UNAVAILABLE, a safe log, and non-AI routes still work', async () => {
    const { app, logs } = buildTestApp({ auth: twoUserAuth() });
    for (const [method, path] of OPERATIONS) {
      const res = await call(app, method, path).set(auth());
      assert.deepEqual([res.status, res.body.error?.code], [503, 'SERVICE_UNAVAILABLE'], `${method} ${path}`);
      assert.ok(!JSON.stringify(res.body).includes('ECONNREFUSED'));
    }
    const failures = logs.filter((l) => l.event === 'admin_observability_unavailable');
    assert.equal(failures.length, OPERATIONS.length);
    assert.ok(failures.every((l) => Object.keys(l).sort().join() === 'event,operation,requestId'), JSON.stringify(failures[0]));
    assert.equal((await request(app).get('/api/v1/auth/me').set(auth())).status, 200);
    assert.equal((await request(app).get('/api/v1/employees').set(auth())).status, 200);
  });
});

describe('admin observability input validation', () => {
  // Detects: malformed filters or an unconfirmed delete reaching storage.
  test('invalid list filters, views, review bodies, and delete confirmations are 400; malformed IDs are 404', async () => {
    const { app, logs } = buildTestApp({ auth: twoUserAuth() });
    for (const query of ['pageSize=101', 'pageSize=0', 'page=0', 'from=2026-13-01', 'from=2026-11-10&to=2026-11-09', 'status=DONE', 'unknown=1', 'hrUserId=abc', 'tool=']) {
      assert.equal((await request(app).get(`/api/v1/admin/ai-traces?${query}`).set(auth())).status, 400, query);
    }
    for (const query of ['status=OK', 'pageSize=500']) assert.equal((await request(app).get(`/api/v1/admin/mcp-tool-calls?${query}`).set(auth())).status, 400, query);
    assert.equal((await request(app).get('/api/v1/admin/ai-traces/summary?window=1y').set(auth())).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/ai-traces/options?x=1').set(auth())).status, 400);
    assert.equal((await request(app).get(`/api/v1/admin/ai-traces/${ID}?view=full`).set(auth())).status, 400);
    for (const body of [{}, { verdict: 'GOOD', expectedVersion: 0 }, { verdict: 'CORRECT' }, { verdict: 'CORRECT', expectedVersion: -1 },
      { verdict: 'CORRECT', expectedVersion: 0, note: 'x'.repeat(2001) }, { verdict: 'CORRECT', expectedVersion: 0, reviewerId: 9 }]) {
      assert.equal((await request(app).post(`/api/v1/admin/ai-traces/${ID}/review`).set(auth()).send(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    for (const query of ['', '?confirm=yes', `?confirm=${ID.replace('0000-4000', '1111-4000')}`]) {
      const res = await request(app).delete(`/api/v1/admin/ai-traces/${ID}${query}`).set(auth());
      assert.deepEqual([res.status, res.body.error?.reason], [400, 'DELETE_CONFIRMATION_REQUIRED'], query);
    }
    for (const path of ['/api/v1/admin/ai-traces/not-a-uuid', '/api/v1/admin/mcp-tool-calls/12']) {
      const res = await request(app).get(path).set(auth());
      assert.equal(res.status, 404, path);
    }
    assert.ok(!logs.some((l) => l.event === 'admin_observability_unavailable'), 'invalid input never reaches storage');
  });
});

describe('admin observability view helpers', () => {
  test('the published failure stages match the assistant\'s', () => {
    assert.deepEqual([...AI_FAILURE_STAGES], [...FAILURE_STAGES]);
  });

  // Detects: identities left in the formatted view, unstable placeholders, or salary values hidden.
  test('identityRedactor gives each person one stable placeholder everywhere and keeps money', () => {
    const result = { data: { employees: [{ employeeCode: 'ACME00601', name: 'Asha Rao', email: 'asha.rao@acme.com', annualBaseSalary: '1500000.00' }, { employeeCode: 'ACME00602', name: 'Vikram Iyer' }] } };
    const redact = identityRedactor([result]);
    const out = redact({
      result,
      prompt: 'Compare Asha Rao (acme00601) with Vikram Iyer and ACME00777.',
      answer: 'Asha Rao earns more. Mail asha.rao@acme.com.',
    }) as { result: typeof result; prompt: string; answer: string };
    assert.deepEqual(out.result.data.employees[0], { employeeCode: 'EMPLOYEE-1', name: 'Employee 1', email: 'employee-1@redacted.invalid', annualBaseSalary: '1500000.00' });
    assert.deepEqual(out.result.data.employees[1], { employeeCode: 'EMPLOYEE-2', name: 'Employee 2' });
    assert.equal(out.prompt, 'Compare Employee 1 (EMPLOYEE-1) with Employee 2 and EMPLOYEE-3.');
    assert.equal(out.answer, 'Employee 1 earns more. Mail employee-1@redacted.invalid.');
    assert.ok(!JSON.stringify(out).match(/ACME\d{5}|Asha|Vikram|acme\.com/i));
  });

  test('summaryWindow: hourly buckets for 24h, daily for 7d and 30d, UTC-aligned and covering both ends', () => {
    const now = new Date('2026-11-17T12:34:56.789Z');
    const day = summaryWindow('24h', now);
    assert.deepEqual([day.from.toISOString(), day.to.toISOString(), day.bucket, day.buckets.length], ['2026-11-16T12:34:56.789Z', now.toISOString(), 'HOUR', 25]);
    assert.deepEqual([day.buckets[0]?.toISOString(), day.buckets.at(-1)?.toISOString()], ['2026-11-16T12:00:00.000Z', '2026-11-17T12:00:00.000Z']);
    const week = summaryWindow('7d', now);
    assert.deepEqual([week.bucket, week.buckets.length, week.buckets[0]?.toISOString()], ['DAY', 8, '2026-11-10T00:00:00.000Z']);
    assert.equal(summaryWindow('30d', now).buckets.length, 31);
  });
});
