// HR user management. Every change and its access_audit_events row commit in
// one transaction. Authorization is checked inside each operation, against
// the actor's current database row, not against data held by a caller.
//
// Lock order (every write): one locking read of the actor row, the target
// row, and, for deactivation and role changes, every ACTIVE ADMIN row, all in
// ascending id order in a single statement. Every operation takes HR user
// row locks in the same global order, so two operations cannot deadlock on
// them, and concurrent last-admin checks serialise (review fix 04a).
//
// Then, under those locks: actor check, target state, idempotent replay
// check, expected-version check, the change, session revocation, version
// increment, and the audit event.
//
// Operation inputs are typed `unknown` where they come from callers that may
// not have validated them: they are validated here at runtime.
import type { Connection, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { errorCode } from '../errors.js';
import { isOneOf } from '../source-workbook/constants.js';
import { ROLES, HR_STATUSES, canManageHrUsers } from './access-policy.js';
import type { HrStatus, Role } from './access-policy.js';
import { MAX_PASSWORD_LENGTH, NEW_PASSWORD_MIN_LENGTH, hashPassword } from './passwords.js';

export type AccessErrorCode =
  | 'FORBIDDEN' | 'INVALID_INPUT' | 'EMAIL_TAKEN' | 'NOT_FOUND' | 'LAST_ACTIVE_ADMIN' | 'STALE_VERSION' | 'DUPLICATE_OPERATION'
  | 'SELF_PASSWORD_REGENERATION';

export class AccessError extends Error {
  readonly code: AccessErrorCode;
  /** INVALID_INPUT caused by a country or department scope (unknown value, or scopes on an ADMIN). */
  readonly invalidScope: boolean;

  constructor(code: AccessErrorCode, message: string, { invalidScope = false }: { invalidScope?: boolean } = {}) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
    this.invalidScope = invalidScope;
  }
}

export const AUDIT_ACTIONS = Object.freeze([
  'HR_USER_CREATED',
  'COUNTRY_SCOPES_CHANGED',
  'DEPARTMENT_SCOPES_CHANGED',
  'HR_USER_ACTIVATED',
  'HR_USER_DEACTIVATED',
  'DISPLAY_NAME_CHANGED',
  'SCOPES_REPLACED',
  'HR_USER_PROMOTED',
  'TEMPORARY_PASSWORD_REGENERATED',
] as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** These actions revoke every active session of the target in the same transaction. */
const SESSION_REVOKING_ACTIONS: ReadonlySet<AuditAction> = new Set(['HR_USER_DEACTIVATED', 'HR_USER_PROMOTED', 'TEMPORARY_PASSWORD_REGENERATED']);

/** Exactly what an audit event stores: never passwords, hashes, tokens, or session IDs. */
export interface AuditState {
  displayName: string;
  role: Role;
  status: HrStatus;
  countries: string[];
  departments: string[];
}

/** Current access state of one HR user. */
export interface HrUserState extends AuditState {
  version: number;
}

/** An access-management API write: the actor's idempotency key and the command fingerprint. */
export interface AccessOperation {
  idempotencyKey: string;
  fingerprint: string;
}

/** Pool or single connection: mysql2's Pool type extends Connection. */
type Db = Pool | Connection;

interface UserStateRow extends RowDataPacket {
  display_name: string;
  role: string;
  status: string;
  version: number;
}
interface LockedUserRow extends RowDataPacket {
  id: number;
  role: string;
  status: string;
}
interface CountryCodeRow extends RowDataPacket {
  country_code: string;
}
interface CodeRow extends RowDataPacket {
  code: string;
}
interface NameRow extends RowDataPacket {
  name: string;
}
interface IdNameRow extends RowDataPacket {
  id: number;
  name: string;
}
interface StoredOperationRow extends RowDataPacket {
  id: number;
  target_hr_user_id: number;
  action: string;
  operation_fingerprint: string;
  resulting_version: number | null;
  revoked_session_count: number | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function validateEmail(email: unknown): string {
  const normalized = normalizeEmail(email);
  if (normalized.length > 254 || !EMAIL.test(normalized)) throw new AccessError('INVALID_INPUT', 'email is not valid');
  return normalized;
}

function validateDisplayName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new AccessError('INVALID_INPUT', 'display name must be 1 to 100 characters');
  }
  return trimmed;
}

