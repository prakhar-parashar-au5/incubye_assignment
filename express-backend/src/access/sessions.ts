// Sign-in, per-request authentication, and sign-out over hr_sessions.
// Every authenticate() call re-reads the session, the HR user, and the scopes,
// so revocation, deactivation, and scope changes apply on the next request.
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { isOneOf } from '../source-workbook/constants.js';
import { HR_STATUSES, ROLES } from './access-policy.js';
import type { HrStatus, Role } from './access-policy.js';
import { normalizeEmail } from './hr-users.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { SESSION_TTL_SECONDS } from './session-tokens.js';
import type { SessionTokens, VerifiedSessionToken } from './session-tokens.js';

export class InvalidCredentialsError extends Error {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export type AuthenticationFailureReason =
  | 'INVALID_TOKEN'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'USER_INACTIVE';

/**
 * One public message for every failure. `reason` is for logs and tests only
 * and must not be sent to the client.
 */
export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';
  readonly reason: AuthenticationFailureReason;

  constructor(reason: AuthenticationFailureReason) {
    super('authentication required');
    this.name = 'AuthenticationError';
    this.reason = reason;
  }
}

/** The current HR user for one request, loaded from the database. */
export interface Principal {
  hrUserId: number;
  email: string;
  displayName: string;
  role: Role;
  status: HrStatus;
  countries: string[];
  departments: string[];
  sessionId: string;
}

export interface SignInResult {
  token: string;
  expiresAt: Date;
}

export interface AuthService {
  signIn(email: unknown, password: unknown): Promise<SignInResult>;
  authenticate(token: unknown): Promise<Principal>;
  signOut(token: unknown): Promise<{ revoked: boolean }>;
}

interface SignInRow extends RowDataPacket {
  id: number;
  password_hash: string;
  status: string;
}
interface SessionUserRow extends RowDataPacket {
  expires_at: string;
  revoked_at: string | null;
  email: string;
  display_name: string;
  role: string;
  status: string;
}
interface CountryCodeRow extends RowDataPacket {
  country_code: string;
}
interface NameRow extends RowDataPacket {
  name: string;
}

/** DATETIME(3) text from mysql2 (UTC session, dateStrings) to a Date. */
const fromDbTime = (text: string): Date => new Date(`${text.replace(' ', 'T')}Z`);

/**
 * @param deps.clock  must be the one the tokens use
 */
export function createAuthService({ pool, tokens, clock = () => new Date() }: {
  pool: Pool;
  tokens: SessionTokens;
  clock?: () => Date;
}): AuthService {
  // Verified against when the email is unknown, so both paths cost one Argon2 check.
  let dummyHash: string | undefined;
  const getDummyHash = async (): Promise<string> => {
    dummyHash ??= await hashPassword('timing-equaliser-not-a-real-password');
    return dummyHash;
  };

  async function signIn(email: unknown, password: unknown): Promise<SignInResult> {
    const [rows] = await pool.execute<SignInRow[]>('SELECT id, password_hash, status FROM hr_users WHERE email = ?', [normalizeEmail(email)]);
    const user = rows[0];
    if (user === undefined) {
      await verifyPassword(await getDummyHash(), typeof password === 'string' ? password : '');
      throw new InvalidCredentialsError();
    }
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

  async function verifyToken(token: unknown): Promise<VerifiedSessionToken> {
    try {
      return await tokens.verify(token);
    } catch {
      throw new AuthenticationError('INVALID_TOKEN');
    }
  }

  async function authenticate(token: unknown): Promise<Principal> {
    const { hrUserId, sessionId } = await verifyToken(token);
    const [rows] = await pool.execute<SessionUserRow[]>(
      `SELECT s.expires_at, s.revoked_at, u.email, u.display_name, u.role, u.status
       FROM hr_sessions s JOIN hr_users u ON u.id = s.hr_user_id
       WHERE s.id = ? AND s.hr_user_id = ?`,
      [sessionId, hrUserId],
    );
    const row = rows[0];
    if (row === undefined) throw new AuthenticationError('SESSION_NOT_FOUND');
    if (row.revoked_at !== null) throw new AuthenticationError('SESSION_REVOKED');
    if (fromDbTime(row.expires_at) <= clock()) throw new AuthenticationError('SESSION_EXPIRED');
    if (row.status !== 'ACTIVE') throw new AuthenticationError('USER_INACTIVE');
    // The ENUM columns guarantee these; the driver types only say "string".
    if (!isOneOf(ROLES, row.role) || !isOneOf(HR_STATUSES, row.status)) {
      throw new Error('unexpected role or status value read from hr_users');
    }

    const [countries] = await pool.execute<CountryCodeRow[]>('SELECT country_code FROM hr_user_country_scopes WHERE hr_user_id = ?', [hrUserId]);
    const [departments] = await pool.execute<NameRow[]>(
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
  async function signOut(token: unknown): Promise<{ revoked: boolean }> {
    const { hrUserId, sessionId } = await verifyToken(token);
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE hr_sessions SET revoked_at = ? WHERE id = ? AND hr_user_id = ? AND revoked_at IS NULL',
      [clock(), sessionId, hrUserId],
    );
    return { revoked: result.affectedRows === 1 };
  }

  return { signIn, authenticate, signOut };
}
