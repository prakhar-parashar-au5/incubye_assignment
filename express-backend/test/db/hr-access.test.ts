// HR access-management API against real MySQL (docs_human/12-hr-access-management.md).
//
// Employee fixture (for accessible-employee counts), 13 employees:
//   IN Tech 3 (one LEFT), IN Support 2, IN Finance 2,
//   US Tech 4, US Support 1, US HR 1.
// So:  IN x Tech = 3;  IN x (Tech, Support) = 5;  (IN, US) x Tech = 7;
//      (IN, US) x (Tech, Support) = 10;  US x Tech = 4;  Admin = 13.
//
// HR users: Meera and Priya (ADMIN), Rohan (SCOPED IN x Tech, Support),
// Empty (SCOPED, no scope rows: older data). Tests create their own targets.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { decodeJwt } from 'jose';
import type { Pool } from 'mysql2/promise';

import { createAccessPreviewTokens } from '../../src/access/access-preview-token.js';
import { createHrAccessService } from '../../src/access/hr-access-service.js';
import type { HrAccessService } from '../../src/access/hr-access-service.js';
import { bootstrapHrUser, regenerateTemporaryPassword, setHrUserStatus } from '../../src/access/hr-users.js';
import { TEMPORARY_PASSWORD_ALPHABET } from '../../src/access/passwords.js';
import { createAuthService } from '../../src/access/sessions.js';
import type { Principal } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import { createPool, openConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { ensureReferenceData } from '../../src/seed/reference-data.js';
import { execStatement, selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { fakeDashboard, fakeSalaryAdjustments, noModelAssistant, fakeAdminObservability, fakeMcpStore } from '../support/http.js';
import { must } from '../support/must.js';
import { thrown } from '../support/thrown.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-hr-password';
const START = new Date('2026-11-15T10:00:00.000Z');
let now = START;
const clock = (): Date => now;
const API = '/api/v1';

let pool: Pool;
let app: ReturnType<typeof createApp>;
let service: HrAccessService;
let auth: ReturnType<typeof createAuthService>;
let logs: LogEntry[] = [];
const ids: Record<string, number> = {};
const tokens: Record<string, string> = {};

let sequence = 0;
const nextEmail = (label = 'person') => `${label}.${++sequence}@acme.com`;
const newKey = () => `hr-access-key-${String(++sequence).padStart(8, '0')}`;
const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const count = async (sql: string, params?: unknown[]): Promise<number> => Number(must((await query(sql, params))[0], 'a count row').n);

function buildApp() {
  const sessionTokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
  auth = createAuthService({ pool, tokens: sessionTokens, clock });
  service = createHrAccessService({ pool, clock, previewTokens: createAccessPreviewTokens({ signingKey: SIGNING_KEY, clock }) });
  const directory = createDirectoryService({ pool, exchangeRate: null, clock });
  return createApp({
    auth,
    directory,
    ...noModelAssistant(directory),
    salaryAdjustments: fakeSalaryAdjustments(),
    dashboard: fakeDashboard(),
    hrAccess: service, adminObservability: fakeAdminObservability(), mcpStore: fakeMcpStore().store,
    logger: (entry) => logs.push(entry),
    clientIpSource: 'socket',
  });
}

const signIn = async (email: string, password = PASSWORD): Promise<string> => (await auth.signIn(email, password)).token;

type Op = 'PROFILE' | 'PROMOTE' | 'SCOPES' | 'DEACTIVATE' | 'REACTIVATE';
const OP_PATH: Record<Op, string> = { PROFILE: 'profile', PROMOTE: 'promote', SCOPES: 'scopes', DEACTIVATE: 'deactivate', REACTIVATE: 'reactivate' };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const list = (token: string, q: Record<string, string | string[]> = {}) => request(app).get(`${API}/hr-users`).query(q).set(bearer(token));
const detail = (token: string, id: number | string) => request(app).get(`${API}/hr-users/${id}`).set(bearer(token));
const auditOf = (token: string, id: number | string, q: Record<string, string> = {}) => request(app).get(`${API}/hr-users/${id}/access-audit`).query(q).set(bearer(token));
const previewCreate = (token: string, body: unknown) => request(app).post(`${API}/hr-users/preview`).set(bearer(token)).send(body as object);
const confirmCreate = (token: string, body: unknown, key: string | null = newKey()) => {
  const req = request(app).post(`${API}/hr-users`).set(bearer(token));
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(body as object);
};
const preview = (token: string, op: Op, id: number, body: unknown) =>
  request(app).post(`${API}/hr-users/${id}/${OP_PATH[op]}/preview`).set(bearer(token)).send(body as object);
const confirm = (token: string, op: Op, id: number, body: unknown, key: string | null = newKey()) => {
  const url = `${API}/hr-users/${id}/${OP_PATH[op]}`;
  const req = (op === 'SCOPES' ? request(app).put(url) : request(app).post(url)).set(bearer(token));
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(body as object);
};

/** Preview (must succeed), then confirm the exact same body. */
async function previewAndConfirm(token: string, op: Op, id: number, body: Record<string, unknown>, key = newKey()) {
  const p = await preview(token, op, id, body);
  assert.equal(p.status, 200, p.text);
  const res = await confirm(token, op, id, { ...body, previewToken: p.body.previewToken }, key);
  return { preview: p.body, res };
}

async function createViaApi(token: string, body: Record<string, unknown>, key = newKey()) {
  const p = await previewCreate(token, body);
  assert.equal(p.status, 200, p.text);
  const res = await confirmCreate(token, { ...body, previewToken: p.body.previewToken }, key);
  return { preview: p.body, res };
}

const version = async (id: number): Promise<number> => Number(must((await query('SELECT version FROM hr_users WHERE id = ?', [id]))[0], 'user').version);

/** Everything an operation could change for one HR user. */
async function stateOf(id: number) {
  const [user] = await query('SELECT display_name, role, status, version, password_hash FROM hr_users WHERE id = ?', [id]);
  return {
    user,
    countries: (await query('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ? ORDER BY country_code', [id])).map((r) => r.country_code),
    departments: (await query('SELECT d.name FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ? ORDER BY d.name', [id])).map((r) => r.name),
    audit: await count('SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ?', [id]),
    openSessions: await count('SELECT COUNT(*) AS n FROM hr_sessions WHERE hr_user_id = ? AND revoked_at IS NULL', [id]),
  };
}

async function scopedUser(label: string, countries: string[], departments: string[]): Promise<{ id: number; email: string }> {
  const email = nextEmail(label);
  const id = await bootstrapHrUser(pool, { email, displayName: `${label} Person`, password: PASSWORD, role: 'SCOPED', countries, departments });
  return { id, email };
}

async function insertEmployees(): Promise<void> {
  const titles: Record<string, string> = { Tech: 'Software Engineer', Support: 'Support Specialist', Finance: 'Senior Accountant', HR: 'HR Generalist' };
  const levels: Record<string, string> = { Tech: 'MID', Support: 'MID', Finance: 'SENIOR', HR: 'MID' };
  const rows: [string, 'IN' | 'US', number][] = [['Tech', 'IN', 3], ['Support', 'IN', 2], ['Finance', 'IN', 2], ['Tech', 'US', 4], ['Support', 'US', 1], ['HR', 'US', 1]];
  let n = 400;
  for (const [department, country, total] of rows) {
    const [title] = await query('SELECT id FROM job_titles WHERE name = ? AND level = ?', [titles[department], levels[department]]);
    for (let i = 0; i < total; i += 1) {
      n += 1;
      const left = department === 'Tech' && country === 'IN' && i === 0;
      await execStatement(pool,
        `INSERT INTO employees (employee_code, first_name, last_name, email, job_title_id, country_code, employment_status, hire_date, employment_end_date)
         VALUES (?, 'Access', ?, ?, ?, ?, ?, '2020-01-01', ?)`,
        [`ACME00${n}`, String(n), `access.${n}@acme.com`, must(title, department).id, country, left ? 'LEFT' : 'CURRENTLY_WORKING', left ? '2025-01-01' : null]);
    }
  }
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
  await insertEmployees();
  ids.meera = await bootstrapHrUser(pool, { email: 'meera@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  ids.priya = await bootstrapHrUser(pool, { email: 'priya@acme.com', displayName: 'Priya Admin', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  ids.rohan = await bootstrapHrUser(pool, { email: 'rohan@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  ids.empty = await bootstrapHrUser(pool, { email: 'empty@acme.com', displayName: 'Empty Scope', password: PASSWORD, role: 'SCOPED', countries: [], departments: [] });
  app = buildApp();
  for (const who of ['meera', 'priya', 'rohan']) tokens[who] = await signIn(`${who}@acme.com`);
});
after(async () => {
  await pool?.end();
});
beforeEach(() => {
  now = START;
  logs = [];
});

describe('permissions', () => {
  // Detects: list or detail routes missing, or reading the wrong user.
  test('Admin HR lists and views HR users', async () => {
    const res = await list(tokens.meera ?? '');
    assert.equal(res.status, 200, res.text);
    const emails = (res.body.users as Row[]).map((u) => u.email);
    for (const email of ['meera@acme.com', 'priya@acme.com', 'rohan@acme.com', 'empty@acme.com']) assert.ok(emails.includes(email), email);
    const rohan = await detail(tokens.meera ?? '', ids.rohan ?? 0);
    assert.equal(rohan.status, 200, rohan.text);
    assert.deepEqual(
      { ...rohan.body.hrUser, createdAt: 'x', updatedAt: 'x' },
      {
        hrUserId: ids.rohan, displayName: 'Rohan Mehta', email: 'rohan@acme.com', role: 'SCOPED', status: 'ACTIVE',
        countries: ['IN'], departments: ['Support', 'Tech'], version: 1, createdAt: 'x', updatedAt: 'x',
        accessSummary: {
          kind: 'SCOPED', text: 'India + Support, India + Tech',
          combinations: [{ country: 'IN', countryName: 'India', department: 'Support' }, { country: 'IN', countryName: 'India', department: 'Tech' }],
        },
        accessibleEmployeeCount: 5, noAccessMessage: null,
      },
    );
  });

  // Detects: any access-management operation reachable by Scoped HR, or a
  // role check that runs after a write.
  test('Scoped HR gets 403 on every operation and nothing is written', async () => {
    const before = await Promise.all([
      count('SELECT COUNT(*) AS n FROM hr_users'), count('SELECT COUNT(*) AS n FROM access_audit_events'),
      count('SELECT COUNT(*) AS n FROM hr_user_country_scopes'), count('SELECT COUNT(*) AS n FROM hr_sessions WHERE revoked_at IS NOT NULL'),
    ]);
    const t = tokens.rohan ?? '';
    const target = ids.empty ?? 0;
    const createBody = { email: nextEmail('blocked'), displayName: 'Blocked', role: 'ADMIN', countries: [], departments: [] };
    const responses = [
      await list(t), await detail(t, target), await auditOf(t, target), await auditOf(t, ids.rohan ?? 0),
      await previewCreate(t, createBody), await confirmCreate(t, { ...createBody, previewToken: 'x' }),
      await preview(t, 'PROFILE', target, { expectedVersion: 1, displayName: 'X' }), await confirm(t, 'PROFILE', target, { expectedVersion: 1, displayName: 'X', previewToken: 'x' }),
      await preview(t, 'PROMOTE', ids.rohan ?? 0, { expectedVersion: 1 }), await confirm(t, 'PROMOTE', ids.rohan ?? 0, { expectedVersion: 1, previewToken: 'x' }),
      await preview(t, 'SCOPES', target, { expectedVersion: 1, countries: ['IN'], departments: ['Tech'] }),
      await confirm(t, 'SCOPES', target, { expectedVersion: 1, countries: ['IN'], departments: ['Tech'], previewToken: 'x' }),
      await preview(t, 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: 1, reason: 'x' }), await confirm(t, 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: 1, reason: 'x', previewToken: 'x' }),
      await preview(t, 'REACTIVATE', target, { expectedVersion: 1, reason: 'x' }), await confirm(t, 'REACTIVATE', target, { expectedVersion: 1, reason: 'x', previewToken: 'x' }),
    ];
    for (const [index, res] of responses.entries()) {
      assert.equal(res.status, 403, `operation ${index}: ${res.text}`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
    const afterCounts = await Promise.all([
      count('SELECT COUNT(*) AS n FROM hr_users'), count('SELECT COUNT(*) AS n FROM access_audit_events'),
      count('SELECT COUNT(*) AS n FROM hr_user_country_scopes'), count('SELECT COUNT(*) AS n FROM hr_sessions WHERE revoked_at IS NOT NULL'),
    ]);
    assert.deepEqual(afterCounts, before);
  });

  test('every operation requires authentication', async () => {
    for (const res of [
      await request(app).get(`${API}/hr-users`), await request(app).get(`${API}/hr-users/1`), await request(app).get(`${API}/hr-users/1/access-audit`),
      await request(app).post(`${API}/hr-users/preview`).send({}), await request(app).post(`${API}/hr-users`).send({}),
      await request(app).put(`${API}/hr-users/1/scopes`).send({}), await request(app).post(`${API}/hr-users/1/deactivate`).send({}),
    ]) assert.equal(res.status, 401, res.text);
  });

  // Detects: authority taken from a principal loaded earlier instead of the
  // actor's current row (frontend state or a stale request context).
  test('an inactive Admin cannot manage HR users, even with a principal loaded before deactivation', async () => {
    const adminEmail = nextEmail('soon.inactive.admin');
    const adminId = await bootstrapHrUser(pool, { email: adminEmail, displayName: 'Soon Inactive Admin', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
    const token = await signIn(adminEmail);
    const stalePrincipal: Principal = await auth.authenticate(token);
    const target = await scopedUser('victim', ['IN'], ['Tech']);
    const p = await preview(token, 'PROFILE', target.id, { expectedVersion: 1, displayName: 'Renamed' });
    assert.equal(p.status, 200, p.text);
    await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: adminId, status: 'INACTIVE', reason: 'Left the company.' });
    // The HTTP session is revoked by deactivation.
    assert.equal((await list(token)).status, 401);
    // The service rechecks the actor row in MySQL inside the write transaction.
    const before = await stateOf(target.id);
    await assert.rejects(
      service.change(stalePrincipal, 'PROFILE', String(target.id), { expectedVersion: 1, displayName: 'Renamed', previewToken: p.body.previewToken }, newKey()),
      (error: unknown) => thrown(error).code === 'FORBIDDEN',
    );
    assert.deepEqual(await stateOf(target.id), before);
  });
});

describe('creation', () => {
  // Detects: a wrong preview, a password that is not returned, stored in plain
  // text, unusable for sign-in, or a missing audit event.
  test('Admin creates a Scoped HR user and sees the temporary password once', async () => {
    const email = nextEmail('new.scoped');
    const body = { email: email.toUpperCase(), displayName: '  New Scoped  ', role: 'SCOPED', countries: ['US', 'IN'], departments: ['Tech', 'Support'] };
    const p = await previewCreate(tokens.meera ?? '', body);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.body.operation, 'CREATE');
    assert.equal(p.body.hrUserId, null);
    assert.equal(p.body.expectedVersion, null);
    assert.equal(p.body.email, email);
    assert.equal(p.body.current, null);
    assert.equal(p.body.changed, true);
    assert.deepEqual(p.body.changedFields, ['displayName', 'role', 'status', 'countries', 'departments']);
    assert.deepEqual(p.body.proposed, {
      displayName: 'New Scoped', role: 'SCOPED', status: 'ACTIVE', countries: ['IN', 'US'], departments: ['Support', 'Tech'],
      accessSummary: {
        kind: 'SCOPED',
        text: 'India + Support, India + Tech, United States + Support, United States + Tech',
        combinations: [
          { country: 'IN', countryName: 'India', department: 'Support' }, { country: 'IN', countryName: 'India', department: 'Tech' },
          { country: 'US', countryName: 'United States', department: 'Support' }, { country: 'US', countryName: 'United States', department: 'Tech' },
        ],
      },
      accessibleEmployeeCount: 10,
    });
    assert.equal(p.body.sessionsToRevoke, 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [email]), 0, 'preview writes nothing');

    const res = await confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.body.previewToken });
    assert.equal(res.status, 201, res.text);
    const password = String(res.body.temporaryPassword);
    assert.ok(password.length >= 12 && [...password].every((c) => TEMPORARY_PASSWORD_ALPHABET.includes(c)));
    assert.match(res.body.temporaryPasswordNotice, /no email was sent/);
    assert.equal(res.body.credentialRecoveryRequired, false);
    assert.equal(res.body.hrUser.email, email);
    assert.equal(res.body.hrUser.version, 1);
    assert.equal(res.body.hrUser.accessibleEmployeeCount, 10);
    assert.equal(res.body.auditEvent.action, 'HR_USER_CREATED');
    assert.equal(res.body.auditEvent.resultingVersion, 1);
    assert.deepEqual(res.body.auditEvent.actor, { hrUserId: ids.meera, displayName: 'Meera Iyer' });
    assert.equal(res.body.auditEvent.before, null);

    const id = Number(res.body.hrUser.hrUserId);
    const [stored] = await query('SELECT password_hash FROM hr_users WHERE id = ?', [id]);
    assert.match(String(stored?.password_hash), /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.ok(!String(stored?.password_hash).includes(password));
    assert.ok((await auth.signIn(email, password)).token.length > 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ?', [id]), 1);
  });

  test('Admin creates another Admin with empty scopes', async () => {
    const { res } = await createViaApi(tokens.meera ?? '', { email: nextEmail('new.admin'), displayName: 'New Admin', role: 'ADMIN', countries: [], departments: [] });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual([res.body.hrUser.role, res.body.hrUser.countries, res.body.hrUser.departments], ['ADMIN', [], []]);
    assert.deepEqual(res.body.hrUser.accessSummary, { kind: 'ALL_EMPLOYEES', text: 'All employees', combinations: [] });
    assert.equal(res.body.hrUser.accessibleEmployeeCount, 13);
  });

  // Detects: Admin scope rows stored, or a Scoped HR user created without access.
  test('rejects an Admin with scopes and a Scoped HR user without both scope lists', async () => {
    const usersBefore = await count('SELECT COUNT(*) AS n FROM hr_users');
    for (const body of [
      { email: nextEmail('bad'), displayName: 'Bad', role: 'ADMIN', countries: ['IN'], departments: [] },
      { email: nextEmail('bad'), displayName: 'Bad', role: 'ADMIN', countries: [], departments: ['Tech'] },
      { email: nextEmail('bad'), displayName: 'Bad', role: 'SCOPED', countries: [], departments: ['Tech'] },
      { email: nextEmail('bad'), displayName: 'Bad', role: 'SCOPED', countries: ['IN'], departments: [] },
      { email: nextEmail('bad'), displayName: 'Bad', role: 'SCOPED', countries: ['GB'], departments: ['Tech'] },
      { email: nextEmail('bad'), displayName: 'Bad', role: 'SCOPED', countries: ['IN'], departments: ['Legal'] },
    ]) {
      const p = await previewCreate(tokens.meera ?? '', body);
      assert.equal(p.status, 422, `${JSON.stringify(body)} ${p.text}`);
      assert.equal(p.body.error.code, 'INVALID_SCOPE');
      const c = await confirmCreate(tokens.meera ?? '', { ...body, previewToken: 'not-a-token' });
      assert.equal(c.status, 422, c.text);
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users'), usersBefore);
  });

  test('rejects a duplicate email without case sensitivity', async () => {
    const body = { email: 'ROHAN@ACME.COM', displayName: 'Another Rohan', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] };
    const p = await previewCreate(tokens.meera ?? '', body);
    assert.equal(p.status, 409, p.text);
    assert.deepEqual(p.body.error, { code: 'EMAIL_TAKEN', message: 'An HR user with this email already exists.' });
    // A preview made before the other user existed still cannot take the email.
    const email = nextEmail('race');
    const early = await previewCreate(tokens.meera ?? '', { ...body, email });
    assert.equal(early.status, 200);
    await bootstrapHrUser(pool, { email, displayName: 'First', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech'] });
    const late = await confirmCreate(tokens.meera ?? '', { ...body, email, previewToken: early.body.previewToken });
    assert.equal(late.status, 409, late.text);
    assert.equal(late.body.error.code, 'EMAIL_TAKEN');
    assert.ok(!late.text.includes('argon2'));
  });

  // Detects: the password leaking into logs, audit, later reads, or a replay.
  test('the temporary password appears only in the successful creation response', async () => {
    const email = nextEmail('once');
    const key = newKey();
    const body = { email, displayName: 'Once Only', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] };
    const { preview: p, res } = await createViaApi(tokens.meera ?? '', body, key);
    assert.equal(res.status, 201, res.text);
    const password = String(res.body.temporaryPassword);
    const id = Number(res.body.hrUser.hrUserId);

    const replay = await confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.previewToken }, key);
    assert.equal(replay.status, 201, replay.text);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.equal(replay.body.temporaryPassword, null);
    assert.equal(replay.body.credentialRecoveryRequired, true);
    assert.match(replay.body.temporaryPasswordNotice, /cannot be shown again/);
    assert.equal(replay.body.hrUser.hrUserId, id);

    const later = [await detail(tokens.meera ?? '', id), await list(tokens.meera ?? '', { q: email }), await auditOf(tokens.meera ?? '', id), replay];
    for (const [index, r] of later.entries()) assert.ok(!r.text.includes(password), `response ${index}`);
    assert.ok(!JSON.stringify(logs).includes(password));
    const audit = await query('SELECT CAST(before_state AS CHAR) AS b, CAST(after_state AS CHAR) AS a, reason FROM access_audit_events');
    assert.ok(!JSON.stringify(audit).includes(password));
  });

  // Detects: a retried creation making two users or failing with EMAIL_TAKEN.
  test('the same idempotency key creates one user, also when retried concurrently', async () => {
    const email = nextEmail('retried');
    const body = { email, displayName: 'Retried', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] };
    const p = await previewCreate(tokens.meera ?? '', body);
    const key = newKey();
    const [a, b] = await Promise.all([
      confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.body.previewToken }, key),
      confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.body.previewToken }, key),
    ]);
    assert.deepEqual([a.status, b.status], [201, 201], `${a.text} ${b.text}`);
    assert.deepEqual([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].sort(), ['true', undefined].sort());
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [email]), 1);
    // The same key with different data conflicts.
    const otherBody = { ...body, email: nextEmail('other') };
    const other = await previewCreate(tokens.meera ?? '', otherBody);
    const conflict = await confirmCreate(tokens.meera ?? '', { ...otherBody, previewToken: other.body.previewToken }, key);
    assert.equal(conflict.status, 409, conflict.text);
    assert.equal(conflict.body.error.code, 'DUPLICATE_OPERATION');
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [otherBody.email]), 0);
  });
});

