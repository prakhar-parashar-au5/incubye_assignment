// HR user management. Every change and its access_audit_events row commit in
// one transaction. Authorization is checked inside each operation, against
// the actor's current database row, not against data held by a caller.
//
// Operation inputs are typed `unknown` where they will come from HTTP requests
// in the later API task: they are validated here at runtime.
import type { Connection, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { errorCode } from '../errors.js';
import { isOneOf } from '../source-workbook/constants.js';
import { ROLES, HR_STATUSES, canManageHrUsers } from './access-policy.js';
import type { HrStatus, Role } from './access-policy.js';
import { MAX_PASSWORD_LENGTH, NEW_PASSWORD_MIN_LENGTH, hashPassword } from './passwords.js';

export type AccessErrorCode = 'FORBIDDEN' | 'INVALID_INPUT' | 'EMAIL_TAKEN' | 'NOT_FOUND' | 'LAST_ACTIVE_ADMIN';

export class AccessError extends Error {
  readonly code: AccessErrorCode;

  constructor(code: AccessErrorCode, message: string) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
  }
}

export const AUDIT_ACTIONS = Object.freeze([
  'HR_USER_CREATED',
  'COUNTRY_SCOPES_CHANGED',
  'DEPARTMENT_SCOPES_CHANGED',
  'HR_USER_ACTIVATED',
  'HR_USER_DEACTIVATED',
] as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Exactly what an audit event stores: never passwords, hashes, tokens, or session IDs. */
export interface AuditState {
  role: Role;
  status: HrStatus;
  countries: string[];
  departments: string[];
}

/** Current access state of one HR user. */
export interface HrUserState extends AuditState {
  version: number;
}

/** Pool or single connection: mysql2's Pool type extends Connection. */
type Db = Pool | Connection;

interface UserStateRow extends RowDataPacket {
  role: string;
  status: string;
  version: number;
}
interface RoleStatusRow extends RowDataPacket {
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
interface IdRow extends RowDataPacket {
  id: number;
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

function validateList(values: unknown, label: string): string[] {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || v === '')) {
    throw new AccessError('INVALID_INPUT', `${label} must be a list of names`);
  }
  // Every element was checked to be a non-empty string above.
  const strings = values as string[];
  if (new Set(strings).size !== strings.length) throw new AccessError('INVALID_INPUT', `${label} must not repeat a value`);
  return [...strings].sort();
}

/** Runs fn(connection) in one transaction. Accepts a pool or a connection. */
async function inTransaction<T>(db: Db, fn: (connection: Connection) => Promise<T>): Promise<T> {
  const pooled = 'getConnection' in db ? await db.getConnection() : undefined;
  const connection: Connection = pooled ?? db;
  try {
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

async function assertActorCanManage(connection: Connection, actorHrUserId: number): Promise<void> {
  const [rows] = await connection.execute<RoleStatusRow[]>('SELECT role, status FROM hr_users WHERE id = ? FOR SHARE', [actorHrUserId]);
  const actor = rows[0];
  if (actor === undefined || !canManageHrUsers(actor)) {
    throw new AccessError('FORBIDDEN', 'only an active Admin HR can manage HR users');
  }
}

async function resolveCountries(connection: Connection, countries: readonly string[]): Promise<void> {
  if (countries.length === 0) return;
  const [rows] = await connection.query<CodeRow[]>('SELECT code FROM countries WHERE code IN (?)', [countries]);
  const known = new Set(rows.map((r) => r.code));
  const missing = countries.filter((c) => !known.has(c));
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown country: ${missing.join(', ')}`);
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
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown department: ${missing.join(', ')}`);
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
    `SELECT role, status, version FROM hr_users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
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
    ...narrowDbRoleStatus(user),
    version: user.version,
    countries: countries.map((r) => r.country_code).sort(),
    departments: departments.map((r) => r.name).sort(),
  };
}

// Only these keys reach the audit log: never passwords, hashes, tokens, or session IDs.
const auditState = ({ role, status, countries, departments }: AuditState): AuditState => ({ role, status, countries, departments });

interface AuditEvent {
  actorHrUserId: number | null;
  targetHrUserId: number;
  action: AuditAction;
  before: AuditState | null;
  after: AuditState;
}

async function writeAudit(connection: Connection, { actorHrUserId, targetHrUserId, action, before, after }: AuditEvent): Promise<void> {
  await connection.execute(
    `INSERT INTO access_audit_events (actor_hr_user_id, target_hr_user_id, action, before_state, after_state)
     VALUES (?, ?, ?, ?, ?)`,
    [actorHrUserId, targetHrUserId, action, before ? JSON.stringify(auditState(before)) : null, JSON.stringify(auditState(after))],
  );
}

async function insertScopes(connection: Connection, hrUserId: number, countries: readonly string[], departmentIds: readonly number[]): Promise<void> {
  if (countries.length > 0) {
    await connection.query('INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES ?', [countries.map((c) => [hrUserId, c])]);
  }
  if (departmentIds.length > 0) {
    await connection.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES ?', [departmentIds.map((d) => [hrUserId, d])]);
  }
}

/** Untrusted creation input (future HTTP body). */
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
    throw new AccessError('INVALID_INPUT', 'an Admin HR cannot have country or department scopes');
  }
}

async function insertUserWithAudit(
  connection: Connection,
  input: NewHrUserInput,
  passwordHash: string,
  actorHrUserId: number | null,
): Promise<number> {
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
  await writeAudit(connection, { actorHrUserId, targetHrUserId: hrUserId, action: 'HR_USER_CREATED', before: null, after });
  return hrUserId;
}

/**
 * Admin operation: creates an ACTIVE HR user with scopes and one audit event.
 * @returns new HR user id
 */
export async function createHrUser(db: Db, { actorHrUserId, ...fields }: NewHrUserFields & { actorHrUserId: number }): Promise<number> {
  const input = validateNewUser(fields);
  const passwordHash = await hashPassword(fields.password); // outside the transaction: keeps it short
  return inTransaction(db, async (connection) => {
    await assertActorCanManage(connection, actorHrUserId);
    return insertUserWithAudit(connection, input, passwordHash, actorHrUserId);
  });
}

/**
 * System setup only (documented demo-user command and tests): creates an HR
 * user without an HR actor. The audit event has actor_hr_user_id = NULL.
 * Not for request handlers.
 */
export async function bootstrapHrUser(db: Db, fields: NewHrUserFields): Promise<number> {
  const input = validateNewUser(fields);
  const passwordHash = await hashPassword(fields.password);
  return inTransaction(db, (connection) => insertUserWithAudit(connection, input, passwordHash, null));
}

export type ChangeResult = { changed: false } | { changed: true; version: number };

interface ChangeTarget {
  actorHrUserId: number;
  targetHrUserId: number;
}

/**
 * Shared shape of a locked, audited change to one HR user. A thrown error
 * rolls back everything: no version change and no audit event.
 * `prelock(connection)` runs first, before any other lock, so operations that
 * lock several rows always take them in the same order (no deadlocks).
 */
async function changeHrUser(
  db: Db,
  { actorHrUserId, targetHrUserId }: ChangeTarget,
  apply: (connection: Connection, before: HrUserState) => Promise<AuditAction | null>,
  { prelock }: { prelock?: ((connection: Connection) => Promise<void>) | undefined } = {},
): Promise<ChangeResult> {
  return inTransaction(db, async (connection) => {
    if (prelock) await prelock(connection);
    await assertActorCanManage(connection, actorHrUserId);
    const before = await loadState(connection, targetHrUserId, { lock: true });
    const action = await apply(connection, before);
    if (action === null) return { changed: false };
    await connection.execute('UPDATE hr_users SET version = version + 1 WHERE id = ?', [targetHrUserId]);
    const after = await loadState(connection, targetHrUserId);
    await writeAudit(connection, { actorHrUserId, targetHrUserId, action, before, after });
    return { changed: true, version: after.version };
  });
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Admin operation: replaces a user's country scopes. Unchanged lists write nothing. */
export async function setCountryScopes(
  db: Db,
  { actorHrUserId, targetHrUserId, countries }: ChangeTarget & { countries: unknown },
): Promise<ChangeResult> {
  const next = validateList(countries, 'countries');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (sameList(before.countries, next)) return null;
    assertAdminHasNoScopes(before.role, next, []);
    await resolveCountries(connection, next);
    await connection.execute('DELETE FROM hr_user_country_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await insertScopes(connection, targetHrUserId, next, []);
    return 'COUNTRY_SCOPES_CHANGED';
  });
}

/** Admin operation: replaces a user's department scopes (by department name). */
export async function setDepartmentScopes(
  db: Db,
  { actorHrUserId, targetHrUserId, departments }: ChangeTarget & { departments: unknown },
): Promise<ChangeResult> {
  const next = validateList(departments, 'departments');
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (sameList(before.departments, next)) return null;
    assertAdminHasNoScopes(before.role, [], next);
    const ids = await resolveDepartments(connection, next);
    await connection.execute('DELETE FROM hr_user_department_scopes WHERE hr_user_id = ?', [targetHrUserId]);
    await insertScopes(connection, targetHrUserId, [], ids);
    return 'DEPARTMENT_SCOPES_CHANGED';
  });
}

/**
 * Admin operation: activates or deactivates an HR user.
 * The last ACTIVE ADMIN cannot be deactivated (approved rule 04a), including
 * by themselves. Deactivating an admin first locks every active admin row in
 * id order, so two concurrent deactivations serialise: the second re-reads
 * the committed state, sees one active admin, and fails with LAST_ACTIVE_ADMIN.
 */
export async function setHrUserStatus(
  db: Db,
  { actorHrUserId, targetHrUserId, status }: ChangeTarget & { status: unknown },
): Promise<ChangeResult> {
  if (!isOneOf(HR_STATUSES, status)) throw new AccessError('INVALID_INPUT', `status must be one of ${HR_STATUSES.join(', ')}`);
  let activeAdminIds: number[] = [];
  const prelock = status === 'INACTIVE'
    ? async (connection: Connection): Promise<void> => {
      const [rows] = await connection.query<IdRow[]>(
        "SELECT id FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
      );
      activeAdminIds = rows.map((r) => r.id);
    }
    : undefined;
  return changeHrUser(db, { actorHrUserId, targetHrUserId }, async (connection, before) => {
    if (before.status === status) return null;
    if (status === 'INACTIVE' && before.role === 'ADMIN') {
      const remaining = activeAdminIds.filter((id) => id !== targetHrUserId);
      if (remaining.length === 0) throw new AccessError('LAST_ACTIVE_ADMIN', 'cannot deactivate the last active Admin HR');
    }
    await connection.execute('UPDATE hr_users SET status = ? WHERE id = ?', [status, targetHrUserId]);
    return status === 'ACTIVE' ? 'HR_USER_ACTIVATED' : 'HR_USER_DEACTIVATED';
  }, { prelock });
}

/** Read-only current state for the demo-user check. */
export async function loadHrUserState(db: Db, hrUserId: number): Promise<HrUserState> {
  return loadState(db, hrUserId);
}
