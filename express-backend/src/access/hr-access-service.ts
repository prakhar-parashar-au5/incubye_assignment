// The HR access-management application service (Admin HR only).
//
// Reads use the request principal, which authenticate() loaded from MySQL for
// this request. Every write goes through the existing operations in
// hr-users.ts, which recheck the actor's current row under the row locks,
// compare the expected hr_users.version, and commit the change, any session
// revocation, the version increment, and the audit event in one transaction.
//
// Confirmation flow for a write:
//   1. strict body (route) -> normalized command -> fingerprint;
//   2. scope values checked against reference data (422 INVALID_SCOPE);
//   3. preview token authenticity and binding, expiry ignored (400 PREVIEW_INVALID);
//   4. in the transaction, under the locks: actor check, replay check (same
//      actor + key: same fingerprint replays, other fingerprint conflicts),
//      expected version (409 STALE_VERSION), then the full preview check:
//      expiry and the digest of the command and the exact proposed state,
//      recomputed from the locked current state (400 PREVIEW_EXPIRED / MISMATCH);
//   5. the change.
//
// Nothing here logs. Passwords, tokens, reasons, and keys stay out of logs.
import type { Pool, RowDataPacket } from 'mysql2/promise';

import { commandFingerprint, previewDigest } from './access-command.js';
import type { AccessOperationKind, NormalizedAccessCommand, ProposedAccessState } from './access-command.js';
import { AccessPreviewTokenError } from './access-preview-token.js';
import type { AccessPreviewTokens } from './access-preview-token.js';
import type { HrStatus, Role } from './access-policy.js';
import {
  AccessError, createHrUserOperation, loadHrUserState, normalizeEmail, promoteToAdmin, regenerateTemporaryPassword, replaceScopes, setDisplayName,
  setHrUserStatus,
} from './hr-users.js';
import type { ChangeResult, HrUserState } from './hr-users.js';
import { generateTemporaryPassword, hashPassword } from './passwords.js';
import type { Principal } from './sessions.js';
import { scopeCondition } from '../directory/directory-repository.js';
import {
  HR_USER_NOT_FOUND, HR_USER_STALE_MESSAGE, NO_EMPLOYEE_ACCESS_USER_MESSAGE, NO_HR_USERS_MESSAGE, NO_SCOPE_ACCESS_MESSAGE,
  REGENERATED_PASSWORD_UNAVAILABLE, REGENERATION_WARNING, TEMPORARY_PASSWORD_NOTICE, TEMPORARY_PASSWORD_UNAVAILABLE,
} from '../http/contract.js';
import type {
  AccessAuditEvent, AccessAuditQuery, AccessAuditResponse, ErrorReason, HrAccessPreview, HrUserChangeResult, HrUserCreateResult, HrUserDetail,
  HrUserDetailResponse, HrUserListQuery, HrUserListResponse, HrUserPasswordRegenerationPreview, HrUserPasswordRegenerationResult, PublicErrorCode,
} from '../http/contract.js';

export type HrAccessErrorCode = Extract<PublicErrorCode,
  'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_VERSION' | 'DUPLICATE_OPERATION' | 'LAST_ACTIVE_ADMIN' | 'EMAIL_TAKEN' | 'INVALID_SCOPE'
  | 'SELF_PASSWORD_REGENERATION_FORBIDDEN'>;

export class HrAccessError extends Error {
  readonly code: HrAccessErrorCode;
  readonly reason: ErrorReason | undefined;
  /** A public message; undefined means the code's standard message. */
  readonly publicMessage: string | undefined;

  constructor(code: HrAccessErrorCode, { reason, message }: { reason?: ErrorReason; message?: string } = {}) {
    super(message ?? code);
    this.name = 'HrAccessError';
    this.code = code;
    this.reason = reason;
    this.publicMessage = message;
  }
}

export interface Replayable<T> {
  value: T;
  replayed: boolean;
}

/** A validated request body: the fields of one preview or confirmation. */
export interface HrAccessInput {
  expectedVersion?: number;
  email?: string;
  displayName?: string;
  role?: Role;
  countries?: string[];
  departments?: string[];
  reason?: string;
  previewToken?: string;
}

export type ChangeOperation = Exclude<AccessOperationKind, 'CREATE' | 'REGENERATE_PASSWORD'>;
type PreviewOperation = Exclude<AccessOperationKind, 'REGENERATE_PASSWORD'>;

