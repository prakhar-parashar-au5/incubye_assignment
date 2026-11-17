// Demo scenario: salary and HR-access activity for the deployed demo (AI Task 06).
//
// Every write goes through the product's own services: salary preview and
// direct apply, request submit, approve, and cancel (salary-adjustment-service),
// and HR-user create, scope replacement, and deactivation (hr-access-service,
// preview then confirm). Bands, version chains, idempotency keys, and audit
// events therefore stay correct; there is no raw SQL write.
//
// Deterministic: each item picks the lowest eligible employee code for its
// country and department (currently working, only the initial import, no
// request, not an oracle-fixture employee, not used by another item) whose
// preview passes. Idempotent: every salary write carries the note
// `DEMO-SCENARIO v1 <item>`, HR users are found by email, and a re-run writes
// nothing. A partly finished earlier run is completed (for example a request
// that exists but was not yet approved).
//
// Guards (fixture-guard.ts): APP_ENV not production, database ends in _demo or
// _test, --database repeats it, the connection matches. Dry run unless `apply`.
// Temporary passwords of created HR users are discarded, never printed.
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import { createAccessPreviewTokens } from '../access/access-preview-token.js';
import { DEMO_USERS } from '../access/demo-users.js';
import { createHrAccessService } from '../access/hr-access-service.js';
import type { Principal } from '../access/sessions.js';
import { createPreviewTokens } from '../compensation/preview-token.js';
import { createSalaryAdjustmentService } from '../compensation/salary-adjustment-service.js';
import type { SalaryAdjustmentCommand } from '../http/contract.js';
import { FixtureRefusedError, assertFixtureTarget } from './fixture-guard.js';

const MARKER = 'DEMO-SCENARIO v1';
const ORACLE_NOTE_PREFIX = 'EVAL-ORACLE-FIXTURE v1';
const CANDIDATE_LIMIT = 100;
type Reason = SalaryAdjustmentCommand['reason'];

interface DirectItem { id: string; country: 'IN' | 'US'; department: string; reason: Reason; percent: string; effectiveInDays: number }
interface RequestItem { id: string; requester: 'rohan' | 'priya'; department: string; reason: Reason; percent: string; effectiveInDays: number; outcome: 'PENDING' | 'APPROVED' | 'CANCELLED' }

export const DIRECT_ITEMS: readonly DirectItem[] = Object.freeze([
  { id: 'direct-in-tech', country: 'IN', department: 'Tech', reason: 'PERFORMANCE', percent: '4', effectiveInDays: 0 },
  { id: 'direct-in-finance', country: 'IN', department: 'Finance', reason: 'MARKET_ADJUSTMENT', percent: '6', effectiveInDays: 0 },
  { id: 'direct-in-hr', country: 'IN', department: 'HR', reason: 'PROMOTION', percent: '10', effectiveInDays: 14 },
  { id: 'direct-in-operations', country: 'IN', department: 'Operations', reason: 'PERFORMANCE', percent: '3', effectiveInDays: 0 },
  { id: 'direct-us-tech', country: 'US', department: 'Tech', reason: 'MARKET_ADJUSTMENT', percent: '5', effectiveInDays: 0 },
  { id: 'direct-us-finance', country: 'US', department: 'Finance', reason: 'PERFORMANCE', percent: '4', effectiveInDays: 14 },
  { id: 'direct-us-support', country: 'US', department: 'Support', reason: 'PROMOTION', percent: '8', effectiveInDays: 0 },
  { id: 'direct-us-operations', country: 'US', department: 'Operations', reason: 'MARKET_ADJUSTMENT', percent: '5', effectiveInDays: 21 },
]);
export const REQUEST_ITEMS: readonly RequestItem[] = Object.freeze([
  { id: 'request-rohan-pending', requester: 'rohan', department: 'Tech', reason: 'PERFORMANCE', percent: '5', effectiveInDays: 7, outcome: 'PENDING' },
  { id: 'request-rohan-approved', requester: 'rohan', department: 'Tech', reason: 'MARKET_ADJUSTMENT', percent: '6', effectiveInDays: 10, outcome: 'APPROVED' },
  { id: 'request-rohan-cancelled', requester: 'rohan', department: 'Support', reason: 'PROMOTION', percent: '12', effectiveInDays: 14, outcome: 'CANCELLED' },
  { id: 'request-priya-pending-1', requester: 'priya', department: 'Support', reason: 'PERFORMANCE', percent: '4', effectiveInDays: 7, outcome: 'PENDING' },
  { id: 'request-priya-pending-2', requester: 'priya', department: 'Support', reason: 'MARKET_ADJUSTMENT', percent: '5', effectiveInDays: 10, outcome: 'PENDING' },
  { id: 'request-priya-approved', requester: 'priya', department: 'Support', reason: 'PERFORMANCE', percent: '3', effectiveInDays: 21, outcome: 'APPROVED' },
]);
export const CANCEL_REASON = 'Superseded by the annual review cycle.';

