// Salary adjustments over HTTP with real MySQL, real sessions, real locks.
// Employees are inserted per scenario (with reference data and salary bands
// from the seed's reference-data step), so expected values are exact.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

import { bootstrapHrUser, setDepartmentScopes, setHrUserStatus } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createSalaryAdjustmentService } from '../../src/compensation/salary-adjustment-service.js';
import { createPreviewTokens } from '../../src/compensation/preview-token.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { fakeDashboard, noModelAssistant } from '../support/http.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-demo-password';
const LEAK_NOTE = 'leak-check-note-text';

let pool: Pool;
let now = new Date('2026-11-15T10:00:00.000Z');
const clock = (): Date => now;
let logs: LogEntry[] = [];
let app: ReturnType<typeof createApp>;
const ids: Record<string, number> = {};
const tokens: Record<string, string> = {};

const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);

function buildApp() {
  const sessionTokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  const directory = createDirectoryService({ pool, exchangeRate: null, clock });
  return createApp({
    auth: createAuthService({ pool, tokens: sessionTokens, clock }),
    directory,
    ...noModelAssistant(directory),
    dashboard: fakeDashboard(),
    salaryAdjustments: createSalaryAdjustmentService({ pool, clock, previewTokens: createPreviewTokens({ signingKey: SIGNING_KEY, clock }) }),
    logger: (entry) => logs.push(entry),
    clientIpSource: 'socket',
  });
}

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.text);
  return String(res.body.token);
}
async function loginAll(): Promise<void> {
  for (const name of ['meera', 'priya', 'rohan', 'asha', 'vikram']) tokens[name] = await login(`${name}@acme.com`);
}

