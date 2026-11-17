import 'server-only';

import { unstable_rethrow } from 'next/navigation';

import { ConfigurationError, readServerConfig } from '@/server/config';
import {
  isCurrentUserResponse,
  isDirectoryOptionsResponse,
  isDirectoryResponse,
  isEmployeeDetailResponse,
  isAssistantMessagesResponse,
  isErrorResponse,
  isLoginResponse,
  type AssistantMessagesRequest,
  type AssistantMessagesResponse,
  type CurrentUserResponse,
  type DirectoryOptionsResponse,
  type DirectoryResponse,
  type EmployeeDetailResponse,
  type LoginRequest,
  type LoginResponse,
  type PublicErrorCode,
  type ErrorResponse,
  type SalaryAdjustmentCommand,
  type SalaryAdjustmentPreview,
  type SalaryAdjustmentResult,
  type SalaryRequestApproval,
  type SalaryRequestList,
  type SalaryRequestResponse,
  isSalaryAdjustmentPreview,
  isSalaryAdjustmentResult,
  isSalaryRequestApproval,
  isSalaryRequestList,
  isSalaryRequestResponse,
  isDashboardBreakdownResponse,
  isDashboardRecentChangesResponse,
  isDashboardSummaryResponse,
  isDashboardWithoutAdjustmentResponse,
  type DashboardBreakdownResponse,
  type DashboardRecentChangesResponse,
  type DashboardSummaryResponse,
  type DashboardWithoutAdjustmentResponse,
} from '@/server/api/contract';
import type { DashboardApiQueries } from '@/lib/dashboard-url';
import type { DirectoryQuery } from '@/lib/directory-url';
import type { operations } from '@/generated/api';
import {
  isAccessAuditResponse, isHrAccessPreview, isHrUserChangeResult, isHrUserCreateResult,
  isHrUserDetailResponse, isHrUserListResponse, isHrUserPasswordRegenerationPreview,
  isHrUserPasswordRegenerationResult,
  type AccessAuditResponse, type HrAccessPreview, type HrUserChangeResult,
  type HrUserCreatePreviewRequest, type HrUserCreateRequest, type HrUserCreateResult,
  type HrUserDeactivatePreviewRequest, type HrUserDeactivateRequest, type HrUserDetailResponse,
  type HrUserListResponse, type HrUserPasswordRegenerationPreview,
  type HrUserPasswordRegenerationPreviewRequest, type HrUserPasswordRegenerationRequest,
  type HrUserPasswordRegenerationResult, type HrUserProfilePreviewRequest, type HrUserProfileRequest,
  type HrUserPromotePreviewRequest, type HrUserPromoteRequest, type HrUserReactivatePreviewRequest,
  type HrUserReactivateRequest, type HrUserScopesPreviewRequest, type HrUserScopesRequest,
} from '@/server/api/contract';

// The only module that talks to the Express API. It runs on the Next.js server only: the
// `server-only` import makes any Client Component import of it a build error.
//
// It never logs request bodies, response bodies, tokens, or configuration values. Failure logs
// carry the operation name, the mapped failure kind, and the HTTP status only.

export type ApiFailureKind =
  | PublicErrorCode
  /** Backend not reachable, or answered with a non-contract 5xx. */
  | 'UNAVAILABLE'
  /** The request exceeded this app's timeout for the operation. */
  | 'TIMEOUT'
  /** Backend answered, but the body did not match the contract. */
  | 'INVALID_RESPONSE'
  /** API_BASE_URL or API_TIMEOUT_MS is missing or invalid. */
  | 'CONFIGURATION';

export type ApiErrorReason = NonNullable<ErrorResponse['error']['reason']>;

export type ApiResult<T> =
  | { ok: true; data: T }
  /** `reason` is the backend's optional public detail for some VALIDATION_ERROR responses. */
  | { ok: false; kind: ApiFailureKind; status?: number; reason?: ApiErrorReason };

type Env = Readonly<Record<string, string | undefined>>;
type Logger = (entry: Record<string, string | number | readonly string[]>) => void;

export type ApiClientOptions = {
  fetch?: typeof fetch;
  env?: Env;
  logger?: Logger;
};

const defaultLogger: Logger = (entry) => console.error(JSON.stringify(entry));

type RequestSpec<T> = {
  operation: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  token?: string;
  body?: unknown;
  expectNoContent?: boolean;
  validate?: (value: unknown) => value is T;
  timeout?: 'default' | 'assistant';
  /** Extra request headers, for example Idempotency-Key. Never logged. */
  headers?: Record<string, string>;
};

