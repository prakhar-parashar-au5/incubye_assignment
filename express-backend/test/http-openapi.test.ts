import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import request from 'supertest';

import { buildOpenApiDocument } from '../src/http/openapi.js';
import { OPENAPI_FILE } from '../src/paths.js';
import { FAKE_TOKEN, buildTestApp } from './support/http.js';

type Json = Record<string, unknown>;
const doc = buildOpenApiDocument() as Json;
const get = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((current, key) => (typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined), value);

describe('OpenAPI contract', () => {
  // Detects: an endpoint missing from, or added to, the published contract.
  test('documents exactly the fifty endpoints', () => {
    const paths = get(doc, 'paths') as Json;
    const operations = Object.entries(paths).flatMap(([path, item]) => Object.keys(item as Json).map((m) => `${m.toUpperCase()} ${path}`));
    assert.deepEqual(operations.sort(), [
      'DELETE /api/v1/admin/ai-traces/{traceId}',
      'GET /api/v1/admin/ai-traces',
      'GET /api/v1/admin/ai-traces/options',
      'GET /api/v1/admin/ai-traces/summary',
      'GET /api/v1/admin/ai-traces/{traceId}',
      'GET /api/v1/admin/mcp-tool-calls',
      'GET /api/v1/admin/mcp-tool-calls/{mcpCallId}',
      'GET /api/v1/assistant/conversations',
      'GET /api/v1/assistant/conversations/{conversationId}',
      'GET /api/v1/auth/me',
      'GET /api/v1/dashboard/breakdowns',
      'GET /api/v1/dashboard/recent-changes',
      'GET /api/v1/dashboard/summary',
      'GET /api/v1/dashboard/without-recent-adjustment',
      'GET /api/v1/employee-directory/options',
      'GET /api/v1/employees',
      'GET /api/v1/employees/{employeeCode}',
      'GET /api/v1/hr-users',
      'GET /api/v1/hr-users/{hrUserId}',
      'GET /api/v1/hr-users/{hrUserId}/access-audit',
      'GET /api/v1/openapi.json',
      'GET /api/v1/salary-adjustment-requests',
      'GET /api/v1/salary-adjustment-requests/{requestId}',
      'GET /health',
      'POST /api/v1/admin/ai-traces/{traceId}/review',
      'POST /api/v1/assistant/conversations',
      'POST /api/v1/assistant/conversations/{conversationId}/messages',
      'POST /api/v1/assistant/messages',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/employees/{employeeCode}/salary-adjustment-requests',
      'POST /api/v1/employees/{employeeCode}/salary-adjustments',
      'POST /api/v1/employees/{employeeCode}/salary-adjustments/preview',
      'POST /api/v1/hr-users',
      'POST /api/v1/hr-users/preview',
      'POST /api/v1/hr-users/{hrUserId}/deactivate',
      'POST /api/v1/hr-users/{hrUserId}/deactivate/preview',
      'POST /api/v1/hr-users/{hrUserId}/profile',
      'POST /api/v1/hr-users/{hrUserId}/profile/preview',
      'POST /api/v1/hr-users/{hrUserId}/promote',
      'POST /api/v1/hr-users/{hrUserId}/promote/preview',
      'POST /api/v1/hr-users/{hrUserId}/reactivate',
      'POST /api/v1/hr-users/{hrUserId}/reactivate/preview',
      'POST /api/v1/hr-users/{hrUserId}/regenerate-temporary-password',
      'POST /api/v1/hr-users/{hrUserId}/regenerate-temporary-password/preview',
      'POST /api/v1/hr-users/{hrUserId}/scopes/preview',
      'POST /api/v1/mcp',
      'POST /api/v1/salary-adjustment-requests/{requestId}/approve',
      'POST /api/v1/salary-adjustment-requests/{requestId}/cancel',
      'PUT /api/v1/hr-users/{hrUserId}/scopes',
    ]);
    assert.equal(get(doc, 'openapi'), '3.1.0');
  });

  // Detects: undocumented or wrongly typed directory query parameters.
  test('directory query parameters match the runtime schema', () => {
    const params = get(doc, 'paths', '/api/v1/employees', 'get', 'parameters') as Json[];
    assert.deepEqual(params.map((p) => [p.name, p.in, p.required]), [
      ['q', 'query', false], ['department', 'query', false], ['country', 'query', false], ['currency', 'query', false],
      ['level', 'query', false], ['status', 'query', false], ['sort', 'query', false], ['direction', 'query', false],
      ['page', 'query', false], ['pageSize', 'query', false], ['comparisonCurrency', 'query', false],
    ]);
    const byName = Object.fromEntries(params.map((p) => [p.name, p.schema]));
    assert.deepEqual(get(byName, 'sort', 'enum'), ['name', 'employeeCode', 'department', 'country', 'level', 'hireDate', 'annualBaseSalary', 'annualCashCompensation']);
    assert.equal(get(byName, 'sort', 'default'), 'name');
    assert.deepEqual([get(byName, 'pageSize', 'minimum'), get(byName, 'pageSize', 'maximum'), get(byName, 'pageSize', 'default')], [1, 100, 25]);
    assert.equal(get(byName, 'q', 'maxLength'), 100);
    assert.deepEqual(get(byName, 'comparisonCurrency', 'enum'), ['USD']);
    const detailParams = get(doc, 'paths', '/api/v1/employees/{employeeCode}', 'get', 'parameters') as Json[];
    assert.deepEqual(detailParams.map((p) => [p.name, p.in, p.required]), [['employeeCode', 'path', true]]);
  });

  // Detects: response schemas missing money, state, or rate fields.
  test('directory, detail, and options responses are documented', () => {
    const responseRef = (path: string) => get(doc, 'paths', path, 'get', 'responses', '200', 'content', 'application/json', 'schema', '$ref');
    assert.equal(responseRef('/api/v1/employees'), '#/components/schemas/DirectoryResponse');
    assert.equal(responseRef('/api/v1/employees/{employeeCode}'), '#/components/schemas/EmployeeDetailResponse');
    assert.equal(responseRef('/api/v1/employee-directory/options'), '#/components/schemas/DirectoryOptionsResponse');
    const selected = get(doc, 'components', 'schemas', 'SelectedCompensation');
    assert.deepEqual(get(selected, 'properties', 'state', 'enum'), ['CURRENT', 'UPCOMING', 'HISTORICAL']);
    assert.equal(get(selected, 'properties', 'annualBaseSalary', 'type'), 'string');
    assert.deepEqual(get(doc, 'components', 'schemas', 'ExchangeRateContext', 'required'), [
      'baseCurrency', 'quoteCurrency', 'rate', 'sourceName', 'sourceUrl', 'effectiveDate', 'retrievedAt',
    ]);
    assert.ok((get(doc, 'components', 'schemas', 'EmployeeDetailResponse', 'properties', 'employee', 'required') as string[]).includes('version'));
    for (const path of ['/api/v1/employees', '/api/v1/employees/{employeeCode}', '/api/v1/employee-directory/options']) {
      const responses = Object.keys(get(doc, 'paths', path, 'get', 'responses') as Json).sort();
      assert.deepEqual(responses, path === '/api/v1/employee-directory/options' ? ['200', '401', '500'] : path === '/api/v1/employees' ? ['200', '400', '401', '500'] : ['200', '401', '404', '500'], path);
    }
  });

  // Detects: optional credentials or an open request object in the contract.
  test('login request requires email and password and allows no other fields', () => {
    const schema = get(doc, 'components', 'schemas', 'LoginRequest');
    assert.deepEqual(get(schema, 'required'), ['email', 'password']);
    assert.equal(get(schema, 'additionalProperties'), false);
    assert.equal(get(schema, 'properties', 'email', 'format'), 'email');
  });

  test('login response includes token, expiry, and user summary', () => {
    const schema = get(doc, 'components', 'schemas', 'LoginResponse');
    assert.deepEqual(get(schema, 'required'), ['token', 'expiresAt', 'user']);
    assert.deepEqual(get(schema, 'properties', 'user', 'required'), ['id', 'displayName', 'email', 'role']);
    assert.deepEqual(get(schema, 'properties', 'user', 'properties', 'role', 'enum'), ['ADMIN', 'SCOPED']);
  });

  test('current-user response includes current scopes and session expiry', () => {
    const schema = get(doc, 'components', 'schemas', 'CurrentUserResponse');
    assert.deepEqual(get(schema, 'required'), ['user', 'scope', 'session']);
    assert.deepEqual(get(schema, 'properties', 'scope', 'required'), ['countries', 'departments']);
    assert.deepEqual(get(schema, 'properties', 'session', 'required'), ['expiresAt']);
  });

  // Detects: protected endpoints documented without authentication.
  test('uses an HTTP Bearer JWT security scheme on every protected endpoint', () => {
    assert.deepEqual(get(doc, 'components', 'securitySchemes', 'bearerAuth'), { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    assert.deepEqual(get(doc, 'paths', '/api/v1/auth/me', 'get', 'security'), [{ bearerAuth: [] }]);
    assert.deepEqual(get(doc, 'paths', '/api/v1/auth/logout', 'post', 'security'), [{ bearerAuth: [] }]);
    for (const path of ['/api/v1/employees', '/api/v1/employees/{employeeCode}', '/api/v1/employee-directory/options']) {
      assert.deepEqual(get(doc, 'paths', path, 'get', 'security'), [{ bearerAuth: [] }], path);
    }
    for (const path of ['/api/v1/assistant/messages', '/api/v1/mcp']) {
      assert.deepEqual(get(doc, 'paths', path, 'post', 'security'), [{ bearerAuth: [] }], path);
    }
    for (const [path, item] of Object.entries(get(doc, 'paths') as Json)) {
      if (!path.includes('salary-adjustment')) continue;
      for (const [method, operation] of Object.entries(item as Json)) {
        assert.deepEqual(get(operation, 'security'), [{ bearerAuth: [] }], `${method} ${path}`);
      }
    }
    assert.equal(get(doc, 'paths', '/api/v1/auth/login', 'post', 'security'), undefined);
  });

  // Detects: salary endpoints documented without idempotency, errors, or schemas.
  test('salary-adjustment operations document schemas, Idempotency-Key, and the approved errors', () => {
    const op = (path: string, method = 'post') => get(doc, 'paths', path, method) as Json;
    const errors = (path: string, method = 'post') => Object.keys(get(op(path, method), 'responses') as Json).sort();
    const headerNames = (path: string) => ((get(op(path), 'parameters') as Json[] | undefined) ?? []).filter((p) => p.in === 'header').map((p) => [p.name, p.required]);
    const preview = '/api/v1/employees/{employeeCode}/salary-adjustments/preview';
    const direct = '/api/v1/employees/{employeeCode}/salary-adjustments';
    const requests = '/api/v1/employees/{employeeCode}/salary-adjustment-requests';
    const approve = '/api/v1/salary-adjustment-requests/{requestId}/approve';
    const cancel = '/api/v1/salary-adjustment-requests/{requestId}/cancel';
    assert.deepEqual(errors(preview), ['200', '400', '401', '404', '409', '422', '500', '503']);
    assert.deepEqual(errors(direct), ['201', '400', '401', '403', '404', '409', '422', '500', '503']);
    assert.deepEqual(errors(requests), ['201', '400', '401', '403', '404', '409', '422', '500', '503']);
    assert.deepEqual(errors(approve), ['200', '400', '401', '403', '404', '409', '422', '500', '503']);
    assert.deepEqual(errors(cancel), ['200', '400', '401', '403', '404', '409', '500', '503']);
    for (const path of [direct, requests, approve, cancel]) assert.deepEqual(headerNames(path), [['Idempotency-Key', true]], path);
    assert.deepEqual(headerNames(preview), []);
    assert.equal(get(op(preview), 'requestBody', 'content', 'application/json', 'schema', '$ref'), '#/components/schemas/SalaryAdjustmentCommand');
    assert.equal(get(op(direct), 'requestBody', 'content', 'application/json', 'schema', '$ref'), '#/components/schemas/SalaryAdjustmentConfirmation');
    assert.equal(get(op(preview), 'responses', '200', 'content', 'application/json', 'schema', '$ref'), '#/components/schemas/SalaryAdjustmentPreview');
    const command = get(doc, 'components', 'schemas', 'SalaryAdjustmentCommand');
    assert.equal(get(command, 'additionalProperties'), false);
    assert.deepEqual(get(command, 'properties', 'method', 'enum'), ['PERCENTAGE_INCREASE', 'PERCENTAGE_DECREASE', 'FIXED_INCREASE', 'FIXED_DECREASE', 'REPLACEMENT']);
    assert.deepEqual(get(command, 'properties', 'reason', 'enum'), ['PERFORMANCE', 'MARKET_ADJUSTMENT', 'PROMOTION', 'ROLE_CHANGE', 'CORRECTION']);
    assert.deepEqual(get(doc, 'components', 'schemas', 'SalaryRequestView', 'properties', 'status', 'enum'), ['PENDING', 'APPROVED', 'CANCELLED', 'STALE']);
    const listParams = (get(op('/api/v1/salary-adjustment-requests', 'get'), 'parameters') as Json[]).map((p) => p.name);
    assert.deepEqual(listParams, ['q', 'department', 'status', 'sort', 'direction', 'page', 'pageSize']);
    assert.ok((get(doc, 'components', 'schemas', 'ErrorResponse', 'properties', 'error', 'properties', 'reason', 'enum') as string[]).includes('PREVIEW_EXPIRED'));
  });

  // Detects: dashboard endpoints documented without auth, strict parameters, or schemas.
  test('dashboard operations document Bearer auth, their exact parameters, and response schemas', () => {
    const expected: Record<string, [string, string[]]> = {
      '/api/v1/dashboard/summary': ['DashboardSummaryResponse', ['department', 'country', 'currency', 'level', 'employmentStatus', 'periodDays', 'noAdjustmentMonths']],
      '/api/v1/dashboard/breakdowns': ['DashboardBreakdownResponse', ['department', 'country', 'currency', 'level', 'employmentStatus', 'breakdown']],
      '/api/v1/dashboard/recent-changes': ['DashboardRecentChangesResponse', ['department', 'country', 'currency', 'level', 'employmentStatus', 'periodDays', 'page', 'pageSize']],
      '/api/v1/dashboard/without-recent-adjustment': ['DashboardWithoutAdjustmentResponse', ['department', 'country', 'currency', 'level', 'employmentStatus', 'noAdjustmentMonths', 'page', 'pageSize']],
    };
    for (const [path, [schema, params]] of Object.entries(expected)) {
      const op = get(doc, 'paths', path, 'get');
      assert.deepEqual(get(op, 'security'), [{ bearerAuth: [] }], path);
      assert.equal(get(op, 'responses', '200', 'content', 'application/json', 'schema', '$ref'), `#/components/schemas/${schema}`, path);
      assert.deepEqual(Object.keys(get(op, 'responses') as Json).sort(), ['200', '400', '401', '500', '503'], path);
      const parameters = get(op, 'parameters') as Json[];
      assert.deepEqual(parameters.map((p) => p.name), params, path);
      for (const p of parameters) assert.equal(p.in, 'query');
    }
    const byName = (path: string) => Object.fromEntries((get(doc, 'paths', path, 'get', 'parameters') as Json[]).map((p) => [p.name, p.schema]));
    assert.deepEqual(get(byName('/api/v1/dashboard/summary'), 'periodDays', 'enum'), ['7', '30', '90']);
    assert.equal(get(byName('/api/v1/dashboard/summary'), 'periodDays', 'default'), '30');
    assert.deepEqual(get(byName('/api/v1/dashboard/summary'), 'noAdjustmentMonths', 'enum'), ['3', '6', '12', '24']);
    assert.deepEqual(get(byName('/api/v1/dashboard/breakdowns'), 'breakdown', 'enum'), ['DEPARTMENT', 'COUNTRY', 'CURRENCY', 'LEVEL', 'EMPLOYMENT_STATUS']);
    const group = get(doc, 'components', 'schemas', 'DashboardBreakdownGroup');
    assert.deepEqual(get(group, 'properties', 'basis', 'enum'), ['CURRENT_SPENDING', 'FUTURE_COMMITMENT', 'COUNT_ONLY']);
    assert.ok((get(group, 'required') as string[]).includes('medianAnnualCashCompensation'));
  });

  // Detects: HR access operations documented without auth, Idempotency-Key,
  // expected-version bodies, or the approved error codes.
  test('HR access-management operations document auth, idempotency, bodies, and errors', () => {
    const base = '/api/v1/hr-users';
    const writes: [string, string, string, string][] = [
      ['post', base, 'HrUserCreateRequest', 'HrUserCreateResult'],
      ['post', `${base}/{hrUserId}/profile`, 'HrUserProfileRequest', 'HrUserChangeResult'],
      ['post', `${base}/{hrUserId}/promote`, 'HrUserPromoteRequest', 'HrUserChangeResult'],
      ['put', `${base}/{hrUserId}/scopes`, 'HrUserScopesRequest', 'HrUserChangeResult'],
      ['post', `${base}/{hrUserId}/deactivate`, 'HrUserDeactivateRequest', 'HrUserChangeResult'],
      ['post', `${base}/{hrUserId}/reactivate`, 'HrUserReactivateRequest', 'HrUserChangeResult'],
      ['post', `${base}/{hrUserId}/regenerate-temporary-password`, 'HrUserPasswordRegenerationRequest', 'HrUserPasswordRegenerationResult'],
    ];
    const previews: [string, string][] = [
      [`${base}/preview`, 'HrUserCreatePreviewRequest'], [`${base}/{hrUserId}/profile/preview`, 'HrUserProfilePreviewRequest'],
      [`${base}/{hrUserId}/promote/preview`, 'HrUserPromotePreviewRequest'], [`${base}/{hrUserId}/scopes/preview`, 'HrUserScopesPreviewRequest'],
      [`${base}/{hrUserId}/deactivate/preview`, 'HrUserDeactivatePreviewRequest'], [`${base}/{hrUserId}/reactivate/preview`, 'HrUserReactivatePreviewRequest'],
    ];
    const ref = (op: unknown, ...keys: string[]) => get(op, ...keys, 'content', 'application/json', 'schema', '$ref');
    for (const [method, path, requestSchema, responseSchema] of writes) {
      const op = get(doc, 'paths', path, method);
      assert.deepEqual(get(op, 'security'), [{ bearerAuth: [] }], path);
      assert.equal(ref(op, 'requestBody'), `#/components/schemas/${requestSchema}`, path);
      const success = path === base ? '201' : '200';
      assert.equal(ref(op, 'responses', success), `#/components/schemas/${responseSchema}`, path);
      const headers = ((get(op, 'parameters') as Json[]).filter((p) => p.in === 'header')).map((p) => [p.name, p.required]);
      assert.deepEqual(headers, [['Idempotency-Key', true]], path);
      for (const code of ['400', '401', '403', '409', '500', '503']) assert.ok(Object.keys(get(op, 'responses') as Json).includes(code), `${path} ${code}`);
    }
    for (const [path, requestSchema] of previews) {
      const op = get(doc, 'paths', path, 'post');
      assert.equal(ref(op, 'requestBody'), `#/components/schemas/${requestSchema}`, path);
      assert.equal(ref(op, 'responses', '200'), '#/components/schemas/HrAccessPreview', path);
      assert.ok(((get(op, 'parameters') as Json[] | undefined) ?? []).every((p) => p.in !== 'header'), path);
    }
    for (const id of ['HrUserProfileRequest', 'HrUserPromoteRequest', 'HrUserScopesRequest', 'HrUserDeactivateRequest', 'HrUserReactivateRequest']) {
      const schema = get(doc, 'components', 'schemas', id);
      assert.equal(get(schema, 'additionalProperties'), false, id);
      assert.ok((get(schema, 'required') as string[]).includes('expectedVersion'), id);
      assert.ok((get(schema, 'required') as string[]).includes('previewToken'), id);
    }
    assert.equal(get(doc, 'components', 'schemas', 'HrUserCreateRequest', 'properties', 'password'), undefined);
    // Review fix 11a: regeneration preview, and results the frontend can tell apart.
    const regenPreview = get(doc, 'paths', `${base}/{hrUserId}/regenerate-temporary-password/preview`, 'post');
    assert.equal(ref(regenPreview, 'requestBody'), '#/components/schemas/HrUserPasswordRegenerationPreviewRequest');
    assert.equal(ref(regenPreview, 'responses', '200'), '#/components/schemas/HrUserPasswordRegenerationPreview');
    assert.equal(get(doc, 'components', 'schemas', 'HrUserPasswordRegenerationPreview', 'properties', 'temporaryPassword'), undefined);
    for (const id of ['HrUserCreateResult', 'HrUserPasswordRegenerationResult']) {
      assert.ok((get(doc, 'components', 'schemas', id, 'required') as string[]).includes('credentialRecoveryRequired'), id);
      assert.equal(get(doc, 'components', 'schemas', id, 'properties', 'credentialRecoveryRequired', 'type'), 'boolean', id);
    }
    for (const id of ['HrUserPasswordRegenerationPreviewRequest', 'HrUserPasswordRegenerationRequest']) {
      const schema = get(doc, 'components', 'schemas', id);
      assert.equal(get(schema, 'additionalProperties'), false, id);
      assert.deepEqual([get(schema, 'properties', 'reason', 'minLength'), get(schema, 'properties', 'reason', 'maxLength')], [1, 2000], id);
    }
    assert.ok((get(doc, 'components', 'schemas', 'AccessAuditEvent', 'properties', 'action', 'enum') as string[]).includes('TEMPORARY_PASSWORD_REGENERATED'));
    // Review fix 11b: self-regeneration is documented as its own 409.
    for (const path of [`${base}/{hrUserId}/regenerate-temporary-password/preview`, `${base}/{hrUserId}/regenerate-temporary-password`]) {
      assert.match(String(get(doc, 'paths', path, 'post', 'responses', '409', 'description')), /SELF_PASSWORD_REGENERATION_FORBIDDEN/, path);
    }
    assert.doesNotMatch(JSON.stringify(doc), /\$argon2id\$|"example"/);
    const listParams = (get(doc, 'paths', base, 'get', 'parameters') as Json[]).map((p) => p.name);
    assert.deepEqual(listParams, ['q', 'role', 'status', 'country', 'department', 'sort', 'direction', 'page', 'pageSize']);
    assert.ok(Object.keys(get(doc, 'paths', `${base}/{hrUserId}/scopes`, 'put', 'responses') as Json).includes('422'));
    assert.ok(Object.keys(get(doc, 'paths', `${base}/{hrUserId}/deactivate`, 'post', 'responses') as Json).includes('409'));
    assert.deepEqual(get(doc, 'components', 'schemas', 'HrUserView', 'properties', 'password_hash'), undefined);
  });

  // Detects: an assistant contract that drifts from the shared frontend contract.
  // Detects: conversation operations documented without auth, idempotency, the
  // single-message body, or the approved errors (AI Task 03).
  test('assistant conversation operations document auth, idempotency, strict bodies, and errors', () => {
    const base = '/api/v1/assistant/conversations';
    const responses = (path: string, method: string) => Object.keys(get(doc, 'paths', path, method, 'responses') as Json).sort();
    for (const [path, method] of [[base, 'get'], [base, 'post'], [`${base}/{conversationId}`, 'get'], [`${base}/{conversationId}/messages`, 'post']] as const) {
      assert.deepEqual(get(doc, 'paths', path, method, 'security'), [{ bearerAuth: [] }], `${method} ${path}`);
    }
    const send = `${base}/{conversationId}/messages`;
    assert.deepEqual(responses(send, 'post'), ['200', '400', '401', '404', '409', '429', '500', '502', '503']);
    assert.deepEqual(responses(`${base}/{conversationId}`, 'get'), ['200', '401', '404', '500', '503']);
    const headers = (get(doc, 'paths', send, 'post', 'parameters') as Json[]).filter((p) => p.in === 'header').map((p) => [p.name, p.required, get(p, 'schema', 'pattern')]);
    assert.deepEqual(headers, [['Idempotency-Key', true, '^[A-Za-z0-9_-]{16,100}$']]);
    const message = get(doc, 'components', 'schemas', 'AssistantMessageRequest');
    assert.equal(get(message, 'additionalProperties'), false);
    assert.deepEqual(Object.keys(get(message, 'properties') as Json).sort(), ['content', 'retryOfTraceId'], 'one message, never a history array');
    assert.deepEqual(get(message, 'required'), ['content']);
    assert.equal(get(doc, 'components', 'schemas', 'AssistantConversationCreateRequest', 'additionalProperties'), false);
    const turn = get(doc, 'components', 'schemas', 'AssistantTurnResponse');
    for (const field of ['answer', 'toolCalls', 'cards', 'limitations', 'generatedAt', 'conversationId', 'traceId', 'previousTraceId', 'userMessageSequence', 'assistantMessageSequence']) {
      assert.ok((get(turn, 'required') as string[]).includes(field), field);
    }
    assert.deepEqual(get(doc, 'components', 'schemas', 'AssistantConversationTurn', 'properties', 'status', 'enum'), ['STARTED', 'COMPLETED', 'FAILED']);
    // Q-C9 and Q-C10: the retry time and a reloaded failure's safe reason are published.
    assert.ok(get(doc, 'paths', send, 'post', 'responses', '429', 'headers', 'Retry-After'));
    const turnError = get(doc, 'components', 'schemas', 'AssistantConversationTurn', 'properties', 'error');
    assert.ok(JSON.stringify(turnError).includes('"reason"'), 'turn error carries reason');
    assert.equal(get(doc, 'paths', '/api/v1/assistant/messages', 'post', 'deprecated'), true);
    assert.equal(get(doc, 'paths', send, 'post', 'deprecated'), undefined);
    const reasons = get(doc, 'components', 'schemas', 'ErrorResponse', 'properties', 'error', 'properties', 'reason', 'enum') as string[];
    for (const reason of ['MODEL_TIMEOUT', 'MODEL_RATE_LIMITED', 'MODEL_ERROR', 'MODEL_INVALID_RESPONSE', 'MODEL_NOT_CONFIGURED', 'TURN_TIMEOUT', 'TRACE_UNAVAILABLE']) {
      assert.ok(reasons.includes(reason), reason);
    }
  });

  test('assistant request and response schemas follow the shared contract', () => {
    const op = get(doc, 'paths', '/api/v1/assistant/messages', 'post');
    assert.equal(get(op, 'requestBody', 'content', 'application/json', 'schema', '$ref'), '#/components/schemas/AssistantMessagesRequest');
    assert.equal(get(op, 'responses', '200', 'content', 'application/json', 'schema', '$ref'), '#/components/schemas/AssistantMessagesResponse');
    assert.deepEqual(Object.keys(get(op, 'responses') as Json).sort(), ['200', '400', '401', '500', '503']);
    const req = get(doc, 'components', 'schemas', 'AssistantMessagesRequest');
    assert.equal(get(req, 'additionalProperties'), false);
    assert.deepEqual([get(req, 'properties', 'messages', 'minItems'), get(req, 'properties', 'messages', 'maxItems')], [1, 10]);
    assert.deepEqual(get(req, 'properties', 'messages', 'items', 'properties', 'role', 'enum'), ['user', 'assistant']);
    assert.equal(get(req, 'properties', 'messages', 'items', 'properties', 'content', 'maxLength'), 2000);
    const res = get(doc, 'components', 'schemas', 'AssistantMessagesResponse');
    assert.deepEqual(get(res, 'required'), ['answer', 'toolCalls', 'cards', 'limitations', 'generatedAt']);
    const card = get(doc, 'components', 'schemas', 'AssistantCard') as Json;
    const variants = (card.oneOf ?? card.anyOf) as Json[];
    assert.deepEqual(variants.map((v) => v.$ref), ['EmployeeListCard', 'CompensationSummaryCard', 'RecentChangesCard', 'NoticeCard'].map((id) => `#/components/schemas/${id}`));
    // Review fix 08a: recent means recently recorded; each change carries recordedAt.
    const change = get(doc, 'components', 'schemas', 'RecentChangesCard', 'properties', 'changes', 'items');
    assert.ok((get(change, 'required') as string[]).includes('recordedAt'));
    assert.equal(get(change, 'properties', 'recordedAt', 'format'), 'date-time');
    assert.ok((get(change, 'required') as string[]).includes('effectiveFrom'));
  });

  // Detects: error codes in the contract that differ from the approved list.
  test('error schema lists exactly the approved public codes', () => {
    assert.deepEqual(get(doc, 'components', 'schemas', 'ErrorResponse', 'properties', 'error', 'properties', 'code', 'enum'), [
      'VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'RATE_LIMITED', 'NOT_FOUND', 'ASSISTANT_UNAVAILABLE',
      'FORBIDDEN', 'STALE_VERSION', 'DUPLICATE_OPERATION', 'PENDING_REQUEST_EXISTS', 'REQUEST_NOT_PENDING', 'EMPLOYEE_INELIGIBLE',
      'LAST_ACTIVE_ADMIN', 'EMAIL_TAKEN', 'INVALID_SCOPE', 'SELF_PASSWORD_REGENERATION_FORBIDDEN', 'MODEL_PROVIDER_FAILED', 'ASSISTANT_TURN_IN_PROGRESS', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
    ]);
  });

  // Detects: a committed openapi.json that drifted from the runtime schemas.
  test('the committed openapi/openapi.json matches the generated contract', async () => {
    const committed: unknown = JSON.parse(await readFile(OPENAPI_FILE, 'utf8'));
    assert.deepEqual(committed, doc, 'run `npm run openapi:generate`');
  });

  test('GET /api/v1/openapi.json serves the generated contract', async () => {
    const res = await request(buildTestApp().app).get('/api/v1/openapi.json');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, doc);
  });

  // Detects: a documented operation with no route behind it.
  test('every documented operation is routed', async () => {
    const { app } = buildTestApp();
    const paths = get(doc, 'paths') as Json;
    for (const [path, item] of Object.entries(paths)) {
      for (const method of Object.keys(item as Json)) {
        const url = path.replace('{employeeCode}', 'ACME00001').replace('{requestId}', '00000000-0000-4000-8000-000000000000').replace('{hrUserId}', '1').replace('{conversationId}', '00000000-0000-4000-8000-000000000000')
          .replace('{traceId}', '00000000-0000-4000-8000-000000000000').replace('{mcpCallId}', '00000000-0000-4000-8000-000000000000');
        const call = method === 'post' ? request(app).post(url) : method === 'put' ? request(app).put(url) : method === 'delete' ? request(app).delete(url) : request(app).get(url);
        const res = await call.set('Authorization', `Bearer ${FAKE_TOKEN}`).send({});
        // Routed operations may answer 404 for a missing resource; only the
        // unmatched-route handler says "Route not found."
        assert.notEqual(res.body.error?.message, 'Route not found.', `${method.toUpperCase()} ${path}`);
      }
    }
  });
});
