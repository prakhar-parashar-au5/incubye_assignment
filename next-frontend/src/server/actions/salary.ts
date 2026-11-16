'use server';

import {
  NOTE_MAX_LENGTH,
  isIdempotencyKey,
  isRequestId,
  type CompensationRecordView,
  type ErrorReason,
  type SalaryAdjustmentCommand,
  type SalaryAdjustmentPreview,
  type SalaryRequestView,
} from '@/lib/salary';
import { api, type ApiFailureKind } from '@/server/api/client';
import { readSessionToken } from '@/server/session-cookie';

// Salary adjustment Server Actions. Each one reads the session token from the HttpOnly cookie,
// calls one backend operation, and maps the result to a small public outcome. The backend
// authorizes every call (role, scope, eligibility, band, version); nothing here decides access.
//
// Nothing here logs request or response bodies: the API client logs operation, kind, status,
// and the backend's public reason code only.

const EMPLOYEE_CODE = /^ACME[0-9]{5}$/;

export type SalaryFailure = {
  ok: false;
  /** Public backend code, or one of this app's transport kinds. */
  kind: ApiFailureKind | 'INVALID_INPUT';
  reason?: ErrorReason;
};

export type PreviewOutcome = { ok: true; preview: SalaryAdjustmentPreview } | SalaryFailure;

export type ConfirmOutcome =
  | { ok: true; mode: 'DIRECT_APPLY'; compensation: CompensationRecordView }
  | { ok: true; mode: 'SUBMIT_REQUEST'; request: SalaryRequestView }
  /** 409 STALE_VERSION: nothing was written; `fresh` is a new preview for the same inputs. */
  | { ok: false; kind: 'STALE_VERSION'; fresh: PreviewOutcome }
  | SalaryFailure;

export type DecisionOutcome = { ok: true; request: SalaryRequestView } | SalaryFailure;

function failure(result: { kind: ApiFailureKind; reason?: ErrorReason }): SalaryFailure {
  return result.reason ? { ok: false, kind: result.kind, reason: result.reason } : { ok: false, kind: result.kind };
}

function validCommand(input: unknown): SalaryAdjustmentCommand | null {
  if (!input || typeof input !== 'object') return null;
  const { target, method, value, effectiveFrom, reason, note } = input as Record<string, unknown>;
  if (typeof target !== 'string' || typeof method !== 'string' || typeof value !== 'string') return null;
  if (typeof effectiveFrom !== 'string' || typeof reason !== 'string') return null;
  if (note !== null && note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX_LENGTH)) return null;
  // Only the contract's fields are forwarded; enum and format checks are the backend's.
  return {
    target: target as SalaryAdjustmentCommand['target'],
    method: method as SalaryAdjustmentCommand['method'],
    value,
    effectiveFrom,
    reason: reason as SalaryAdjustmentCommand['reason'],
    note: typeof note === 'string' && note.trim().length > 0 ? note : null,
  };
}

export async function previewSalaryAdjustment(employeeCode: unknown, command: unknown): Promise<PreviewOutcome> {
  const parsed = validCommand(command);
  if (typeof employeeCode !== 'string' || !EMPLOYEE_CODE.test(employeeCode) || !parsed) return { ok: false, kind: 'INVALID_INPUT' };
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };
  const result = await api().previewSalaryAdjustment(token, employeeCode, parsed);
  return result.ok ? { ok: true, preview: result.data } : failure(result);
}

export async function confirmSalaryAdjustment(input: {
  employeeCode: unknown;
  mode: unknown;
  previewToken: unknown;
  adjustment: unknown;
  idempotencyKey: unknown;
}): Promise<ConfirmOutcome> {
  const adjustment = validCommand(input.adjustment);
  const { employeeCode, mode, previewToken, idempotencyKey } = input;
  if (
    typeof employeeCode !== 'string' ||
    !EMPLOYEE_CODE.test(employeeCode) ||
    (mode !== 'DIRECT_APPLY' && mode !== 'SUBMIT_REQUEST') ||
    typeof previewToken !== 'string' ||
    previewToken.length === 0 ||
    previewToken.length > 4096 ||
    !isIdempotencyKey(idempotencyKey) ||
    !adjustment
  ) {
    return { ok: false, kind: 'INVALID_INPUT' };
  }
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };

  const body = { previewToken, adjustment };
  if (mode === 'DIRECT_APPLY') {
    const result = await api().applySalaryAdjustment(token, employeeCode, body, idempotencyKey);
    if (result.ok) return { ok: true, mode, compensation: result.data.compensation };
    if (result.kind === 'STALE_VERSION') return { ok: false, kind: 'STALE_VERSION', fresh: await previewSalaryAdjustment(employeeCode, adjustment) };
    return failure(result);
  }
  const result = await api().submitSalaryAdjustmentRequest(token, employeeCode, body, idempotencyKey);
  if (result.ok) return { ok: true, mode, request: result.data.request };
  if (result.kind === 'STALE_VERSION') return { ok: false, kind: 'STALE_VERSION', fresh: await previewSalaryAdjustment(employeeCode, adjustment) };
  return failure(result);
}

export async function approveSalaryRequest(requestId: unknown, idempotencyKey: unknown): Promise<DecisionOutcome> {
  if (!isRequestId(requestId) || !isIdempotencyKey(idempotencyKey)) return { ok: false, kind: 'INVALID_INPUT' };
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };
  const result = await api().approveSalaryAdjustmentRequest(token, requestId, idempotencyKey);
  return result.ok ? { ok: true, request: result.data.request } : failure(result);
}

export async function cancelSalaryRequest(requestId: unknown, note: unknown, idempotencyKey: unknown): Promise<DecisionOutcome> {
  if (!isRequestId(requestId) || !isIdempotencyKey(idempotencyKey) || typeof note !== 'string') return { ok: false, kind: 'INVALID_INPUT' };
  const text = note.trim();
  if (text.length === 0 || text.length > NOTE_MAX_LENGTH) return { ok: false, kind: 'VALIDATION_ERROR', reason: 'NOTE_REQUIRED' };
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };
  const result = await api().cancelSalaryAdjustmentRequest(token, requestId, text, idempotencyKey);
  return result.ok ? { ok: true, request: result.data.request } : failure(result);
}
