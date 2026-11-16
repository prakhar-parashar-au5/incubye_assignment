// Signed five-minute preview tokens for HR access-management changes.
//
// Same construction as the salary-adjustment preview token
// (src/compensation/preview-token.ts) with its own audience and key label, so
// a token from one feature can never verify in the other, or as a session
// token. The token carries identifiers, the expected HR user version, and a
// digest of the command and proposed access state: never a password, email,
// display name, or reason. Confirmation resends the command; the backend
// recomputes the digest under the row locks and compares.
import { createHmac } from 'node:crypto';
import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import { ACCESS_OPERATIONS } from './access-command.js';
import type { AccessOperationKind } from './access-command.js';

export const ACCESS_PREVIEW_TTL_SECONDS = 5 * 60;
const ALGORITHM = 'HS256';
const AUDIENCE = 'acme-hr-access-preview';
const ISSUER = 'acme-backend';
const KEY_LABEL = 'acme hr-access preview token v1';

export interface AccessPreviewBinding {
  actorHrUserId: number;
  sessionId: string;
  operation: AccessOperationKind;
  /** 0 for CREATE */
  targetHrUserId: number;
  /** 0 for CREATE */
  expectedVersion: number;
  digest: string;
}

export type AccessPreviewExpectation = Omit<AccessPreviewBinding, 'expectedVersion' | 'digest'>;

export class AccessPreviewTokenError extends Error {
  readonly reason: 'PREVIEW_EXPIRED' | 'PREVIEW_INVALID';

  constructor(reason: 'PREVIEW_EXPIRED' | 'PREVIEW_INVALID') {
    super(reason === 'PREVIEW_EXPIRED' ? 'The preview has expired. Request a new preview.' : 'The preview is not valid for this change. Request a new preview.');
    this.name = 'AccessPreviewTokenError';
    this.reason = reason;
  }
}

export interface AccessPreviewTokens {
  sign(binding: AccessPreviewBinding): Promise<{ token: string; expiresAt: Date }>;
  /** Verifies signature, audience, expiry, and the actor/session/operation/target binding. */
  verify(token: string, expected: AccessPreviewExpectation): Promise<{ expectedVersion: number; digest: string }>;
  /** As verify(), but an expired token is accepted. Only to identify an idempotent replay; never for a new write. */
  verifyIgnoringExpiry(token: string, expected: AccessPreviewExpectation): Promise<{ expectedVersion: number; digest: string }>;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function createAccessPreviewTokens({ signingKey, clock = () => new Date() }: { signingKey: string; clock?: () => Date }): AccessPreviewTokens {
  const key = createHmac('sha256', signingKey).update(KEY_LABEL).digest();

  async function sign(binding: AccessPreviewBinding): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(clock().getTime() / 1000);
    const token = await new SignJWT({
      sid: binding.sessionId, op: binding.operation, tgt: binding.targetHrUserId, ver: binding.expectedVersion, dig: binding.digest,
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(binding.actorHrUserId))
      .setAudience(AUDIENCE)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_PREVIEW_TTL_SECONDS)
      .sign(key);
    return { token, expiresAt: new Date((iat + ACCESS_PREVIEW_TTL_SECONDS) * 1000) };
  }

  async function verify(token: string, expected: AccessPreviewExpectation, { ignoreExpiry = false } = {}) {
    let payload: JWTPayload;
    try {
      // For a replay, evaluate the claims at the token's own issue time, so
      // only expiry is skipped; the signature and every other check still apply.
      const issuedAt = ignoreExpiry ? decodeJwt(token).iat : undefined;
      if (ignoreExpiry && typeof issuedAt !== 'number') throw new AccessPreviewTokenError('PREVIEW_INVALID');
      ({ payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        audience: AUDIENCE,
        issuer: ISSUER,
        currentDate: issuedAt === undefined ? clock() : new Date(issuedAt * 1000),
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: 0,
      }));
    } catch (error) {
      if (error instanceof AccessPreviewTokenError) throw error;
      throw new AccessPreviewTokenError(error instanceof errors.JWTExpired ? 'PREVIEW_EXPIRED' : 'PREVIEW_INVALID');
    }
    const { sub, sid, op, tgt, ver, dig } = payload;
    if (
      sub !== String(expected.actorHrUserId) || sid !== expected.sessionId || op !== expected.operation
      || !(ACCESS_OPERATIONS as readonly unknown[]).includes(op) || tgt !== expected.targetHrUserId
      || !isCount(ver) || typeof dig !== 'string'
    ) {
      throw new AccessPreviewTokenError('PREVIEW_INVALID');
    }
    return { expectedVersion: ver, digest: dig };
  }

  return {
    sign,
    verify: (token, expected) => verify(token, expected),
    verifyIgnoringExpiry: (token, expected) => verify(token, expected, { ignoreExpiry: true }),
  };
}
