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
  test('documents exactly the seventeen endpoints', () => {
    const paths = get(doc, 'paths') as Json;
    const operations = Object.entries(paths).flatMap(([path, item]) => Object.keys(item as Json).map((m) => `${m.toUpperCase()} ${path}`));
    assert.deepEqual(operations.sort(), [
      'GET /api/v1/auth/me',
      'GET /api/v1/employee-directory/options',
      'GET /api/v1/employees',
      'GET /api/v1/employees/{employeeCode}',
      'GET /api/v1/openapi.json',
      'GET /api/v1/salary-adjustment-requests',
      'GET /api/v1/salary-adjustment-requests/{requestId}',
      'GET /health',
      'POST /api/v1/assistant/messages',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/employees/{employeeCode}/salary-adjustment-requests',
      'POST /api/v1/employees/{employeeCode}/salary-adjustments',
      'POST /api/v1/employees/{employeeCode}/salary-adjustments/preview',
      'POST /api/v1/mcp',
      'POST /api/v1/salary-adjustment-requests/{requestId}/approve',
      'POST /api/v1/salary-adjustment-requests/{requestId}/cancel',
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

  // Detects: an assistant contract that drifts from the shared frontend contract.
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
      'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
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
        const url = path.replace('{employeeCode}', 'ACME00001').replace('{requestId}', '00000000-0000-4000-8000-000000000000');
        const call = method === 'post' ? request(app).post(url) : request(app).get(url);
        const res = await call.set('Authorization', `Bearer ${FAKE_TOKEN}`).send({});
        // Routed operations may answer 404 for a missing resource; only the
        // unmatched-route handler says "Route not found."
        assert.notEqual(res.body.error?.message, 'Route not found.', `${method.toUpperCase()} ${path}`);
      }
    }
  });
});
