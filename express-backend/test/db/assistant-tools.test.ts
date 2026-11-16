// Assistant tools, MCP, and the assistant endpoint against real MySQL, real
// sessions, and the full 10,000-employee seed. The model is always the fake
// adapter. Expected values come from independent SQL and BigInt arithmetic.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { bootstrapHrUser } from '../../src/access/hr-users.js';
import { createAuthService } from '../../src/access/sessions.js';
import type { Principal } from '../../src/access/sessions.js';
import { createSessionTokens } from '../../src/access/session-tokens.js';
import { createAssistantService } from '../../src/assistant/assistant-service.js';
import { createCompensationInsights } from '../../src/assistant/compensation-insights.js';
import { TOOL_INPUT_SCHEMAS, TOOL_NAMES } from '../../src/assistant/tool-schemas.js';
import { createToolRegistry } from '../../src/assistant/tools.js';
import type { ToolOutcome, ToolRegistry } from '../../src/assistant/tools.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createDirectoryService } from '../../src/directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../../src/directory/exchange-rate.js';
import { createApp } from '../../src/http/app.js';
import type { LogEntry } from '../../src/http/request-log.js';
import { seedDatabase } from '../../src/seed/seed-database.js';
import { createSourceWorkbook } from '../../src/source-workbook/source-workbook.js';
import { ASSISTANT_EVAL_CASES } from '../../scripts/assistant-eval-cases.js';
import { selectRows } from '../support/db.js';
import type { Row } from '../support/db.js';
import { answer, scriptedModel } from '../support/fake-model.js';
import type { FakeStep } from '../support/fake-model.js';
import { fakeSalaryAdjustments } from '../support/http.js';
import { must } from '../support/must.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';

const DATABASE_URL = testDatabaseUrl();
const SIGNING_KEY = 'test-only-signing-key-0123456789abcdef';
const PASSWORD = 'synthetic-shared-demo-password';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const AS_OF = '2026-11-15';
const clock = (): Date => NOW;

const RATE: ExchangeRateSnapshot = {
  baseCurrency: 'USD', quoteCurrency: 'INR', rate: '93.9100', sourceName: 'test source',
  sourceUrl: 'https://example.test/rate', effectiveDate: '2026-11-06', retrievedAt: '2026-11-14T18:47:36Z',
};

let pool: Pool;
let dir: string;
let tools: ToolRegistry;
let toolsWithoutRate: ToolRegistry;
let admin: Principal;
let rohan: Principal;
const logs: LogEntry[] = [];

const query = (sql: string, params?: unknown[]): Promise<Row[]> => selectRows(pool, sql, params);
const BASE = 'FROM employees e JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id';
const ROHAN = "e.country_code = 'IN' AND d.name IN ('Tech', 'Support')";

async function completed(registry: ToolRegistry, principal: Principal, name: string, args: unknown) {
  const outcome: ToolOutcome = await registry.run(name, args, { principal, asOf: AS_OF, now: NOW });
  assert.equal(outcome.status, 'completed', `${name}: ${JSON.stringify(outcome)}`);
  if (outcome.status !== 'completed') throw new Error('unreachable');
  return outcome.result;
}

type CardEmployee = { employeeCode: string; country: string; department: string; compensation: { annualBaseSalary: { amount: string; currency: string }; annualCashCompensation: { amount: string; currency: string } } | null };
const employeesOf = (data: Record<string, unknown>): CardEmployee[] => data.employees as CardEmployee[];
const assertRohanScope = (employees: readonly { country: string; department: string }[]) => {
  for (const e of employees) assert.ok(e.country === 'IN' && ['Tech', 'Support'].includes(e.department), JSON.stringify(e));
};

