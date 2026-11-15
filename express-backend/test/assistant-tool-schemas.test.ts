import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_INPUT_SCHEMAS, TOOL_NAMES, strictFunctionParameters } from '../src/assistant/tool-schemas.js';

const accepts = (name: keyof typeof TOOL_INPUT_SCHEMAS, input: unknown) =>
  assert.equal(TOOL_INPUT_SCHEMAS[name].safeParse(input).success, true, `${name} ${JSON.stringify(input)}`);
const rejects = (name: keyof typeof TOOL_INPUT_SCHEMAS, input: unknown) =>
  assert.equal(TOOL_INPUT_SCHEMAS[name].safeParse(input).success, false, `${name} ${JSON.stringify(input)}`);

describe('assistant tool input schemas', () => {
  // Detects: a mutation or arbitrary-SQL tool added to the registry.
  test('the registry has exactly the five read-only tools', () => {
    assert.deepEqual([...TOOL_NAMES], [
      'search_employees',
      'get_employee_compensation',
      'get_top_compensated_employees',
      'get_recent_compensation_changes',
      'get_compensation_summary',
    ]);
    for (const name of TOOL_NAMES) assert.doesNotMatch(name, /sql|query_db|update|create|delete|insert|set_|write|change_salary|adjust/i);
  });

  // Detects: malformed model or MCP arguments reaching application operations.
  test('rejects non-objects and unknown fields for every tool', () => {
    for (const name of TOOL_NAMES) {
      for (const bad of [null, 'x', 42, [], { sql: 'SELECT 1' }]) rejects(name, bad);
    }
    rejects('search_employees', { query: 'a', limit: 5, role: 'ADMIN' });
    rejects('get_employee_compensation', { employeeCode: 'ACME00001', hrUserId: 1 });
  });

  test('search_employees: query 1..100 characters, limit 1..10', () => {
    accepts('search_employees', { query: 'Sneha' });
    accepts('search_employees', { query: 'Sneha', limit: 10 });
    accepts('search_employees', { query: 'Sneha', limit: null });
    for (const bad of [{}, { query: '' }, { query: '   ' }, { query: 'x'.repeat(101) }, { query: 'a', limit: 0 }, { query: 'a', limit: 11 }, { query: 'a', limit: 2.5 }, { query: 'a', limit: '5' }]) {
      rejects('search_employees', bad);
    }
  });

  test('get_employee_compensation: an employee code, case-insensitive', () => {
    accepts('get_employee_compensation', { employeeCode: 'ACME00001' });
    assert.equal(TOOL_INPUT_SCHEMAS.get_employee_compensation.parse({ employeeCode: 'acme00001' }).employeeCode, 'ACME00001');
    for (const bad of [{}, { employeeCode: 'ACME1' }, { employeeCode: "ACME00001' OR '1'='1" }, { employeeCode: 1 }]) rejects('get_employee_compensation', bad);
  });

  test('get_top_compensated_employees: metric, optional currency and comparison currency, limit 1..10', () => {
    accepts('get_top_compensated_employees', { metric: 'ANNUAL_CASH' });
    accepts('get_top_compensated_employees', { metric: 'ANNUAL_BASE', currency: 'INR', comparisonCurrency: null, limit: 3 });
    accepts('get_top_compensated_employees', { metric: 'ANNUAL_BASE', currency: null, comparisonCurrency: 'USD', limit: null });
    for (const bad of [{}, { metric: 'SALARY' }, { metric: 'ANNUAL_BASE', currency: 'EUR' }, { metric: 'ANNUAL_BASE', comparisonCurrency: 'INR' }, { metric: 'ANNUAL_BASE', limit: 11 }]) {
      rejects('get_top_compensated_employees', bad);
    }
  });

  // Detects: the initial import being requestable as a "recent change".
  test('get_recent_compensation_changes: days 1..365, limit 1..20, includeInitialImport only false', () => {
    accepts('get_recent_compensation_changes', { days: 30 });
    accepts('get_recent_compensation_changes', { days: 365, limit: 20, includeInitialImport: false });
    accepts('get_recent_compensation_changes', { days: 1, limit: null, includeInitialImport: null });
    for (const bad of [{}, { days: 0 }, { days: 366 }, { days: 30, limit: 21 }, { days: 30, includeInitialImport: true }]) {
      rejects('get_recent_compensation_changes', bad);
    }
  });

  test('get_compensation_summary: groupBy and metric', () => {
    accepts('get_compensation_summary', { groupBy: 'DEPARTMENT', metric: 'ANNUAL_BASE' });
    accepts('get_compensation_summary', { groupBy: 'CURRENCY', metric: 'ANNUAL_CASH' });
    for (const bad of [{}, { groupBy: 'LEVEL', metric: 'ANNUAL_BASE' }, { groupBy: 'COUNTRY' }]) rejects('get_compensation_summary', bad);
  });
});

describe('OpenAI strict function parameters', () => {
  // Detects: a schema the Responses API rejects in strict mode (optional keys, open objects).
  test('every property is required, optional ones accept null, and objects are closed', () => {
    for (const name of TOOL_NAMES) {
      const schema = strictFunctionParameters(TOOL_INPUT_SCHEMAS[name]);
      assert.equal(schema.type, 'object', name);
      assert.equal(schema.additionalProperties, false, name);
      assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort(), name);
      assert.equal('$schema' in schema, false);
    }
    const top = strictFunctionParameters(TOOL_INPUT_SCHEMAS.get_top_compensated_employees);
    assert.ok(JSON.stringify(top.properties?.currency).includes('"null"'), 'optional currency must accept null');
    assert.ok(!JSON.stringify(strictFunctionParameters(TOOL_INPUT_SCHEMAS.get_compensation_summary).properties?.metric).includes('"null"'));
  });
});
