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
  test('documents exactly the five endpoints', () => {
    const paths = get(doc, 'paths') as Json;
    const operations = Object.entries(paths).flatMap(([path, item]) => Object.keys(item as Json).map((m) => `${m.toUpperCase()} ${path}`));
    assert.deepEqual(operations.sort(), [
      'GET /api/v1/auth/me',
      'GET /api/v1/openapi.json',
      'GET /health',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
    ]);
    assert.equal(get(doc, 'openapi'), '3.1.0');
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
  test('uses an HTTP Bearer JWT security scheme on /me and /logout only', () => {
    assert.deepEqual(get(doc, 'components', 'securitySchemes', 'bearerAuth'), { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    assert.deepEqual(get(doc, 'paths', '/api/v1/auth/me', 'get', 'security'), [{ bearerAuth: [] }]);
    assert.deepEqual(get(doc, 'paths', '/api/v1/auth/logout', 'post', 'security'), [{ bearerAuth: [] }]);
    assert.equal(get(doc, 'paths', '/api/v1/auth/login', 'post', 'security'), undefined);
  });

  // Detects: error codes in the contract that differ from the approved list.
  test('error schema lists exactly the approved public codes', () => {
    assert.deepEqual(get(doc, 'components', 'schemas', 'ErrorResponse', 'properties', 'error', 'properties', 'code', 'enum'), [
      'VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'RATE_LIMITED', 'NOT_FOUND', 'INTERNAL_ERROR',
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
        const call = method === 'post' ? request(app).post(path) : request(app).get(path);
        const res = await call.set('Authorization', `Bearer ${FAKE_TOKEN}`).send({});
        assert.notEqual(res.status, 404, `${method.toUpperCase()} ${path}`);
      }
    }
  });
});