export interface HrAccessService {
  list(principal: Principal, query: HrUserListQuery): Promise<HrUserListResponse>;
  get(principal: Principal, hrUserId: string): Promise<HrUserDetailResponse>;
  audit(principal: Principal, hrUserId: string, query: AccessAuditQuery): Promise<AccessAuditResponse>;
  preview(principal: Principal, operation: PreviewOperation, hrUserId: string | null, input: HrAccessInput): Promise<HrAccessPreview>;
  create(principal: Principal, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserCreateResult>>;
  change(principal: Principal, operation: ChangeOperation, hrUserId: string, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserChangeResult>>;
  /** Review fix 11a: Admin recovery of an unusable or unknown temporary password. */
  previewPasswordRegeneration(principal: Principal, hrUserId: string, input: HrAccessInput): Promise<HrUserPasswordRegenerationPreview>;
  regeneratePassword(principal: Principal, hrUserId: string, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserPasswordRegenerationResult>>;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  status: HrStatus;
  version: number;
  created_at: string;
  updated_at: string;
}
interface ScopeRow extends RowDataPacket {
  hr_user_id: number;
  value: string;
}
interface CountRow extends RowDataPacket {
  n: string;
}
interface CountryRow extends RowDataPacket {
  code: string;
  name: string;
}
interface AuditRow extends RowDataPacket {
  action: AccessAuditEvent['action'];
  created_at: string;
  actor_hr_user_id: number | null;
  actor_name: string | null;
  target_hr_user_id: number;
  target_name: string;
  target_email: string;
  before_state: unknown;
  after_state: unknown;
  reason: string | null;
  resulting_version: number | null;
  revoked_session_count: number | null;
}

const HR_USER_ID = /^[1-9][0-9]{0,9}$/;
const SESSION_REVOKING: ReadonlySet<AccessOperationKind> = new Set(['PROMOTE', 'DEACTIVATE', 'REGENERATE_PASSWORD']);

const toIso = (dbTime: string): string => `${dbTime.replace(' ', 'T')}Z`;
const sorted = (list: readonly string[]): string[] => [...list].sort();
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);
const notFound = (): HrAccessError => new HrAccessError('NOT_FOUND', { message: HR_USER_NOT_FOUND });

function parseHrUserId(text: string | null): number {
  if (text === null || !HR_USER_ID.test(text) || Number(text) > 4_294_967_295) throw notFound();
  return Number(text);
}

/** Domain errors to public errors. Messages never carry SQL or input values beyond the code's text. */
function publicError(error: unknown): unknown {
  if (!(error instanceof AccessError)) return error;
  switch (error.code) {
    case 'FORBIDDEN': return new HrAccessError('FORBIDDEN');
    case 'NOT_FOUND': return notFound();
    case 'EMAIL_TAKEN': return new HrAccessError('EMAIL_TAKEN');
    case 'LAST_ACTIVE_ADMIN': return new HrAccessError('LAST_ACTIVE_ADMIN');
    case 'STALE_VERSION': return new HrAccessError('STALE_VERSION', { message: HR_USER_STALE_MESSAGE });
    case 'DUPLICATE_OPERATION': return new HrAccessError('DUPLICATE_OPERATION');
    case 'INVALID_INPUT': return error.invalidScope ? new HrAccessError('INVALID_SCOPE') : new HrAccessError('VALIDATION_ERROR');
    case 'SELF_PASSWORD_REGENERATION': return new HrAccessError('SELF_PASSWORD_REGENERATION_FORBIDDEN');
  }
}

function previewError(error: unknown): unknown {
  if (error instanceof AccessPreviewTokenError) return new HrAccessError('VALIDATION_ERROR', { reason: error.reason, message: error.message });
  return error;
}

const mismatch = (): HrAccessError =>
  new HrAccessError('VALIDATION_ERROR', { reason: 'PREVIEW_MISMATCH', message: 'The change does not match the preview. Request a new preview.' });

export function createHrAccessService({ pool, previewTokens, clock = () => new Date() }: {
  pool: Pool;
  previewTokens: AccessPreviewTokens;
  clock?: () => Date;
}): HrAccessService {
  // -------------------------------------------------------------------------
  // Reference data and views

  async function countryNames(): Promise<Map<string, string>> {
    const [rows] = await pool.query<CountryRow[]>('SELECT code, name FROM countries');
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  /** Unknown country codes or department names: 422 INVALID_SCOPE. */
  async function assertKnownScopes(countries: readonly string[], departments: readonly string[]): Promise<void> {
    if (countries.length > 0) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT code FROM countries WHERE code IN (?)', [countries]);
      const known = new Set(rows.map((r) => String(r.code)));
      if (countries.some((c) => !known.has(c))) throw new HrAccessError('INVALID_SCOPE', { message: 'Unknown country in scope.' });
    }
    if (departments.length > 0) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM departments WHERE name IN (?)', [departments]);
      // Exact names: the ai_ci collation alone would accept "tech".
      const known = new Set(rows.map((r) => String(r.name)));
      if (departments.some((d) => !known.has(d))) throw new HrAccessError('INVALID_SCOPE', { message: 'Unknown department in scope.' });
    }
  }

  function accessSummary(state: Pick<ProposedAccessState, 'role' | 'status' | 'countries' | 'departments'>, names: Map<string, string>): HrUserDetail['accessSummary'] {
    if (state.status !== 'ACTIVE') return { kind: 'INACTIVE', text: 'Inactive: access to no employees.', combinations: [] };
    if (state.role === 'ADMIN') return { kind: 'ALL_EMPLOYEES', text: 'All employees', combinations: [] };
    if (state.countries.length === 0 || state.departments.length === 0) return { kind: 'NO_EMPLOYEES', text: NO_SCOPE_ACCESS_MESSAGE, combinations: [] };
    const combinations = state.countries.flatMap((country) => state.departments.map((department) => ({
      country, countryName: names.get(country) ?? country, department,
    })));
    return { kind: 'SCOPED', text: combinations.map((c) => `${c.countryName} + ${c.department}`).join(', '), combinations };
  }

  /** Permission-aware count with the directory's scope SQL (same policy, in MySQL). */
  async function accessibleEmployees(state: Pick<ProposedAccessState, 'role' | 'status' | 'countries' | 'departments'>): Promise<number> {
    const scope = scopeCondition(state);
    const [rows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS n FROM employees e
       JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
       WHERE ${scope.sql}`,
      scope.params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async function activeSessions(hrUserId: number): Promise<number> {
    const now = clock();
    const [rows] = await pool.query<CountRow[]>(
      'SELECT COUNT(*) AS n FROM hr_sessions WHERE hr_user_id = ? AND revoked_at IS NULL AND expires_at > ?', [hrUserId, now]);
    return Number(rows[0]?.n ?? 0);
  }

  async function scopesOf(ids: readonly number[]): Promise<{ countries: Map<number, string[]>; departments: Map<number, string[]> }> {
    const countries = new Map<number, string[]>();
    const departments = new Map<number, string[]>();
    if (ids.length > 0) {
      const [c] = await pool.query<ScopeRow[]>('SELECT hr_user_id, country_code AS value FROM hr_user_country_scopes WHERE hr_user_id IN (?)', [ids]);
      const [d] = await pool.query<ScopeRow[]>(
        'SELECT s.hr_user_id, dp.name AS value FROM hr_user_department_scopes s JOIN departments dp ON dp.id = s.department_id WHERE s.hr_user_id IN (?)', [ids]);
      for (const row of c) countries.set(row.hr_user_id, [...(countries.get(row.hr_user_id) ?? []), row.value]);
      for (const row of d) departments.set(row.hr_user_id, [...(departments.get(row.hr_user_id) ?? []), row.value]);
    }
    return { countries, departments };
  }

  function userView(row: UserRow, countries: string[], departments: string[], names: Map<string, string>) {
    const state = { role: row.role, status: row.status, countries: sorted(countries), departments: sorted(departments) };
    return {
      hrUserId: row.id,
      displayName: row.display_name,
      email: row.email,
      ...state,
      accessSummary: accessSummary(state, names),
      version: row.version,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  const USER_COLUMNS = 'u.id, u.email, u.display_name, u.role, u.status, u.version, u.created_at, u.updated_at';

  async function detailOf(hrUserId: number): Promise<HrUserDetail> {
    const [rows] = await pool.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM hr_users u WHERE u.id = ?`, [hrUserId]);
    const row = rows[0];
    if (row === undefined) throw notFound();
    const scopes = await scopesOf([hrUserId]);
    const view = userView(row, scopes.countries.get(hrUserId) ?? [], scopes.departments.get(hrUserId) ?? [], await countryNames());
    const accessibleEmployeeCount = await accessibleEmployees(view);
    return { ...view, accessibleEmployeeCount, noAccessMessage: accessibleEmployeeCount === 0 ? NO_EMPLOYEE_ACCESS_USER_MESSAGE : null };
  }

  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

  function auditStateView(value: unknown): AccessAuditEvent['after'] {
    const state = json(value) as Partial<AccessAuditEvent['after']>;
    return {
      displayName: typeof state.displayName === 'string' ? state.displayName : null,
      role: state.role as AccessAuditEvent['after']['role'],
      status: state.status as AccessAuditEvent['after']['status'],
      countries: state.countries ?? [],
      departments: state.departments ?? [],
    };
  }

  const AUDIT_SELECT = `SELECT a.action, a.created_at, a.actor_hr_user_id, ac.display_name AS actor_name, a.target_hr_user_id,
         t.display_name AS target_name, t.email AS target_email, a.before_state, a.after_state, a.reason, a.resulting_version, a.revoked_session_count
  FROM access_audit_events a
  JOIN hr_users t ON t.id = a.target_hr_user_id
  LEFT JOIN hr_users ac ON ac.id = a.actor_hr_user_id`;

  function auditView(row: AuditRow): AccessAuditEvent {
    return {
      action: row.action,
      occurredAt: toIso(row.created_at),
      actor: row.actor_hr_user_id === null || row.actor_name === null ? null : { hrUserId: row.actor_hr_user_id, displayName: row.actor_name },
      target: { hrUserId: row.target_hr_user_id, displayName: row.target_name, email: row.target_email },
      before: row.before_state === null ? null : auditStateView(row.before_state),
      after: auditStateView(row.after_state),
      reason: row.reason,
      resultingVersion: row.resulting_version,
      revokedSessionCount: row.revoked_session_count,
    };
  }

  async function auditEvent(auditEventId: number): Promise<AccessAuditEvent> {
    const [rows] = await pool.query<AuditRow[]>(`${AUDIT_SELECT} WHERE a.id = ?`, [auditEventId]);
    const row = rows[0];
    if (row === undefined) throw new Error('audit event not found after write');
    return auditView(row);
  }

  // -------------------------------------------------------------------------
  // Reads

  async function list(_principal: Principal, query: HrUserListQuery): Promise<HrUserListResponse> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q !== undefined) {
      // utf8mb4_0900_ai_ci: case-insensitive partial name, case-insensitive exact email.
      where.push("(u.display_name LIKE ? ESCAPE '\\\\' OR u.email = ?)");
      params.push(`%${escapeLike(query.q)}%`, normalizeEmail(query.q));
    }
    if (query.role !== undefined) {
      where.push('u.role = ?');
      params.push(query.role);
    }
    if (query.status !== 'ALL') {
      where.push('u.status = ?');
      params.push(query.status);
    }
    // Admin HR has no scope rows and counts as access to every country and department.
    if (query.country !== undefined) {
      where.push("(u.role = 'ADMIN' OR EXISTS (SELECT 1 FROM hr_user_country_scopes c WHERE c.hr_user_id = u.id AND c.country_code = ?))");
      params.push(query.country);
    }
    if (query.department !== undefined) {
      where.push(`(u.role = 'ADMIN' OR EXISTS (SELECT 1 FROM hr_user_department_scopes s JOIN departments dp ON dp.id = s.department_id
                                               WHERE s.hr_user_id = u.id AND dp.name = ?))`);
      params.push(query.department);
    }
    const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const direction = (query.direction ?? (query.sort === 'updatedAt' ? 'desc' : 'asc')) === 'desc' ? 'DESC' : 'ASC';
    const column = { updatedAt: 'u.updated_at', name: 'u.display_name', email: 'u.email' }[query.sort];
    const [rows] = await pool.query<UserRow[]>(
      `SELECT ${USER_COLUMNS} FROM hr_users u ${whereSql} ORDER BY ${column} ${direction}, u.id ${direction} LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const [counts] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS n FROM hr_users u ${whereSql}`, params);
    const totalRows = Number(counts[0]?.n ?? 0);
    const scopes = await scopesOf(rows.map((r) => r.id));
    const names = await countryNames();
    return {
      users: rows.map((r) => userView(r, scopes.countries.get(r.id) ?? [], scopes.departments.get(r.id) ?? [], names)),
      page: { number: query.page, size: query.pageSize, totalRows, totalPages: Math.ceil(totalRows / query.pageSize) },
      emptyMessage: NO_HR_USERS_MESSAGE,
    };
  }

  async function get(_principal: Principal, hrUserIdText: string): Promise<HrUserDetailResponse> {
    return { hrUser: await detailOf(parseHrUserId(hrUserIdText)) };
  }

  async function audit(_principal: Principal, hrUserIdText: string, query: AccessAuditQuery): Promise<AccessAuditResponse> {
    const hrUserId = parseHrUserId(hrUserIdText);
    const [users] = await pool.query<RowDataPacket[]>('SELECT id FROM hr_users WHERE id = ?', [hrUserId]);
    if (users.length === 0) throw notFound();
    const [rows] = await pool.query<AuditRow[]>(
      `${AUDIT_SELECT} WHERE a.target_hr_user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [hrUserId, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const [counts] = await pool.query<CountRow[]>('SELECT COUNT(*) AS n FROM access_audit_events WHERE target_hr_user_id = ?', [hrUserId]);
    const totalRows = Number(counts[0]?.n ?? 0);
    return {
      hrUserId,
      events: rows.map(auditView),
      page: { number: query.page, size: query.pageSize, totalRows, totalPages: Math.ceil(totalRows / query.pageSize) },
    };
  }

  // -------------------------------------------------------------------------
  // Commands

  /** The normalized command for one operation. Lists sorted, text trimmed, email lower-case. */
  function normalize(operation: AccessOperationKind, targetHrUserId: number | null, input: HrAccessInput): NormalizedAccessCommand {
    const command: NormalizedAccessCommand = {
      operation, targetHrUserId, expectedVersion: operation === 'CREATE' ? null : input.expectedVersion ?? null,
      email: null, displayName: null, role: null, countries: null, departments: null, reason: null,
    };
    switch (operation) {
      case 'CREATE':
        return {
          ...command, email: normalizeEmail(input.email), displayName: input.displayName?.trim() ?? null, role: input.role ?? null,
          countries: sorted(input.countries ?? []), departments: sorted(input.departments ?? []),
        };
      case 'PROFILE': return { ...command, displayName: input.displayName?.trim() ?? null };
      case 'PROMOTE': return command;
      case 'SCOPES': return { ...command, countries: sorted(input.countries ?? []), departments: sorted(input.departments ?? []) };
      case 'DEACTIVATE':
      case 'REACTIVATE':
      case 'REGENERATE_PASSWORD': return { ...command, reason: input.reason?.trim() ?? null };
    }
  }

  /** Workflow rules for a new user, then known reference values. */
  async function validateCreate(command: NormalizedAccessCommand): Promise<ProposedAccessState> {
    const countries = command.countries ?? [];
    const departments = command.departments ?? [];
    if (command.role === 'ADMIN' && (countries.length > 0 || departments.length > 0)) {
      throw new HrAccessError('INVALID_SCOPE', { message: 'An Admin HR user has no country or department scopes.' });
    }
    if (command.role === 'SCOPED' && (countries.length === 0 || departments.length === 0)) {
      throw new HrAccessError('INVALID_SCOPE', { message: 'A Scoped HR user needs at least one country and one department.' });
    }
    await assertKnownScopes(countries, departments);
    return { displayName: command.displayName ?? '', role: command.role ?? 'SCOPED', status: 'ACTIVE', countries, departments };
  }

  /** The exact access state a change would produce from `current`. Throws for invalid scopes. */
  function proposedFor(operation: ChangeOperation, current: HrUserState, command: NormalizedAccessCommand): ProposedAccessState {
    const base: ProposedAccessState = {
      displayName: current.displayName, role: current.role, status: current.status, countries: current.countries, departments: current.departments,
    };
    switch (operation) {
      case 'PROFILE': return { ...base, displayName: command.displayName ?? current.displayName };
      case 'PROMOTE': return { ...base, role: 'ADMIN', countries: [], departments: [] };
      case 'SCOPES': {
        const countries = command.countries ?? [];
        const departments = command.departments ?? [];
        if (current.role === 'ADMIN' && (countries.length > 0 || departments.length > 0)) {
          throw new HrAccessError('INVALID_SCOPE', { message: 'An Admin HR user has no country or department scopes.' });
        }
        return { ...base, countries, departments };
      }
      case 'DEACTIVATE': return { ...base, status: 'INACTIVE' };
      case 'REACTIVATE': return { ...base, status: 'ACTIVE' };
    }
  }

  function changedFields(current: ProposedAccessState | null, proposed: ProposedAccessState): HrAccessPreview['changedFields'] {
    const fields: HrAccessPreview['changedFields'] = [];
    if (current?.displayName !== proposed.displayName) fields.push('displayName');
    if (current?.role !== proposed.role) fields.push('role');
    if (current?.status !== proposed.status) fields.push('status');
    if (current === null || !sameList(current.countries, proposed.countries)) fields.push('countries');
    if (current === null || !sameList(current.departments, proposed.departments)) fields.push('departments');
    return fields;
  }

  async function stateView(state: ProposedAccessState, names: Map<string, string>) {
    return { ...state, accessSummary: accessSummary(state, names), accessibleEmployeeCount: await accessibleEmployees(state) };
  }

  async function loadTarget(hrUserId: number): Promise<HrUserState> {
    try {
      return await loadHrUserState(pool, hrUserId);
    } catch (error) {
      throw publicError(error);
    }
  }

  async function assertNotLastActiveAdmin(hrUserId: number, current: HrUserState): Promise<void> {
    if (current.role !== 'ADMIN' || current.status !== 'ACTIVE') return;
    const [rows] = await pool.query<CountRow[]>(
      "SELECT COUNT(*) AS n FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ?", [hrUserId]);
    if (Number(rows[0]?.n ?? 0) === 0) throw new HrAccessError('LAST_ACTIVE_ADMIN');
  }

  // -------------------------------------------------------------------------
  // Preview (writes nothing)

  async function preview(principal: Principal, operation: PreviewOperation, hrUserIdText: string | null, input: HrAccessInput): Promise<HrAccessPreview> {
    const names = await countryNames();
    if (operation === 'CREATE') {
      const command = normalize('CREATE', null, input);
      const proposed = await validateCreate(command);
      const [taken] = await pool.query<RowDataPacket[]>('SELECT id FROM hr_users WHERE email = ?', [command.email]);
      if (taken.length > 0) throw new HrAccessError('EMAIL_TAKEN');
      const { token, expiresAt } = await previewTokens.sign({
        actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, operation, targetHrUserId: 0, expectedVersion: 0,
        digest: previewDigest({ actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, command, proposed }),
      });
      return {
        operation, hrUserId: null, email: command.email ?? '', expectedVersion: null, changed: true,
        changedFields: changedFields(null, proposed), current: null, proposed: await stateView(proposed, names),
        sessionsToRevoke: 0, reason: null, previewToken: token, previewExpiresAt: expiresAt.toISOString(),
      };
    }

    const hrUserId = parseHrUserId(hrUserIdText);
    const command = normalize(operation, hrUserId, input);
    if (operation === 'SCOPES') await assertKnownScopes(command.countries ?? [], command.departments ?? []);
    const current = await loadTarget(hrUserId);
    if (current.version !== input.expectedVersion) throw new HrAccessError('STALE_VERSION', { message: HR_USER_STALE_MESSAGE });
    const proposed = proposedFor(operation, current, command);
    const fields = changedFields(current, proposed);
    if (operation === 'DEACTIVATE' && fields.length > 0) await assertNotLastActiveAdmin(hrUserId, current);
    const [email] = await pool.query<RowDataPacket[]>('SELECT email FROM hr_users WHERE id = ?', [hrUserId]);
    const { token, expiresAt } = await previewTokens.sign({
      actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, operation, targetHrUserId: hrUserId, expectedVersion: current.version,
      digest: previewDigest({ actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, command, proposed }),
    });
    return {
      operation, hrUserId, email: String(email[0]?.email ?? ''), expectedVersion: current.version, changed: fields.length > 0,
      changedFields: fields, current: await stateView(current, names), proposed: await stateView(proposed, names),
      sessionsToRevoke: SESSION_REVOKING.has(operation) && fields.length > 0 ? await activeSessions(hrUserId) : 0,
      reason: command.reason, previewToken: token, previewExpiresAt: expiresAt.toISOString(),
    };
  }

  /** Authenticity and binding only (expiry ignored): enough to identify a replay. */
  async function checkPreviewBinding(principal: Principal, operation: AccessOperationKind, targetHrUserId: number, previewToken: string | undefined) {
    try {
      return await previewTokens.verifyIgnoringExpiry(previewToken ?? '', {
        actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, operation, targetHrUserId,
      });
    } catch (error) {
      throw previewError(error);
    }
  }

  /** Full check for a new write: expiry, expected version, and the exact digest. */
  async function confirmPreview(principal: Principal, command: NormalizedAccessCommand, proposed: ProposedAccessState, previewToken: string | undefined): Promise<void> {
    let verified;
    try {
      verified = await previewTokens.verify(previewToken ?? '', {
        actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, operation: command.operation, targetHrUserId: command.targetHrUserId ?? 0,
      });
    } catch (error) {
      throw previewError(error);
    }
    if (verified.expectedVersion !== (command.expectedVersion ?? 0)) throw mismatch();
    if (verified.digest !== previewDigest({ actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, command, proposed })) throw mismatch();
  }

  // -------------------------------------------------------------------------
  // Writes

  async function create(principal: Principal, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserCreateResult>> {
    if (principal.role !== 'ADMIN') throw new HrAccessError('FORBIDDEN');
    const command = normalize('CREATE', null, input);
    const proposed = await validateCreate(command);
    await checkPreviewBinding(principal, 'CREATE', 0, input.previewToken);
    const temporaryPassword = generateTemporaryPassword();
    let result;
    try {
      result = await createHrUserOperation(pool, {
        actorHrUserId: principal.hrUserId,
        email: command.email, displayName: command.displayName, role: command.role,
        countries: command.countries, departments: command.departments, password: temporaryPassword,
        operation: { idempotencyKey, fingerprint: commandFingerprint(command) },
        confirm: () => confirmPreview(principal, command, proposed, input.previewToken),
      });
    } catch (error) {
      throw publicError(error);
    }
    return {
      value: {
        hrUser: await detailOf(result.hrUserId),
        auditEvent: await auditEvent(result.auditEventId),
        temporaryPassword: result.replayed ? null : temporaryPassword,
        credentialRecoveryRequired: result.replayed,
        temporaryPasswordNotice: result.replayed ? TEMPORARY_PASSWORD_UNAVAILABLE : TEMPORARY_PASSWORD_NOTICE,
      },
      replayed: result.replayed,
    };
  }

  async function change(principal: Principal, operation: ChangeOperation, hrUserIdText: string, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserChangeResult>> {
    if (principal.role !== 'ADMIN') throw new HrAccessError('FORBIDDEN');
    const hrUserId = parseHrUserId(hrUserIdText);
    const command = normalize(operation, hrUserId, input);
    if (operation === 'SCOPES') await assertKnownScopes(command.countries ?? [], command.departments ?? []);
    await checkPreviewBinding(principal, operation, hrUserId, input.previewToken);
    const options = {
      actorHrUserId: principal.hrUserId,
      targetHrUserId: hrUserId,
      expectedVersion: command.expectedVersion ?? undefined,
      operation: { idempotencyKey, fingerprint: commandFingerprint(command) },
      now: clock(),
      // Runs under the row locks, after the replay and version checks.
      confirm: (current: HrUserState) => confirmPreview(principal, command, proposedFor(operation, current, command), input.previewToken),
    };
    let result: ChangeResult;
    try {
      switch (operation) {
        case 'PROFILE': result = await setDisplayName(pool, { ...options, displayName: command.displayName }); break;
        case 'PROMOTE': result = await promoteToAdmin(pool, options); break;
        case 'SCOPES': result = await replaceScopes(pool, { ...options, countries: command.countries, departments: command.departments }); break;
        case 'DEACTIVATE': result = await setHrUserStatus(pool, { ...options, status: 'INACTIVE', reason: command.reason }); break;
        case 'REACTIVATE': result = await setHrUserStatus(pool, { ...options, status: 'ACTIVE', reason: command.reason }); break;
      }
    } catch (error) {
      throw publicError(error);
    }
    return {
      value: {
        hrUser: await detailOf(hrUserId),
        changed: result.changed,
        auditEvent: result.changed ? await auditEvent(result.auditEventId) : null,
        revokedSessionCount: result.changed ? result.revokedSessionCount : 0,
      },
      replayed: result.changed && result.replayed,
    };
  }

  // -------------------------------------------------------------------------
  // Temporary-password regeneration (review fix 11a)

  /** Review fix 11b: checked before any token check, hashing, read of the target, or write. */
  function rejectSelfRegeneration(principal: Principal, hrUserId: number): void {
    if (principal.hrUserId === hrUserId) throw new HrAccessError('SELF_PASSWORD_REGENERATION_FORBIDDEN');
  }

  async function previewPasswordRegeneration(principal: Principal, hrUserIdText: string, input: HrAccessInput): Promise<HrUserPasswordRegenerationPreview> {
    const hrUserId = parseHrUserId(hrUserIdText);
    rejectSelfRegeneration(principal, hrUserId);
    const command = normalize('REGENERATE_PASSWORD', hrUserId, input);
    const current = await loadTarget(hrUserId);
    if (current.version !== input.expectedVersion) throw new HrAccessError('STALE_VERSION', { message: HR_USER_STALE_MESSAGE });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT email FROM hr_users WHERE id = ?', [hrUserId]);
    const { token, expiresAt } = await previewTokens.sign({
      actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, operation: 'REGENERATE_PASSWORD', targetHrUserId: hrUserId,
      expectedVersion: current.version,
      // Access does not change: the proposed state is the current state.
      digest: previewDigest({ actorHrUserId: principal.hrUserId, sessionId: principal.sessionId, command, proposed: current }),
    });
    return {
      operation: 'REGENERATE_PASSWORD',
      target: { hrUserId, displayName: current.displayName, email: String(rows[0]?.email ?? ''), role: current.role, status: current.status },
      expectedVersion: current.version,
      sessionsToRevoke: await activeSessions(hrUserId),
      warning: REGENERATION_WARNING,
      reason: command.reason ?? '',
      previewToken: token,
      previewExpiresAt: expiresAt.toISOString(),
    };
  }

  async function regeneratePassword(principal: Principal, hrUserIdText: string, input: HrAccessInput, idempotencyKey: string): Promise<Replayable<HrUserPasswordRegenerationResult>> {
    if (principal.role !== 'ADMIN') throw new HrAccessError('FORBIDDEN');
    const hrUserId = parseHrUserId(hrUserIdText);
    rejectSelfRegeneration(principal, hrUserId);
    const command = normalize('REGENERATE_PASSWORD', hrUserId, input);
    await checkPreviewBinding(principal, 'REGENERATE_PASSWORD', hrUserId, input.previewToken);
    // A fresh random password for every new command (never derived from the
    // key). Hashed outside the transaction; discarded unused on a replay.
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    let result: ChangeResult;
    try {
      result = await regenerateTemporaryPassword(pool, {
        actorHrUserId: principal.hrUserId,
        targetHrUserId: hrUserId,
        passwordHash,
        reason: command.reason,
        expectedVersion: command.expectedVersion ?? undefined,
        operation: { idempotencyKey, fingerprint: commandFingerprint(command) },
        now: clock(),
        confirm: (current: HrUserState) => confirmPreview(principal, command, current, input.previewToken),
      });
    } catch (error) {
      throw publicError(error);
    }
    if (!result.changed) throw new Error('a regeneration always changes the user');
    // The transaction has committed: the password is returned only now.
    return {
      value: {
        hrUser: await detailOf(hrUserId),
        auditEvent: await auditEvent(result.auditEventId),
        revokedSessionCount: result.revokedSessionCount,
        temporaryPassword: result.replayed ? null : temporaryPassword,
        credentialRecoveryRequired: result.replayed,
        temporaryPasswordNotice: result.replayed ? REGENERATED_PASSWORD_UNAVAILABLE : TEMPORARY_PASSWORD_NOTICE,
      },
      replayed: result.replayed,
    };
  }

  return { list, get, audit, preview, create, change, previewPasswordRegeneration, regeneratePassword };
}