describe('scope', () => {
  // Detects: OR across dimensions, AND within a list, or a count that ignores the policy.
  test('scope preview returns the exact cross-product and accessible employee count', async () => {
    const target = await scopedUser('scope.preview', ['IN'], ['Tech']);
    const cases: [string[], string[], number, number][] = [
      [['IN'], ['Tech'], 3, 1], [['IN'], ['Tech', 'Support'], 5, 2], [['IN', 'US'], ['Tech'], 7, 2], [['IN', 'US'], ['Tech', 'Support'], 10, 4], [['US'], ['HR'], 1, 1],
    ];
    for (const [countries, departments, employees, combinations] of cases) {
      const p = await preview(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries, departments });
      assert.equal(p.status, 200, p.text);
      assert.equal(p.body.current.accessibleEmployeeCount, 3);
      assert.equal(p.body.proposed.accessibleEmployeeCount, employees, `${countries} x ${departments}`);
      assert.equal(p.body.proposed.accessSummary.combinations.length, combinations);
    }
    assert.equal(await version(target.id), 1, 'previews write nothing');
  });

  // Detects: two-step scope replacement, a missing audit event, or a scope
  // change that needs a new session.
  test('replacing both dimensions commits once, audits exact states, and applies on the next request', async () => {
    const target = await scopedUser('scope.replace', ['IN'], ['Tech']);
    const targetToken = await signIn(target.email);
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['US'], departments: ['Support', 'Tech'] });
    assert.equal(p.changed, true);
    assert.deepEqual(p.changedFields, ['countries', 'departments']);
    assert.equal(p.sessionsToRevoke, 0);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.revokedSessionCount, 0);
    assert.equal(res.body.hrUser.version, 2);
    assert.equal(res.body.hrUser.accessibleEmployeeCount, 5);
    assert.deepEqual(
      { action: res.body.auditEvent.action, before: res.body.auditEvent.before, after: res.body.auditEvent.after, version: res.body.auditEvent.resultingVersion },
      {
        action: 'SCOPES_REPLACED',
        before: { displayName: 'scope.replace Person', role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'] },
        after: { displayName: 'scope.replace Person', role: 'SCOPED', status: 'ACTIVE', countries: ['US'], departments: ['Support', 'Tech'] },
        version: 2,
      },
    );
    assert.equal(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ? AND action <> 'HR_USER_CREATED'", [target.id]), 1);
    // The same session sees the new scope on its next request.
    const me = await request(app).get(`${API}/auth/me`).set(bearer(targetToken));
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.scope, { countries: ['US'], departments: ['Support', 'Tech'] });
    const employees = await request(app).get(`${API}/employees`).set(bearer(targetToken));
    assert.equal(employees.body.page.totalRows, 5);
  });

  // Detects: older empty-scope rows crashing the page, or treated as "all".
  test('an existing empty scope loads safely and grants no employee access', async () => {
    const res = await detail(tokens.meera ?? '', ids.empty ?? 0);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.hrUser.accessibleEmployeeCount, 0);
    assert.equal(res.body.hrUser.noAccessMessage, 'This HR user currently has access to no employees.');
    assert.deepEqual(res.body.hrUser.accessSummary, { kind: 'NO_EMPLOYEES', text: 'This scope grants access to no employees.', combinations: [] });
    const target = await scopedUser('to.empty', ['IN'], ['Tech']);
    const p = await preview(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['IN'], departments: [] });
    assert.equal(p.status, 200, p.text);
    assert.equal(p.body.proposed.accessibleEmployeeCount, 0);
    assert.equal(p.body.proposed.accessSummary.text, 'This scope grants access to no employees.');
  });

  test('rejects unknown, malformed, and repeated scope values', async () => {
    const target = await scopedUser('scope.invalid', ['IN'], ['Tech']);
    const unknown = [{ countries: ['GB'], departments: ['Tech'] }, { countries: ['IN'], departments: ['Legal'] }, { countries: ['IN'], departments: ['tech'] }];
    for (const scopes of unknown) {
      const p = await preview(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, ...scopes });
      assert.equal(p.status, 422, p.text);
      assert.equal(p.body.error.code, 'INVALID_SCOPE');
    }
    for (const scopes of [{ countries: ['in'], departments: ['Tech'] }, { countries: ['IN', 'IN'], departments: ['Tech'] }, { countries: 'IN', departments: ['Tech'] }]) {
      const p = await preview(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, ...scopes });
      assert.equal(p.status, 400, p.text);
    }
    assert.equal(await version(target.id), 1);
  });
});

