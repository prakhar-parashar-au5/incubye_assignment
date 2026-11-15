import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Principal } from '../src/access/sessions.js';
import { createToolRegistry } from '../src/assistant/tools.js';
import { fakeDirectory, fakeInsights, MEERA } from './support/http.js';

const ROHAN: Principal = { ...MEERA, hrUserId: 2, role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };

const usRow = {
  employeeCode: 'ACME00024', firstName: 'Patricia', lastName: 'Martinez', email: 'p@acme.com', department: 'Tech' as const,
  jobTitle: 'Junior Software Engineer', level: 'JUNIOR' as const, country: 'US' as const, employmentStatus: 'CURRENTLY_WORKING' as const,
  hireDate: '2020-01-01', compensation: null,
};

describe('tool registry scope check in application code', () => {
  // Detects: a tool trusting the SQL scope alone (a query bug would leak hidden employees).
  test('an out-of-scope row from an operation fails the tool closed', async () => {
    const leaky = fakeDirectory();
    leaky.list = async (_principal, query) => ({
      employees: [usRow],
      page: { number: 1, size: query.pageSize, totalRows: 1, totalPages: 1 },
      sort: { field: 'name', direction: 'asc', comparison: null },
      exchangeRate: null,
    });
    const tools = createToolRegistry({ directory: leaky, insights: fakeInsights(), exchangeRate: null });
    assert.deepEqual(await tools.run('search_employees', { query: 'Patricia' }, { principal: ROHAN, asOf: '2026-11-15', now: new Date('2026-11-15T10:00:00.000Z') }), { status: 'failed', errorName: 'ScopeViolationError' });
    const admin = await tools.run('search_employees', { query: 'Patricia' }, { principal: MEERA, asOf: '2026-11-15', now: new Date('2026-11-15T10:00:00.000Z') });
    assert.equal(admin.status, 'completed');
  });

  // Detects: a description that lets the model read "recent" as "recently effective".
  test('the recent-changes tool says recent means recently recorded', () => {
    const tools = createToolRegistry({ directory: fakeDirectory(), insights: fakeInsights(), exchangeRate: null });
    const description = tools.definitions.find((d) => d.name === 'get_recent_compensation_changes')?.description ?? '';
    assert.match(description, /recorded/i);
    assert.match(description, /future/i);
    assert.match(description, /initial import/i);
  });

  // Detects: invalid arguments reaching an application operation.
  test('invalid arguments and unknown tools are rejected before any operation runs', async () => {
    const directory = fakeDirectory();
    let calls = 0;
    directory.list = async (...args) => {
      calls += 1;
      return fakeDirectory().list(...args);
    };
    const tools = createToolRegistry({ directory, insights: fakeInsights(), exchangeRate: null });
    const context = { principal: MEERA, asOf: '2026-11-15', now: new Date('2026-11-15T10:00:00.000Z') };
    assert.deepEqual(await tools.run('search_employees', { query: '' }, context), { status: 'rejected', reason: 'INVALID_ARGUMENTS' });
    assert.deepEqual(await tools.run('update_salary', { employeeCode: 'ACME00001' }, context), { status: 'rejected', reason: 'UNKNOWN_TOOL' });
    assert.deepEqual(await tools.run('constructor', {}, context), { status: 'rejected', reason: 'UNKNOWN_TOOL' });
    assert.equal(calls, 0);
  });
});
