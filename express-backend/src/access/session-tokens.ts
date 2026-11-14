// Session JWTs with "jose" (maintained, MIT, no native code). HS256 with a
// key from the injected environment. The token proves "who and which session";
// role, status, and scopes are always loaded from the database per request.
import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export const SESSION_TTL_SECONDS = 2 * 60 * 60;
const ALGORITHM = 'HS256';
const MIN_KEY_BYTES = 32;
const APPROVED_CLAIMS = ['exp', 'iat', 'sid', 'sub'];
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What sign() needs. */
export interface SessionClaims {
  hrUserId: number;
  sessionId: string;
  issuedAt: Date;
}

/** What verify() proves. Every field is required. */
export interface VerifiedSessionToken {
  hrUserId: number;
  sessionId: string;
  expiresAt: Date;
}

export interface SessionTokens {
  sign(claims: SessionClaims): Promise<string>;
  /** Rejects with InvalidTokenError for anything that is not a valid session token. */
  verify(token: unknown): Promise<VerifiedSessionToken>;
}

export class InvalidTokenError extends Error {
  readonly code = 'INVALID_TOKEN';

  constructor() {
    super('invalid or expired session token');
    this.name = 'InvalidTokenError';
  }
}

function encodeKey(signingKey: unknown): Uint8Array {
  if (typeof signingKey !== 'string' || Buffer.byteLength(signingKey, 'utf8') < MIN_KEY_BYTES) {
    throw new TypeError(`JWT signing key must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return new TextEncoder().encode(signingKey);
}

/** Reads JWT_SIGNING_KEY from an injected environment object. Never reads files. */
export function readSigningKey(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const key = env.JWT_SIGNING_KEY;
  if (key === undefined || key === '') throw new Error('JWT_SIGNING_KEY is not set');
  encodeKey(key); // length check; the message never includes the key
  return key;
}

const toSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

/**
 * @param options.clock  injected so expiry is deterministic in tests
 */
export function createSessionTokens({ signingKey, clock = () => new Date() }: { signingKey: string; clock?: () => Date }): SessionTokens {
  const key = encodeKey(signingKey);

  async function sign({ hrUserId, sessionId, issuedAt }: SessionClaims): Promise<string> {
    const iat = toSeconds(issuedAt);
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(hrUserId))
      .setIssuedAt(iat)
      .setExpirationTime(iat + SESSION_TTL_SECONDS)
      .sign(key);
  }

  async function verify(token: unknown): Promise<VerifiedSessionToken> {
    if (typeof token !== 'string' || token === '') throw new InvalidTokenError();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        currentDate: clock(),
        requiredClaims: APPROVED_CLAIMS,
      }));
    } catch {
      throw new InvalidTokenError();
    }
    const { sub, sid, exp, iat } = payload;
    const claimNames = Object.keys(payload).sort();
    const hrUserId = Number(sub);
    if (
      claimNames.join(',') !== APPROVED_CLAIMS.join(',')
      || typeof sub !== 'string'
      || !/^[1-9]\d*$/.test(sub)
      || !Number.isSafeInteger(hrUserId)
      || typeof sid !== 'string'
      || !SESSION_ID.test(sid)
      || typeof exp !== 'number'
      || typeof iat !== 'number'
      || exp - iat !== SESSION_TTL_SECONDS
    ) {
      throw new InvalidTokenError();
    }
    return { hrUserId, sessionId: sid, expiresAt: new Date(exp * 1000) };
  }

  return { sign, verify };
}