describe('role', () => {
  // Detects: promotion keeping scope rows or old sessions.
  test('promotion removes all scope rows and revokes existing sessions', async () => {
    const target = await scopedUser('promoted', ['IN', 'US'], ['Tech']);
    const first = await signIn(target.email);
    await signIn(target.email);
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'PROMOTE', target.id, { expectedVersion: 1 });
    assert.deepEqual([p.current.role, p.proposed.role, p.proposed.countries, p.proposed.departments, p.sessionsToRevoke], ['SCOPED', 'ADMIN', [], [], 2]);
    assert.equal(p.proposed.accessibleEmployeeCount, 13);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.revokedSessionCount, 2);
    assert.deepEqual(res.body.hrUser.accessSummary, { kind: 'ALL_EMPLOYEES', text: 'All employees', combinations: [] });
    const state = await stateOf(target.id);
    assert.deepEqual([state.user?.role, state.countries, state.departments, state.openSessions], ['ADMIN', [], [], 0]);
    assert.deepEqual(
      [res.body.auditEvent.action, res.body.auditEvent.before.countries, res.body.auditEvent.before.departments, res.body.auditEvent.after.role, res.body.auditEvent.revokedSessionCount],
      ['HR_USER_PROMOTED', ['IN', 'US'], ['Tech'], 'ADMIN', 2],
    );
    assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(first))).status, 401);
    // Signing in again gives Admin access.
    const again = await signIn(target.email);
    assert.equal((await list(again)).status, 200);
  });

  // Detects: a demotion path, or scopes accepted on an Admin.
  test('Admin-to-Scoped demotion and Admin scope assignment are rejected', async () => {
    const before = await stateOf(ids.priya ?? 0);
    const viaProfile = await preview(tokens.meera ?? '', 'PROFILE', ids.priya ?? 0, { expectedVersion: before.user?.version, displayName: 'Priya', role: 'SCOPED' });
    assert.equal(viaProfile.status, 400);
    const scopes = await preview(tokens.meera ?? '', 'SCOPES', ids.priya ?? 0, { expectedVersion: before.user?.version, countries: ['IN'], departments: ['Tech'] });
    assert.equal(scopes.status, 422, scopes.text);
    assert.equal(scopes.body.error.code, 'INVALID_SCOPE');
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'PROMOTE', ids.priya ?? 0, { expectedVersion: before.user?.version });
    assert.equal(p.changed, false);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.changed, res.body.auditEvent], [false, null]);
    assert.deepEqual(await stateOf(ids.priya ?? 0), before);
  });
});