function validateReason(reason: unknown): string | null {
  if (reason === undefined || reason === null) return null;
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length === 0 || trimmed.length > 2000) throw new AccessError('INVALID_INPUT', 'reason must be 1 to 2000 characters');
  return trimmed;
}

function validateList(values: unknown, label: string): string[] {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || v === '')) {
    throw new AccessError('INVALID_INPUT', `${label} must be a list of names`);
  }
  // Every element was checked to be a non-empty string above.
  const strings = values as string[];
  if (new Set(strings).size !== strings.length) throw new AccessError('INVALID_INPUT', `${label} must not repeat a value`);
  return [...strings].sort();
}

function validateExpectedVersion(version: unknown): number | undefined {
  if (version === undefined) return undefined;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new AccessError('INVALID_INPUT', 'expected version must be a positive integer');
  }
  return version;
}

/**
 * Runs fn(connection) in one READ COMMITTED transaction: every read after a
 * lock sees the latest committed rows. Accepts a pool or a connection.
 */
async function inTransaction<T>(db: Db, fn: (connection: Connection) => Promise<T>): Promise<T> {
  const pooled = 'getConnection' in db ? await db.getConnection() : undefined;
  const connection: Connection = pooled ?? db;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    try {
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    pooled?.release();
  }
}

/**
 * Locks the given HR user rows, plus every ACTIVE ADMIN row when asked, in
 * ascending id order with one statement. Returns the locked rows.
 */
async function lockHrUsers(connection: Connection, ids: readonly number[], { activeAdmins = false } = {}): Promise<LockedUserRow[]> {
  const [rows] = await connection.query<LockedUserRow[]>(
    `SELECT id, role, status FROM hr_users
     WHERE id IN (?)${activeAdmins ? " OR (role = 'ADMIN' AND status = 'ACTIVE')" : ''}
     ORDER BY id FOR UPDATE`,
    [[...new Set(ids)]],
  );
  return rows;
}

function assertActorCanManage(locked: readonly LockedUserRow[], actorHrUserId: number): void {
  const actor = locked.find((row) => row.id === actorHrUserId);
  if (actor === undefined || !canManageHrUsers(actor)) {
    throw new AccessError('FORBIDDEN', 'only an active Admin HR can manage HR users');
  }
}

async function resolveCountries(connection: Connection, countries: readonly string[]): Promise<void> {
  if (countries.length === 0) return;
  const [rows] = await connection.query<CodeRow[]>('SELECT code FROM countries WHERE code IN (?)', [countries]);
  const known = new Set(rows.map((r) => r.code));
  const missing = countries.filter((c) => !known.has(c));
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown country: ${missing.join(', ')}`, { invalidScope: true });
}

/** Resolves exact department names to ids. Returns ids in input order. */
async function resolveDepartments(connection: Connection, departments: readonly string[]): Promise<number[]> {
  if (departments.length === 0) return [];
  const [rows] = await connection.query<IdNameRow[]>('SELECT id, name FROM departments WHERE name IN (?)', [departments]);
  const idByName = new Map(rows.map((r) => [r.name, r.id])); // exact name; collation alone would accept "tech"
  const ids: number[] = [];
  const missing: string[] = [];
  for (const department of departments) {
    const id = idByName.get(department);
    if (id === undefined) missing.push(department);
    else ids.push(id);
  }
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown department: ${missing.join(', ')}`, { invalidScope: true });
  return ids;
}

/**
 * Narrows a role or status read from MySQL. The ENUM columns guarantee these
 * values; the driver types only say "string", so check rather than assume.
 */
