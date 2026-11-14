// HR user management. Every change and its access_audit_events row commit in
// one transaction. Authorization is checked inside each operation, against
// the actor's current database row, not against data held by a caller.
import { ROLES, HR_STATUSES, canManageHrUsers } from './access-policy.js';
import { MAX_PASSWORD_LENGTH, NEW_PASSWORD_MIN_LENGTH, hashPassword } from './passwords.js';

export class AccessError extends Error {
  /** @param {'FORBIDDEN' | 'INVALID_INPUT' | 'EMAIL_TAKEN' | 'NOT_FOUND' | 'LAST_ACTIVE_ADMIN'} code */
  constructor(code, message) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized.length > 254 || !EMAIL.test(normalized)) throw new AccessError('INVALID_INPUT', 'email is not valid');
  return normalized;
}

function validateDisplayName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new AccessError('INVALID_INPUT', 'display name must be 1 to 100 characters');
  }
  return trimmed;
}

function validateList(values, label) {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || v === '')) {
    throw new AccessError('INVALID_INPUT', `${label} must be a list of names`);
  }
  if (new Set(values).size !== values.length) throw new AccessError('INVALID_INPUT', `${label} must not repeat a value`);
  return [...values].sort();
}

/** Runs fn(connection) in one transaction. Accepts a pool or a connection. */
async function inTransaction(db, fn) {
  const ownsConnection = typeof db.getConnection === 'function';
  const connection = ownsConnection ? await db.getConnection() : db;
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
    if (ownsConnection) connection.release();
  }
}

async function assertActorCanManage(connection, actorHrUserId) {
  const [rows] = await connection.execute('SELECT role, status FROM hr_users WHERE id = ? FOR SHARE', [actorHrUserId]);
  if (rows.length === 0 || !canManageHrUsers(rows[0])) {
    throw new AccessError('FORBIDDEN', 'only an active Admin HR can manage HR users');
  }
}

async function resolveCountries(connection, countries) {
  if (countries.length === 0) return;
  const [rows] = await connection.query('SELECT code FROM countries WHERE code IN (?)', [countries]);
  const known = new Set(rows.map((r) => r.code));
  const missing = countries.filter((c) => !known.has(c));
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown country: ${missing.join(', ')}`);
}

/** Resolves exact department names to ids. Returns ids in input order. */
async function resolveDepartments(connection, departments) {
  if (departments.length === 0) return [];
  const [rows] = await connection.query('SELECT id, name FROM departments WHERE name IN (?)', [departments]);
  const idByName = new Map(rows.map((r) => [r.name, r.id])); // exact name; collation alone would accept "tech"
  const missing = departments.filter((d) => !idByName.has(d));
  if (missing.length > 0) throw new AccessError('INVALID_INPUT', `unknown department: ${missing.join(', ')}`);
  return departments.map((d) => idByName.get(d));
}

/** Current access state of one HR user. Locks the row when lock is true. */
async function loadState(connection, hrUserId, { lock = false } = {}) {
  const [users] = await connection.execute(
    `SELECT role, status, version FROM hr_users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [hrUserId],
  );
  if (users.length === 0) throw new AccessError('NOT_FOUND', 'HR user not found');
  const [countries] = await connection.execute('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ?', [hrUserId]);
  const [departments] = await connection.execute(
    `SELECT d.name FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ?`,
    [hrUserId],
  );
  return {
    role: users[0].role,
    status: users[0].status,
    version: users[0].version,
    countries: countries.map((r) => r.country_code).sort(),
    departments: departments.map((r) => r.name).sort(),
  };
}

// Only these keys reach the audit log: never passwords, hashes, tokens, or session IDs.
const auditState = ({ role, status, countries, departments }) => ({ role, status, countries, departments });

async function writeAudit(connection, { actorHrUserId, targetHrUserId, action, before, after }) {
  await connection.execute(
    `INSERT INTO access_audit_events (actor_hr_user_id, target_hr_user_id, action, before_state, after_state)
     VALUES (?, ?, ?, ?, ?)`,
    [actorHrUserId, targetHrUserId, action, before ? JSON.stringify(auditState(before)) : null, JSON.stringify(auditState(after))],
  );
}

