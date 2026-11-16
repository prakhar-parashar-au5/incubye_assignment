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
} from '@/server/api/contract';
import type { DirectoryQuery } from '@/lib/directory-url';

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

export type ApiResult<T> = { ok: true; data: T } | { ok: false; kind: ApiFailureKind; status?: number };

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
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: unknown;
  expectNoContent?: boolean;
  validate?: (value: unknown) => value is T;
  timeout?: 'default' | 'assistant';
};

export function createApiClient(options: ApiClientOptions = {}) {
  // Resolved per call so tests can replace the global fetch after the client is created.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const log = options.logger ?? defaultLogger;

  async function request<T>(spec: RequestSpec<T>): Promise<ApiResult<T>> {
    const fail = (kind: ApiFailureKind, status?: number): ApiResult<T> => {
      log({ event: 'api_request_failed', operation: spec.operation, kind, ...(status ? { status } : {}) });
      return status ? { ok: false, kind, status } : { ok: false, kind };
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
    const headers: Record<string, string> = { Accept: 'application/json' };
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
      if (isErrorResponse(payload)) return fail(payload.error.code, response.status);
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
    getDirectoryOptions(token: string) {
      return request<DirectoryOptionsResponse>({
        operation: 'getDirectoryOptions',
        method: 'GET',
        path: '/api/v1/employee-directory/options',
        token,
        validate: isDirectoryOptionsResponse,
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let defaultClient: ApiClient | undefined;
export function api(): ApiClient {
  defaultClient ??= createApiClient();
  return defaultClient;
}