function narrowDbRoleStatus(row: { role: string; status: string }): { role: Role; status: HrStatus } {
  if (!isOneOf(ROLES, row.role) || !isOneOf(HR_STATUSES, row.status)) {
    throw new Error('unexpected role or status value read from hr_users');
  }
  return { role: row.role, status: row.status };
}

/** Current access state of one HR user. Locks the row when lock is true. */
async function loadState(connection: Db, hrUserId: number, { lock = false } = {}): Promise<HrUserState> {
  const [users] = await connection.execute<UserStateRow[]>(
    `SELECT display_name, role, status, version FROM hr_users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [hrUserId],
  );
  const user = users[0];
  if (user === undefined) throw new AccessError('NOT_FOUND', 'HR user not found');
  const [countries] = await connection.execute<CountryCodeRow[]>('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ?', [hrUserId]);
  const [departments] = await connection.execute<NameRow[]>(
    `SELECT d.name FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ?`,
    [hrUserId],
  );
  return {
    displayName: user.display_name,
    ...narrowDbRoleStatus(user),
    version: user.version,
    countries: countries.map((r) => r.country_code).sort(),
    departments: departments.map((r) => r.name).sort(),
  };
}

// Only these keys reach the audit log: never passwords, hashes, tokens, or session IDs.
const auditState = ({ displayName, role, status, countries, departments }: AuditState): AuditState => ({ displayName, role, status, countries, departments });

interface AuditEvent {
  actorHrUserId: number | null;
  targetHrUserId: number;
  action: AuditAction;
  before: AuditState | null;
  after: AuditState;
  resultingVersion: number;
  reason?: string | null;
  revokedSessionCount?: number | null;
  operation?: AccessOperation | undefined;
}

/** @returns the audit event id */
async function writeAudit(connection: Connection, event: AuditEvent): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO access_audit_events (actor_hr_user_id, target_hr_user_id, action, before_state, after_state, reason,
                                      resulting_version, revoked_session_count, operation_idempotency_key, operation_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.actorHrUserId, event.targetHrUserId, event.action,
      event.before ? JSON.stringify(auditState(event.before)) : null, JSON.stringify(auditState(event.after)),
      event.reason ?? null, event.resultingVersion, event.revokedSessionCount ?? null,
      event.operation?.idempotencyKey ?? null, event.operation?.fingerprint ?? null,
    ],
  );
  return result.insertId;
}

/** The audit event an earlier write by this actor stored under this key, if any. */
async function findOperation(connection: Connection, actorHrUserId: number, operation: AccessOperation): Promise<StoredOperationRow | undefined> {
  const [rows] = await connection.execute<StoredOperationRow[]>(
    `SELECT id, target_hr_user_id, action, operation_fingerprint, resulting_version, revoked_session_count
     FROM access_audit_events WHERE actor_hr_user_id = ? AND operation_idempotency_key = ?`,
    [actorHrUserId, operation.idempotencyKey],
  );
  return rows[0];
}

/** A unique-key race on the idempotency key (same actor, same key) is a duplicate operation. */
function mapDuplicateOperation(error: unknown): unknown {
  if (errorCode(error) === 'ER_DUP_ENTRY' && error instanceof Error && /uk_access_audit_operation_key/.test(error.message)) {
    return new AccessError('DUPLICATE_OPERATION', 'this idempotency key was already used for a different operation');
  }
  return error;
}

async function insertScopes(connection: Connection, hrUserId: number, countries: readonly string[], departmentIds: readonly number[]): Promise<void> {
  if (countries.length > 0) {
    await connection.query('INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES ?', [countries.map((c) => [hrUserId, c])]);
  }
  if (departmentIds.length > 0) {
    await connection.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES ?', [departmentIds.map((d) => [hrUserId, d])]);
  }
}

/** Untrusted creation input. */
export interface NewHrUserFields {
  email: unknown;
  displayName: unknown;
  password: unknown;
  role: unknown;
  countries: unknown;
  departments: unknown;
}

interface NewHrUserInput {
  email: string;
  displayName: string;
  role: Role;
  countries: string[];
  departments: string[];
}

function validateNewUser({ email, displayName, password, role, countries, departments }: NewHrUserFields): NewHrUserInput {
  if (!isOneOf(ROLES, role)) throw new AccessError('INVALID_INPUT', `role must be one of ${ROLES.join(', ')}`);
  if (typeof password !== 'string' || password.length < NEW_PASSWORD_MIN_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AccessError(
      'INVALID_INPUT',
      `password must be ${NEW_PASSWORD_MIN_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  const input: NewHrUserInput = {
    email: validateEmail(email),
    displayName: validateDisplayName(displayName),
    role,
    countries: validateList(countries, 'countries'),
    departments: validateList(departments, 'departments'),
  };
  assertAdminHasNoScopes(role, input.countries, input.departments);
  return input;
}

// Approved rule (04a): an ADMIN has empty country and department scope lists.
function assertAdminHasNoScopes(role: Role, countries: readonly string[], departments: readonly string[]): void {
  if (role === 'ADMIN' && (countries.length > 0 || departments.length > 0)) {
    throw new AccessError('INVALID_INPUT', 'an Admin HR cannot have country or department scopes', { invalidScope: true });
  }
}

async function insertUserWithAudit(
  connection: Connection,
  input: NewHrUserInput,
  passwordHash: string,
  actorHrUserId: number | null,
  operation?: AccessOperation,
): Promise<{ hrUserId: number; auditEventId: number }> {
  await resolveCountries(connection, input.countries);
  const departmentIds = await resolveDepartments(connection, input.departments);
  let hrUserId: number;
  try {
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO hr_users (email, display_name, password_hash, role, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
      [input.email, input.displayName, passwordHash, input.role],
    );
    hrUserId = result.insertId;
  } catch (error) {
    if (errorCode(error) === 'ER_DUP_ENTRY') throw new AccessError('EMAIL_TAKEN', 'an HR user with this email already exists');
    throw error;
  }
  await insertScopes(connection, hrUserId, input.countries, departmentIds);
  const after = await loadState(connection, hrUserId);
  const auditEventId = await writeAudit(connection, {
    actorHrUserId, targetHrUserId: hrUserId, action: 'HR_USER_CREATED', before: null, after, resultingVersion: after.version, operation,
  });
  return { hrUserId, auditEventId };
}

export interface CreateResult {
  hrUserId: number;
  auditEventId: number;
  /** True when this idempotency key already created this user: nothing was written. */
  replayed: boolean;
}

/**
 * Admin operation: creates an ACTIVE HR user with scopes and one audit event.
 * With an operation, the same actor and key replays the original creation for
 * the same command fingerprint and fails with DUPLICATE_OPERATION otherwise.
 * The actor row is locked FOR UPDATE, so retries of one creation serialise.
 */
export async function createHrUserOperation(
  db: Db,
  { actorHrUserId, operation, confirm, ...fields }: NewHrUserFields & {
    actorHrUserId: number;
    operation?: AccessOperation;
    /** Runs under the actor lock after the replay check, before the insert. A throw rolls back. */
    confirm?: () => Promise<void>;
  },
): Promise<CreateResult> {
  const input = validateNewUser(fields);
  const passwordHash = await hashPassword(fields.password); // outside the transaction: keeps it short
  try {
    return await inTransaction(db, async (connection) => {
      assertActorCanManage(await lockHrUsers(connection, [actorHrUserId]), actorHrUserId);
      if (operation !== undefined) {
        const stored = await findOperation(connection, actorHrUserId, operation);
        if (stored !== undefined) {
          if (stored.action !== 'HR_USER_CREATED' || stored.operation_fingerprint !== operation.fingerprint) {
            throw new AccessError('DUPLICATE_OPERATION', 'this idempotency key was already used for a different operation');
          }
          return { hrUserId: stored.target_hr_user_id, auditEventId: stored.id, replayed: true };
        }
      }
      if (confirm !== undefined) await confirm();
      return { ...(await insertUserWithAudit(connection, input, passwordHash, actorHrUserId, operation)), replayed: false };
    });
  } catch (error) {
    throw mapDuplicateOperation(error);
  }
}

/**
 * Admin operation: creates an ACTIVE HR user with scopes and one audit event.
 * @returns new HR user id
 */
export async function createHrUser(db: Db, args: NewHrUserFields & { actorHrUserId: number }): Promise<number> {
  return (await createHrUserOperation(db, args)).hrUserId;
}

/**
 * System setup only (documented demo-user command and tests): creates an HR
 * user without an HR actor. The audit event has actor_hr_user_id = NULL.
 * Not for request handlers.
 */
export async function bootstrapHrUser(db: Db, fields: NewHrUserFields): Promise<number> {
  const input = validateNewUser(fields);
  const passwordHash = await hashPassword(fields.password);
  return inTransaction(db, async (connection) => (await insertUserWithAudit(connection, input, passwordHash, null)).hrUserId);
}

export type ChangeResult =
  | { changed: false }
  | { changed: true; version: number; auditEventId: number; revokedSessionCount: number; replayed: boolean };

interface ChangeTarget {
  actorHrUserId: number;
  targetHrUserId: number;
}

/** Options shared by every change. The access-management API always passes all of them. */
export interface ChangeOptions {
  /** hr_users.version the caller previewed; a mismatch is STALE_VERSION. */
  expectedVersion?: unknown;
  /** Idempotency key and command fingerprint. */
  operation?: AccessOperation;
  /** Time used for session revocation. */
  now?: Date;
  /**
   * Runs under the row locks after the replay and version checks, before the
   * change, with the current state (e.g. the exact preview check). A throw rolls back.
   */
  confirm?: (current: HrUserState) => Promise<void>;
}

interface ChangePlan {
  action: AuditAction;
  reason?: string | null;
}

/**
 * Shared shape of a locked, audited change to one HR user. A thrown error
 * rolls back everything: no change, session revocation, version, or audit.
 * `apply` returns null for "nothing to change" (no version, no audit).
 */
async function changeHrUser(
  db: Db,
  { actorHrUserId, targetHrUserId }: ChangeTarget,
  apply: (connection: Connection, before: HrUserState, locked: readonly LockedUserRow[]) => Promise<ChangePlan | null>,
  { lockActiveAdmins = false, expectedVersion, operation, now = new Date(), confirm }: ChangeOptions & { lockActiveAdmins?: boolean },
): Promise<ChangeResult> {
  const expected = validateExpectedVersion(expectedVersion);
  try {
    return await inTransaction(db, async (connection) => {
      const locked = await lockHrUsers(connection, [actorHrUserId, targetHrUserId], { activeAdmins: lockActiveAdmins });
      assertActorCanManage(locked, actorHrUserId);
      const before = await loadState(connection, targetHrUserId);

      // Replay before the version check: a retry after success returns the
      // original result instead of a stale conflict.
      if (operation !== undefined) {
        const stored = await findOperation(connection, actorHrUserId, operation);
        if (stored !== undefined) {
          if (stored.target_hr_user_id !== targetHrUserId || stored.operation_fingerprint !== operation.fingerprint || stored.resulting_version === null) {
            throw new AccessError('DUPLICATE_OPERATION', 'this idempotency key was already used for a different operation');
          }
          return { changed: true, version: stored.resulting_version, auditEventId: stored.id, revokedSessionCount: stored.revoked_session_count ?? 0, replayed: true };
        }
      }
      if (expected !== undefined && before.version !== expected) {
        throw new AccessError('STALE_VERSION', 'the HR user changed after the expected version');
      }
      if (confirm !== undefined) await confirm(before);

      const plan = await apply(connection, before, locked);
      if (plan === null) return { changed: false };
      let revokedSessionCount: number | null = null;
      if (SESSION_REVOKING_ACTIONS.has(plan.action)) {
        const [revoked] = await connection.execute<ResultSetHeader>(
          'UPDATE hr_sessions SET revoked_at = ? WHERE hr_user_id = ? AND revoked_at IS NULL AND expires_at > ?',
          [now, targetHrUserId, now],
        );
        revokedSessionCount = revoked.affectedRows;
      }
      await connection.execute('UPDATE hr_users SET version = version + 1 WHERE id = ?', [targetHrUserId]);
      const after = await loadState(connection, targetHrUserId);
      const auditEventId = await writeAudit(connection, {
        actorHrUserId, targetHrUserId, action: plan.action, before, after, resultingVersion: after.version,
        reason: plan.reason ?? null, revokedSessionCount, operation,
      });
      return { changed: true, version: after.version, auditEventId, revokedSessionCount: revokedSessionCount ?? 0, replayed: false };
    });
  } catch (error) {
    throw mapDuplicateOperation(error);
  }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Admin operation: replaces a user's country scopes. Unchanged lists write nothing. */
export async function setCountryScopes(
  db: Db,
  { actorHrUserId, targetHrUserId, countries, ...options }: ChangeTarget & ChangeOptions & { countries: unknown },
): Promise<ChangeResult> {
  const next = validateList(countries, 'countries');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (sameList(before.countries, next)) return null;
    assertAdminHasNoScopes(before.role, next, []);
    await resolveCountries(connection, next);
    await connection.execute('DELETE FROM hr_user_country_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await insertScopes(connection, targetHrUserId, next, []);
    return { action: 'COUNTRY_SCOPES_CHANGED' };
  }, options);
}

/** Admin operation: replaces a user's department scopes (by department name). */
export async function setDepartmentScopes(
  db: Db,
  { actorHrUserId, targetHrUserId, departments, ...options }: ChangeTarget & ChangeOptions & { departments: unknown },
): Promise<ChangeResult> {
  const next = validateList(departments, 'departments');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (sameList(before.departments, next)) return null;
    assertAdminHasNoScopes(before.role, [], next);
    const ids = await resolveDepartments(connection, next);
    await connection.execute('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await insertScopes(connection, targetHrUserId, [], ids);
    return { action: 'DEPARTMENT_SCOPES_CHANGED' };
  }, options);
}

/**
 * Admin operation: replaces country and department scopes together in one
 * transaction and one audit event, so no intermediate state (one dimension
 * changed) is ever committed or visible. Unchanged lists write nothing.
 */
export async function replaceScopes(
  db: Db,
  { actorHrUserId, targetHrUserId, countries, departments, ...options }: ChangeTarget & ChangeOptions & { countries: unknown; departments: unknown },
): Promise<ChangeResult> {
  const nextCountries = validateList(countries, 'countries');
  const nextDepartments = validateList(departments, 'departments');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    assertAdminHasNoScopes(before.role, nextCountries, nextDepartments);
    if (sameList(before.countries, nextCountries) && sameList(before.departments, nextDepartments)) return null;
    await resolveCountries(connection, nextCountries);
    const departmentIds = await resolveDepartments(connection, nextDepartments);
    await connection.execute('DELETE FROM hr_user_country_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await connection.execute('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await insertScopes(connection, targetHrUserId, nextCountries, departmentIds);
    return { action: 'SCOPES_REPLACED' };
  }, options);
}