describe('activation and deactivation', () => {
  // Detects: sessions surviving deactivation, or sessions restored on reactivation.
  test('deactivation revokes every session; reactivation restores role and scopes but not sessions', async () => {
    const target = await scopedUser('cycle', ['IN'], ['Tech', 'Support']);
    const sessionA = await signIn(target.email);
    const sessionB = await signIn(target.email);
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'DEACTIVATE', target.id, { expectedVersion: 1, reason: 'Moved to another team.' });
    assert.deepEqual([p.proposed.status, p.proposed.accessibleEmployeeCount, p.sessionsToRevoke], ['INACTIVE', 0, 2]);
    assert.deepEqual(p.proposed.accessSummary, { kind: 'INACTIVE', text: 'Inactive: access to no employees.', combinations: [] });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.hrUser.status, res.body.revokedSessionCount, res.body.auditEvent.reason], ['INACTIVE', 2, 'Moved to another team.']);
    for (const token of [sessionA, sessionB]) assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(token))).status, 401);

    const back = await previewAndConfirm(tokens.meera ?? '', 'REACTIVATE', target.id, { expectedVersion: 2, reason: 'Returned.' });
    assert.equal(back.res.status, 200, back.res.text);
    assert.deepEqual([back.res.body.hrUser.status, back.res.body.hrUser.role, back.res.body.hrUser.countries, back.res.body.hrUser.departments], ['ACTIVE', 'SCOPED', ['IN'], ['Support', 'Tech']]);
    assert.deepEqual([back.res.body.auditEvent.action, back.res.body.auditEvent.reason, back.res.body.revokedSessionCount], ['HR_USER_ACTIVATED', 'Returned.', 0]);
    for (const token of [sessionA, sessionB]) assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(token))).status, 401);
    assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(await signIn(target.email)))).status, 200);
  });

  test('deactivation and reactivation require reason notes within their limits', async () => {
    const target = await scopedUser('reasons', ['IN'], ['Tech']);
    for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, reason: '   ' }, { expectedVersion: 1, reason: 'x'.repeat(2001) }]) {
      assert.equal((await preview(tokens.meera ?? '', 'DEACTIVATE', target.id, body)).status, 400);
      assert.equal((await confirm(tokens.meera ?? '', 'DEACTIVATE', target.id, { ...body, previewToken: 'x' })).status, 400);
    }
    assert.equal((await preview(tokens.meera ?? '', 'DEACTIVATE', target.id, { expectedVersion: 1, reason: 'x'.repeat(2000) })).status, 200);
    assert.equal((await preview(tokens.meera ?? '', 'REACTIVATE', target.id, { expectedVersion: 1, reason: 'x'.repeat(501) })).status, 400);
    assert.equal((await preview(tokens.meera ?? '', 'REACTIVATE', target.id, { expectedVersion: 1 })).status, 400);
    assert.equal(await version(target.id), 1);
  });

  // Detects: a check-then-update race that leaves zero active admins.
  test('concurrent cross-deactivations of two Admins leave one active Admin', async () => {
    for (let round = 0; round < 5; round += 1) {
      const a = { email: nextEmail('race.admin.a') };
      const b = { email: nextEmail('race.admin.b') };
      const aId = await bootstrapHrUser(pool, { ...a, displayName: 'Race A', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
      const bId = await bootstrapHrUser(pool, { ...b, displayName: 'Race B', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
      // Leave only these two active: every other active admin is deactivated for the round.
      const others = (await query("SELECT id FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id NOT IN (?)", [[aId, bId]])).map((r) => Number(r.id));
      for (const id of others) await setHrUserStatus(pool, { actorHrUserId: aId, targetHrUserId: id, status: 'INACTIVE', reason: 'race setup' });
      const [aToken, bToken] = [await signIn(a.email), await signIn(b.email)];
      const pa = await preview(aToken, 'DEACTIVATE', bId, { expectedVersion: 1, reason: 'race' });
      const pb = await preview(bToken, 'DEACTIVATE', aId, { expectedVersion: 1, reason: 'race' });
      assert.deepEqual([pa.status, pb.status], [200, 200]);
      const results = await Promise.all([
        confirm(aToken, 'DEACTIVATE', bId, { expectedVersion: 1, reason: 'race', previewToken: pa.body.previewToken }),
        confirm(bToken, 'DEACTIVATE', aId, { expectedVersion: 1, reason: 'race', previewToken: pb.body.previewToken }),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.text).join(' | '));
      for (const r of results.filter((x) => x.status !== 200)) assert.ok([401, 403, 409].includes(r.status), r.text);
      assert.equal(await count("SELECT COUNT(*) AS n FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE'"), 1, `round ${round}`);
      // Restore the fixture admins for later tests.
      const survivor = Number(must((await query("SELECT id FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE'"))[0], 'survivor').id);
      for (const id of others) await setHrUserStatus(pool, { actorHrUserId: survivor, targetHrUserId: id, status: 'ACTIVE', reason: 'race teardown' });
    }
    tokens.meera = await signIn('meera@acme.com');
    tokens.priya = await signIn('priya@acme.com');
  });
});

describe('concurrency and idempotency', () => {
  test('every target update requires an expected version and an idempotency key', async () => {
    const target = await scopedUser('versions', ['IN'], ['Tech']);
    const bodies: [Op, Record<string, unknown>][] = [
      ['PROFILE', { displayName: 'X' }], ['PROMOTE', {}], ['SCOPES', { countries: ['IN'], departments: ['Tech'] }],
      ['DEACTIVATE', { reason: 'x' }], ['REACTIVATE', { reason: 'x' }],
    ];
    for (const [op, body] of bodies) {
      assert.equal((await preview(tokens.meera ?? '', op, target.id, body)).status, 400, op);
      assert.equal((await confirm(tokens.meera ?? '', op, target.id, { ...body, previewToken: 'x' })).status, 400, op);
      const withVersion = { ...body, expectedVersion: 1 };
      const p = await preview(tokens.meera ?? '', op, target.id, withVersion);
      const noKey = await confirm(tokens.meera ?? '', op, target.id, { ...withVersion, previewToken: p.body.previewToken }, null);
      assert.equal(noKey.status, 400, op);
      assert.equal(noKey.body.error.reason, 'IDEMPOTENCY_KEY_REQUIRED');
    }
    assert.equal(await version(target.id), 1);
  });

  // Detects: a stale confirmation that changes anything at all.
  test('a stale expected version returns 409 and changes no user, scope, session, version, or audit row', async () => {
    const target = await scopedUser('stale', ['IN'], ['Tech']);
    await signIn(target.email);
    const staleDeactivate = await preview(tokens.priya ?? '', 'DEACTIVATE', target.id, { expectedVersion: 1, reason: 'Stale attempt.' });
    const staleScopes = await preview(tokens.priya ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['US'], departments: ['HR'] });
    const done = await previewAndConfirm(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['IN', 'US'], departments: ['Tech'] });
    assert.equal(done.res.status, 200);
    const before = await stateOf(target.id);
    for (const [op, body, p] of [
      ['DEACTIVATE', { expectedVersion: 1, reason: 'Stale attempt.' }, staleDeactivate],
      ['SCOPES', { expectedVersion: 1, countries: ['US'], departments: ['HR'] }, staleScopes],
    ] as const) {
      const res = await confirm(tokens.priya ?? '', op, target.id, { ...body, previewToken: p.body.previewToken });
      assert.equal(res.status, 409, res.text);
      assert.deepEqual(res.body.error, { code: 'STALE_VERSION', message: 'This HR user changed after your preview. Review the current state and preview again.' });
    }
    assert.deepEqual(await stateOf(target.id), before);
    // A preview against an old version is also stale.
    const late = await preview(tokens.priya ?? '', 'PROFILE', target.id, { expectedVersion: 1, displayName: 'Late' });
    assert.equal(late.status, 409);
  });

  // Detects: a retry applying twice, or a reused key applying a different command.
  test('same key and command replays the original result; same key with different data conflicts', async () => {
    const target = await scopedUser('replay', ['IN'], ['Tech']);
    const key = newKey();
    const body = { expectedVersion: 1, countries: ['US'], departments: ['Tech'] };
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'SCOPES', target.id, body, key);
    assert.equal(res.status, 200, res.text);
    const replay = await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, previewToken: p.previewToken }, key);
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.deepEqual(replay.body.auditEvent, res.body.auditEvent);
    assert.equal(await version(target.id), 2);
    // The replay identifies the command even after the preview expired.
    now = new Date(START.getTime() + 10 * 60_000);
    const expiredReplay = await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, previewToken: p.previewToken }, key);
    assert.equal(expiredReplay.status, 200, expiredReplay.text);
    now = START;
    // Same key, different command (other countries, other operation, other target).
    const changed = await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, countries: ['IN'], previewToken: p.previewToken }, key);
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'DUPLICATE_OPERATION');
    const otherOp = await preview(tokens.meera ?? '', 'PROFILE', target.id, { expectedVersion: 2, displayName: 'Other' });
    const otherOpRes = await confirm(tokens.meera ?? '', 'PROFILE', target.id, { expectedVersion: 2, displayName: 'Other', previewToken: otherOp.body.previewToken }, key);
    assert.equal(otherOpRes.body.error.code, 'DUPLICATE_OPERATION');
    assert.equal(await version(target.id), 2);
    // A new key with the old preview is a new operation: stale.
    const fresh = await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, previewToken: p.previewToken });
    assert.equal(fresh.body.error.code, 'STALE_VERSION');
  });

  test('two concurrent scope changes from one version produce one success and one stale conflict', async () => {
    const target = await scopedUser('concurrent.scopes', ['IN'], ['Tech']);
    const pa = await preview(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['US'], departments: ['Tech'] });
    const pb = await preview(tokens.priya ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['IN'], departments: ['Support'] });
    const results = await Promise.all([
      confirm(tokens.meera ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['US'], departments: ['Tech'], previewToken: pa.body.previewToken }),
      confirm(tokens.priya ?? '', 'SCOPES', target.id, { expectedVersion: 1, countries: ['IN'], departments: ['Support'], previewToken: pb.body.previewToken }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(' | '));
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'STALE_VERSION');
    assert.equal(await version(target.id), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ? AND action = 'SCOPES_REPLACED'", [target.id]), 1);
  });

  // Detects: a confirmation that differs from the preview, or an old preview reused.
  test('the confirmation must match an unexpired preview for this operation, target, and actor', async () => {
    const target = await scopedUser('exact', ['IN'], ['Tech']);
    const body = { expectedVersion: 1, countries: ['US'], departments: ['Tech'] };
    const p = await preview(tokens.meera ?? '', 'SCOPES', target.id, body);
    const checks: [Record<string, unknown>, string | null, string][] = [
      [{ ...body, departments: ['Support'], previewToken: p.body.previewToken }, tokens.meera ?? '', 'PREVIEW_MISMATCH'],
      [{ ...body, previewToken: `${String(p.body.previewToken)}x` }, tokens.meera ?? '', 'PREVIEW_INVALID'],
      [{ ...body, previewToken: p.body.previewToken }, tokens.priya ?? '', 'PREVIEW_INVALID'],
    ];
    for (const [confirmation, token, reason] of checks) {
      const res = await confirm(token ?? '', 'SCOPES', target.id, confirmation);
      assert.equal(res.status, 400, res.text);
      assert.equal(res.body.error.reason, reason);
    }
    const otherTarget = await scopedUser('exact.other', ['IN'], ['Tech']);
    assert.equal((await confirm(tokens.meera ?? '', 'SCOPES', otherTarget.id, { ...body, previewToken: p.body.previewToken })).body.error.reason, 'PREVIEW_INVALID');
    const profileToken = (await preview(tokens.meera ?? '', 'PROFILE', target.id, { expectedVersion: 1, displayName: 'Y' })).body.previewToken;
    assert.equal((await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, previewToken: profileToken })).body.error.reason, 'PREVIEW_INVALID');
    now = new Date(START.getTime() + 5 * 60_000);
    const expired = await confirm(tokens.meera ?? '', 'SCOPES', target.id, { ...body, previewToken: p.body.previewToken });
    assert.equal(expired.body.error.reason, 'PREVIEW_EXPIRED');
    now = START;
    assert.equal(await version(target.id), 1);
    assert.equal(decodeJwt(String(p.body.previewToken)).exp, Math.floor(START.getTime() / 1000) + 300);
    assert.equal(p.body.previewExpiresAt, '2026-11-15T10:05:00.000Z');
  });
});