/** Independent ranking of currently working employees by exact USD value. */
async function independentTop(where: string, metric: 'base' | 'cash', limit: number): Promise<string[]> {
  // Seed: one record per employee, effective on or before the as-of date for every CURRENTLY_WORKING employee.
  const rows = await query(
    `SELECT e.employee_code, c.annual_base_salary, c.annual_bonus, c.currency ${BASE}
     JOIN compensation_records c ON c.employee_id = e.id
     WHERE e.employment_status = 'CURRENTLY_WORKING' AND c.effective_from <= ? AND ${where}`,
    [AS_OF],
  );
  const keyed = rows.map((r) => {
    const base = BigInt(String(r.annual_base_salary).replace('.', ''));
    const bonus = BigInt(String(r.annual_bonus).replace('.', ''));
    const cents = metric === 'base' ? base : base + bonus;
    // Exact key proportional to USD: USD cents x 9391 (93.91 x 100), INR cents x 100.
    return { code: String(r.employee_code), key: r.currency === 'USD' ? cents * 9391n : cents * 100n };
  });
  keyed.sort((a, b) => (a.key === b.key ? a.code.localeCompare(b.code) : a.key > b.key ? -1 : 1));
  return keyed.slice(0, limit).map((k) => k.code);
}

before(async () => {
  await resetTestDatabase(DATABASE_URL);
  await runMigrations({ databaseUrl: DATABASE_URL });
  dir = await mkdtemp(path.join(tmpdir(), 'acme-assistant-'));
  const workbookPath = path.join(dir, 'acme-employees.xlsx');
  await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  await seedDatabase({ databaseUrl: DATABASE_URL, workbookPath, replace: true, appEnv: 'test' });
  pool = createPool(DATABASE_URL, { connectionLimit: 4 });
  const directory = createDirectoryService({ pool, exchangeRate: RATE, clock });
  tools = createToolRegistry({ directory, insights: createCompensationInsights({ pool, exchangeRate: RATE }), exchangeRate: RATE });
  const directoryWithoutRate = createDirectoryService({ pool, exchangeRate: null, clock });
  toolsWithoutRate = createToolRegistry({ directory: directoryWithoutRate, insights: createCompensationInsights({ pool, exchangeRate: null }), exchangeRate: null });

  const meeraId = await bootstrapHrUser(pool, { email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', password: PASSWORD, role: 'ADMIN', countries: [], departments: [] });
  const rohanId = await bootstrapHrUser(pool, { email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', password: PASSWORD, role: 'SCOPED', countries: ['IN'], departments: ['Tech', 'Support'] });
  const session = { sessionId: 'n/a', sessionExpiresAt: NOW, status: 'ACTIVE' as const };
  admin = { ...session, hrUserId: meeraId, email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', role: 'ADMIN', countries: [], departments: [] };
  rohan = { ...session, hrUserId: rohanId, email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };
});
after(async () => {
  await pool?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('recent changes on the pristine seed', () => {
  // Detects: the initial import reported as a new salary change.
  test('only INITIAL_IMPORT records exist, so the answer is an honest empty result', async () => {
    assert.equal(Number(must((await query("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT'"))[0], 'n').n), 0);
    const result = await completed(tools, admin, 'get_recent_compensation_changes', { days: 365 });
    assert.deepEqual(result.data, {
      totalMatching: 0, changes: [],
      message: 'No compensation changes were recorded in the last 365 days for employees you can access. The initial import is not counted as a change.',
    });
    assert.deepEqual(result.cards.map((c) => c.type), ['notice']);
    assert.ok(result.limitations.includes('The initial import is not counted as a salary change.'));
  });
});

describe('top compensated employees', () => {
  // Detects: raw INR and USD amounts compared (INR would always win), or rounding before ranking.
  test('without a currency, Admin ranking uses the exact USD comparison and discloses the rate', async () => {
    for (const [metric, key] of [['ANNUAL_BASE', 'base'], ['ANNUAL_CASH', 'cash']] as const) {
      const result = await completed(tools, admin, 'get_top_compensated_employees', { metric, limit: 10 });
      assert.deepEqual(employeesOf(result.data).map((e) => e.employeeCode), await independentTop('TRUE', key, 10), metric);
      assert.equal((result.data.comparison as { sourceUrl: string }).sourceUrl, RATE.sourceUrl);
      assert.ok(result.limitations.some((l) => l.includes('93.9100 INR per USD') && l.includes('2026-11-06')));
      const card = must(result.cards[0], 'card');
      assert.ok(card.type === 'employee_list' && card.exchangeRate?.effectiveDate === '2026-11-06');
    }
    // The seeded top earners by USD include both currencies (INR max ~7,000,000 = ~74,540 USD; US managers reach 250,000).
    const top = await completed(tools, admin, 'get_top_compensated_employees', { metric: 'ANNUAL_BASE', limit: 1 });
    assert.equal(employeesOf(top.data)[0]?.compensation?.annualBaseSalary.currency, 'USD');
  });

  // Detects: scope missing from the ranking query.
  test('Rohan receives only permitted employees, matching an independent scoped ranking', async () => {
    const result = await completed(tools, rohan, 'get_top_compensated_employees', { metric: 'ANNUAL_CASH', limit: 10 });
    const employees = employeesOf(result.data);
    assertRohanScope(employees);
    assert.deepEqual(employees.map((e) => e.employeeCode), await independentTop(ROHAN, 'cash', 10));
  });

  // Detects: a single-currency request still converted, or ranked on the wrong column.
  test('with a currency, ranks natively within that currency', async () => {
    const result = await completed(toolsWithoutRate, admin, 'get_top_compensated_employees', { metric: 'ANNUAL_BASE', currency: 'INR', limit: 3 });
    const expected = (await query(
      `SELECT e.employee_code ${BASE} JOIN compensation_records c ON c.employee_id = e.id
       WHERE e.employment_status = 'CURRENTLY_WORKING' AND c.currency = 'INR' ORDER BY c.annual_base_salary DESC, e.employee_code LIMIT 3`,
    )).map((r) => r.employee_code);
    assert.deepEqual(employeesOf(result.data).map((e) => e.employeeCode), expected);
    for (const e of employeesOf(result.data)) assert.equal(e.compensation?.annualBaseSalary.currency, 'INR');
  });

  // Detects: a fallback to raw native comparison when the rate is missing.
  test('a missing exchange rate returns insufficiency, not a raw comparison', async () => {
    const result = await completed(toolsWithoutRate, admin, 'get_top_compensated_employees', { metric: 'ANNUAL_CASH', currency: null, comparisonCurrency: 'USD' });
    assert.equal(result.data.status, 'insufficient');
    assert.equal(result.data.reason, 'NO_EXCHANGE_RATE');
    assert.equal('employees' in result.data, false);
    assert.deepEqual(result.cards.map((c) => c.type), ['notice']);
    assert.ok(result.limitations.includes('Raw INR and USD amounts are never compared.'));
  });
});

describe('search and employee compensation', () => {
  // Detects: an out-of-scope employee disclosed through either lookup.
  test('Rohan cannot find or open an out-of-scope employee, and both results equal an unknown code', async () => {
    const usCode = String(must((await query("SELECT employee_code FROM employees WHERE country_code = 'US' ORDER BY employee_code LIMIT 1"))[0], 'us').employee_code);
    const outOfScope = await completed(tools, rohan, 'get_employee_compensation', { employeeCode: usCode });
    const unknown = await completed(tools, rohan, 'get_employee_compensation', { employeeCode: 'ACME99999' });
    assert.deepEqual(outOfScope, unknown);
    assert.equal(outOfScope.data.found, false);
    const search = await completed(tools, rohan, 'search_employees', { query: usCode });
    assert.deepEqual(search.data, { totalMatching: 0, returned: 0, employees: [] });
    const adminView = await completed(tools, admin, 'get_employee_compensation', { employeeCode: usCode });
    assert.equal(adminView.data.found, true);
  });

  // Detects: history missing, or money changed on the way to the tool output.
  test('Admin sees full history with exact decimal strings', async () => {
    const result = await completed(tools, admin, 'get_employee_compensation', { employeeCode: 'acme00001' });
    const employee = (result.data.employee as CardEmployee);
    assert.equal(employee.employeeCode, 'ACME00001');
    assert.deepEqual(employee.compensation?.annualCashCompensation, { amount: '3557885.85', currency: 'INR' });
    assert.deepEqual(result.data.compensationHistory, [{
      version: 1, effectiveFrom: '2024-02-06', changeReason: 'INITIAL_IMPORT',
      annualBaseSalary: { amount: '3026700.00', currency: 'INR' }, annualBonus: { amount: '531185.85', currency: 'INR' },
      annualCashCompensation: { amount: '3557885.85', currency: 'INR' },
    }]);
  });

  test('Rohan search returns only permitted employees', async () => {
    const result = await completed(tools, rohan, 'search_employees', { query: 'Sharma', limit: 10 });
    assert.ok(employeesOf(result.data).length > 0);
    assertRohanScope(employeesOf(result.data));
  });
});

describe('compensation summary', () => {
  // Detects: INR and USD added together, leavers counted as spend, or wrong averages.
  test('Admin by country keeps native currencies separate and matches independent SQL', async () => {
    const result = await completed(tools, admin, 'get_compensation_summary', { groupBy: 'COUNTRY', metric: 'ANNUAL_BASE' });
    const expected = await query(
      `SELECT e.country_code AS grp, c.currency, COUNT(*) AS n, SUM(c.annual_base_salary) AS total
       FROM employees e JOIN compensation_records c ON c.employee_id = e.id
       WHERE e.employment_status = 'CURRENTLY_WORKING' GROUP BY e.country_code, c.currency ORDER BY e.country_code`,
    );
    const groups = result.data.groups as { group: string; currency: string; employeeCount: number; total: { amount: string }; average: { amount: string } }[];
    assert.deepEqual(groups.map((g) => [g.group, g.currency, g.employeeCount, g.total.amount]),
      expected.map((r) => [r.grp, r.currency, Number(r.n), String(r.total)]));
    // Average: exact cents / count, half-up, checked with BigInt.
    for (const g of groups) {
      const cents = BigInt(g.total.amount.replace('.', ''));
      const n = BigInt(g.employeeCount);
      const avg = (cents % n) * 2n >= n ? cents / n + 1n : cents / n;
      assert.equal(g.average.amount, `${avg / 100n}.${String(avg % 100n).padStart(2, '0')}`);
    }
    assert.ok(result.limitations.includes('Covers currently working employees only.'));
  });

  test('Rohan by department sees only Support and Tech in INR', async () => {
    const result = await completed(tools, rohan, 'get_compensation_summary', { groupBy: 'DEPARTMENT', metric: 'ANNUAL_CASH' });
    const groups = result.data.groups as { group: string; currency: string; employeeCount: number }[];
    assert.deepEqual(groups.map((g) => [g.group, g.currency]), [['Support', 'INR'], ['Tech', 'INR']]);
    const expected = await query(`SELECT d.name AS grp, COUNT(*) AS n ${BASE} WHERE e.employment_status = 'CURRENTLY_WORKING' AND ${ROHAN} GROUP BY d.name ORDER BY d.name`);
    assert.deepEqual(groups.map((g) => g.employeeCount), expected.map((r) => Number(r.n)));
  });
});

describe('recent changes by record creation time', () => {
  // NOW = 2026-11-15T10:00:00.000Z. "Recent" means recorded by HR recently (created_at),
  // not effective recently. Each marker sets created_at explicitly.
  let inTech: string;
  let inSupport: string;
  let usFinance: string;
  before(async () => {
    const pick = async (where: string) => {
      const [row] = await query(`SELECT e.id, e.employee_code ${BASE} WHERE e.employment_status = 'CURRENTLY_WORKING' AND ${where} ORDER BY e.employee_code LIMIT 1`);
      return must(row, where);
    };
    const inTechRow = await pick("e.country_code = 'IN' AND d.name = 'Tech'");
    const inSupportRow = await pick("e.country_code = 'IN' AND d.name = 'Support'");
    const usRow = await pick("e.country_code = 'US' AND d.name = 'Finance'");
    inTech = String(inTechRow.employee_code);
    inSupport = String(inSupportRow.employee_code);
    usFinance = String(usRow.employee_code);
    const add = (id: unknown, version: number, base: string, currency: string, from: string, reason: string, createdAt: string) => pool.query(
      `INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason, created_at)
       VALUES (?, ?, ?, '0.00', ?, ?, ?, ?, ?)`,
      [id, version, base, currency, currency === 'INR' ? 'MONTHLY' : 'ANNUAL', from, reason, createdAt],
    );
    // Recorded 5 days ago, effective 10 days ago: recent.
    await add(inTechRow.id, 2, '4100000.00', 'INR', '2026-11-05', 'PERFORMANCE', '2026-11-10 09:00:00.000');
    // Same created_at as above, inserted later: the stable tie-break puts it first.
    await add(inSupportRow.id, 2, '2500000.00', 'INR', '2026-11-05', 'MARKET_ADJUSTMENT', '2026-11-10 09:00:00.000');
    // Recorded and effective long ago: never recent.
    await add(usRow.id, 2, '1.00', 'USD', '2025-10-01', 'CORRECTION', '2025-10-01 12:00:00.000');
    // Effective yesterday but recorded 10 months ago: not recent.
    await add(usRow.id, 3, '140000.00', 'USD', '2026-11-14', 'MARKET_ADJUSTMENT', '2026-01-10 12:00:00.000');
    // Recorded 2 hours ago, effective next month: recent, although the change is in the future.
    await add(usRow.id, 4, '150000.00', 'USD', '2026-12-01', 'PROMOTION', '2026-11-15 08:00:00.000');
    // Recorded after the injected current time: outside the window.
    await add(inTechRow.id, 3, '4200000.00', 'INR', '2026-12-15', 'PROMOTION', '2026-11-15 11:00:00.000');
  });

  type Change = { employeeCode: string; version: number; changeReason: string; recordedAt: string; effectiveFrom: string;
    annualBaseSalaryChange: { amount: string } | null; previous: { annualBaseSalary: { amount: string } } | null };

  // Detects: selection by effective date, future-effective changes dropped, old records
  // with recent effective dates included, records after "now" included, or unstable order.
  test('Admin sees changes recorded in the window, newest record first, with effective dates', async () => {
    const result = await completed(tools, admin, 'get_recent_compensation_changes', { days: 30, limit: 20 });
    const changes = result.data.changes as Change[];
    assert.deepEqual(changes.map((c) => [c.employeeCode, c.version, c.changeReason, c.recordedAt, c.effectiveFrom]), [
      [usFinance, 4, 'PROMOTION', '2026-11-15T08:00:00.000Z', '2026-12-01'],
      [inSupport, 2, 'MARKET_ADJUSTMENT', '2026-11-10T09:00:00.000Z', '2026-11-05'],
      [inTech, 2, 'PERFORMANCE', '2026-11-10T09:00:00.000Z', '2026-11-05'],
    ]);
    assert.equal(result.data.totalMatching, 3);
    // Previous record and exact difference still follow the effective-date timeline.
    const [expectedPrevious] = await query(
      `SELECT c.annual_base_salary FROM compensation_records c JOIN employees e ON e.id = c.employee_id
       WHERE e.employee_code = ? AND (c.effective_from < '2026-12-01' OR (c.effective_from = '2026-12-01' AND c.version < 4))
       ORDER BY c.effective_from DESC, c.version DESC LIMIT 1`,
      [usFinance],
    );
    assert.equal(changes[0]?.previous?.annualBaseSalary.amount, '140000.00');
    assert.equal(String(must(expectedPrevious, 'previous').annual_base_salary), '140000.00');
    assert.equal(changes[0]?.annualBaseSalaryChange?.amount, '10000.00');
    const previousIn = String(must((await query('SELECT annual_base_salary FROM compensation_records c JOIN employees e ON e.id = c.employee_id WHERE e.employee_code = ? AND c.version = 1', [inTech]))[0], 'v1').annual_base_salary);
    const delta = BigInt('410000000') - BigInt(previousIn.replace('.', ''));
    const abs = delta < 0n ? -delta : delta;
    assert.equal(changes[2]?.annualBaseSalaryChange?.amount, `${delta < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`);
    const card = must(result.cards[0], 'card');
    assert.ok(card.type === 'recent_changes' && card.changes[0]?.recordedAt === '2026-11-15T08:00:00.000Z');
  });

  // Detects: a window that does not end at the injected current time.
  test('the window is measured back from the current time, not from midnight', async () => {
    const lastDay = await completed(tools, admin, 'get_recent_compensation_changes', { days: 1 });
    assert.deepEqual((lastDay.data.changes as Change[]).map((c) => [c.employeeCode, c.version]), [[usFinance, 4]]);
    const fourDays = await completed(tools, admin, 'get_recent_compensation_changes', { days: 4 });
    assert.equal(fourDays.data.totalMatching, 1);
    const year = await completed(tools, admin, 'get_recent_compensation_changes', { days: 365 });
    assert.equal(year.data.totalMatching, 4, 'includes the record from 2026-01-10, still excludes 2025-10-01 and the future record');
  });

  test('Rohan sees only the India Tech and Support changes', async () => {
    const result = await completed(tools, rohan, 'get_recent_compensation_changes', { days: 365 });
    assert.deepEqual((result.data.changes as Change[]).map((c) => c.employeeCode), [inSupport, inTech]);
  });

  test('a window with no recorded changes says so', async () => {
    const empty = await completed(tools, rohan, 'get_recent_compensation_changes', { days: 1 });
    assert.equal(empty.data.totalMatching, 0);
    assert.match(String(empty.data.message), /No compensation changes were recorded in the last 1 day/);
  });

  after(async () => {
    await pool.query("DELETE FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT'");
  });
});

describe('HTTP assistant and MCP with real authentication', () => {
  let server: Server;
  let baseUrl: string;
  let meeraToken: string;
  let rohanToken: string;
  let fakeSteps: FakeStep[] = [];
  const httpLogs = logs;

  before(async () => {
    const tokens = createSessionTokens({ signingKey: SIGNING_KEY, clock });
    const directory = createDirectoryService({ pool, exchangeRate: RATE, clock });
    const model = {
      open(request: Parameters<ReturnType<typeof scriptedModel>['open']>[0]) {
        return scriptedModel(fakeSteps).open(request);
      },
    };
    const app = createApp({
      auth: createAuthService({ pool, tokens, clock }),
      directory,
      tools,
      assistant: createAssistantService({ model, tools, logger: (e) => httpLogs.push(e), clock }),
      toolClock: clock,
      salaryAdjustments: fakeSalaryAdjustments(),
      logger: (e) => httpLogs.push(e),
      clientIpSource: 'socket',
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = async (email: string) => {
      const res = await request(baseUrl).post('/api/v1/auth/login').send({ email, password: PASSWORD });
      assert.equal(res.status, 200, res.text);
      return String(res.body.token);
    };
    meeraToken = await login('meera.iyer@acme.com');
    rohanToken = await login('rohan.mehta@acme.com');
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function mcpClient(token: string): Promise<Client> {
    const client = new Client({ name: 'acme-test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
  }

  // Detects: MCP and the in-product assistant running different logic or scope.
  test('MCP returns the same authorized result as the shared tool implementation', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['get_top_compensated_employees', { metric: 'ANNUAL_CASH', limit: 5 }],
      ['search_employees', { query: 'Sharma', limit: 10 }],
      ['get_compensation_summary', { groupBy: 'DEPARTMENT', metric: 'ANNUAL_BASE' }],
      ['get_employee_compensation', { employeeCode: 'ACME00001' }],
    ];
    for (const [token, principal] of [[meeraToken, admin], [rohanToken, rohan]] as const) {
      const client = await mcpClient(token);
      try {
        for (const [name, args] of calls) {
          const viaMcp = await client.callTool({ name, arguments: args });
          const direct = await completed(tools, principal, name, args);
          assert.deepEqual(viaMcp.structuredContent, JSON.parse(JSON.stringify({ data: direct.data, cards: direct.cards, limitations: direct.limitations })), `${principal.role} ${name}`);
        }
        const top = await client.callTool({ name: 'get_top_compensated_employees', arguments: { metric: 'ANNUAL_BASE', limit: 10 } });
        if (principal.role === 'SCOPED') assertRohanScope(employeesOf((top.structuredContent as { data: Record<string, unknown> }).data));
      } finally {
        await client.close();
      }
    }
  });

  // Detects: a mutation or SQL tool reachable through MCP.
  test('MCP lists only the five read-only tools and rejects unknown tool names', async () => {
    const client = await mcpClient(rohanToken);
    try {
      const { tools: listed } = await client.listTools();
      assert.deepEqual(listed.map((t) => t.name), [...TOOL_NAMES]);
      // The SDK answers an unregistered tool with a protocol error.
      await assert.rejects(client.callTool({ name: 'run_sql', arguments: { sql: 'DELETE FROM employees' } }), /not found/);
      assert.equal(Number(must((await query('SELECT COUNT(*) AS n FROM employees'))[0], 'n').n), 10000);
    } finally {
      await client.close();
    }
  });

  const ask = (token: string, question: string) =>
    request(baseUrl).post('/api/v1/assistant/messages').set('Authorization', `Bearer ${token}`).send({ messages: [{ role: 'user', content: question }] });

  // Evaluation fixtures: the fake model replays the call a correct model makes.
  for (const evalCase of ASSISTANT_EVAL_CASES) {
    test(`evaluation: ${evalCase.id}`, async () => {
      if (evalCase.toolCall !== null && evalCase.expectedTool !== null) {
        // The fixture's arguments are valid for the advertised schema.
        assert.equal(TOOL_INPUT_SCHEMAS[evalCase.expectedTool].safeParse(evalCase.toolCall).success, true);
      }
      fakeSteps = evalCase.toolCall === null || evalCase.expectedTool === null
        ? [() => answer('I am read-only and cannot change salaries.')]
        : [
          () => ({ kind: 'tool_calls', calls: [{ callId: `eval_${evalCase.id}`, name: String(evalCase.expectedTool), arguments: JSON.stringify(evalCase.toolCall) }] }),
          () => answer('Here is what the tools returned.'),
        ];
      for (const token of [meeraToken, rohanToken]) {
        const res = await ask(token, evalCase.question);
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.body.toolCalls, evalCase.expectedTool === null ? [] : [{ name: evalCase.expectedTool, status: 'completed' }]);
        const cardTypes = (res.body.cards as { type: string }[]).map((c) => c.type);
        // Rohan cannot see ACME00001 (India HR), so that lookup is a notice for him.
        const expected = token === rohanToken && evalCase.id === 'employee-history' ? ['notice'] : evalCase.expectedCards;
        assert.deepEqual(cardTypes, expected, `${evalCase.id} ${token === meeraToken ? 'admin' : 'rohan'}`);
        if (token === rohanToken) {
          for (const card of res.body.cards as { type: string; employees?: { country: string; department: string }[] }[]) {
            if (card.employees) assertRohanScope(card.employees);
          }
        }
      }
      if (evalCase.expectedTool === null) assert.equal(Number(must((await query("SELECT COUNT(*) AS n FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT'"))[0], 'n').n), 0);
    });
  }

  // Detects: chat, names, salaries, arguments, or tokens in any log line.
  test('logs from assistant and MCP calls contain no sensitive content', async () => {
    const sneha = await completed(tools, admin, 'get_employee_compensation', { employeeCode: 'ACME00001' });
    const text = JSON.stringify(httpLogs);
    for (const secret of ['Sneha', 'Singh', '3026700', '3557885', 'Sharma', 'highest annual cash', meeraToken, rohanToken, 'Bearer', 'SELECT', 'ACME0']) {
      assert.ok(!text.includes(secret), `log contains ${secret}`);
    }
    assert.ok(sneha.data.found);
    const events = new Set(httpLogs.map((l) => l.event));
    assert.ok(events.has('assistant_tool') && events.has('mcp_tool') && events.has('request'));
    for (const entry of httpLogs.filter((l) => l.event === 'assistant_tool' || l.event === 'mcp_tool')) {
      assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'event', 'requestId', 'status', 'tool']);
    }
  });
});