/** Admin operation: changes the display name. Sessions are not revoked. */
export async function setDisplayName(
  db: Db,
  { actorHrUserId, targetHrUserId, displayName, ...options }: ChangeTarget & ChangeOptions & { displayName: unknown },
): Promise<ChangeResult> {
  const next = validateDisplayName(displayName);
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (before.displayName === next) return null;
    await connection.execute('UPDATE hr_users SET display_name = ? WHERE id = ?', [next, targetHrUserId]);
    return { action: 'DISPLAY_NAME_CHANGED' };
  }, options);
}

/**
 * Admin operation: promotes SCOPED HR to ADMIN HR. Removes every scope row and
 * revokes every active session of the target, in one transaction. An ADMIN
 * target is unchanged (there is no demotion). Uses the active-Admin lock order.
 */
export async function promoteToAdmin(
  db: Db,
  { actorHrUserId, targetHrUserId, ...options }: ChangeTarget & ChangeOptions,
): Promise<ChangeResult> {
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (before.role === 'ADMIN') return null;
    await connection.execute('DELETE FROM hr_user_country_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await connection.execute('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await connection.execute("UPDATE hr_users SET role = 'ADMIN' WHERE id = ?", [targetHrUserId]);
    return { action: 'HR_USER_PROMOTED' };
  }, { ...options, lockActiveAdmins: true });
}