describe('audit', () => {
  test('access audit lists exact events newest first with actor, states, reason, and version', async () => {
    const target = await scopedUser('audited', ['IN'], ['Tech']);
    await previewAndConfirm(tokens.meera ?? '', 'PROFILE', target.id, { expectedVersion: 1, displayName: 'Audited Renamed' });
    await previewAndConfirm(tokens.priya ?? '', 'DEACTIVATE', target.id, { expectedVersion: 2, reason: 'Contract ended.' });
    const res = await auditOf(tokens.meera ?? '', target.id, { pageSize: '2' });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.page, { number: 1, size: 2, totalRows: 3, totalPages: 2 });
    const [deactivated, renamed] = res.body.events as Row[];
    assert.deepEqual({ ...deactivated, occurredAt: 'x' }, {
      action: 'HR_USER_DEACTIVATED', occurredAt: 'x',
      actor: { hrUserId: ids.priya, displayName: 'Priya Admin' },
      target: { hrUserId: target.id, displayName: 'Audited Renamed', email: target.email },
      before: { displayName: 'Audited Renamed', role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'] },
      after: { displayName: 'Audited Renamed', role: 'SCOPED', status: 'INACTIVE', countries: ['IN'], departments: ['Tech'] },
      reason: 'Contract ended.', resultingVersion: 3, revokedSessionCount: 0,
    });
    assert.deepEqual([renamed?.action, (renamed?.before as Row).displayName, (renamed?.after as Row).displayName, renamed?.reason, renamed?.revokedSessionCount],
      ['DISPLAY_NAME_CHANGED', 'audited Person', 'Audited Renamed', null, null]);
    const page2 = await auditOf(tokens.meera ?? '', target.id, { pageSize: '2', page: '2' });
    assert.deepEqual((page2.body.events as Row[]).map((e) => [e.action, e.actor, e.resultingVersion]), [['HR_USER_CREATED', null, 1]]);
    assert.equal((await auditOf(tokens.meera ?? '', 999_999)).status, 404);
  });

  // Detects: no-op submissions adding noise or bumping versions.
  test('a no-change submission writes no audit event and keeps the version', async () => {
    const target = await scopedUser('nochange', ['IN'], ['Tech']);
    const before = await stateOf(target.id);
    for (const [op, body] of [
      ['PROFILE', { expectedVersion: 1, displayName: 'nochange Person' }],
      ['SCOPES', { expectedVersion: 1, countries: ['IN'], departments: ['Tech'] }],
      ['REACTIVATE', { expectedVersion: 1, reason: 'Already active.' }],
    ] as const) {
      const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', op, target.id, body);
      assert.deepEqual([p.changed, p.changedFields], [false, []], op);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual([res.body.changed, res.body.auditEvent, res.body.hrUser.version], [false, null, 1], op);
    }
    assert.deepEqual(await stateOf(target.id), before);
  });

  // Detects: a change committed without its audit event (separate transactions).
  test('an audit insert failure rolls back user, scope, role, status, session, and version changes', async () => {
    const promote = await scopedUser('rollback.promote', ['IN'], ['Tech']);
    const deactivate = await scopedUser('rollback.deactivate', ['US'], ['Tech']);
    await signIn(promote.email);
    await signIn(deactivate.email);
    const pending: [Op, number, Record<string, unknown>][] = [
      ['PROMOTE', promote.id, { expectedVersion: 1 }],
      ['DEACTIVATE', deactivate.id, { expectedVersion: 1, reason: 'Rollback test.' }],
      ['SCOPES', deactivate.id, { expectedVersion: 1, countries: ['IN'], departments: ['HR'] }],
      ['PROFILE', promote.id, { expectedVersion: 1, displayName: 'Rolled Back' }],
    ];
    const previews = await Promise.all(pending.map(([op, id, body]) => preview(tokens.meera ?? '', op, id, body)));
    const before = [await stateOf(promote.id), await stateOf(deactivate.id)];
    const createBody = { email: nextEmail('rollback.create'), displayName: 'Rolled Back', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] };
    const createPreview = await previewCreate(tokens.meera ?? '', createBody);
    const [{ cutoff }] = await query('SELECT UTC_TIMESTAMP(3) AS cutoff');
    await query('SELECT SLEEP(0.01)');
    await execStatement(pool, `ALTER TABLE access_audit_events ADD CONSTRAINT test_only_fail_audit CHECK (created_at <= '${String(cutoff)}')`);
    try {
      for (const [index, [op, id, body]] of pending.entries()) {
        const res = await confirm(tokens.meera ?? '', op, id, { ...body, previewToken: previews[index]?.body.previewToken });
        assert.equal(res.status, 500, `${op} ${res.text}`);
        assert.deepEqual(res.body.error, { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
      }
      const created = await confirmCreate(tokens.meera ?? '', { ...createBody, previewToken: createPreview.body.previewToken });
      assert.equal(created.status, 500);
    } finally {
      await execStatement(pool, 'ALTER TABLE access_audit_events DROP CHECK test_only_fail_audit');
    }
    assert.deepEqual([await stateOf(promote.id), await stateOf(deactivate.id)], before);
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [createBody.email]), 0);
  });

  // Detects: an update or delete path for audit history.
  test('audit events cannot be updated or deleted through application operations', async () => {
    for (const method of ['patch', 'delete', 'put'] as const) {
      const res = await request(app)[method](`${API}/hr-users/${ids.rohan}/access-audit`).set(bearer(tokens.meera ?? ''));
      assert.equal(res.status, 404, method);
      assert.equal(res.body.error.message, 'Route not found.');
    }
    const srcDir = path.resolve('src');
    const files = (await readdir(srcDir, { recursive: true })).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const text = await readFile(path.join(srcDir, file), 'utf8');
      assert.doesNotMatch(text, /(UPDATE|DELETE\s+FROM)\s+access_audit_events/i, file);
    }
  });

  // Detects: secrets copied into audit rows.
  test('audit rows contain no password, hash, JWT, cookie, session ID, or authorization data', async () => {
    const target = await scopedUser('secrets', ['IN'], ['Tech']);
    const targetToken = await signIn(target.email);
    await previewAndConfirm(tokens.meera ?? '', 'DEACTIVATE', target.id, { expectedVersion: 1, reason: 'Secrets check.' });
    const sessionIds = (await query('SELECT id FROM hr_sessions')).map((r) => String(r.id));
    const hashes = (await query('SELECT password_hash FROM hr_users')).map((r) => String(r.password_hash));
    const rows = await query(`SELECT CAST(before_state AS CHAR) AS b, CAST(after_state AS CHAR) AS a, reason, operation_idempotency_key AS k, operation_fingerprint AS f
                              FROM access_audit_events`);
    for (const row of rows) {
      const text = JSON.stringify([row.b, row.a, row.reason]);
      assert.doesNotMatch(text, /argon2|password|token|bearer|cookie|session/i);
      for (const secret of [targetToken, tokens.meera ?? '', ...sessionIds, ...hashes]) assert.ok(!JSON.stringify(row).includes(secret));
      for (const state of [row.a, row.b].filter((v): v is string => typeof v === 'string')) {
        assert.deepEqual(Object.keys(JSON.parse(state)).sort(), ['countries', 'departments', 'displayName', 'role', 'status']);
      }
    }
  });
});

