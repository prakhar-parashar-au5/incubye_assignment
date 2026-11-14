// Session JWTs with "jose" (maintained, MIT, no native code). HS256 with a
// key from the injected environment. The token proves "who and which session";
// role, status, and scopes are always loaded from the database per request.
import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_TTL_SECONDS = 2 * 60 * 60;
const ALGORITHM = 'HS256';
const MIN_KEY_BYTES = 32;
const APPROVED_CLAIMS = ['exp', 'iat', 'sid', 'sub'];
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class InvalidTokenError extends Error {
  constructor() {
    super('invalid or expired session token');
    this.name = 'InvalidTokenError';
    this.code = 'INVALID_TOKEN';
  }
}

function encodeKey(signingKey) {
  if (typeof signingKey !== 'string' || Buffer.byteLength(signingKey, 'utf8') < MIN_KEY_BYTES) {
    throw new TypeError(`JWT signing key must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return new TextEncoder().encode(signingKey);
}

/** Reads JWT_SIGNING_KEY from an injected environment object. Never reads files. */
export function readSigningKey(env = process.env) {
  const key = env.JWT_SIGNING_KEY;
  if (key === undefined || key === '') throw new Error('JWT_SIGNING_KEY is not set');
  encodeKey(key); // length check; the message never includes the key
  return key;
}

const toSeconds = (date) => Math.floor(date.getTime() / 1000);

/**
 * @param {{ signingKey: string, clock?: () => Date }} options
 *   clock is injected so expiry is deterministic in tests.
 */
export function createSessionTokens({ signingKey, clock = () => new Date() }) {
  const key = encodeKey(signingKey);

  /** @param {{ hrUserId: number, sessionId: string, issuedAt: Date }} claims */
  async function sign({ hrUserId, sessionId, issuedAt }) {
    const iat = toSeconds(issuedAt);
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(hrUserId))
      .setIssuedAt(iat)
      .setExpirationTime(iat + SESSION_TTL_SECONDS)
      .sign(key);
  }

  /** @returns {Promise<{ hrUserId: number, sessionId: string, expiresAt: Date }>} */
  async function verify(token) {
    if (typeof token !== 'string' || token === '') throw new InvalidTokenError();
    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        currentDate: clock(),
        requiredClaims: APPROVED_CLAIMS,
      }));
    } catch {
      throw new InvalidTokenError();
    }
    const claimNames = Object.keys(payload).sort();
    const hrUserId = Number(payload.sub);
    if (
      claimNames.join(',') !== APPROVED_CLAIMS.join(',')
      || !/^[1-9]\d*$/.test(payload.sub)
      || !Number.isSafeInteger(hrUserId)
      || typeof payload.sid !== 'string'
      || !SESSION_ID.test(payload.sid)
      || payload.exp - payload.iat !== SESSION_TTL_SECONDS
    ) {
      throw new InvalidTokenError();
    }
    return { hrUserId, sessionId: payload.sid, expiresAt: new Date(payload.exp * 1000) };
  }

  return { sign, verify };
}