/**
 * Admin operation: activates or deactivates an HR user.
 * The last ACTIVE ADMIN cannot be deactivated (approved rule 04a), including
 * by themselves. Deactivation locks every active admin row together with the
 * actor and target in id order, so two concurrent deactivations serialise:
 * the second re-reads the committed state, sees one active admin, and fails
 * with LAST_ACTIVE_ADMIN. Deactivation revokes every active session of the
 * target in the same transaction. Reactivation restores the stored role and
 * scopes, never sessions.
 */
export async function setHrUserStatus(
  db: Db,
  { actorHrUserId, targetHrUserId, status, reason, ...options }: ChangeTarget & ChangeOptions & { status: unknown; reason?: unknown },
): Promise<ChangeResult> {
  if (!isOneOf(HR_STATUSES, status)) throw new AccessError('INVALID_INPUT', `status must be one of ${HR_STATUSES.join(', ')}`);
  const note = validateReason(reason);
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before, locked) => {
    if (before.status === status) return null;
    if (status === 'INACTIVE' && before.role === 'ADMIN') {
      const remaining = locked.filter((row) => row.role === 'ADMIN' && row.status === 'ACTIVE' && row.id !== targetHrUserId);
      if (remaining.length === 0) throw new AccessError('LAST_ACTIVE_ADMIN', 'cannot deactivate the last active Admin HR');
    }
    await connection.execute('UPDATE hr_users SET status = ? WHERE id = ?', [status, targetHrUserId]);
    return { action: status === 'ACTIVE' ? 'HR_USER_ACTIVATED' : 'HR_USER_DEACTIVATED', reason: note };
  }, { ...options, lockActiveAdmins: status === 'INACTIVE' });
}