export const SCENARIO_HR_USERS = Object.freeze({
  priya: { email: 'priya.nair.demo@acme.com', displayName: 'Priya Nair', countries: ['IN'], departments: ['Support'] },
  arjun: { email: 'arjun.rao.demo@acme.com', displayName: 'Arjun Rao', countries: ['IN'], departments: ['Tech'], replacedWith: { countries: ['US'], departments: ['Finance'] } },
  kavya: { email: 'kavya.menon.demo@acme.com', displayName: 'Kavya Menon', countries: ['US'], departments: ['Operations'], deactivationReason: 'Left the HR team.' },
} as const);

export interface ScenarioReport {
  kind: 'acme-demo-scenario'; mode: 'DRY_RUN' | 'APPLIED'; database: string; evaluationDate: string;
  directAdjustments: { item: string; employeeCode: string | null; status: 'CREATED' | 'EXISTS' | 'PLANNED' }[];
  requests: { item: string; employeeCode: string | null; requestId: string | null; requester: string; outcome: string; status: 'CREATED' | 'EXISTS' | 'COMPLETED' | 'PLANNED' }[];
  hrUsers: { email: string; displayName: string; events: string[]; status: 'CREATED' | 'EXISTS' | 'COMPLETED' | 'PLANNED' }[];
}

const noteFor = (id: string): string => `${MARKER} ${id}`;
const isoDay = (instant: Date): string => instant.toISOString().slice(0, 10);
const addDays = (day: string, days: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000));
type Row = RowDataPacket & Record<string, unknown>;