describe('API', () => {
  test('list search, filters, sorting, and pagination run server-side', async () => {
    const t = tokens.meera ?? '';
    const emails = async (q: Record<string, string>) => {
      const res = await list(t, { pageSize: '100', ...q });
      assert.equal(res.status, 200, res.text);
      return (res.body.users as Row[]).map((u) => String(u.email));
    };
    assert.deepEqual(await emails({ q: 'ROHAN M' }), ['rohan@acme.com']);
    assert.deepEqual(await emails({ q: 'Rohan@ACME.com' }), ['rohan@acme.com']);
    assert.deepEqual(await emails({ q: 'rohan@acme' }), [], 'email matches exactly, not partially');
    assert.deepEqual(await emails({ q: '%' }), [], 'wildcards are literal');
    const admins = await emails({ role: 'ADMIN' });
    assert.ok(admins.includes('meera@acme.com') && !admins.includes('rohan@acme.com'));
    // Admin HR counts as access to every country and department.
    const usTech = await emails({ country: 'US', department: 'Tech' });
    assert.ok(usTech.includes('meera@acme.com') && !usTech.includes('rohan@acme.com'));
    const inSupport = await emails({ country: 'IN', department: 'Support' });
    assert.ok(inSupport.includes('meera@acme.com') && inSupport.includes('rohan@acme.com') && !inSupport.includes('empty@acme.com'));
    // Inactive users are hidden by default.
    const inactive = await scopedUser('hidden', ['IN'], ['Tech']);
    await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: inactive.id, status: 'INACTIVE', reason: 'hidden' });
    assert.ok(!(await emails({})).includes(inactive.email));
    assert.ok((await emails({ status: 'ALL' })).includes(inactive.email));
    assert.ok((await emails({ status: 'INACTIVE' })).every((e) => e !== 'meera@acme.com'));
    // Sorting.
    const byName = await list(t, { sort: 'name', pageSize: '100', status: 'ALL' });
    const names = (byName.body.users as Row[]).map((u) => String(u.displayName));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const byEmailDesc = (await list(t, { sort: 'email', direction: 'desc', pageSize: '100' })).body.users as Row[];
    const emailsDesc = byEmailDesc.map((u) => String(u.email));
    assert.deepEqual(emailsDesc, [...emailsDesc].sort((a, b) => b.localeCompare(a, 'en')));
    const byUpdated = (await list(t, { pageSize: '100' })).body.users as Row[];
    const updated = byUpdated.map((u) => String(u.updatedAt));
    assert.deepEqual(updated, [...updated].sort().reverse(), 'default: last updated, newest first');
    // Pagination with correct totals.
    const total = (await list(t, { status: 'ALL' })).body.page.totalRows as number;
    const page = await list(t, { status: 'ALL', pageSize: '3', page: '2' });
    assert.deepEqual([page.body.users.length, page.body.page.totalRows, page.body.page.totalPages], [3, total, Math.ceil(total / 3)]);
    const empty = await list(t, { q: 'nobody-matches-this' });
    assert.deepEqual([empty.body.users, empty.body.page.totalRows, empty.body.emptyMessage], [[], 0, 'No HR users match these filters.']);
    // Allowlisted parameters only.
    const badQueries: Record<string, string | string[]>[] = [{ sort: 'password' }, { pageSize: '101' }, { role: 'SUPERUSER' }, { status: 'active' }, { unknown: '1' }, { role: ['ADMIN', 'SCOPED'] }];
    for (const bad of badQueries) {
      assert.equal((await list(t, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await detail(t, 'abc')).status, 404);
    assert.equal((await detail(t, 999_999)).status, 404);
  });

  // Detects: malformed or extra body fields reaching the service.
  test('runtime schemas reject unknown and malformed fields', async () => {
    const target = await scopedUser('schemas', ['IN'], ['Tech']);
    const t = tokens.meera ?? '';
    for (const body of [
      { expectedVersion: 1, displayName: 'X', email: 'new@acme.com' },
      { expectedVersion: '1', displayName: 'X' },
      { expectedVersion: 0, displayName: 'X' },
      { expectedVersion: 1, displayName: '' },
      { expectedVersion: 1, displayName: 'x'.repeat(101) },
    ]) assert.equal((await preview(t, 'PROFILE', target.id, body)).status, 400, JSON.stringify(body));
    for (const body of [
      { email: 'not-an-email', displayName: 'X', role: 'ADMIN', countries: [], departments: [] },
      { email: nextEmail(), displayName: 'X', role: 'SUPERUSER', countries: [], departments: [] },
      { email: nextEmail(), displayName: 'X', role: 'ADMIN', countries: [], departments: [], password: 'chosen-by-admin' },
      { email: nextEmail(), displayName: 'X', role: 'ADMIN', countries: [] },
    ]) assert.equal((await previewCreate(t, body)).status, 400, JSON.stringify(body));
  });

  // Detects: hashes, session IDs, or tokens in any access-management response.
  test('responses contain no password hash or session data', async () => {
    const target = await scopedUser('no.leak', ['IN'], ['Tech']);
    const targetToken = await signIn(target.email);
    const sid = String(decodeJwt(targetToken).sid);
    const { preview: p, res } = await previewAndConfirm(tokens.meera ?? '', 'PROMOTE', target.id, { expectedVersion: 1 });
    const bodies = [JSON.stringify(p), res.text, (await detail(tokens.meera ?? '', target.id)).text, (await list(tokens.meera ?? '', { pageSize: '100' })).text, (await auditOf(tokens.meera ?? '', target.id)).text];
    const hashes = (await query('SELECT password_hash FROM hr_users')).map((r) => String(r.password_hash));
    for (const text of bodies) {
      assert.doesNotMatch(text, /argon2|password_?hash|sessionId|"sid"/i);
      assert.ok(!text.includes(sid) && !text.includes(targetToken));
      for (const hash of hashes) assert.ok(!text.includes(hash));
    }
  });

  // Detects: bodies, emails, reasons, or temporary passwords in logs.
  test('logs contain only route patterns: no body, password, token, or audit state', async () => {
    const email = nextEmail('logged');
    const { res } = await createViaApi(tokens.meera ?? '', { email, displayName: 'Logged Person', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] });
    const id = Number(res.body.hrUser.hrUserId);
    await previewAndConfirm(tokens.meera ?? '', 'DEACTIVATE', id, { expectedVersion: 1, reason: 'A private reason for the log test.' });
    await auditOf(tokens.meera ?? '', id);
    const text = JSON.stringify(logs);
    for (const secret of [String(res.body.temporaryPassword), email, 'private reason', tokens.meera ?? '', 'INACTIVE', 'Logged Person']) {
      assert.ok(!text.includes(secret), secret);
    }
    for (const entry of logs) {
      assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'event', 'method', 'path', 'requestId', 'status']);
      assert.ok(!String(entry.path).includes(String(id)), String(entry.path));
    }
    assert.ok(logs.some((e) => e.path === '/api/v1/hr-users/:hrUserId/deactivate'));
  });
});