let codeSequence = 200;
/** Inserts an employee with one INITIAL_IMPORT record (or several records). */
async function employee(spec: {
  title?: string; level?: string; country?: 'IN' | 'US'; status?: string; hire?: string; end?: string | null;
  base?: string; bonus?: string; from?: string;
} = {}): Promise<string> {
  codeSequence += 1;
  const code = `ACME${String(codeSequence).padStart(5, '0')}`;
  const country = spec.country ?? 'IN';
  const [title] = await query('SELECT id FROM job_titles WHERE name = ? AND level = ?', [spec.title ?? 'Software Engineer', spec.level ?? 'MID']);
  const [result] = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date, employment_end_date)
     VALUES (?, 'Test', ?, ?, ?, ?, ?, ?, ?)`,
    [code, `Person${codeSequence}`, `test.${code.toLowerCase()}@acme.com`, must(title, 'title').id, country,
      spec.status ?? 'CURRENTLY_WORKING', spec.hire ?? '2020-01-01', spec.end ?? null],
  );
  const employeeId = (result as { insertId: number }).insertId;
  await pool.query(
    `INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'INITIAL_IMPORT')`,
    [employeeId, spec.base ?? '1500000.00', spec.bonus ?? '100000.00', country === 'IN' ? 'INR' : 'USD', country === 'IN' ? 'MONTHLY' : 'ANNUAL', spec.from ?? spec.hire ?? '2020-01-01'],
  );
  return code;
}

const records = async (code: string) => query(
  `SELECT c.version, c.annual_base_salary AS base, c.annual_bonus AS bonus, c.effective_from AS from_date, c.change_reason AS reason,
          c.change_note AS note, c.changed_by_hr_user_id AS changed_by, c.source_request_id AS source, c.previous_compensation_record_id AS previous_id
   FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE e.employee_code = ? ORDER BY c.version`, [code]);
const requestRows = async (code: string) => query(
  `SELECT r.status, r.decision_note, r.public_id FROM compensation_change_requests r JOIN employees e ON e.id = r.employee_id
   WHERE e.employee_code = ? ORDER BY r.id`, [code]);

type Command = { target: string; method: string; value: string; effectiveFrom: string; reason: string; note?: string | null };
const raise = (overrides: Partial<Command> = {}): Command => ({
  target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '10', effectiveFrom: '2026-11-15', reason: 'PERFORMANCE', ...overrides,
});
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const key = () => randomUUID();

const preview = (token: string, code: string, command: Command) =>
  request(app).post(`/api/v1/employees/${code}/salary-adjustments/preview`).set(auth(token)).send(command);
async function okPreview(token: string, code: string, command: Command) {
  const res = await preview(token, code, command);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const apply = (token: string, code: string, previewToken: string, command: Command, idempotencyKey: string | null = key()) => {
  const call = request(app).post(`/api/v1/employees/${code}/salary-adjustments`).set(auth(token));
  return (idempotencyKey === null ? call : call.set('Idempotency-Key', idempotencyKey)).send({ previewToken, adjustment: command });
};
const submit = (token: string, code: string, previewToken: string, command: Command, idempotencyKey: string = key()) =>
  request(app).post(`/api/v1/employees/${code}/salary-adjustment-requests`).set(auth(token)).set('Idempotency-Key', idempotencyKey)
    .send({ previewToken, adjustment: command });
const approve = (token: string, requestId: string, idempotencyKey: string = key()) =>
  request(app).post(`/api/v1/salary-adjustment-requests/${requestId}/approve`).set(auth(token)).set('Idempotency-Key', idempotencyKey).send({});
const cancel = (token: string, requestId: string, note: string | undefined, idempotencyKey: string = key()) =>
  request(app).post(`/api/v1/salary-adjustment-requests/${requestId}/cancel`).set(auth(token)).set('Idempotency-Key', idempotencyKey)
    .send(note === undefined ? {} : { note });

/** Scoped preview, then submission; returns the request ID. */
async function pendingRequest(code: string, command: Command = raise(), who = 'rohan'): Promise<string> {
  const p = await okPreview(tokens[who] ?? '', code, command);
  const res = await submit(tokens[who] ?? '', code, p.previewToken, command);
  assert.equal(res.status, 201, res.text);
  return String(res.body.request.requestId);
}

function errorOf(res: { status: number; body: { error?: { code: string; reason?: string } } }) {
  return [res.status, res.body.error?.code, res.body.error?.reason];
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  pool = createPool(DATABASE_URL, { connectionLimit: 8 });
  const connection = await openConnection(DATABASE_URL);
  try {
    await ensureReferenceData(connection);
  } finally {
    await connection.end();
  }
  ids.meera = await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  ids.priya = await bootstrapHrUser(pool, { email: 'priya@acme.com', displayName: 'Priya Admin', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  ids.rohan = await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  ids.asha = await bootstrapHrUser(pool, { email: 'asha@acme.com', displayName: 'Asha Scoped', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech'] });
  ids.vikram = await bootstrapHrUser(pool, { email: 'vikram@acme.com', displayName: 'Vikram Scoped', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech'] });
});
after(async () => {
  await pool?.end();
});
beforeEach(async () => {
  now = new Date('2026-11-15T10:00:00.000Z');
  logs = [];
  app = buildApp();
  if (tokens.meera === undefined) await loginAll();
});

describe('preview', () => {
  // Detects: a preview that writes, or wrong exact values.
  test('Admin preview returns exact values and DIRECT_APPLY, and writes nothing', async () => {
    const code = await employee();
    const before = await query('SELECT (SELECT COUNT(*) FROM compensation_records) AS c, (SELECT COUNT(*) FROM compensation_change_requests) AS r');
    const body = await okPreview(tokens.meera ?? '', code, raise({ note: '  Strong year.  ' }));
    assert.deepEqual({ ...body, previewToken: typeof body.previewToken }, {
      employee: { employeeCode: code, name: `Test Person${codeSequence}`, email: `test.${code.toLowerCase()}@acme.com`, department: 'Tech', jobTitle: 'Software Engineer', level: 'MID', country: 'IN', employmentStatus: 'CURRENTLY_WORKING' },
      adjustment: { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '10', effectiveFrom: '2026-11-15', reason: 'PERFORMANCE', note: 'Strong year.' },
      currency: 'INR',
      current: { compensationVersion: 1, state: 'CURRENT', effectiveFrom: '2020-01-01', annualBaseSalary: '1500000.00', annualBonus: '100000.00', annualCashCompensation: '1600000.00' },
      proposed: { annualBaseSalary: '1650000.00', annualBonus: '100000.00', annualCashCompensation: '1750000.00' },
      change: { amount: '150000.00', direction: 'INCREASE', percentage: '10.00', annualCashImpact: '150000.00' },
      salaryBand: { currency: 'INR', minAnnualBaseSalary: '1000000.00', maxAnnualBaseSalary: '2200000.00', maxAnnualBonus: '1000000.00', minPercentageIncrease: 1, maxPercentageIncrease: 200, minPercentageDecrease: 1, maxPercentageDecrease: 50 },
      validation: { valid: true },
      warnings: { futureChange: null, pendingRequestWillBecomeStale: false },
      expectedCompensationVersion: 1,
      confirmationMode: 'DIRECT_APPLY',
      previewToken: 'string',
      previewExpiresAt: '2026-11-15T10:05:00.000Z',
    });
    const afterCounts = await query('SELECT (SELECT COUNT(*) FROM compensation_records) AS c, (SELECT COUNT(*) FROM compensation_change_requests) AS r');
    assert.deepEqual(afterCounts, before);
  });

  test('Scoped HR preview returns SUBMIT_REQUEST', async () => {
    const code = await employee();
    assert.equal((await okPreview(tokens.rohan ?? '', code, raise())).confirmationMode, 'SUBMIT_REQUEST');
  });

  // Detects: hidden employees disclosed through preview, or LEFT employees adjustable.
  test('unknown and out-of-scope employees get identical 404s; LEFT is ineligible', async () => {
    const us = await employee({ country: 'US', title: 'Senior Accountant', level: 'SENIOR', base: '150000.00', bonus: '5000.00' });
    const outOfScope = await preview(tokens.rohan ?? '', us, raise());
    const unknown = await preview(tokens.rohan ?? '', 'ACME99999', raise());
    const malformed = await preview(tokens.rohan ?? '', 'nope', raise());
    for (const res of [outOfScope, unknown, malformed]) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Employee not found.' } });
    }
    const left = await employee({ status: 'LEFT', end: '2025-06-30' });
    const res = await preview(tokens.meera ?? '', left, raise());
    assert.deepEqual([res.status, res.body], [422, { error: { code: 'EMPLOYEE_INELIGIBLE', message: 'This employee is not eligible for a compensation adjustment.' } }]);
  });

  // Detects: invalid inputs mapped to the wrong public error, or band checks left to the frontend.
  test('invalid adjustments return VALIDATION_ERROR with a reason', async () => {
    const code = await employee();
    const zeroBonus = await employee({ bonus: '0.00' });
    const cases: [string, Command, string][] = [
      [code, raise({ value: '201' }), 'PERCENTAGE_RANGE'],
      [code, raise({ method: 'PERCENTAGE_DECREASE', value: '51' }), 'PERCENTAGE_RANGE'],
      [code, raise({ value: '5.5' }), 'PERCENTAGE_RANGE'],
      [code, raise({ method: 'FIXED_INCREASE', value: '1.001' }), 'INVALID_AMOUNT'],
      [code, raise({ method: 'REPLACEMENT', value: '1500000' }), 'NO_CHANGE'],
      [code, raise({ method: 'REPLACEMENT', value: '2200000.01' }), 'SALARY_BAND'],
      [code, raise({ method: 'PERCENTAGE_DECREASE', value: '50' }), 'SALARY_BAND'],
      [code, raise({ target: 'ANNUAL_BONUS', method: 'REPLACEMENT', value: '1000000.01' }), 'SALARY_BAND'],
      [zeroBonus, raise({ target: 'ANNUAL_BONUS' }), 'ZERO_BONUS_PERCENTAGE'],
      [code, raise({ effectiveFrom: '2026-11-14' }), 'PAST_EFFECTIVE_DATE'],
      [code, raise({ reason: 'CORRECTION' }), 'NOTE_REQUIRED'],
      [code, raise({ reason: 'CORRECTION', note: '   ' }), 'NOTE_REQUIRED'],
    ];
    for (const [employeeCode, command, reason] of cases) {
      const res = await preview(tokens.meera ?? '', employeeCode, command);
      assert.deepEqual(errorOf(res), [400, 'VALIDATION_ERROR', reason], JSON.stringify(command));
    }
    for (const bad of [{ ...raise(), extra: 1 }, { ...raise(), reason: 'INITIAL_IMPORT' }, { ...raise(), note: 'x'.repeat(2001) }, { ...raise(), effectiveFrom: '2026-13-01' }]) {
      assert.deepEqual(errorOf(await preview(tokens.meera ?? '', code, bad as Command)).slice(0, 2), [400, 'VALIDATION_ERROR']);
    }
    // Zero bonus accepts a fixed increase and a replacement.
    assert.equal((await okPreview(tokens.meera ?? '', zeroBonus, raise({ target: 'ANNUAL_BONUS', method: 'FIXED_INCREASE', value: '5000' }))).proposed.annualBonus, '5000.00');
  });

  test('missing authentication fails on every salary route', async () => {
    const code = await employee();
    const calls = [
      request(app).post(`/api/v1/employees/${code}/salary-adjustments/preview`).send(raise()),
      request(app).post(`/api/v1/employees/${code}/salary-adjustments`).send({}),
      request(app).post(`/api/v1/employees/${code}/salary-adjustment-requests`).send({}),
      request(app).get('/api/v1/salary-adjustment-requests'),
      request(app).get(`/api/v1/salary-adjustment-requests/${randomUUID()}`),
      request(app).post(`/api/v1/salary-adjustment-requests/${randomUUID()}/approve`).send({}),
      request(app).post(`/api/v1/salary-adjustment-requests/${randomUUID()}/cancel`).send({ note: 'x' }),
    ];
    for (const call of calls) assert.equal((await call).status, 401);
  });
});

describe('preview token', () => {
  // Detects: a confirmed change that differs from what was reviewed.
  test('rejects changed fields, an expired preview, and another actor', async () => {
    const code = await employee();
    const command = raise();
    const p = await okPreview(tokens.meera ?? '', code, command);
    for (const changed of [raise({ value: '11' }), raise({ effectiveFrom: '2026-11-16' }), raise({ reason: 'PROMOTION' }), raise({ note: 'added' }), raise({ target: 'ANNUAL_BONUS' })]) {
      assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p.previewToken, changed)), [400, 'VALIDATION_ERROR', 'PREVIEW_MISMATCH'], JSON.stringify(changed));
    }
    assert.deepEqual(errorOf(await apply(tokens.priya ?? '', code, p.previewToken, command)), [400, 'VALIDATION_ERROR', 'PREVIEW_INVALID']);
    const other = await employee();
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', other, p.previewToken, command)), [400, 'VALIDATION_ERROR', 'PREVIEW_INVALID']);
    now = new Date('2026-11-15T10:05:00.000Z');
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p.previewToken, command)), [400, 'VALIDATION_ERROR', 'PREVIEW_EXPIRED']);
    assert.equal((await records(code)).length, 1);
  });

  // Detects: a Scoped HR token used for direct apply, or an Admin token used as a request.
  test('the confirmation mode is bound to the role', async () => {
    const code = await employee();
    const scoped = await okPreview(tokens.rohan ?? '', code, raise());
    assert.deepEqual(errorOf(await apply(tokens.rohan ?? '', code, scoped.previewToken, raise())).slice(0, 2), [403, 'FORBIDDEN']);
    const admin = await okPreview(tokens.meera ?? '', code, raise());
    assert.deepEqual(errorOf(await submit(tokens.meera ?? '', code, admin.previewToken, raise())).slice(0, 2), [403, 'FORBIDDEN']);
  });
});

describe('Admin direct change', () => {
  // Detects: no version created, a mutable update, or missing actor and lineage.
  test('creates one immutable version with actor, previous record, and note', async () => {
    const code = await employee();
    const command = raise({ note: LEAK_NOTE });
    const p = await okPreview(tokens.meera ?? '', code, command);
    const res = await apply(tokens.meera ?? '', code, p.previewToken, command);
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(res.body, {
      employeeCode: code,
      compensation: {
        version: 2, annualBaseSalary: '1650000.00', annualBonus: '100000.00', annualCashCompensation: '1750000.00', currency: 'INR',
        payFrequency: 'MONTHLY', effectiveFrom: '2026-11-15', changeReason: 'PERFORMANCE', changeNote: LEAK_NOTE,
        changedBy: { displayName: 'Meera Iyer', email: 'meera@acme.com' }, sourceRequestId: null, recordedAt: '2026-11-15T10:00:00.000Z',
      },
    });
    const rows = await records(code);
    assert.equal(rows.length, 2);
    assert.deepEqual({ ...rows[0] }, { version: 1, base: '1500000.00', bonus: '100000.00', from_date: '2020-01-01', reason: 'INITIAL_IMPORT', note: null, changed_by: null, source: null, previous_id: null });
    assert.deepEqual([rows[1]?.version, rows[1]?.changed_by, rows[1]?.source, rows[1]?.note], [2, ids.meera, null, LEAK_NOTE]);
    assert.ok(rows[1]?.previous_id !== null);
    // Today's change is current today.
    const detail = await request(app).get(`/api/v1/employees/${code}`).set(auth(tokens.meera ?? ''));
    assert.deepEqual([detail.body.compensation.version, detail.body.compensation.state, detail.body.compensationHistory.length], [2, 'CURRENT', 2]);
  });

  // Detects: a bonus change that alters base salary or the reverse.
  test('a direct bonus change keeps base salary', async () => {
    const code = await employee();
    const command = raise({ target: 'ANNUAL_BONUS', method: 'FIXED_DECREASE', value: '25000.50' });
    const p = await okPreview(tokens.meera ?? '', code, command);
    assert.equal((await apply(tokens.meera ?? '', code, p.previewToken, command)).status, 201);
    assert.deepEqual(await records(code).then((r) => [r[1]?.base, r[1]?.bonus]), ['1500000.00', '74999.50']);
  });

  // Detects: a retried confirmation creating a second version.
  test('a duplicate confirmation returns the original result and creates one version', async () => {
    const code = await employee();
    const command = raise();
    const p = await okPreview(tokens.meera ?? '', code, command);
    const idempotencyKey = key();
    const first = await apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey);
    const second = await apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey);
    assert.deepEqual([first.status, second.status], [201, 201]);
    assert.deepEqual(second.body, first.body);
    assert.equal(second.headers['idempotency-replayed'], 'true');
    assert.equal((await records(code)).length, 2);
    // Same key, different command: conflict, no write.
    const otherCommand = raise({ value: '5' });
    const p2 = await okPreview(tokens.meera ?? '', code, otherCommand);
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p2.previewToken, otherCommand, idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: two simultaneous retries of one confirmation both writing (the lock serializes them).
  test('two concurrent identical confirmations with one key create one version', async () => {
    const code = await employee();
    const command = raise();
    const p = await okPreview(tokens.meera ?? '', code, command);
    const idempotencyKey = key();
    const results = await Promise.all([1, 2, 3].map(() => apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey)));
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201]);
    assert.equal(new Set(results.map((r) => JSON.stringify(r.body))).size, 1);
    assert.equal(results.filter((r) => r.headers['idempotency-replayed'] === 'true').length, 2);
    assert.equal((await records(code)).length, 2);
  });

  // Review fix 09a. Detects: replay decided by outcome instead of command.
  // Both previews are made against version 1, so only the method differs.
  test('same key, different method with the same rounded outcome: conflict', async () => {
    const code = await employee();
    const percent = raise({ method: 'PERCENTAGE_INCREASE', value: '10' });
    const fixed = raise({ method: 'FIXED_INCREASE', value: '150000' });
    const pPercent = await okPreview(tokens.meera ?? '', code, percent);
    const pFixed = await okPreview(tokens.meera ?? '', code, fixed);
    assert.equal(pPercent.proposed.annualBaseSalary, pFixed.proposed.annualBaseSalary);
    const idempotencyKey = key();
    assert.equal((await apply(tokens.meera ?? '', code, pPercent.previewToken, percent, idempotencyKey)).status, 201);
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, pFixed.previewToken, fixed, idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: two different inputs that round to one amount treated as one command.
  test('same key, different input with the same rounded outcome: conflict', async () => {
    // Bonus 0.03: +20% = 0.036 and +30% = 0.039 both round to 0.04.
    const code = await employee({ bonus: '0.03' });
    const twenty = raise({ target: 'ANNUAL_BONUS', value: '20' });
    const thirty = raise({ target: 'ANNUAL_BONUS', value: '30' });
    const p20 = await okPreview(tokens.meera ?? '', code, twenty);
    const p30 = await okPreview(tokens.meera ?? '', code, thirty);
    assert.deepEqual([p20.proposed.annualBonus, p30.proposed.annualBonus], ['0.04', '0.04']);
    const idempotencyKey = key();
    assert.equal((await apply(tokens.meera ?? '', code, p20.previewToken, twenty, idempotencyKey)).status, 201);
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p30.previewToken, thirty, idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: a replay that fails once the preview has expired, or a normalized-equal input treated as different.
  test('same key and exact command replays the original result, even after the preview expired', async () => {
    const code = await employee();
    const command = raise({ method: 'FIXED_INCREASE', value: '150000', note: '  same note ' });
    const p = await okPreview(tokens.meera ?? '', code, command);
    const idempotencyKey = key();
    const first = await apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey);
    assert.equal(first.status, 201);
    now = new Date('2026-11-15T10:06:00.000Z');
    // "150000.00" and "same note" normalize to the same command as "150000" and "  same note ".
    const replay = await apply(tokens.meera ?? '', code, p.previewToken, { ...command, value: '150000.00', note: 'same note' }, idempotencyKey);
    assert.deepEqual([replay.status, replay.headers['idempotency-replayed'], replay.body], [201, 'true', first.body]);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: plain-text command data stored, a missing fingerprint on direct records,
  // or a fingerprint on imported and approved records.
  test('direct records store only a SHA-256 fingerprint; imports and approvals store none', async () => {
    const code = await employee();
    const command = raise({ note: LEAK_NOTE });
    const p = await okPreview(tokens.meera ?? '', code, command);
    const idempotencyKey = key();
    assert.equal((await apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey)).status, 201);
    const rows = await query(
      `SELECT c.version, c.operation_fingerprint AS fp FROM compensation_records c JOIN employees e ON e.id = c.employee_id
       WHERE e.employee_code = ? ORDER BY c.version`, [code]);
    assert.equal(rows[0]?.fp, null);
    const fingerprint = String(rows[1]?.fp);
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    for (const text of ['1650000', '1500000', LEAK_NOTE, 'leak-check', p.previewToken, idempotencyKey, code, 'PERFORMANCE']) {
      assert.ok(!fingerprint.includes(text), `fingerprint contains ${text.slice(0, 20)}`);
    }
    const approvedCode = await employee();
    assert.equal((await approve(tokens.meera ?? '', await pendingRequest(approvedCode))).status, 200);
    const [approved] = await query(
      `SELECT c.operation_fingerprint AS fp FROM compensation_records c JOIN employees e ON e.id = c.employee_id
       WHERE e.employee_code = ? AND c.version = 2`, [approvedCode]);
    assert.equal(approved?.fp, null);
  });

  // Detects: USD compensation adjusted with the India band, or currency and pay frequency changed.
  test('a US employee direct adjustment keeps USD and uses the US salary band', async () => {
    const code = await employee({ country: 'US', title: 'Senior Accountant', level: 'SENIOR', base: '150000.00', bonus: '5000.00' });
    const command = raise({ value: '10' });
    const p = await okPreview(tokens.meera ?? '', code, command);
    assert.deepEqual([p.currency, p.employee.country, p.proposed.annualBaseSalary, p.proposed.annualCashCompensation], ['USD', 'US', '165000.00', '170000.00']);
    assert.deepEqual(p.salaryBand, {
      currency: 'USD', minAnnualBaseSalary: '120000.00', maxAnnualBaseSalary: '190000.00', maxAnnualBonus: '10000.00',
      minPercentageIncrease: 1, maxPercentageIncrease: 200, minPercentageDecrease: 1, maxPercentageDecrease: 50,
    });
    const res = await apply(tokens.meera ?? '', code, p.previewToken, command);
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(
      [res.body.compensation.currency, res.body.compensation.payFrequency, res.body.compensation.annualBaseSalary, res.body.compensation.annualBonus],
      ['USD', 'ANNUAL', '165000.00', '5000.00'],
    );
    // The US band, not the India one, limits the next change.
    assert.deepEqual(errorOf(await preview(tokens.meera ?? '', code, raise({ method: 'REPLACEMENT', value: '190000.01' }))), [400, 'VALIDATION_ERROR', 'SALARY_BAND']);
    assert.deepEqual(errorOf(await preview(tokens.meera ?? '', code, raise({ target: 'ANNUAL_BONUS', method: 'REPLACEMENT', value: '10000.01' }))), [400, 'VALIDATION_ERROR', 'SALARY_BAND']);
    assert.equal((await okPreview(tokens.meera ?? '', code, raise({ method: 'REPLACEMENT', value: '190000' }))).proposed.annualBaseSalary, '190000.00');
  });

  test('an Idempotency-Key is required', async () => {
    const code = await employee();
    const p = await okPreview(tokens.meera ?? '', code, raise());
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p.previewToken, raise(), null)), [400, 'VALIDATION_ERROR', 'IDEMPOTENCY_KEY_REQUIRED']);
    assert.deepEqual(errorOf(await apply(tokens.meera ?? '', code, p.previewToken, raise(), 'short')), [400, 'VALIDATION_ERROR', 'IDEMPOTENCY_KEY_REQUIRED']);
  });

  // Detects: a lost update between two concurrent Admin changes.
  test('two concurrent direct changes against one version: one success, one stale conflict', async () => {
    const code = await employee();
    const a = raise({ value: '10' });
    const b = raise({ value: '20' });
    const pa = await okPreview(tokens.meera ?? '', code, a);
    const pb = await okPreview(tokens.priya ?? '', code, b);
    const results = await Promise.all([apply(tokens.meera ?? '', code, pa.previewToken, a), apply(tokens.priya ?? '', code, pb.previewToken, b)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'STALE_VERSION');
    assert.equal((await records(code)).length, 2);
    // A fresh preview is required, and it is not confirmed automatically.
    const loser = results[0]?.status === 409 ? 'meera' : 'priya';
    const fresh = await okPreview(tokens[loser] ?? '', code, loser === 'meera' ? a : b);
    assert.equal(fresh.expectedCompensationVersion, 2);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: a pending request left applicable after compensation changed.
  test('a direct change makes the pending request stale', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    const p = await okPreview(tokens.meera ?? '', code, raise({ value: '5' }));
    assert.equal(p.warnings.pendingRequestWillBecomeStale, true);
    assert.equal((await apply(tokens.meera ?? '', code, p.previewToken, raise({ value: '5' }))).status, 201);
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', 'Compensation changed after this request was created.']]);
    assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [409, 'REQUEST_NOT_PENDING']);
  });

  // Detects: compensation committed while the stale update failed (or the reverse).
  test('compensation and the stale update roll back together', async () => {
    const code = await employee();
    await pendingRequest(code);
    const p = await okPreview(tokens.meera ?? '', code, raise({ value: '5' }));
    // Test-only failure: only rows marked stale at or after 10:00:01 fail, so earlier rows pass the ALTER.
    now = new Date('2026-11-15T10:00:01.000Z');
    await pool.query("ALTER TABLE compensation_change_requests ADD CONSTRAINT test_only_fail_stale CHECK (status <> 'STALE' OR decided_at < '2026-11-15 10:00:01.000')");
    try {
      const res = await apply(tokens.meera ?? '', code, p.previewToken, raise({ value: '5' }));
      assert.equal(res.status, 500);
    } finally {
      await pool.query('ALTER TABLE compensation_change_requests DROP CHECK test_only_fail_stale');
    }
    assert.equal((await records(code)).length, 1);
    assert.deepEqual((await requestRows(code)).map((r) => r.status), ['PENDING']);
  });

  test('Scoped HR cannot call direct apply', async () => {
    const code = await employee();
    const p = await okPreview(tokens.meera ?? '', code, raise());
    assert.deepEqual(errorOf(await apply(tokens.rohan ?? '', code, p.previewToken, raise())).slice(0, 2), [403, 'FORBIDDEN']);
    assert.equal((await records(code)).length, 1);
  });
});

describe('Scoped HR requests', () => {
  // Detects: a request that writes compensation, or a duplicate request on retry.
  test('creates one pending request and no compensation; a retry returns the same request', async () => {
    const code = await employee();
    const command = raise({ note: LEAK_NOTE });
    const p = await okPreview(tokens.rohan ?? '', code, command);
    const idempotencyKey = key();
    const first = await submit(tokens.rohan ?? '', code, p.previewToken, command, idempotencyKey);
    const second = await submit(tokens.rohan ?? '', code, p.previewToken, command, idempotencyKey);
    assert.deepEqual([first.status, second.status], [201, 201]);
    assert.deepEqual(second.body, first.body);
    const view = first.body.request;
    assert.deepEqual({ ...view, requestId: typeof view.requestId }, {
      requestId: 'string', status: 'PENDING',
      employee: { employeeCode: code, name: `Test Person${codeSequence}`, email: `test.${code.toLowerCase()}@acme.com`, department: 'Tech', jobTitle: 'Software Engineer', level: 'MID', country: 'IN', employmentStatus: 'CURRENTLY_WORKING' },
      requestedBy: { displayName: 'Rohan Mehta', email: 'rohan@acme.com' },
      adjustment: { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: '10', currency: 'INR', previousValue: '1500000.00', proposedValue: '1650000.00', effectiveFrom: '2026-11-15', reason: 'PERFORMANCE', note: LEAK_NOTE },
      requestedAgainstVersion: 1, createdAt: '2026-11-15T10:00:00.000Z', decidedBy: null, decidedAt: null, decisionNote: null, resultingCompensationVersion: null,
    });
    assert.equal((await records(code)).length, 1);
    assert.equal((await requestRows(code)).length, 1);
  });

  // Review fix 09a: checks whether request idempotency has the direct-change defect.
  // Requests store every command field, so a different method with the same outcome must conflict.
  test('request: same key, different method with the same rounded outcome is a duplicate operation', async () => {
    const code = await employee();
    const percent = raise({ value: '10' });
    const p = await okPreview(tokens.rohan ?? '', code, percent);
    const idempotencyKey = key();
    assert.equal((await submit(tokens.rohan ?? '', code, p.previewToken, percent, idempotencyKey)).status, 201);
    const fixed = raise({ method: 'FIXED_INCREASE', value: '150000' });
    assert.deepEqual(errorOf(await submit(tokens.rohan ?? '', code, p.previewToken, fixed, idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.equal((await requestRows(code)).length, 1);
  });

  test('a second pending request for the same employee is rejected', async () => {
    const code = await employee();
    await pendingRequest(code);
    const res = await preview(tokens.asha ?? '', code, raise({ value: '5' }));
    assert.deepEqual(errorOf(res).slice(0, 2), [409, 'PENDING_REQUEST_EXISTS']);
  });

  test('Scoped HR cannot request an out-of-scope employee', async () => {
    const support = await employee({ title: 'Support Specialist' });
    const p = await okPreview(tokens.rohan ?? '', support, raise());
    // Asha's scope is Tech only.
    assert.equal((await preview(tokens.asha ?? '', support, raise())).status, 404);
    assert.equal((await submit(tokens.asha ?? '', support, p.previewToken, raise())).status, 404);
  });

  test('Scoped HR cannot approve or cancel any request, including their own', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    assert.deepEqual(errorOf(await approve(tokens.rohan ?? '', requestId)).slice(0, 2), [403, 'FORBIDDEN']);
    assert.deepEqual(errorOf(await cancel(tokens.rohan ?? '', requestId, 'no')).slice(0, 2), [403, 'FORBIDDEN']);
    assert.deepEqual(errorOf(await approve(tokens.asha ?? '', requestId)).slice(0, 2), [403, 'FORBIDDEN']);
    assert.deepEqual((await requestRows(code)).map((r) => r.status), ['PENDING']);
  });

  // Detects: request visibility by requester instead of current scope, or leaks outside scope.
  test('Scoped HR sees requests for employees in scope, including other requesters, and nothing else', async () => {
    const tech = await employee();
    const support = await employee({ title: 'Support Specialist' });
    const byAsha = await pendingRequest(tech, raise(), 'asha');
    const byRohan = await pendingRequest(support, raise(), 'rohan');
    const rohanList = await request(app).get('/api/v1/salary-adjustment-requests').query({ pageSize: '100' }).set(auth(tokens.rohan ?? ''));
    const rohanIds = rohanList.body.requests.map((r: { requestId: string }) => r.requestId);
    assert.ok(rohanIds.includes(byAsha) && rohanIds.includes(byRohan));
    const ashaList = await request(app).get('/api/v1/salary-adjustment-requests').query({ pageSize: '100' }).set(auth(tokens.asha ?? ''));
    const ashaIds = ashaList.body.requests.map((r: { requestId: string }) => r.requestId);
    assert.ok(ashaIds.includes(byAsha) && !ashaIds.includes(byRohan));
    for (const r of ashaList.body.requests) assert.equal(r.employee.department, 'Tech');
    const hidden = await request(app).get(`/api/v1/salary-adjustment-requests/${byRohan}`).set(auth(tokens.asha ?? ''));
    const unknown = await request(app).get(`/api/v1/salary-adjustment-requests/${randomUUID()}`).set(auth(tokens.asha ?? ''));
    for (const res of [hidden, unknown]) assert.deepEqual([res.status, res.body], [404, { error: { code: 'NOT_FOUND', message: 'Salary change request not found.' } }]);
    assert.equal((await request(app).get(`/api/v1/salary-adjustment-requests/${byAsha}`).set(auth(tokens.rohan ?? ''))).status, 200);
  });
});

describe('approval and cancellation', () => {
  // Detects: approval writing different values than requested, or the requester recorded as the actor.
  test('approval creates the exact requested version, with the approving Admin as actor', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code, raise({ value: '7', note: LEAK_NOTE }));
    const res = await approve(tokens.meera ?? '', requestId);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.request.status, 'APPROVED');
    assert.deepEqual(res.body.request.decidedBy, { displayName: 'Meera Iyer', email: 'meera@acme.com' });
    assert.equal(res.body.request.resultingCompensationVersion, 2);
    assert.deepEqual([res.body.compensation.annualBaseSalary, res.body.compensation.sourceRequestId, res.body.compensation.changedBy.displayName], ['1605000.00', requestId, 'Meera Iyer']);
    const rows = await records(code);
    assert.deepEqual([rows.length, rows[1]?.base, rows[1]?.changed_by, rows[1]?.note], [2, '1605000.00', ids.meera, LEAK_NOTE]);
    const [stored] = await query('SELECT requested_by_hr_user_id AS requester FROM compensation_change_requests WHERE public_id = ?', [requestId]);
    assert.equal(stored?.requester, ids.rohan);
  });

  // Detects: a retried approval creating a second version.
  test('repeated approval returns the original result; another Admin gets a conflict', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    const idempotencyKey = key();
    const first = await approve(tokens.meera ?? '', requestId, idempotencyKey);
    const second = await approve(tokens.meera ?? '', requestId, idempotencyKey);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.deepEqual(second.body, first.body);
    assert.deepEqual(errorOf(await approve(tokens.priya ?? '', requestId)).slice(0, 2), [409, 'REQUEST_NOT_PENDING']);
    assert.equal((await records(code)).length, 2);
  });

  // Detects: a double approval under concurrency.
  test('two Admins approving one request concurrently: one success, one conflict', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    const results = await Promise.all([approve(tokens.meera ?? '', requestId), approve(tokens.priya ?? '', requestId)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'REQUEST_NOT_PENDING');
    assert.equal((await records(code)).length, 2);
  });

  // Detects: approval and request status committed separately.
  test('a compensation insert failure leaves the request pending', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    // Test-only failure for records created at or after 10:00:01 from a request.
    now = new Date('2026-11-15T10:00:01.000Z');
    await pool.query("ALTER TABLE compensation_records ADD CONSTRAINT test_only_fail_insert CHECK (source_request_id IS NULL OR created_at < '2026-11-15 10:00:01.000')");
    try {
      assert.equal((await approve(tokens.meera ?? '', requestId)).status, 500);
    } finally {
      await pool.query('ALTER TABLE compensation_records DROP CHECK test_only_fail_insert');
    }
    assert.deepEqual((await requestRows(code)).map((r) => r.status), ['PENDING']);
    assert.equal((await records(code)).length, 1);
    assert.equal((await approve(tokens.meera ?? '', requestId)).status, 200);
  });

  test('a request-status update failure rolls back the compensation insert', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    // Test-only failure for approvals decided at or after 10:00:02 (the previous test approves at 10:00:01).
    now = new Date('2026-11-15T10:00:02.000Z');
    await pool.query("ALTER TABLE compensation_change_requests ADD CONSTRAINT test_only_fail_approve CHECK (status <> 'APPROVED' OR decided_at < '2026-11-15 10:00:02.000')");
    try {
      assert.equal((await approve(tokens.meera ?? '', requestId)).status, 500);
    } finally {
      await pool.query('ALTER TABLE compensation_change_requests DROP CHECK test_only_fail_approve');
    }
    assert.equal((await records(code)).length, 1);
    assert.deepEqual((await requestRows(code)).map((r) => r.status), ['PENDING']);
  });

  // Detects: cancellation changing compensation, a cancellation without a note, or a non-idempotent retry.
  test('cancellation requires a note, changes no compensation, and is idempotent', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    assert.deepEqual(errorOf(await cancel(tokens.meera ?? '', requestId, undefined)).slice(0, 2), [400, 'VALIDATION_ERROR']);
    assert.deepEqual(errorOf(await cancel(tokens.meera ?? '', requestId, '')).slice(0, 2), [400, 'VALIDATION_ERROR']);
    const idempotencyKey = key();
    const first = await cancel(tokens.meera ?? '', requestId, 'Budget closed.', idempotencyKey);
    const second = await cancel(tokens.meera ?? '', requestId, 'Budget closed.', idempotencyKey);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.deepEqual(second.body, first.body);
    assert.deepEqual([first.body.request.status, first.body.request.decisionNote, first.body.request.decidedBy.displayName], ['CANCELLED', 'Budget closed.', 'Meera Iyer']);
    assert.deepEqual(errorOf(await cancel(tokens.meera ?? '', requestId, 'Other note.', idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.equal((await records(code)).length, 1);
    assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [409, 'REQUEST_NOT_PENDING']);
  });

  // Detects: an approval idempotency key reused for another request.
  test('an approval key reused for another request is a duplicate operation', async () => {
    const one = await employee();
    const two = await employee();
    const idempotencyKey = key();
    assert.equal((await approve(tokens.meera ?? '', await pendingRequest(one), idempotencyKey)).status, 200);
    const other = await pendingRequest(two);
    assert.deepEqual(errorOf(await approve(tokens.meera ?? '', other, idempotencyKey)).slice(0, 2), [409, 'DUPLICATE_OPERATION']);
    assert.deepEqual((await requestRows(two)).map((r) => r.status), ['PENDING']);
  });

  // One pending request per employee, so "other pending requests" for the same
  // employee cannot exist; after approval a new request uses the new version.
  test('after approval, a new request is allowed against the new version', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    assert.equal((await approve(tokens.meera ?? '', requestId)).status, 200);
    const next = await okPreview(tokens.asha ?? '', code, raise({ value: '3' }));
    assert.equal(next.expectedCompensationVersion, 2);
  });
});

describe('approval revalidation', () => {
  // Detects: approval of a request whose basis has changed.
  test('a stale request cannot be approved', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    // Another source changes compensation (an Admin direct change).
    const p = await okPreview(tokens.meera ?? '', code, raise({ value: '2' }));
    assert.equal((await apply(tokens.meera ?? '', code, p.previewToken, raise({ value: '2' }))).status, 201);
    assert.deepEqual(errorOf(await approve(tokens.priya ?? '', requestId)).slice(0, 2), [409, 'REQUEST_NOT_PENDING']);
  });

  // Detects: approval for a requester who has since been deactivated.
  test('an inactive requester makes the request stale at approval', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code, raise(), 'vikram');
    await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.vikram ?? 0, status: 'INACTIVE' });
    try {
      assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [409, 'STALE_VERSION']);
    } finally {
      await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.vikram ?? 0, status: 'ACTIVE' });
      tokens.vikram = await login('vikram@acme.com');
    }
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', 'The requester is no longer active.']]);
    assert.equal((await records(code)).length, 1);
  });

  test('requester scope removal makes the request stale at approval', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code, raise(), 'vikram');
    await setDepartmentScopes(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.vikram ?? 0, departments: ['Support'] });
    try {
      assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [409, 'STALE_VERSION']);
    } finally {
      await setDepartmentScopes(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.vikram ?? 0, departments: ['Tech'] });
    }
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', "The employee is outside the requester's current scope."]]);
  });

  test('an employee who left makes the request stale and ineligible', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    await pool.query("UPDATE employees SET employment_status = 'LEFT', employment_end_date = '2026-11-15' WHERE employee_code = ?", [code]);
    assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [422, 'EMPLOYEE_INELIGIBLE']);
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', 'The employee is no longer eligible.']]);
  });

  test('an effective date that passed while pending makes the request stale', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code, raise({ effectiveFrom: '2026-11-16' }));
    now = new Date('2026-11-17T09:00:00.000Z');
    const token = await login('meera@acme.com');
    assert.deepEqual(errorOf(await approve(token, requestId)).slice(0, 2), [409, 'STALE_VERSION']);
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', 'The effective date has passed.']]);
  });

  test('a salary band that no longer permits the result makes the request stale', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code, raise({ value: '40' }));
    const [band] = await query(
      `SELECT b.id, b.max_annual_base_salary FROM salary_bands b JOIN employees e ON e.job_title_id = b.job_title_id AND e.country_code = b.country_code
       WHERE e.employee_code = ?`, [code]);
    await pool.query("UPDATE salary_bands SET max_annual_base_salary = '2000000.00' WHERE id = ?", [band?.id]);
    try {
      assert.deepEqual(errorOf(await approve(tokens.meera ?? '', requestId)).slice(0, 2), [409, 'STALE_VERSION']);
    } finally {
      await pool.query('UPDATE salary_bands SET max_annual_base_salary = ? WHERE id = ?', [band?.max_annual_base_salary, band?.id]);
    }
    assert.deepEqual((await requestRows(code)).map((r) => [r.status, r.decision_note]), [['STALE', 'The salary band no longer permits this result.']]);
  });
});

describe('effective dates and future changes', () => {
  // Detects: a future change shown as current early, or never becoming current.
  test('a future change becomes current only on its effective date', async () => {
    const code = await employee();
    const command = raise({ effectiveFrom: '2026-12-01' });
    const p = await okPreview(tokens.meera ?? '', code, command);
    assert.equal((await apply(tokens.meera ?? '', code, p.previewToken, command)).status, 201);
    const detail = async () => (await request(app).get(`/api/v1/employees/${code}`).set(auth(tokens.meera ?? ''))).body.compensation.version;
    assert.equal(await detail(), 1);
    now = new Date('2026-12-01T00:00:00.000Z');
    tokens.meera = await login('meera@acme.com');
    assert.equal(await detail(), 2);
  });

  // Detects: a second scheduled change silently stacked on the first.
  test('a second approved future change is rejected; an immediate change keeps the future amount and warns', async () => {
    const code = await employee();
    const future = raise({ method: 'REPLACEMENT', value: '1800000', effectiveFrom: '2026-12-01' });
    const pf = await okPreview(tokens.meera ?? '', code, future);
    assert.equal((await apply(tokens.meera ?? '', code, pf.previewToken, future)).status, 201);

    assert.deepEqual(errorOf(await preview(tokens.meera ?? '', code, raise({ effectiveFrom: '2026-12-15' }))), [400, 'VALIDATION_ERROR', 'FUTURE_CHANGE_EXISTS']);

    const today = raise({ value: '5' });
    const pt = await okPreview(tokens.meera ?? '', code, today);
    assert.deepEqual(pt.warnings.futureChange, {
      effectiveFrom: '2026-12-01', annualBaseSalary: '1800000.00', annualBonus: '100000.00',
      message: 'An approved change effective 2026-12-01 will still take effect with its scheduled amounts.',
    });
    assert.equal(pt.current.compensationVersion, 1);
    assert.equal(pt.expectedCompensationVersion, 2);
    assert.equal((await apply(tokens.meera ?? '', code, pt.previewToken, today)).status, 201);
    const rows = await records(code);
    assert.deepEqual(rows.map((r) => [r.version, r.base, r.from_date]), [
      [1, '1500000.00', '2020-01-01'], [2, '1800000.00', '2026-12-01'], [3, '1575000.00', '2026-11-15'],
    ]);
  });

  // Detects: a joiner's change placed before their start compensation.
  test('a soon-to-join employee is eligible from the start date', async () => {
    const code = await employee({ status: 'SOON_TO_JOIN', hire: '2027-01-15' });
    assert.deepEqual(errorOf(await preview(tokens.meera ?? '', code, raise())), [400, 'VALIDATION_ERROR', 'EFFECTIVE_BEFORE_CURRENT']);
    const p = await okPreview(tokens.meera ?? '', code, raise({ effectiveFrom: '2027-01-15' }));
    assert.deepEqual([p.current.state, p.current.compensationVersion, p.proposed.annualBaseSalary], ['UPCOMING', 1, '1650000.00']);
  });
});

describe('request list', () => {
  // Detects: SQL built from list input, or an unsupported filter accepted.
  test('filters and sorting are allowlisted and parameterized', async () => {
    const code = await employee();
    await pendingRequest(code);
    const list = (token: string, q: Record<string, string>) => request(app).get('/api/v1/salary-adjustment-requests').query(q).set(auth(token));
    const byCode = await list(tokens.meera ?? '', { q: code, status: 'PENDING' });
    assert.deepEqual(byCode.body.requests.map((r: { employee: { employeeCode: string } }) => r.employee.employeeCode), [code]);
    for (const q of [{ sort: 'id' }, { sort: 'created_at; DROP TABLE x' }, { direction: 'sideways' }, { status: 'REJECTED' }, { extra: '1' }, { department: 'Legal' }] as Record<string, string>[]) {
      assert.equal((await list(tokens.meera ?? '', q)).status, 400, JSON.stringify(q));
    }
    assert.equal((await list(tokens.rohan ?? '', { department: 'Tech' })).status, 400, 'Scoped HR has no department filter');
    for (const q of ["%", "' OR '1'='1", '_']) assert.equal((await list(tokens.meera ?? '', { q })).body.page.totalRows, 0, q);
    const asc = await list(tokens.meera ?? '', { direction: 'asc', pageSize: '100' });
    const times = asc.body.requests.map((r: { createdAt: string }) => r.createdAt);
    assert.deepEqual(times, [...times].sort());
    assert.equal((await list(tokens.meera ?? '', { department: 'Finance' })).body.page.totalRows, 0);
  });
});

describe('response and logging hygiene', () => {
  // Detects: internal database IDs or idempotency keys in responses.
  test('responses contain no internal IDs or keys', async () => {
    const code = await employee();
    const requestId = await pendingRequest(code);
    const approved = await approve(tokens.meera ?? '', requestId);
    const listed = await request(app).get('/api/v1/salary-adjustment-requests').set(auth(tokens.meera ?? ''));
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) { keys.add(k); walk(v); }
    };
    [approved.body, listed.body].forEach(walk);
    // requestId and sourceRequestId are public random UUIDs, not database IDs.
    for (const k of keys) {
      if (k === 'requestId' || k === 'sourceRequestId') continue;
      assert.doesNotMatch(k, /(^id$|Id$|_id$|idempotency|key)/i, k);
    }
    assert.ok(keys.has('requestId') && keys.has('sourceRequestId'));
    assert.match(String(approved.body.request.requestId), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // Detects: salary values, notes, tokens, keys, or bodies in logs.
  test('logs contain no salary values, notes, preview tokens, idempotency keys, or bodies', async () => {
    const code = await employee();
    const command = raise({ note: LEAK_NOTE });
    const p = await okPreview(tokens.meera ?? '', code, command);
    const idempotencyKey = `leak-check-key-${randomUUID()}`;
    await apply(tokens.meera ?? '', code, p.previewToken, command, idempotencyKey);
    await apply(tokens.meera ?? '', code, p.previewToken, raise({ value: '9' }), idempotencyKey);
    const requestId = await pendingRequest(code, raise({ value: '3', note: LEAK_NOTE }));
    await cancel(tokens.meera ?? '', requestId, LEAK_NOTE);
    const text = JSON.stringify(logs);
    for (const secret of [LEAK_NOTE, p.previewToken, idempotencyKey, 'leak-check', '1650000', '1500000', code, tokens.meera ?? '', 'Bearer']) {
      assert.ok(!text.includes(secret), `log contains ${secret.slice(0, 20)}`);
    }
  });
});
