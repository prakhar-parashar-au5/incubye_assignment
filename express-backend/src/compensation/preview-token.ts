// Signed five-minute preview tokens for salary adjustments.
//
// The token is held by the browser (through the Next.js server), so it
// carries no salary value, note, or reason: only identifiers, the expected
// compensation versions, the confirmation mode, and a SHA-256 digest of the
// complete command and its exact proposed result. Confirmation resends the
// command; the backend recalculates the result and compares digests, so no
// bound field can change after signing.
//
// The HMAC key is derived from JWT_SIGNING_KEY with a fixed label, so a
// preview token can never verify as a session token or the reverse.
import { createHash, createHmac } from 'node:crypto';
import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export const PREVIEW_TTL_SECONDS = 5 * 60;
const ALGORITHM = 'HS256';
const AUDIENCE = 'acme-salary-adjustment-preview';
const ISSUER = 'acme-backend';
const KEY_LABEL = 'acme salary-adjustment preview token v1';

export const CONFIRMATION_MODES = Object.freeze(['DIRECT_APPLY', 'SUBMIT_REQUEST'] as const);
export type ConfirmationMode = (typeof CONFIRMATION_MODES)[number];

/** The normalized adjustment command, as previewed. */
export interface AdjustmentCommand {
  target: string;
  method: string;
  value: string;
  effectiveFrom: string;
  reason: string;
  note: string | null;
}

export interface PreviewBinding {
  actorHrUserId: number;
  sessionId: string;
  employeeCode: string;
  confirmationMode: ConfirmationMode;
  expectedCompensationVersion: number;
  baseCompensationVersion: number;
  command: AdjustmentCommand;
  proposed: { annualBaseSalary: string; annualBonus: string };
}

export interface VerifiedPreview {
  expectedCompensationVersion: number;
  baseCompensationVersion: number;
  digest: string;
}

export type PreviewTokenErrorReason = 'PREVIEW_EXPIRED' | 'PREVIEW_INVALID';

export class PreviewTokenError extends Error {
  readonly reason: PreviewTokenErrorReason;

  constructor(reason: PreviewTokenErrorReason) {
    super(reason === 'PREVIEW_EXPIRED' ? 'The preview has expired. Request a new preview.' : 'The preview is not valid for this change. Request a new preview.');
    this.name = 'PreviewTokenError';
    this.reason = reason;
  }
}

/** SHA-256 over every bound field in a fixed order. */
export function commandDigest(binding: PreviewBinding): string {
  const { command: c, proposed: p } = binding;
  const fields = [
    binding.actorHrUserId, binding.sessionId, binding.employeeCode, binding.confirmationMode,
    binding.expectedCompensationVersion, binding.baseCompensationVersion,
    c.target, c.method, c.value, c.effectiveFrom, c.reason, c.note,
    p.annualBaseSalary, p.annualBonus,
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export interface PreviewTokens {
  sign(binding: PreviewBinding): Promise<{ token: string; expiresAt: Date }>;
  /** Verifies signature, audience, expiry, and the actor/session/employee/mode binding. */
  verify(token: string, expected: { actorHrUserId: number; sessionId: string; employeeCode: string; confirmationMode: ConfirmationMode }): Promise<VerifiedPreview>;
  /**
   * Like verify(), but an expired token is accepted. Only for identifying the
   * command of an idempotent replay (the original operation already passed
   * full verification); never for a new write.
   */
  verifyIgnoringExpiry(token: string, expected: { actorHrUserId: number; sessionId: string; employeeCode: string; confirmationMode: ConfirmationMode }): Promise<VerifiedPreview>;
}

const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

export function createPreviewTokens({ signingKey, clock = () => new Date() }: { signingKey: string; clock?: () => Date }): PreviewTokens {
  const key = createHmac('sha256', signingKey).update(KEY_LABEL).digest();

  async function sign(binding: PreviewBinding): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(clock().getTime() / 1000);
    const token = await new SignJWT({
      sid: binding.sessionId,
      emp: binding.employeeCode,
      mode: binding.confirmationMode,
      ver: binding.expectedCompensationVersion,
      bv: binding.baseCompensationVersion,
      dig: commandDigest(binding),
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(binding.actorHrUserId))
      .setAudience(AUDIENCE)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + PREVIEW_TTL_SECONDS)
      .sign(key);
    return { token, expiresAt: new Date((iat + PREVIEW_TTL_SECONDS) * 1000) };
  }

  async function verify(token: string, expected: { actorHrUserId: number; sessionId: string; employeeCode: string; confirmationMode: ConfirmationMode }, { ignoreExpiry = false } = {}): Promise<VerifiedPreview> {
    let payload: JWTPayload;
    try {
      // For a replay, evaluate the claims at the token's own issue time, so
      // only expiry is skipped; the signature and every other check still apply.
      const issuedAt = ignoreExpiry ? decodeJwt(token).iat : undefined;
      if (ignoreExpiry && typeof issuedAt !== 'number') throw new PreviewTokenError('PREVIEW_INVALID');
      ({ payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        audience: AUDIENCE,
        issuer: ISSUER,
        currentDate: issuedAt === undefined ? clock() : new Date(issuedAt * 1000),
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: 0,
      }));
    } catch (error) {
      if (error instanceof PreviewTokenError) throw error;
      throw new PreviewTokenError(error instanceof errors.JWTExpired ? 'PREVIEW_EXPIRED' : 'PREVIEW_INVALID');
    }
    const { sub, sid, emp, mode, ver, bv, dig } = payload;
    if (
      sub !== String(expected.actorHrUserId) || sid !== expected.sessionId || emp !== expected.employeeCode
      || mode !== expected.confirmationMode || !isVersion(ver) || !isVersion(bv) || typeof dig !== 'string'
    ) {
      throw new PreviewTokenError('PREVIEW_INVALID');
    }
    return { expectedCompensationVersion: ver, baseCompensationVersion: bv, digest: dig };
  }

  return {
    sign,
    verify: (token, expected) => verify(token, expected),
    verifyIgnoringExpiry: (token, expected) => verify(token, expected, { ignoreExpiry: true }),
  };
}