async function insertScopes(connection, hrUserId, countries, departmentIds) {
  if (countries.length > 0) {
    await connection.query('INSERT INTO hr_user_country_scopes (hr_user_id, country_code) VALUES ?', [countries.map((c) => [hrUserId, c])]);
  }
  if (departmentIds.length > 0) {
    await connection.query('INSERT INTO hr_user_department_scopes (hr_user_id, department_id) VALUES ?', [departmentIds.map((d) => [hrUserId, d])]);
  }
}

function validateNewUser({ email, displayName, password, role, countries, departments }) {
  if (!ROLES.includes(role)) throw new AccessError('INVALID_INPUT', `role must be one of ${ROLES.join(', ')}`);
  if (typeof password !== 'string' || password.length < NEW_PASSWORD_MIN_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AccessError(
      'INVALID_INPUT',
      `password must be ${NEW_PASSWORD_MIN_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  const input = {
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
function assertAdminHasNoScopes(role, countries, departments) {
  if (role === 'ADMIN' && (countries.length > 0 || departments.length > 0)) {
    throw new AccessError('INVALID_INPUT', 'an Admin HR cannot have country or department scopes');
  }
}

async function insertUserWithAudit(connection, input, passwordHash, actorHrUserId) {
  await resolveCountries(connection, input.countries);
  const departmentIds = await resolveDepartments(connection, input.departments);
  let hrUserId;
  try {
    const [result] = await connection.execute(
      "INSERT INTO hr_users (email, display_name, password_hash, role, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
      [input.email, input.displayName, passwordHash, input.role],
    );
    hrUserId = result.insertId;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new AccessError('EMAIL_TAKEN', 'an HR user with this email already exists');
    throw error;
  }
  await insertScopes(connection, hrUserId, input.countries, departmentIds);
  const after = await loadState(connection, hrUserId);
  await writeAudit(connection, { actorHrUserId, targetHrUserId: hrUserId, action: 'HR_USER_CREATED', before: null, after });
  return hrUserId;
}

/**
 * Admin operation: creates an ACTIVE HR user with scopes and one audit event.
 * @param db  pool or connection
 * @returns {Promise<number>} new HR user id
 */
export async function createHrUser(db, { actorHrUserId, password, ...fields }) {
  const input = validateNewUser({ ...fields, password });
  const passwordHash = await hashPassword(password); // outside the transaction: keeps it short
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
export async function bootstrapHrUser(db, { password, ...fields }) {
  const input = validateNewUser({ ...fields, password });
  const passwordHash = await hashPassword(password);
  return inTransaction(db, (connection) => insertUserWithAudit(connection, input, passwordHash, null));
}

/**
 * Shared shape of a locked, audited change to one HR user. A thrown error
 * rolls back everything: no version change and no audit event.
 * `prelock(connection)` runs first, before any other lock, so operations that
 * lock several rows always take them in the same order (no deadlocks).
 */
async function changeHrUser(db, { actorHrUserId, targetHrUserId }, apply, { prelock } = {}) {
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

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Admin operation: replaces a user's country scopes. Unchanged lists write nothing. */
export async function setCountryScopes(db, { actorHrUserId, targetHrUserId, countries }) {
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
export async function setDepartmentScopes(db, { actorHrUserId, targetHrUserId, departments }) {
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
export async function setHrUserStatus(db, { actorHrUserId, targetHrUserId, status }) {
  if (!HR_STATUSES.includes(status)) throw new AccessError('INVALID_INPUT', `status must be one of ${HR_STATUSES.join(', ')}`);
  let activeAdminIds = [];
  const prelock = status === 'INACTIVE'
    ? async (connection) => {
      const [rows] = await connection.query(
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
export async function loadHrUserState(db, hrUserId) {
  return loadState(db, hrUserId);
}
