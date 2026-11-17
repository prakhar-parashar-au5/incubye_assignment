// Fixes from live evaluation 01 (AI Task 05): D1 scope limitation on
// aggregate tool results, D2 role-aware refusal guidance in the instructions.
// Fake data and no model. MySQL: test/db/assistant-conversations.test.ts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { Principal } from '../src/access/sessions.js';
import { PROMPT_VERSION, assistantInstructions, createAssistantService } from '../src/assistant/assistant-service.js';
import { createToolRegistry, scopeLimitation } from '../src/assistant/tools.js';
import type { ToolOutcome } from '../src/assistant/tools.js';
import { MEERA, fakeDirectory, fakeInsights } from './support/http.js';

const ROHAN: Principal = { ...MEERA, hrUserId: 2, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] };
const ROHAN_LIMITATION = 'Covers only employees in your access: India; Support, Tech.';
const AGGREGATES: [string, unknown][] = [
  ['get_top_compensated_employees', { metric: 'ANNUAL_BASE', currency: 'INR', comparisonCurrency: null, limit: 5 }],
  ['get_compensation_summary', { groupBy: 'CURRENCY', metric: 'ANNUAL_BASE' }],
  ['get_recent_compensation_changes', { days: 30, limit: 10, includeInitialImport: null }],
];
const limitationsOf = (outcome: ToolOutcome): string[] => {
  assert.equal(outcome.status, 'completed');
  return outcome.status === 'completed' ? outcome.result.limitations : [];
};

describe('D1: scope limitation on aggregate results', () => {
  const tools = createToolRegistry({ directory: fakeDirectory(), insights: fakeInsights(), exchangeRate: null });
  const context = (principal: Principal) => ({ principal, asOf: '2026-11-15', now: new Date('2026-11-15T09:00:00.000Z') });

  // Detects: a Scoped HR ranking or total presented as if it covered the whole company.
  test('Scoped HR rankings, summaries, and recent-change totals state the current scope, in fixed text', async () => {
    for (const [name, args] of AGGREGATES) {
      const limitations = limitationsOf(await tools.run(name, args, context(ROHAN)));
      assert.equal(limitations[0], ROHAN_LIMITATION, name);
    }
  });

  test('the text follows the principal\'s current scope, sorted, with country names', async () => {
    const wider = { ...ROHAN, countries: ['US', 'IN'], departments: ['Tech', 'Finance'] };
    assert.equal(scopeLimitation(wider), 'Covers only employees in your access: India, United States; Finance, Tech.');
    assert.equal(scopeLimitation({ ...ROHAN, countries: [], departments: [] }), 'Covers only employees in your access: none.');
    assert.equal(limitationsOf(await tools.run('get_compensation_summary', { groupBy: 'COUNTRY', metric: 'ANNUAL_CASH' }, context(wider)))[0],
      'Covers only employees in your access: India, United States; Finance, Tech.');
  });

  test('Admin HR results carry no scope limitation; single-employee lookups never do', async () => {
    for (const [name, args] of AGGREGATES) {
      const limitations = limitationsOf(await tools.run(name, args, context(MEERA)));
      assert.ok(!limitations.some((l) => l.startsWith('Covers only employees in your access')), name);
    }
    assert.equal(scopeLimitation(MEERA), null);
    const search = limitationsOf(await tools.run('search_employees', { query: 'x', limit: null }, context(ROHAN)));
    assert.ok(!search.some((l) => l.startsWith('Covers only')));
  });
});

describe('D2 and instructions v2', () => {
  test('the prompt version is v2 and the hash differs by role', () => {
    assert.equal(PROMPT_VERSION, 'assistant-instructions-v2');
    const service = createAssistantService({ model: null, tools: createToolRegistry({ directory: fakeDirectory(), insights: fakeInsights(), exchangeRate: null }), logger: () => undefined });
    const admin = service.prompt('2026-11-15', 'ADMIN');
    const scoped = service.prompt('2026-11-15', 'SCOPED');
    assert.deepEqual([admin.version, scoped.version], ['assistant-instructions-v2', 'assistant-instructions-v2']);
    assert.notEqual(admin.hash, scoped.hash);
  });

  // Detects: a bare "I'm read-only" refusal, or a Scoped user sent to a page they cannot use.
  test('both roles: refuse, never claim or attempt a change, and name where it is done; scope rule; exact money', () => {
    for (const role of ['ADMIN', 'SCOPED'] as const) {
      const text = assistantInstructions('2026-11-15', role);
      assert.match(text, /never claim a change was made/i, role);
      assert.match(text, /never call a tool to attempt/i, role);
      assert.match(text, /Adjust compensation/, role);
      assert.match(text, /Salary requests/, role);
      assert.match(text, /limited to the employees you can access/i, role);
      assert.match(text, /never describe them as company-wide or organization-wide/i, role);
      assert.match(text, /currency code/i, role);
    }
  });

  test('Admin HR is pointed to HR Access; Scoped HR never is', () => {
    const admin = assistantInstructions('2026-11-15', 'ADMIN');
    const scoped = assistantInstructions('2026-11-15', 'SCOPED');
    assert.match(admin, /"HR Access"/);
    assert.match(admin, /"Adjust compensation" on the employee's page/);
    assert.ok(!/HR Access/.test(scoped), 'Scoped HR is never pointed to HR Access');
    assert.match(scoped, /salary request/i);
    assert.match(scoped, /Admin HR/);
  });
});