export function createApiClient(options: ApiClientOptions = {}) {
  // Resolved per call so tests can replace the global fetch after the client is created.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const log = options.logger ?? defaultLogger;

  async function request<T>(spec: RequestSpec<T>): Promise<ApiResult<T>> {
    const fail = (kind: ApiFailureKind, status?: number, reason?: ApiErrorReason): ApiResult<T> => {
      log({ event: 'api_request_failed', operation: spec.operation, kind, ...(status ? { status } : {}), ...(reason ? { reason } : {}) });
      const failure: ApiResult<T> = status ? { ok: false, kind, status } : { ok: false, kind };
      return reason ? { ...failure, reason } : failure;
    };

    let config;
    try {
      config = readServerConfig(options.env ?? process.env);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        log({ event: 'api_configuration_error', operation: spec.operation, variables: error.variables });
        return { ok: false, kind: 'CONFIGURATION' };
      }
      throw error;
    }

    const url = new URL(spec.path.replace(/^\//, ''), config.apiBaseUrl);
    const headers: Record<string, string> = { ...spec.headers, Accept: 'application/json' };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.token) headers.Authorization = `Bearer ${spec.token}`;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(spec.timeout === 'assistant' ? config.assistantTimeoutMs : config.apiTimeoutMs),
      });
    } catch (error) {
      // Next.js interrupts fetches during prerendering and expects that rejection to propagate.
      unstable_rethrow(error);
      if (error instanceof DOMException && error.name === 'TimeoutError') return fail('TIMEOUT');
      // Network failure, refused connection, DNS failure, or timeout. The error itself is not
      // logged because undici messages can include the target address.
      return fail('UNAVAILABLE');
    }

    if (response.ok && spec.expectNoContent) {
      await response.body?.cancel();
      return { ok: true, data: undefined as T };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch (error) {
      unstable_rethrow(error);
      return fail(response.status >= 500 ? 'UNAVAILABLE' : 'INVALID_RESPONSE', response.status);
    }

    if (!response.ok) {
      if (isErrorResponse(payload)) return fail(payload.error.code, response.status, payload.error.reason);
      return fail(response.status >= 500 ? 'UNAVAILABLE' : 'INVALID_RESPONSE', response.status);
    }
    if (spec.validate && !spec.validate(payload)) return fail('INVALID_RESPONSE', response.status);
    return { ok: true, data: payload as T };
  }

  return {
    login(body: LoginRequest) {
      return request<LoginResponse>({
        operation: 'login',
        method: 'POST',
        path: '/api/v1/auth/login',
        body,
        validate: isLoginResponse,
      });
    },
    getCurrentUser(token: string) {
      return request<CurrentUserResponse>({
        operation: 'getCurrentUser',
        method: 'GET',
        path: '/api/v1/auth/me',
        token,
        validate: isCurrentUserResponse,
      });
    },
    logout(token: string) {
      return request<void>({
        operation: 'logout',
        method: 'POST',
        path: '/api/v1/auth/logout',
        token,
        expectNoContent: true,
      });
    },
    listEmployees(token: string, query: DirectoryQuery) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const search = params.toString();
      return request<DirectoryResponse>({
        operation: 'listEmployees',
        method: 'GET',
        path: `/api/v1/employees${search ? `?${search}` : ''}`,
        token,
        validate: isDirectoryResponse,
      });
    },
    getEmployee(token: string, employeeCode: string) {
      return request<EmployeeDetailResponse>({
        operation: 'getEmployee',
        method: 'GET',
        path: `/api/v1/employees/${encodeURIComponent(employeeCode)}`,
        token,
        validate: isEmployeeDetailResponse,
      });
    },
    sendAssistantMessages(token: string, body: AssistantMessagesRequest) {
      return request<AssistantMessagesResponse>({
        operation: 'sendAssistantMessages',
        method: 'POST',
        path: '/api/v1/assistant/messages',
        token,
        body,
        validate: isAssistantMessagesResponse,
        timeout: 'assistant',
      });
    },
    previewSalaryAdjustment(token: string, employeeCode: string, command: SalaryAdjustmentCommand) {
      return request<SalaryAdjustmentPreview>({
        operation: 'previewSalaryAdjustment',
        method: 'POST',
        path: `/api/v1/employees/${encodeURIComponent(employeeCode)}/salary-adjustments/preview`,
        token,
        body: command,
        validate: isSalaryAdjustmentPreview,
      });
    },
    applySalaryAdjustment(token: string, employeeCode: string, confirmation: SalaryAdjustmentConfirmationBody, idempotencyKey: string) {
      return request<SalaryAdjustmentResult>({
        operation: 'applySalaryAdjustment',
        method: 'POST',
        path: `/api/v1/employees/${encodeURIComponent(employeeCode)}/salary-adjustments`,
        token,
        body: confirmation,
        headers: { 'Idempotency-Key': idempotencyKey },
        validate: isSalaryAdjustmentResult,
      });
    },
    submitSalaryAdjustmentRequest(token: string, employeeCode: string, confirmation: SalaryAdjustmentConfirmationBody, idempotencyKey: string) {
      return request<SalaryRequestResponse>({
        operation: 'submitSalaryAdjustmentRequest',
        method: 'POST',
        path: `/api/v1/employees/${encodeURIComponent(employeeCode)}/salary-adjustment-requests`,
        token,
        body: confirmation,
        headers: { 'Idempotency-Key': idempotencyKey },
        validate: isSalaryRequestResponse,
      });
    },
    listSalaryAdjustmentRequests(token: string, query: Record<string, string | number | undefined>) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const search = params.toString();
      return request<SalaryRequestList>({
        operation: 'listSalaryAdjustmentRequests',
        method: 'GET',
        path: `/api/v1/salary-adjustment-requests${search ? `?${search}` : ''}`,
        token,
        validate: isSalaryRequestList,
      });
    },
    getSalaryAdjustmentRequest(token: string, requestId: string) {
      return request<SalaryRequestResponse>({
        operation: 'getSalaryAdjustmentRequest',
        method: 'GET',
        path: `/api/v1/salary-adjustment-requests/${encodeURIComponent(requestId)}`,
        token,
        validate: isSalaryRequestResponse,
      });
    },
    approveSalaryAdjustmentRequest(token: string, requestId: string, idempotencyKey: string) {
      return request<SalaryRequestApproval>({
        operation: 'approveSalaryAdjustmentRequest',
        method: 'POST',
        path: `/api/v1/salary-adjustment-requests/${encodeURIComponent(requestId)}/approve`,
        token,
        headers: { 'Idempotency-Key': idempotencyKey },
        validate: isSalaryRequestApproval,
      });
    },
    cancelSalaryAdjustmentRequest(token: string, requestId: string, note: string, idempotencyKey: string) {
      return request<SalaryRequestResponse>({
        operation: 'cancelSalaryAdjustmentRequest',
        method: 'POST',
        path: `/api/v1/salary-adjustment-requests/${encodeURIComponent(requestId)}/cancel`,
        token,
        body: { note },
        headers: { 'Idempotency-Key': idempotencyKey },
        validate: isSalaryRequestResponse,
      });
    },
    getDirectoryOptions(token: string) {
      return request<DirectoryOptionsResponse>({
        operation: 'getDirectoryOptions',
        method: 'GET',
        path: '/api/v1/employee-directory/options',
        token,
        validate: isDirectoryOptionsResponse,
      });
    },
    getDashboardSummary(token: string, query: DashboardApiQueries['summary']) {
      return request<DashboardSummaryResponse>({
        operation: 'getDashboardSummary',
        method: 'GET',
        path: `/api/v1/dashboard/summary${querySuffix(query)}`,
        token,
        validate: isDashboardSummaryResponse,
      });
    },
    getDashboardBreakdown(token: string, query: DashboardApiQueries['breakdown']) {
      return request<DashboardBreakdownResponse>({
        operation: 'getDashboardBreakdown',
        method: 'GET',
        path: `/api/v1/dashboard/breakdowns${querySuffix(query)}`,
        token,
        validate: isDashboardBreakdownResponse,
      });
    },
    getDashboardRecentChanges(token: string, query: DashboardApiQueries['recent']) {
      return request<DashboardRecentChangesResponse>({
        operation: 'getDashboardRecentChanges',
        method: 'GET',
        path: `/api/v1/dashboard/recent-changes${querySuffix(query)}`,
        token,
        validate: isDashboardRecentChangesResponse,
      });
    },
    getDashboardWithoutRecentAdjustment(token: string, query: DashboardApiQueries['without']) {
      return request<DashboardWithoutAdjustmentResponse>({
        operation: 'getDashboardWithoutRecentAdjustment',
        method: 'GET',
        path: `/api/v1/dashboard/without-recent-adjustment${querySuffix(query)}`,
        token,
        validate: isDashboardWithoutAdjustmentResponse,
      });
    },
    listHrUsers(token: string, query: NonNullable<operations['listHrUsers']['parameters']['query']>) {
      return request<HrUserListResponse>({ operation: 'listHrUsers', method: 'GET', path: `/api/v1/hr-users${querySuffix(query)}`, token, validate: isHrUserListResponse });
    },
    createHrUserPreview(token: string, body: HrUserCreatePreviewRequest) {
      return request<HrAccessPreview>({ operation: 'previewHrUserCreation', method: 'POST', path: '/api/v1/hr-users/preview', token, body, validate: isHrAccessPreview });
    },
    createHrUser(token: string, body: HrUserCreateRequest, key: string) {
      return request<HrUserCreateResult>({ operation: 'createHrUser', method: 'POST', path: '/api/v1/hr-users', token, body, headers: { 'Idempotency-Key': key }, validate: isHrUserCreateResult });
    },
    getHrUser(token: string, id: number) {
      return request<HrUserDetailResponse>({ operation: 'getHrUser', method: 'GET', path: `/api/v1/hr-users/${id}`, token, validate: isHrUserDetailResponse });
    },
    listHrUserAccessAudit(token: string, id: number, query: NonNullable<operations['listHrUserAccessAudit']['parameters']['query']>) {
      return request<AccessAuditResponse>({ operation: 'listHrUserAccessAudit', method: 'GET', path: `/api/v1/hr-users/${id}/access-audit${querySuffix(query)}`, token, validate: isAccessAuditResponse });
    },
    previewHrUserProfile(token: string, id: number, body: HrUserProfilePreviewRequest) { return hrPreview('previewHrUserProfile', `/api/v1/hr-users/${id}/profile/preview`, token, body); },
    updateHrUserProfile(token: string, id: number, body: HrUserProfileRequest, key: string) { return hrChange('updateHrUserProfile', `/api/v1/hr-users/${id}/profile`, 'POST', token, body, key); },
    previewHrUserPromotion(token: string, id: number, body: HrUserPromotePreviewRequest) { return hrPreview('previewHrUserPromotion', `/api/v1/hr-users/${id}/promote/preview`, token, body); },
    promoteHrUser(token: string, id: number, body: HrUserPromoteRequest, key: string) { return hrChange('promoteHrUser', `/api/v1/hr-users/${id}/promote`, 'POST', token, body, key); },
    previewHrUserScopes(token: string, id: number, body: HrUserScopesPreviewRequest) { return hrPreview('previewHrUserScopes', `/api/v1/hr-users/${id}/scopes/preview`, token, body); },
    replaceHrUserScopes(token: string, id: number, body: HrUserScopesRequest, key: string) { return hrChange('replaceHrUserScopes', `/api/v1/hr-users/${id}/scopes`, 'PUT', token, body, key); },
    previewHrUserDeactivation(token: string, id: number, body: HrUserDeactivatePreviewRequest) { return hrPreview('previewHrUserDeactivation', `/api/v1/hr-users/${id}/deactivate/preview`, token, body); },
    deactivateHrUser(token: string, id: number, body: HrUserDeactivateRequest, key: string) { return hrChange('deactivateHrUser', `/api/v1/hr-users/${id}/deactivate`, 'POST', token, body, key); },
    previewHrUserReactivation(token: string, id: number, body: HrUserReactivatePreviewRequest) { return hrPreview('previewHrUserReactivation', `/api/v1/hr-users/${id}/reactivate/preview`, token, body); },
    reactivateHrUser(token: string, id: number, body: HrUserReactivateRequest, key: string) { return hrChange('reactivateHrUser', `/api/v1/hr-users/${id}/reactivate`, 'POST', token, body, key); },
    previewHrUserPasswordRegeneration(token: string, id: number, body: HrUserPasswordRegenerationPreviewRequest) {
      return request<HrUserPasswordRegenerationPreview>({ operation: 'previewHrUserPasswordRegeneration', method: 'POST', path: `/api/v1/hr-users/${id}/regenerate-temporary-password/preview`, token, body, validate: isHrUserPasswordRegenerationPreview });
    },
    regenerateHrUserPassword(token: string, id: number, body: HrUserPasswordRegenerationRequest, key: string) {
      return request<HrUserPasswordRegenerationResult>({ operation: 'regenerateHrUserPassword', method: 'POST', path: `/api/v1/hr-users/${id}/regenerate-temporary-password`, token, body, headers: { 'Idempotency-Key': key }, validate: isHrUserPasswordRegenerationResult });
    },
  };

  function hrPreview(operation: string, path: string, token: string, body: unknown) {
    return request<HrAccessPreview>({ operation, method: 'POST', path, token, body, validate: isHrAccessPreview });
  }
  function hrChange(operation: string, path: string, method: 'POST' | 'PUT', token: string, body: unknown, key: string) {
    return request<HrUserChangeResult>({ operation, method, path, token, body, headers: { 'Idempotency-Key': key }, validate: isHrUserChangeResult });
  }
}

/** `?a=1&b=2` from defined, non-empty values; the backend rejects empty and repeated keys. */
function querySuffix(query: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

type SalaryAdjustmentConfirmationBody = { previewToken: string; adjustment: SalaryAdjustmentCommand };

export type ApiClient = ReturnType<typeof createApiClient>;

let defaultClient: ApiClient | undefined;
export function api(): ApiClient {
  defaultClient ??= createApiClient();
  return defaultClient;
}