describe('temporary-password recovery (11a)', () => {
  const regenPath = (id: number) => `${API}/hr-users/${id}/regenerate-temporary-password`;
  const previewRegen = (token: string, id: number, body: unknown) => request(app).post(`${regenPath(id)}/preview`).set(bearer(token)).send(body as object);
  const confirmRegen = (token: string, id: number, body: unknown, key: string | null = newKey()) => {
    const req = request(app).post(regenPath(id)).set(bearer(token));
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  async function regenerate(token: string, id: number, body: Record<string, unknown>, key = newKey()) {
    const p = await previewRegen(token, id, body);
    assert.equal(p.status, 200, p.text);
    const res = await confirmRegen(token, id, { ...body, previewToken: p.body.previewToken }, key);
    return { preview: p.body, res };
  }
  const hashOf = async (id: number): Promise<string> => String(must((await query('SELECT password_hash FROM hr_users WHERE id = ?', [id]))[0], 'user').password_hash);
  const canSignIn = (email: string, password: string): Promise<boolean> => auth.signIn(email, password).then(() => true, () => false);

  // Given: Admin creates an HR user but the successful response is treated as lost.
  // When: Admin retries create with the same key, receives the recovery-required
  //       state, then previews and confirms password regeneration.
  // Then: one account exists, a new temporary password is returned once, and it signs in.
  // Detects: a committed create with a lost response stranding an unusable active account.
  test('a lost creation response is recovered by regenerating the temporary password', async () => {
    const email = nextEmail('lost.create');
    const key = newKey();
    const body = { email, displayName: 'Lost Create', role: 'SCOPED', countries: ['IN'], departments: ['Tech'] };
    const p = await previewCreate(tokens.meera ?? '', body);
    const lost = await confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.body.previewToken }, key);
    assert.equal(lost.status, 201, lost.text);
    assert.equal(lost.body.credentialRecoveryRequired, false);
    // The response above is treated as lost: its password is never used.

    const retry = await confirmCreate(tokens.meera ?? '', { ...body, previewToken: p.body.previewToken }, key);
    assert.equal(retry.status, 201, retry.text);
    assert.equal(retry.headers['idempotency-replayed'], 'true');
    assert.deepEqual([retry.body.temporaryPassword, retry.body.credentialRecoveryRequired], [null, true]);
    assert.match(retry.body.temporaryPasswordNotice, /regenerate/i);
    const id = Number(retry.body.hrUser.hrUserId);

    const { res } = await regenerate(tokens.meera ?? '', id, { expectedVersion: 1, reason: 'Original creation response was lost.' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.credentialRecoveryRequired, false);
    const password = String(res.body.temporaryPassword);
    assert.ok(password.length >= 12 && [...password].every((c) => TEMPORARY_PASSWORD_ALPHABET.includes(c)));
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_users WHERE email = ?', [email]), 1);
    assert.equal(await canSignIn(email, password), true);
    assert.equal(await canSignIn(email, String(lost.body.temporaryPassword)), false, 'the lost password no longer works');
  });

  test('Scoped HR gets 403 and unauthenticated requests get 401; nothing is written', async () => {
    const target = await scopedUser('regen.blocked', ['IN'], ['Tech']);
    const before = await stateOf(target.id);
    const body = { expectedVersion: 1, reason: 'Blocked.' };
    for (const res of [await previewRegen(tokens.rohan ?? '', target.id, body), await confirmRegen(tokens.rohan ?? '', target.id, { ...body, previewToken: 'x' })]) {
      assert.equal(res.status, 403, res.text);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
    assert.equal((await request(app).post(`${regenPath(target.id)}/preview`).send(body)).status, 401);
    assert.equal((await request(app).post(regenPath(target.id)).set('Idempotency-Key', newKey()).send(body)).status, 401);
    assert.deepEqual(await stateOf(target.id), before);
  });

  // Detects: a preview that writes, miscounts sessions, or leaks a credential.
  test('preview writes nothing and reports the exact target, sessions, warning, reason, and expiry', async () => {
    const target = await scopedUser('regen.preview', ['IN'], ['Tech']);
    await signIn(target.email);
    await signIn(target.email);
    await auth.signOut(await signIn(target.email)); // revoked: not counted
    const before = await stateOf(target.id);
    const p = await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: '  Forgot the temporary credential.  ' });
    assert.equal(p.status, 200, p.text);
    assert.deepEqual({ ...p.body, previewToken: 'x' }, {
      operation: 'REGENERATE_PASSWORD',
      target: { hrUserId: target.id, displayName: 'regen.preview Person', email: target.email, role: 'SCOPED', status: 'ACTIVE' },
      expectedVersion: 1,
      sessionsToRevoke: 2,
      warning: 'Confirming replaces this HR user\'s password. Every previous password and every active session stops working.',
      reason: 'Forgot the temporary credential.',
      previewToken: 'x',
      previewExpiresAt: '2026-11-15T10:05:00.000Z',
    });
    assert.doesNotMatch(p.text, /temporaryPassword|argon2/i);
    assert.deepEqual(await stateOf(target.id), before);
    assert.equal((await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 2, reason: 'x' })).status, 409);
  });

  // Detects: plaintext storage, surviving sessions or passwords, or a missing audit event.
  test('confirmation stores only a new Argon2id hash, revokes every session, and audits once', async () => {
    const target = await scopedUser('regen.confirm', ['IN'], ['Tech']);
    const sessions = [await signIn(target.email), await signIn(target.email)];
    const oldHash = await hashOf(target.id);
    const { res } = await regenerate(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Credential shared on the wrong channel.' });
    assert.equal(res.status, 200, res.text);
    const password = String(res.body.temporaryPassword);
    assert.match(res.body.temporaryPasswordNotice, /no email was sent/);
    const hash = await hashOf(target.id);
    assert.notEqual(hash, oldHash);
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.ok(!hash.includes(password));
    assert.deepEqual([res.body.hrUser.version, res.body.revokedSessionCount], [2, 2]);
    assert.equal(await count('SELECT COUNT(*) AS n FROM hr_sessions WHERE hr_user_id = ? AND revoked_at IS NULL', [target.id]), 0);
    for (const token of sessions) assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(token))).status, 401);
    assert.equal(await canSignIn(target.email, PASSWORD), false, 'the previous password stops working');
    assert.equal(await canSignIn(target.email, password), true);
    const event = res.body.auditEvent;
    assert.deepEqual(
      [event.action, event.actor, event.reason, event.resultingVersion, event.revokedSessionCount, event.before.status, event.after.role],
      ['TEMPORARY_PASSWORD_REGENERATED', { hrUserId: ids.meera, displayName: 'Meera Iyer' }, 'Credential shared on the wrong channel.', 2, 2, 'ACTIVE', 'SCOPED'],
    );
    assert.equal(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ? AND action = 'TEMPORARY_PASSWORD_REGENERATED'", [target.id]), 1);
  });

  test('a stale expected version writes nothing', async () => {
    const target = await scopedUser('regen.stale', ['IN'], ['Tech']);
    await signIn(target.email);
    const stale = await previewRegen(tokens.priya ?? '', target.id, { expectedVersion: 1, reason: 'Stale.' });
    await previewAndConfirm(tokens.meera ?? '', 'PROFILE', target.id, { expectedVersion: 1, displayName: 'Renamed First' });
    const before = await stateOf(target.id);
    const res = await confirmRegen(tokens.priya ?? '', target.id, { expectedVersion: 1, reason: 'Stale.', previewToken: stale.body.previewToken });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, 'STALE_VERSION');
    assert.ok(!('temporaryPassword' in res.body));
    assert.deepEqual(await stateOf(target.id), before);
  });

  // Detects: a retry regenerating twice, or a reused key applying another command.
  test('same key and command replays without regenerating; same key with other data conflicts', async () => {
    const target = await scopedUser('regen.replay', ['IN'], ['Tech']);
    const other = await scopedUser('regen.replay.other', ['IN'], ['Tech']);
    const key = newKey();
    const body = { expectedVersion: 1, reason: 'Replay check.' };
    const { preview: p, res } = await regenerate(tokens.meera ?? '', target.id, body, key);
    assert.equal(res.status, 200, res.text);
    const hash = await hashOf(target.id);
    const replay = await confirmRegen(tokens.meera ?? '', target.id, { ...body, previewToken: p.previewToken }, key);
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.deepEqual([replay.body.temporaryPassword, replay.body.credentialRecoveryRequired], [null, true]);
    assert.match(replay.body.temporaryPasswordNotice, /cannot be shown/);
    assert.deepEqual(replay.body.auditEvent, res.body.auditEvent);
    assert.equal(replay.body.revokedSessionCount, res.body.revokedSessionCount);
    assert.deepEqual([await hashOf(target.id), await version(target.id)], [hash, 2]);
    assert.ok(!replay.text.includes(String(res.body.temporaryPassword)));
    // Same key with a different reason, expected version, or target.
    const conflicts = [
      await confirmRegen(tokens.meera ?? '', target.id, { ...body, reason: 'Another reason.', previewToken: p.previewToken }, key),
      await confirmRegen(tokens.meera ?? '', target.id, { ...body, expectedVersion: 2, previewToken: p.previewToken }, key),
    ];
    const otherPreview = await previewRegen(tokens.meera ?? '', other.id, body);
    conflicts.push(await confirmRegen(tokens.meera ?? '', other.id, { ...body, previewToken: otherPreview.body.previewToken }, key));
    for (const conflict of conflicts) {
      assert.equal(conflict.status, 409, conflict.text);
      assert.equal(conflict.body.error.code, 'DUPLICATE_OPERATION');
    }
    assert.deepEqual([await hashOf(target.id), await version(target.id), await version(other.id)], [hash, 2, 1]);
  });

  // Detects: no way back after a lost regeneration response.
  test('a fresh regeneration after a lost regeneration response returns another usable password', async () => {
    const target = await scopedUser('regen.lost', ['IN'], ['Tech']);
    const first = await regenerate(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'First attempt.' });
    assert.equal(first.res.status, 200);
    const lostPassword = String(first.res.body.temporaryPassword); // treated as lost
    const second = await regenerate(tokens.meera ?? '', target.id, { expectedVersion: 2, reason: 'First response was lost.' });
    assert.equal(second.res.status, 200, second.res.text);
    const password = String(second.res.body.temporaryPassword);
    assert.notEqual(password, lostPassword);
    assert.equal(await canSignIn(target.email, lostPassword), false);
    assert.equal(await canSignIn(target.email, password), true);
    assert.equal(await version(target.id), 3);
  });

  // Detects: a hash change or session revocation committed without its audit event.
  test('an audit insert failure rolls back the hash, sessions, and version', async () => {
    const target = await scopedUser('regen.rollback', ['IN'], ['Tech']);
    await signIn(target.email);
    const p = await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Rollback.' });
    const before = await stateOf(target.id);
    const [{ cutoff }] = await query('SELECT UTC_TIMESTAMP(3) AS cutoff');
    await query('SELECT SLEEP(0.01)');
    await execStatement(pool, `ALTER TABLE access_audit_events ADD CONSTRAINT test_only_fail_audit CHECK (created_at <= '${String(cutoff)}')`);
    let res;
    try {
      res = await confirmRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Rollback.', previewToken: p.body.previewToken });
    } finally {
      await execStatement(pool, 'ALTER TABLE access_audit_events DROP CHECK test_only_fail_audit');
    }
    assert.equal(res.status, 500);
    assert.deepEqual(res.body.error, { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    assert.deepEqual(await stateOf(target.id), before); // includes password_hash, version, sessions, audit count
    assert.equal(await canSignIn(target.email, PASSWORD), true);
  });

  test('concurrent regenerations: different keys give one success and one stale conflict; the same key applies once', async () => {
    const target = await scopedUser('regen.concurrent', ['IN'], ['Tech']);
    const body = { expectedVersion: 1, reason: 'Concurrent.' };
    const pa = await previewRegen(tokens.meera ?? '', target.id, body);
    const pb = await previewRegen(tokens.priya ?? '', target.id, body);
    const results = await Promise.all([
      confirmRegen(tokens.meera ?? '', target.id, { ...body, previewToken: pa.body.previewToken }),
      confirmRegen(tokens.priya ?? '', target.id, { ...body, previewToken: pb.body.previewToken }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(' | '));
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'STALE_VERSION');
    const winner = must(results.find((r) => r.status === 200), 'winner');
    assert.equal(await canSignIn(target.email, String(winner.body.temporaryPassword)), true);
    assert.equal(await version(target.id), 2);

    const same = await scopedUser('regen.same.key', ['IN'], ['Tech']);
    const p = await previewRegen(tokens.meera ?? '', same.id, body);
    const key = newKey();
    const pair = await Promise.all([1, 2].map(() => confirmRegen(tokens.meera ?? '', same.id, { ...body, previewToken: p.body.previewToken }, key)));
    assert.deepEqual(pair.map((r) => r.status), [200, 200], pair.map((r) => r.text).join(' | '));
    assert.deepEqual(pair.map((r) => r.body.credentialRecoveryRequired).sort(), [false, true]);
    assert.equal(pair.filter((r) => r.body.temporaryPassword !== null).length, 1);
    assert.equal(await version(same.id), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ? AND action = 'TEMPORARY_PASSWORD_REGENERATED'", [same.id]), 1);
  });

  test('reason, expected version, and idempotency key are required', async () => {
    const target = await scopedUser('regen.required', ['IN'], ['Tech']);
    for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, reason: '   ' }, { expectedVersion: 1, reason: 'x'.repeat(2001) }, { reason: 'ok' }, { expectedVersion: 1, reason: 'ok', extra: 1 }]) {
      assert.equal((await previewRegen(tokens.meera ?? '', target.id, body)).status, 400, JSON.stringify(body));
      assert.equal((await confirmRegen(tokens.meera ?? '', target.id, { ...body, previewToken: 'x' })).status, 400, JSON.stringify(body));
    }
    assert.equal((await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'x'.repeat(2000) })).status, 200);
    const p = await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'ok' });
    const noKey = await confirmRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'ok', previewToken: p.body.previewToken }, null);
    assert.equal(noKey.body.error.reason, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await previewRegen(tokens.meera ?? '', 999_999, { expectedVersion: 1, reason: 'ok' })).status, 404);
    assert.equal(await version(target.id), 1);
  });

  // Review fix 11b: a lost self-regeneration response would revoke the only
  // session able to recover, so an Admin can never regenerate their own password.
  test('an Admin cannot regenerate their own temporary password; nothing is written', async () => {
    const meeraId = ids.meera ?? 0;
    const before = await stateOf(meeraId);
    const body = { expectedVersion: Number(before.user?.version), reason: 'Self.' };
    const previewRes = await previewRegen(tokens.meera ?? '', meeraId, body);
    const confirmRes = await confirmRegen(tokens.meera ?? '', meeraId, { ...body, previewToken: 'not-a-real-preview-token' });
    for (const res of [previewRes, confirmRes]) {
      assert.equal(res.status, 409, res.text);
      assert.deepEqual(res.body.error, {
        code: 'SELF_PASSWORD_REGENERATION_FORBIDDEN', message: 'Ask another active Admin HR user to regenerate your temporary password.',
      });
    }
    // The domain operation refuses it too, whatever the caller.
    await assert.rejects(
      regenerateTemporaryPassword(pool, { actorHrUserId: meeraId, targetHrUserId: meeraId, passwordHash: before.user?.password_hash as string, reason: 'Self.' }),
      (error: unknown) => thrown(error).code === 'SELF_PASSWORD_REGENERATION',
    );
    assert.deepEqual(await stateOf(meeraId), before); // hash, sessions, version, audit unchanged
    assert.equal((await list(tokens.meera ?? '')).status, 200, 'the session still works');
  });

  // Review fix 11b: sign-in must not create a session from a password that a
  // concurrent regeneration replaced. Both orders, with controlled barriers.
  describe('sign-in racing regeneration', () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** True once some connection is running a statement matching the pattern (blocked on a row lock). */
    async function waitForStatement(pattern: RegExp, timeoutMs = 5000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const rows = await query('SHOW FULL PROCESSLIST');
        if (rows.some((r) => typeof r.Info === 'string' && pattern.test(r.Info))) return true;
        await sleep(10);
      }
      return false;
    }
    const sessionTokens = () => createSessionTokens({ signingKey: SIGNING_KEY, clock });

    // Sign-in has verified the old password and is paused before inserting its
    // session; the regeneration starts. The new session must end up revoked.
    test('sign-in first: the regeneration waits, then revokes the new session', async () => {
      const target = await scopedUser('race.signin.first', ['IN'], ['Tech']);
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let reached = (): void => undefined;
      const atGate = new Promise<void>((resolve) => { reached = resolve; });
      const racingAuth = createAuthService({
        pool, tokens: sessionTokens(), clock, afterPasswordCheck: async () => { reached(); await gate; },
      });
      const p = await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Race: sign-in first.' });
      const signing = racingAuth.signIn(target.email, PASSWORD);
      await atGate;
      const regenerating = confirmRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Race: sign-in first.', previewToken: p.body.previewToken })
        .then((r) => r);
      const regenerationOutcome = await Promise.race([
        regenerating.then(() => 'finished before sign-in completed'),
        waitForStatement(/FROM hr_users[\s\S]*FOR UPDATE/).then((seen) => (seen ? 'waiting for the sign-in' : 'not observed')),
      ]);
      release();
      const { token } = await signing;
      const regen = await regenerating;
      assert.equal(regen.status, 200, regen.text);
      assert.equal(regenerationOutcome, 'waiting for the sign-in', 'the regeneration must wait for the sign-in row lock');
      assert.equal(regen.body.revokedSessionCount, 1);
      assert.equal((await request(app).get(`${API}/auth/me`).set(bearer(token))).status, 401, 'the old-password session is revoked');
      assert.equal(await count('SELECT COUNT(*) AS n FROM hr_sessions WHERE hr_user_id = ? AND revoked_at IS NULL', [target.id]), 0);
      assert.equal((await auth.signIn(target.email, String(regen.body.temporaryPassword))).token.length > 0, true);
    });

    // The regeneration has replaced the hash and holds the row lock (held at its
    // session-revocation step by the test); the sign-in starts with the old password.
    test('regeneration first: the sign-in waits, then reads the new hash and the old password fails', async () => {
      const target = await scopedUser('race.regen.first', ['IN'], ['Tech']);
      await signIn(target.email);
      const [existing] = await query('SELECT id FROM hr_sessions WHERE hr_user_id = ?', [target.id]);
      const holder = await pool.getConnection();
      let regenerating;
      let signing;
      try {
        await holder.beginTransaction();
        await holder.query('SELECT id FROM hr_sessions WHERE id = ? FOR UPDATE', [existing?.id]);
        const p = await previewRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Race: regeneration first.' });
        regenerating = confirmRegen(tokens.meera ?? '', target.id, { expectedVersion: 1, reason: 'Race: regeneration first.', previewToken: p.body.previewToken })
          .then((r) => r);
        assert.ok(await waitForStatement(/UPDATE hr_sessions SET revoked_at/), 'the regeneration reached session revocation under its row lock');
        signing = auth.signIn(target.email, PASSWORD).then((r) => ({ ok: true as const, token: r.token }), (e: unknown) => ({ ok: false as const, code: thrown(e).code }));
        assert.ok(await waitForStatement(/FROM hr_users[\s\S]*FOR SHARE|INSERT INTO hr_sessions/), 'the sign-in is waiting on the HR-user row');
      } finally {
        await holder.commit();
        holder.release();
      }
      const regen = await regenerating;
      assert.equal(regen.status, 200, regen.text);
      const outcome = await signing;
      assert.deepEqual(outcome, { ok: false, code: 'INVALID_CREDENTIALS' }, 'the old password must not create a session');
      assert.equal(await count('SELECT COUNT(*) AS n FROM hr_sessions WHERE hr_user_id = ? AND revoked_at IS NULL', [target.id]), 0);
      assert.ok((await auth.signIn(target.email, String(regen.body.temporaryPassword))).token.length > 0);
    });
  });

  // Detects: the new password or its hash reaching logs, audit, contract, or later reads.
  test('the password and hash are absent from logs, audit, OpenAPI, reads, and replay output', async () => {
    const target = await scopedUser('regen.leak', ['IN'], ['Tech']);
    const key = newKey();
    const body = { expectedVersion: 1, reason: 'Leak check.' };
    const { preview: p, res } = await regenerate(tokens.meera ?? '', target.id, body, key);
    const password = String(res.body.temporaryPassword);
    const hash = await hashOf(target.id);
    const replay = await confirmRegen(tokens.meera ?? '', target.id, { ...body, previewToken: p.previewToken }, key);
    const reads = [
      replay.text, JSON.stringify(p), (await detail(tokens.meera ?? '', target.id)).text,
      (await list(tokens.meera ?? '', { pageSize: '100' })).text, (await auditOf(tokens.meera ?? '', target.id)).text,
      JSON.stringify(logs), await readFile(path.resolve('openapi/openapi.json'), 'utf8'),
    ];
    for (const [index, text] of reads.entries()) {
      assert.ok(!text.includes(password), `password in output ${index}`);
      assert.ok(!text.includes(hash), `hash in output ${index}`);
      assert.doesNotMatch(text, /\$argon2id\$/, `hash format in output ${index}`);
    }
    assert.ok(!res.text.includes(hash));
    const audit = await query('SELECT CAST(before_state AS CHAR) AS b, CAST(after_state AS CHAR) AS a, reason FROM access_audit_events WHERE target_hr_user_id = ?', [target.id]);
    assert.ok(!JSON.stringify(audit).includes(password) && !JSON.stringify(audit).includes(hash));
    assert.ok(!(await auditOf(tokens.meera ?? '', target.id)).text.includes(key), 'idempotency key is not public');
  });
});

