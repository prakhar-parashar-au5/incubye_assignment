// Review fix 11b: dashboard routes turn recognized database connectivity and
// lock-timeout failures into 503 SERVICE_UNAVAILABLE, and keep every other
// failure on the standard 500 INTERNAL_ERROR path. No SQL, URL, credential,
// stack trace, or query value reaches the body or the logs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import type { DashboardService } from '../src/dashboard/dashboard-service.js';
import { FAKE_TOKEN, buildTestApp, fakeDashboard } from './support/http.js';

const SECRET_SQL = "SELECT annual_base_salary FROM compensation_records WHERE employee_code = 'ACME00042'";
const SECRET_URL = 'mysql://acme:super-secret-password@db.internal:3306/acme';

/** An error shaped like mysql2's: a code, plus a message and stack full of sensitive text. */
function databaseError(code: string): Error {
  const error = new Error(`${code}: connect to ${SECRET_URL} failed while running ${SECRET_SQL}`);
  Object.assign(error, { code, errno: 2003, sql: SECRET_SQL, sqlMessage: `Access for ${SECRET_URL}` });
  error.stack = `Error: ${SECRET_SQL}\n    at Pool.query (${SECRET_URL})`;
  return error;
}

function failingDashboard(error: Error): DashboardService {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return { ...fakeDashboard(), summary: fail, breakdowns: fail, recentChanges: fail, withoutRecentAdjustment: fail };
}

const ENDPOINTS = [
  ['/api/v1/dashboard/summary', { department: 'Tech', periodDays: '30' }],
  ['/api/v1/dashboard/breakdowns', { breakdown: 'COUNTRY' }],
  ['/api/v1/dashboard/recent-changes', { periodDays: '90', page: '2' }],
  ['/api/v1/dashboard/without-recent-adjustment', { noAdjustmentMonths: '12' }],
] as const;

function assertNoSensitiveText(text: string): void {
  for (const secret of [SECRET_SQL, SECRET_URL, 'super-secret-password', 'ACME00042', 'SELECT', 'Pool.query', 'db.internal']) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
}

describe('dashboard database failures', () => {
  // Detects: connectivity or lock failures reported as 500, or details leaked.
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_LOCK_WAIT_TIMEOUT']) {
    test(`${code} becomes 503 SERVICE_UNAVAILABLE on every dashboard route`, async () => {
      const { app, logs } = buildTestApp({ dashboard: failingDashboard(databaseError(code)) });
      for (const [path, query] of ENDPOINTS) {
        const res = await request(app).get(path).query(query).set('Authorization', `Bearer ${FAKE_TOKEN}`);
        assert.equal(res.status, 503, `${path}: ${res.text}`);
        assert.deepEqual(res.body, { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Try again.' } });
        assert.equal(res.headers['cache-control'], 'no-store');
        assertNoSensitiveText(res.text);
      }
      assertNoSensitiveText(JSON.stringify(logs));
      assert.deepEqual(logs.map((l) => [l.event, l.status]), ENDPOINTS.map(() => ['request', 503]));
    });
  }

  // Detects: a broad catch that hides programming errors as "unavailable".
  test('an unrecognized error stays 500 INTERNAL_ERROR, logging only its class and code', async () => {
    for (const error of [new TypeError(`cannot read ${SECRET_SQL}`), databaseError('ER_PARSE_ERROR'), databaseError('ER_ACCESS_DENIED_ERROR')]) {
      const { app, logs } = buildTestApp({ dashboard: failingDashboard(error) });
      const res = await request(app).get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${FAKE_TOKEN}`);
      assert.equal(res.status, 500, res.text);
      assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
      assertNoSensitiveText(res.text);
      assertNoSensitiveText(JSON.stringify(logs));
      const logged = logs.find((l) => l.event === 'request_error');
      assert.deepEqual([logged?.errorName, logged?.errorCode], [error.name, 'code' in error ? (error as { code: string }).code : null]);
    }
  });
});
