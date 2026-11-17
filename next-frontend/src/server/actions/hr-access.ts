'use server';

import {
  isHrUserCreatePreviewRequest,
  isHrUserCreateRequest,
  isHrUserDeactivatePreviewRequest,
  isHrUserDeactivateRequest,
  isHrUserPasswordRegenerationPreviewRequest,
  isHrUserPasswordRegenerationRequest,
  isHrUserProfilePreviewRequest,
  isHrUserProfileRequest,
  isHrUserPromotePreviewRequest,
  isHrUserPromoteRequest,
  isHrUserReactivatePreviewRequest,
  isHrUserReactivateRequest,
  isHrUserScopesPreviewRequest,
  isHrUserScopesRequest,
  type HrAccessPreview,
  type HrUserChangeResult,
  type HrUserCreateResult,
  type HrUserDetail,
  type HrUserPasswordRegenerationPreview,
  type HrUserPasswordRegenerationResult,
} from '@/server/api/contract';
import { api, type ApiFailureKind, type ApiResult } from '@/server/api/client';
import { readSessionToken } from '@/server/session-cookie';

export type HrAccessOperation = 'CREATE' | 'PROFILE' | 'PROMOTE' | 'SCOPES' | 'DEACTIVATE' | 'REACTIVATE' | 'REGENERATE_PASSWORD';
type Failure = { ok: false; kind: ApiFailureKind | 'INVALID_INPUT'; current?: HrUserDetail };
export type PreviewOutcome = { ok: true; preview: HrAccessPreview | HrUserPasswordRegenerationPreview } | Failure;
export type ConfirmOutcome = { ok: true; result: HrUserChangeResult | HrUserCreateResult | HrUserPasswordRegenerationResult } | Failure;

const previewValid = {
  CREATE: isHrUserCreatePreviewRequest,
  PROFILE: isHrUserProfilePreviewRequest,
  PROMOTE: isHrUserPromotePreviewRequest,
  SCOPES: isHrUserScopesPreviewRequest,
  DEACTIVATE: isHrUserDeactivatePreviewRequest,
  REACTIVATE: isHrUserReactivatePreviewRequest,
  REGENERATE_PASSWORD: isHrUserPasswordRegenerationPreviewRequest,
} as const;
const confirmValid = {
  CREATE: isHrUserCreateRequest,
  PROFILE: isHrUserProfileRequest,
  PROMOTE: isHrUserPromoteRequest,
  SCOPES: isHrUserScopesRequest,
  DEACTIVATE: isHrUserDeactivateRequest,
  REACTIVATE: isHrUserReactivateRequest,
  REGENERATE_PASSWORD: isHrUserPasswordRegenerationRequest,
} as const;

export async function previewHrAccess(operation: unknown, targetId: unknown, body: unknown): Promise<PreviewOutcome> {
  if (!isOperation(operation) || !previewValid[operation](body) || !validTarget(operation, targetId)) return { ok: false, kind: 'INVALID_INPUT' };
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };
  const id = typeof targetId === 'number' ? targetId : 0;
  const client = api();
  const result = operation === 'CREATE' ? await client.createHrUserPreview(token, body as never) : await previewTarget(client, operation, id, token, body as never);
  return result.ok ? { ok: true, preview: result.data } : { ok: false, kind: result.kind };
}

export async function confirmHrAccess(input: { operation: unknown; targetId: unknown; body: unknown; idempotencyKey: unknown }): Promise<ConfirmOutcome> {
  const { operation, targetId, body, idempotencyKey } = input;
  if (!isOperation(operation) || !confirmValid[operation](body) || !validTarget(operation, targetId) || !isKey(idempotencyKey)) return { ok: false, kind: 'INVALID_INPUT' };
  const token = await readSessionToken();
  if (!token) return { ok: false, kind: 'UNAUTHENTICATED' };
  const id = typeof targetId === 'number' ? targetId : 0;
  const result = operation === 'CREATE'
    ? await api().createHrUser(token, body as never, idempotencyKey)
    : await confirmTarget(operation, id, token, body as never, idempotencyKey);
  if (result.ok) return { ok: true, result: result.data };
  if (result.kind === 'STALE_VERSION' && operation !== 'CREATE') {
    const fresh = await api().getHrUser(token, id);
    if (fresh.ok) return { ok: false, kind: result.kind, current: fresh.data.hrUser };
  }
  return { ok: false, kind: result.kind };
}

function isOperation(value: unknown): value is HrAccessOperation {
  return typeof value === 'string' && Object.hasOwn(previewValid, value);
}
function validTarget(operation: HrAccessOperation, targetId: unknown): boolean {
  return operation === 'CREATE' ? targetId === null : Number.isSafeInteger(targetId) && Number(targetId) > 0;
}
function isKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

async function previewTarget(client: ReturnType<typeof api>, operation: Exclude<HrAccessOperation, 'CREATE'>, id: number, token: string, body: never) {
  switch (operation) {
    case 'PROFILE': return client.previewHrUserProfile(token, id, body);
    case 'PROMOTE': return client.previewHrUserPromotion(token, id, body);
    case 'SCOPES': return client.previewHrUserScopes(token, id, body);
    case 'DEACTIVATE': return client.previewHrUserDeactivation(token, id, body);
    case 'REACTIVATE': return client.previewHrUserReactivation(token, id, body);
    case 'REGENERATE_PASSWORD': return client.previewHrUserPasswordRegeneration(token, id, body);
  }
}

async function confirmTarget(operation: Exclude<HrAccessOperation, 'CREATE'>, id: number, token: string, body: never, key: string): Promise<ApiResult<HrUserChangeResult | HrUserPasswordRegenerationResult>> {
  switch (operation) {
    case 'PROFILE': return api().updateHrUserProfile(token, id, body, key);
    case 'PROMOTE': return api().promoteHrUser(token, id, body, key);
    case 'SCOPES': return api().replaceHrUserScopes(token, id, body, key);
    case 'DEACTIVATE': return api().deactivateHrUser(token, id, body, key);
    case 'REACTIVATE': return api().reactivateHrUser(token, id, body, key);
    case 'REGENERATE_PASSWORD': return api().regenerateHrUserPassword(token, id, body, key);
  }
}