export async function runDemoScenario({ pool, apply, clock = () => new Date(), appEnv, databaseName, confirmDatabase }: {
  pool: Pool; apply: boolean; clock?: () => Date; appEnv: unknown; databaseName: string; confirmDatabase: unknown;
}): Promise<ScenarioReport> {
  await assertFixtureTarget(pool, { appEnv, databaseName, confirmDatabase });
  const now = clock();
  const today = isoDay(now);
  const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await pool.query<Row[]>(sql, params))[0];

  // Principals loaded from the database, as requireAuth would, with a process-local session ID.
  const principalFor = async (email: string): Promise<Principal | null> => {
    const [user] = await q('SELECT id, email, display_name, role, status FROM hr_users WHERE email = ?', [email]);
    if (!user) return null;
    const countries = (await q('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ? ORDER BY country_code', [user.id])).map((r) => String(r.country_code));
    const departments = (await q('SELECT d.name FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ? ORDER BY d.name', [user.id])).map((r) => String(r.name));
    return {
      hrUserId: Number(user.id), email: String(user.email), displayName: String(user.display_name), role: user.role as Principal['role'], status: user.status as Principal['status'],
      countries, departments, sessionId: randomUUID(), sessionExpiresAt: new Date(now.getTime() + 3_600_000),
    };
  };
  const meeraEmail = DEMO_USERS.find((u) => u.key === 'meera')?.email ?? '';
  const rohanEmail = DEMO_USERS.find((u) => u.key === 'rohan')?.email ?? '';
  const meera = await principalFor(meeraEmail);
  const rohan = await principalFor(rohanEmail);
  if (meera?.role !== 'ADMIN' || meera.status !== 'ACTIVE' || rohan?.status !== 'ACTIVE') {
    throw new FixtureRefusedError('refusing: the demo HR users (active Meera Iyer and Rohan Mehta) do not exist (run db:seed-demo-users first)');
  }
  const signingKey = randomUUID() + randomUUID();
  const salary = createSalaryAdjustmentService({ pool, clock, previewTokens: createPreviewTokens({ signingKey, clock }) });
  const access = createHrAccessService({ pool, clock, previewTokens: createAccessPreviewTokens({ signingKey, clock }) });

  // ---- HR users (first, so Priya can submit requests) ----
  const hrUsers: ScenarioReport['hrUsers'] = [];
  const ensureUser = async (key: keyof typeof SCENARIO_HR_USERS): Promise<{ id: number | null; created: boolean }> => {
    const spec = SCENARIO_HR_USERS[key];
    const [existing] = await q('SELECT id FROM hr_users WHERE email = ?', [spec.email]);
    if (existing) return { id: Number(existing.id), created: false };
    if (!apply) return { id: null, created: false };
    const input = { email: spec.email, displayName: spec.displayName, role: 'SCOPED' as const, countries: [...spec.countries], departments: [...spec.departments] };
    const preview = await access.preview(meera, 'CREATE', null, input);
    // The temporary password in the result is discarded here and never printed.
    const created = await access.create(meera, { ...input, previewToken: preview.previewToken }, `demo-scenario-v1-create-${key}`);
    return { id: created.value.hrUser.hrUserId, created: true };
  };
  const version = async (id: number): Promise<number> => Number((await q('SELECT version FROM hr_users WHERE id = ?', [id]))[0]?.version);
  for (const key of ['priya', 'arjun', 'kavya'] as const) {
    const spec = SCENARIO_HR_USERS[key];
    const { id, created } = await ensureUser(key);
    const events = ['HR_USER_CREATED'];
    let completed = false;
    if (key === 'arjun') {
      events.push('SCOPES_REPLACED');
      if (id !== null && (await q("SELECT 1 FROM access_audit_events WHERE target_hr_user_id = ? AND action = 'SCOPES_REPLACED' LIMIT 1", [id])).length === 0 && apply) {
        const input = { expectedVersion: await version(id), countries: [...SCENARIO_HR_USERS.arjun.replacedWith.countries], departments: [...SCENARIO_HR_USERS.arjun.replacedWith.departments] };
        const preview = await access.preview(meera, 'SCOPES', String(id), input);
        await access.change(meera, 'SCOPES', String(id), { ...input, previewToken: preview.previewToken }, 'demo-scenario-v1-scopes-arjun');
        completed = !created;
      }
    }
    if (key === 'kavya') {
      events.push('HR_USER_DEACTIVATED');
      if (id !== null && (await q('SELECT status FROM hr_users WHERE id = ?', [id]))[0]?.status === 'ACTIVE' && apply) {
        const input = { expectedVersion: await version(id), reason: SCENARIO_HR_USERS.kavya.deactivationReason };
        const preview = await access.preview(meera, 'DEACTIVATE', String(id), input);
        await access.change(meera, 'DEACTIVATE', String(id), { ...input, previewToken: preview.previewToken }, 'demo-scenario-v1-deactivate-kavya');
        completed = !created;
      }
    }
    hrUsers.push({ email: spec.email, displayName: spec.displayName, events, status: id === null ? 'PLANNED' : created ? 'CREATED' : completed ? 'COMPLETED' : 'EXISTS' });
  }
  const priya = await principalFor(SCENARIO_HR_USERS.priya.email);

  // ---- employee choice ----
  const used = new Set<string>([
    ...(await q(`SELECT DISTINCT e.employee_code FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE c.change_note LIKE ?`, [`${ORACLE_NOTE_PREFIX}%`])).map((r) => String(r.employee_code)),
  ]);
  const markedRecord = async (id: string) => (await q('SELECT e.employee_code FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE c.change_note = ? LIMIT 1', [noteFor(id)]))[0];
  const markedRequest = async (id: string) => (await q(`SELECT r.public_id, r.status, e.employee_code FROM compensation_change_requests r JOIN employees e ON e.id = r.employee_id
    WHERE r.note = ? ORDER BY r.id LIMIT 1`, [noteFor(id)]))[0];
  for (const item of [...DIRECT_ITEMS.map((i) => i.id), ...REQUEST_ITEMS.map((i) => i.id)]) {
    const found = (await markedRecord(item)) ?? (await markedRequest(item));
    if (found) used.add(String(found.employee_code));
  }
  async function pick(principal: Principal, country: string, department: string, command: SalaryAdjustmentCommand) {
    const candidates = await q(`SELECT e.employee_code FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
      WHERE e.employment_status = 'CURRENTLY_WORKING' AND e.country_code = ? AND d.name = ?
        AND NOT EXISTS (SELECT 1 FROM compensation_records c WHERE c.employee_id = e.id AND (c.version > 1 OR c.change_reason <> 'INITIAL_IMPORT'))
        AND NOT EXISTS (SELECT 1 FROM compensation_change_requests r WHERE r.employee_id = e.id)
      ORDER BY e.employee_code LIMIT ${CANDIDATE_LIMIT}`, [country, department]);
    for (const row of candidates) {
      const code = String(row.employee_code);
      if (used.has(code)) continue;
      try {
        const preview = await salary.preview(principal, code, command);
        used.add(code);
        return { code, previewToken: preview.previewToken };
      } catch {
        // Outside its band or otherwise ineligible: try the next code.
      }
    }
    throw new FixtureRefusedError(`no eligible ${country} ${department} employee for the demo scenario`);
  }

  // ---- Admin direct adjustments ----
  const directAdjustments: ScenarioReport['directAdjustments'] = [];
  for (const item of DIRECT_ITEMS) {
    const existing = await markedRecord(item.id);
    if (existing) { directAdjustments.push({ item: item.id, employeeCode: String(existing.employee_code), status: 'EXISTS' }); continue; }
    const command: SalaryAdjustmentCommand = { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: item.percent, effectiveFrom: addDays(today, item.effectiveInDays), reason: item.reason, note: noteFor(item.id) };
    const chosen = await pick(meera, item.country, item.department, command);
    if (apply) await salary.applyDirect(meera, chosen.code, { previewToken: chosen.previewToken, adjustment: command }, `demo-scenario-v1-${item.id}`);
    directAdjustments.push({ item: item.id, employeeCode: chosen.code, status: apply ? 'CREATED' : 'PLANNED' });
  }

  // ---- Scoped requests, then Meera's decisions ----
  const requests: ScenarioReport['requests'] = [];
  for (const item of REQUEST_ITEMS) {
    const requester = item.requester === 'rohan' ? rohan : priya;
    const requesterName = item.requester === 'rohan' ? rohan.displayName : SCENARIO_HR_USERS.priya.displayName;
    let existing = await markedRequest(item.id);
    let status: ScenarioReport['requests'][number]['status'] = 'EXISTS';
    if (!existing) {
      if (!apply || requester === null) {
        requests.push({ item: item.id, employeeCode: null, requestId: null, requester: requesterName, outcome: item.outcome, status: 'PLANNED' });
        continue;
      }
      const command: SalaryAdjustmentCommand = { target: 'BASE_SALARY', method: 'PERCENTAGE_INCREASE', value: item.percent, effectiveFrom: addDays(today, item.effectiveInDays), reason: item.reason, note: noteFor(item.id) };
      const chosen = await pick(requester, 'IN', item.department, command);
      await salary.submitRequest(requester, chosen.code, { previewToken: chosen.previewToken, adjustment: command }, `demo-scenario-v1-${item.id}`);
      existing = await markedRequest(item.id);
      status = 'CREATED';
    }
    if (!existing) throw new FixtureRefusedError(`request ${item.id} was not recorded`);
    const requestId = String(existing.public_id);
    if (existing.status === 'PENDING' && item.outcome !== 'PENDING' && apply) {
      if (item.outcome === 'APPROVED') await salary.approve(meera, requestId, `demo-scenario-v1-approve-${item.id}`);
      else await salary.cancel(meera, requestId, CANCEL_REASON, `demo-scenario-v1-cancel-${item.id}`);
      if (status === 'EXISTS') status = 'COMPLETED';
    }
    requests.push({ item: item.id, employeeCode: String(existing.employee_code), requestId, requester: requesterName, outcome: item.outcome, status });
  }

  return { kind: 'acme-demo-scenario', mode: apply ? 'APPLIED' : 'DRY_RUN', database: databaseName, evaluationDate: today, directAdjustments, requests, hrUsers };
}
