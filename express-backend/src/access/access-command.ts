// Canonical identity of one access-management command.
//
// - commandFingerprint: stored with the audit event it created
//   (access_audit_events.operation_fingerprint). A reused idempotency key is
//   compared by command, not by outcome.
// - previewDigest: carried in the preview token; also binds the actor's
//   session and the exact proposed access state, so no field can change
//   between preview and confirmation.
//
// Both are SHA-256 over JSON-encoded fields in a fixed order (so field
// boundaries cannot shift) after a distinct label (so neither can equal the
// other or any salary digest). Only hashes leave this module.
import { createHash } from 'node:crypto';

import type { HrStatus, Role } from './access-policy.js';

export const ACCESS_OPERATIONS = Object.freeze(['CREATE', 'PROFILE', 'PROMOTE', 'SCOPES', 'DEACTIVATE', 'REACTIVATE', 'REGENERATE_PASSWORD'] as const);
export type AccessOperationKind = (typeof ACCESS_OPERATIONS)[number];

/** Normalized command fields. Absent fields are null, lists are sorted. */
export interface NormalizedAccessCommand {
  operation: AccessOperationKind;
  /** null for CREATE */
  targetHrUserId: number | null;
  /** null for CREATE */
  expectedVersion: number | null;
  email: string | null;
  displayName: string | null;
  role: Role | null;
  countries: string[] | null;
  departments: string[] | null;
  reason: string | null;
}

export interface ProposedAccessState {
  displayName: string;
  role: Role;
  status: HrStatus;
  countries: string[];
  departments: string[];
}

const FINGERPRINT_LABEL = 'acme access-management command v1';
const DIGEST_LABEL = 'acme access-management preview v1';

const commandFields = (c: NormalizedAccessCommand): unknown[] => [
  c.operation, c.targetHrUserId, c.expectedVersion, c.email, c.displayName, c.role, c.countries, c.departments, c.reason,
];

const sha256 = (label: string, fields: unknown[]): string => createHash('sha256').update(`${label}\n${JSON.stringify(fields)}`).digest('hex');

export function commandFingerprint(command: NormalizedAccessCommand): string {
  return sha256(FINGERPRINT_LABEL, commandFields(command));
}

export function previewDigest(binding: { actorHrUserId: number; sessionId: string; command: NormalizedAccessCommand; proposed: ProposedAccessState }): string {
  const p = binding.proposed;
  return sha256(DIGEST_LABEL, [
    binding.actorHrUserId, binding.sessionId, ...commandFields(binding.command),
    p.displayName, p.role, p.status, p.countries, p.departments,
  ]);
}
