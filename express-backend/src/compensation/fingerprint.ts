// Canonical fingerprint of a direct salary-adjustment command, stored with
// the compensation record it created (compensation_records.operation_fingerprint).
//
// Idempotency compares commands, not outcomes: two methods or inputs that
// round to the same amount are different commands. The fingerprint is a
// SHA-256 over every command field, JSON-encoded in a fixed order (so field
// boundaries cannot shift) after a version label (so it cannot equal any other
// digest in the system, such as the preview-token digest). Only the hash is
// stored: no amount, note, preview token, or idempotency key.
import { createHash } from 'node:crypto';

import type { ConfirmationMode } from './preview-token.js';

const LABEL = 'acme direct salary-adjustment command v1';

export interface DirectCommandIdentity {
  employeeCode: string;
  target: string;
  method: string;
  /** Normalized: whole percentages as given, amounts with two decimals. */
  value: string;
  effectiveFrom: string;
  reason: string;
  /** Normalized: trimmed, blank as null. */
  note: string | null;
  expectedCompensationVersion: number;
  baseCompensationVersion: number;
  confirmationMode: ConfirmationMode;
}

export function directCommandFingerprint(identity: DirectCommandIdentity): string {
  const fields = [
    identity.employeeCode,
    identity.target,
    identity.method,
    identity.value,
    identity.effectiveFrom,
    identity.reason,
    identity.note,
    identity.expectedCompensationVersion,
    identity.baseCompensationVersion,
    identity.confirmationMode,
  ];
  return createHash('sha256').update(`${LABEL}\n${JSON.stringify(fields)}`).digest('hex');
}
