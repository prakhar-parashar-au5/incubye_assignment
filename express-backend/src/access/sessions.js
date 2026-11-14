// Sign-in, per-request authentication, and sign-out over hr_sessions.
// Every authenticate() call re-reads the session, the HR user, and the scopes,
// so revocation, deactivation, and scope changes apply on the next request.
import { randomUUID } from 'node:crypto';

import { normalizeEmail } from './hr-users.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { SESSION_TTL_SECONDS } from './session-tokens.js';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
    this.code = 'INVALID_CREDENTIALS';
  }
}

/**
 * One public message for every failure. `reason` is for logs and tests only
 * and must not be sent to the client.
 */
export class AuthenticationError extends Error {
  /** @param {'INVALID_TOKEN'|'SESSION_NOT_FOUND'|'SESSION_REVOKED'|'SESSION_EXPIRED'|'USER_INACTIVE'} reason */
  constructor(reason) {
    super('authentication required');
    this.name = 'AuthenticationError';
    this.code = 'UNAUTHENTICATED';
    this.reason = reason;
  }
}

/** DATETIME(3) text from mysql2 (UTC session) to a Date. */
const fromDbTime = (text) => new Date(`${text.replace(' ', 'T')}Z`);

/**
 * @param {{ pool: import('mysql2/promise').Pool,
 *           tokens: ReturnType<import('./session-tokens.js').createSessionTokens>,
 *           clock?: () => Date }} deps  clock must be the one the tokens use
 */
export function createAuthService({ pool, tokens, clock = () => new Date() }) {
  // Verified against when the email is unknown, so both paths cost one Argon2 check.
  let dummyHash;
  const getDummyHash = async () => {
    dummyHash ??= await hashPassword('timing-equaliser-not-a-real-password');
    return dummyHash;
  };

  async function signIn(email, password) {
    const [rows] = await pool.execute('SELECT id, password_hash, status FROM hr_users WHERE email = ?', [normalizeEmail(email)]);
    if (rows.length === 0) {
      await verifyPassword(await getDummyHash(), typeof password === 'string' ? password : '');
      throw new InvalidCredentialsError();
    }
    const user = rows[0];
    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk || user.status !== 'ACTIVE') throw new InvalidCredentialsError();

    // Whole seconds, so the database expiry equals the JWT exp claim.
    const issuedAt = new Date(Math.floor(clock().getTime() / 1000) * 1000);
    const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_SECONDS * 1000);
    const sessionId = randomUUID();
    await pool.execute(
      'INSERT INTO hr_sessions (id, hr_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [sessionId, user.id, issuedAt, expiresAt],
    );
    const token = await tokens.sign({ hrUserId: user.id, sessionId, issuedAt });
    return { token, expiresAt };
  }

  async function verifyToken(token) {
    try {
      return await tokens.verify(token);
    } catch {
      throw new AuthenticationError('INVALID_TOKEN');
    }
  }

  /**
   * Returns the current principal for one request:
   * { hrUserId, email, displayName, role, status, countries, departments, sessionId }.
   */
  async function authenticate(token) {
    const { hrUserId, sessionId } = await verifyToken(token);
    const [rows] = await pool.execute(
      `SELECT s.expires_at, s.revoked_at, u.email, u.display_name, u.role, u.status
       FROM hr_sessions s JOIN hr_users u ON u.id = s.hr_user_id
       WHERE s.id = ? AND s.hr_user_id = ?`,
      [sessionId, hrUserId],
    );
    if (rows.length === 0) throw new AuthenticationError('SESSION_NOT_FOUND');
    const row = rows[0];
    if (row.revoked_at !== null) throw new AuthenticationError('SESSION_REVOKED');
    if (fromDbTime(row.expires_at) <= clock()) throw new AuthenticationError('SESSION_EXPIRED');
    if (row.status !== 'ACTIVE') throw new AuthenticationError('USER_INACTIVE');

    const [countries] = await pool.execute('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ?', [hrUserId]);
    const [departments] = await pool.execute(
      'SELECT d.name FROM hr_user_department_scopes s JOIN departments d ON d.id = s.department_id WHERE s.hr_user_id = ?',
      [hrUserId],
    );
    return {
      hrUserId,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      countries: countries.map((r) => r.country_code).sort(),
      departments: departments.map((r) => r.name).sort(),
      sessionId,
    };
  }

  /** Revokes the token's session. Returns { revoked: false } if it was already revoked. */
  async function signOut(token) {
    const { hrUserId, sessionId } = await verifyToken(token);
    const [result] = await pool.execute(
      'UPDATE hr_sessions SET revoked_at = ? WHERE id = ? AND hr_user_id = ? AND revoked_at IS NULL',
      [clock(), sessionId, hrUserId],
    );
    return { revoked: result.affectedRows === 1 };
  }

  return { signIn, authenticate, signOut };
}