/**
 * Admin operation (review fix 11a): replaces the user's password hash with the
 * hash of a newly generated temporary password, revokes every active session,
 * increments the version, and writes one TEMPORARY_PASSWORD_REGENERATED event,
 * in one transaction. The caller hashes the password before calling; only the
 * hash reaches the database, and neither reaches the audit event. Always a
 * change: a replay (same actor, key, and fingerprint) writes nothing.
 */
export async function regenerateTemporaryPassword(
  db: Db,
  { actorHrUserId, targetHrUserId, passwordHash, reason, ...options }: ChangeTarget & ChangeOptions & { passwordHash: string; reason: unknown },
): Promise<ChangeResult> {
  // Review fix 11b: self-regeneration revokes the actor's own session; a lost
  // response would then leave no session able to recover (a sole Admin is locked out).
  if (actorHrUserId === targetHrUserId) {
    throw new AccessError('SELF_PASSWORD_REGENERATION', 'an Admin cannot regenerate their own temporary password');
  }
  if (!passwordHash.startsWith('$argon2id$')) throw new AccessError('INVALID_INPUT', 'password hash must be Argon2id');
  const note = validateReason(reason);
  if (note === null) throw new AccessError('INVALID_INPUT', 'reason is required');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection) => {
    await connection.execute('UPDATE hr_users SET password_hash = ? WHERE id = ?', [passwordHash, targetHrUserId]);
    return { action: 'TEMPORARY_PASSWORD_REGENERATED', reason: note };
  }, options);
}

/** Read-only current state. */
export async function loadHrUserState(db: Db, hrUserId: number): Promise<HrUserState> {
  return loadState(db, hrUserId);
}