describe('migration 004', () => {
  // Detects: a second audit table, or audit columns that accept malformed operations.
  test('extends access_audit_events only, with checked operation, reason, and version columns', async () => {
    const tables = (await query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '%audit%'")).map((r) => r.t);
    assert.deepEqual(tables, ['access_audit_events']);
    const columns = await query(
      `SELECT column_name AS c, column_type AS t, is_nullable AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'access_audit_events' AND ordinal_position > 7 ORDER BY ordinal_position`,
    );
    assert.deepEqual(columns.map((r) => `${String(r.c)} ${String(r.t)} ${String(r.n)}`), [
      'reason varchar(2000) YES', 'resulting_version int unsigned YES', 'revoked_session_count int unsigned YES',
      'operation_idempotency_key varchar(128) YES', 'operation_fingerprint char(64) YES',
    ]);
    const base = {
      actor_hr_user_id: ids.priya, target_hr_user_id: ids.empty, action: 'HR_USER_DEACTIVATED',
      before_state: '{}', after_state: '{}', resulting_version: 2, reason: 'ok',
      operation_idempotency_key: 'migration-check-key-0001', operation_fingerprint: 'a'.repeat(64),
    };
    const rejects = async (overrides: Record<string, unknown>, constraint: string) => {
      await assert.rejects(execStatement(pool, 'INSERT INTO access_audit_events SET ?', [{ ...base, ...overrides }]), (error: unknown) => {
        assert.match(thrown(error).message, new RegExp(constraint));
        return true;
      });
    };
    await rejects({ operation_fingerprint: null }, 'chk_access_audit_operation');
    await rejects({ operation_fingerprint: 'A'.repeat(64) }, 'chk_access_audit_fingerprint_format');
    await rejects({ reason: '   ' }, 'chk_access_audit_reason');
    await rejects({ reason: null }, 'chk_access_audit_status_reason');
    await rejects({ actor_hr_user_id: null }, 'chk_access_audit_operation_actor');
    assert.equal(await count('SELECT COUNT(*) AS n FROM access_audit_events WHERE operation_idempotency_key = ?', [base.operation_idempotency_key]), 0);
    // Every creation event carries resulting version 1, including system-created users.
    assert.equal(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'HR_USER_CREATED' AND (resulting_version IS NULL OR resulting_version <> 1)"), 0);
  });
});

describe('last active Admin', () => {
  // Detects: management lockout. Runs last: it leaves a single active Admin.
  test('the last active Admin cannot be deactivated; self-deactivation works when another Admin is active', async () => {
    const admins = (await query("SELECT id FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ?", [ids.meera])).map((r) => Number(r.id));
    for (const id of admins) await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: id, status: 'INACTIVE', reason: 'setup' });
    tokens.meera = await signIn('meera@acme.com');
    const meeraVersion = await version(ids.meera ?? 0);
    const before = await stateOf(ids.meera ?? 0);
    const blocked = await preview(tokens.meera ?? '', 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: meeraVersion, reason: 'Leaving.' });
    assert.equal(blocked.status, 409, blocked.text);
    assert.deepEqual(blocked.body.error, {
      code: 'LAST_ACTIVE_ADMIN', message: 'You cannot deactivate the last active Admin HR user. Activate or create another Admin first.',
    });
    // Review fix 11b: the sole Admin cannot regenerate their own password either.
    const selfRegen = await request(app).post(`${API}/hr-users/${ids.meera}/regenerate-temporary-password/preview`).set(bearer(tokens.meera ?? ''))
      .send({ expectedVersion: meeraVersion, reason: 'Sole Admin.' });
    assert.equal(selfRegen.status, 409, selfRegen.text);
    assert.equal(selfRegen.body.error.code, 'SELF_PASSWORD_REGENERATION_FORBIDDEN');
    const selfRegenConfirm = await request(app).post(`${API}/hr-users/${ids.meera}/regenerate-temporary-password`).set(bearer(tokens.meera ?? ''))
      .set('Idempotency-Key', newKey()).send({ expectedVersion: meeraVersion, reason: 'Sole Admin.', previewToken: 'x' });
    assert.equal(selfRegenConfirm.body.error.code, 'SELF_PASSWORD_REGENERATION_FORBIDDEN');
    assert.deepEqual(await stateOf(ids.meera ?? 0), before);
    assert.equal((await list(tokens.meera ?? '')).status, 200, 'the sole Admin keeps a working session');
    // A preview made while another Admin was active cannot be confirmed after that Admin left.
    const priyaVersion = await version(ids.priya ?? 0);
    const back = await previewAndConfirm(tokens.meera ?? '', 'REACTIVATE', ids.priya ?? 0, { expectedVersion: priyaVersion, reason: 'Back.' });
    assert.equal(back.res.status, 200, back.res.text);
    const early = await preview(tokens.meera ?? '', 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: meeraVersion, reason: 'Leaving.' });
    assert.equal(early.status, 200, early.text);
    await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.priya ?? 0, status: 'INACTIVE', reason: 'Left again.' });
    const late = await confirm(tokens.meera ?? '', 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: meeraVersion, reason: 'Leaving.', previewToken: early.body.previewToken });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'LAST_ACTIVE_ADMIN');
    assert.deepEqual(await stateOf(ids.meera ?? 0), before);

    // With Priya active again, Meera can deactivate herself; her session ends.
    await setHrUserStatus(pool, { actorHrUserId: ids.meera ?? 0, targetHrUserId: ids.priya ?? 0, status: 'ACTIVE', reason: 'Back again.' });
    const self = await previewAndConfirm(tokens.meera ?? '', 'DEACTIVATE', ids.meera ?? 0, { expectedVersion: meeraVersion, reason: 'Leaving.' });
    assert.equal(self.res.status, 200, self.res.text);
    assert.equal(self.res.body.hrUser.status, 'INACTIVE');
    assert.equal((await list(tokens.meera ?? '')).status, 401);
    assert.equal(await count("SELECT COUNT(*) AS n FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE'"), 1);
  });
});
