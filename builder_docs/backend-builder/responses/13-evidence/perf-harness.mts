// Measurement harness for Backend Task 13 (evidence only; not product code).
// Calls the real services (directory, dashboard, assistant tools, admin AI
// summary) and records every SQL statement each one sends. For each scenario:
//   - EXPLAIN (traditional) of every statement: table, access type, key, estimated rows;
//   - rows examined, measured: each statement is re-run on one dedicated
//     connection and ROWS_EXAMINED is read from performance_schema;
//   - p50 / p95 / max wall time of the whole service call over RUNS runs
//     (nearest rank), after 2 warm-up calls, on a normal pool.
// Read-only except nothing: it never writes.
//
// Run from express-backend/:
//   DATABASE_URL=... npx tsx ../builder_docs/backend-builder/responses/13-evidence/perf-harness.mts \
//     --group directory|dashboard|tools|ai-summary [--runs 30]
import { performance } from 'node:perf_hooks';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../../../../express-backend/src/access/sessions.js';
import { createCompensationInsights } from '../../../../express-backend/src/assistant/compensation-insights.js';
import { createAdminObservabilityRepository } from '../../../../express-backend/src/assistant/observability/admin-repository.js';
import { createToolRegistry } from '../../../../express-backend/src/assistant/tools.js';
import { createDashboardService } from '../../../../express-backend/src/dashboard/dashboard-service.js';
import { createPool } from '../../../../express-backend/src/db/connection.js';
import { createDirectoryService } from '../../../../express-backend/src/directory/directory-repository.js';
import { loadExchangeRate } from '../../../../express-backend/src/directory/exchange-rate.js';
import {
  DashboardBreakdownQuery,
  DashboardRecentChangesQuery,
  DashboardSummaryQuery,
  DashboardWithoutAdjustmentQuery,
  DirectoryQueryParams,
} from '../../../../express-backend/src/http/contract.js';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const GROUP = arg('--group') ?? 'directory';
const RUNS = Number(arg('--runs') ?? 30);
const NOW = new Date('2026-11-18T00:00:00.000Z'); // after the demo-scenario and oracle writes (recorded 2026-11-17 ~17:16 UTC)
const AS_OF = '2026-11-18';

const base = { email: 'x', displayName: 'x', status: 'ACTIVE' as const, sessionId: 'x', sessionExpiresAt: new Date(0) };
const ADMIN: Principal = { ...base, hrUserId: 1, role: 'ADMIN', countries: [], departments: [] };
const SCOPED: Principal = { ...base, hrUserId: 2, role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };

const pool = createPool(process.env.DATABASE_URL, { connectionLimit: 8 });
const captured: { sql: string; params: unknown }[] = [];
let capturing = false;
const recording = new Proxy(pool, {
  get(target, prop, receiver) {
    if (prop === 'query' || prop === 'execute') {
      return (sql: unknown, params?: unknown) => {
        if (capturing) captured.push({ sql: String(typeof sql === 'object' && sql !== null && 'sql' in sql ? (sql as { sql: string }).sql : sql), params });
        return (target.query as (s: unknown, p?: unknown) => Promise<unknown>)(sql, params);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as Pool;

interface PlanRow { table: string; type: string; key: string | null; rows: number; extra: string }
interface StatementEvidence { plan: PlanRow[]; rowsExamined: number; rowsSent: number }

async function evidenceFor(conn: PoolConnection, sql: string, params: unknown): Promise<StatementEvidence> {
  const [planRows] = await conn.query<RowDataPacket[]>(`EXPLAIN ${sql}`, params as never);
  const plan = planRows.map((r) => ({ table: String(r.table), type: String(r.type), key: r.key === null ? null : String(r.key), rows: Number(r.rows), extra: String(r.Extra ?? '') }));
  await conn.query(sql, params as never);
  const [[ps]] = await conn.query<RowDataPacket[]>(
    'SELECT ROWS_EXAMINED AS examined, ROWS_SENT AS sent FROM performance_schema.events_statements_history WHERE THREAD_ID = PS_CURRENT_THREAD_ID() ORDER BY EVENT_ID DESC LIMIT 1',
  );
  return { plan, rowsExamined: Number(ps?.examined), rowsSent: Number(ps?.sent) };
}

const nearestRank = (sorted: number[], p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? NaN;

async function measure(name: string, run: () => Promise<unknown>) {
  captured.length = 0;
  capturing = true;
  await run();
  capturing = false;
  const statements = [...captured];
  const conn = await pool.getConnection();
  const evidence: StatementEvidence[] = [];
  try {
    await conn.query("SET SESSION time_zone = '+00:00'");
    for (const s of statements) evidence.push(await evidenceFor(conn, s.sql, s.params));
  } finally {
    conn.release();
  }
  await run();
  await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const result = {
    name,
    statements: statements.length,
    p50: Number(nearestRank(times, 0.5).toFixed(1)),
    p95: Number(nearestRank(times, 0.95).toFixed(1)),
    max: Number((times.at(-1) ?? NaN).toFixed(1)),
    runs: RUNS,
    rowsExamined: evidence.reduce((s, e) => s + e.rowsExamined, 0),
    perStatement: evidence.map((e) => ({
      rowsExamined: e.rowsExamined,
      rowsSent: e.rowsSent,
      access: e.plan.map((p) => `${p.table}:${p.type}:${p.key ?? '-'}(~${p.rows})`).join(' '),
    })),
  };
  console.log(JSON.stringify(result));
  return result;
}

try {
  const exchangeRate = await loadExchangeRate();
  const clock = () => NOW;
  const [[counts]] = await pool.query<RowDataPacket[]>(
    `SELECT VERSION() AS v, (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM compensation_records) AS records,
       (SELECT COUNT(*) FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT') AS changes,
       (SELECT COUNT(*) FROM compensation_change_requests) AS requests, (SELECT COUNT(*) FROM ai_traces) AS traces`,
  );
  console.log(JSON.stringify({ header: true, group: GROUP, runs: RUNS, now: NOW.toISOString(), ...counts }));

  if (GROUP === 'directory') {
    const directory = createDirectoryService({ pool: recording, exchangeRate, clock });
    const [[sample]] = await pool.query<RowDataPacket[]>("SELECT email FROM employees WHERE employee_code = 'ACME05000'");
    const list = (principal: Principal, q: Record<string, string>) => () => directory.list(principal, DirectoryQueryParams.parse(q));
    const lastPage = async (principal: Principal, q: Record<string, string>) => {
      const first = await directory.list(principal, DirectoryQueryParams.parse(q));
      return String(first.page.totalPages);
    };
    const scenarios: [string, () => Promise<unknown>][] = [
      ['search: partial name "sneha" (Admin)', list(ADMIN, { q: 'sneha' })],
      ['search: exact code ACME05000 (Admin)', list(ADMIN, { q: 'ACME05000' })],
      ['search: code prefix ACME050 (Admin)', list(ADMIN, { q: 'ACME050' })],
      ['search: exact email (Admin)', list(ADMIN, { q: String(sample?.email) })],
      ['search: partial name "sneha" (Scoped)', list(SCOPED, { q: 'sneha' })],
      ['filter: department Tech + country IN (Admin)', list(ADMIN, { department: 'Tech', country: 'IN' })],
      ['filter: level SENIOR + status CURRENTLY_WORKING (Admin)', list(ADMIN, { level: 'SENIOR', status: 'CURRENTLY_WORKING' })],
      ['filter: currency USD (needs selected compensation in count) (Admin)', list(ADMIN, { currency: 'USD' })],
      ['scope only, default page 1 (Scoped)', list(SCOPED, {})],
    ];
    for (const sort of ['name', 'employeeCode', 'department', 'country', 'level', 'hireDate', 'annualBaseSalary', 'annualCashCompensation']) {
      const q = sort.startsWith('annual') ? { sort, direction: 'desc', comparisonCurrency: 'USD' } : { sort };
      scenarios.push([`sort ${sort}, page 1 (Admin)`, list(ADMIN, q)]);
    }
    for (const [label, principal, q] of [
      ['sort name, last page (Admin)', ADMIN, { sort: 'name' }],
      ['sort annualCashCompensation, last page (Admin)', ADMIN, { sort: 'annualCashCompensation', direction: 'desc', comparisonCurrency: 'USD' }],
      ['sort annualBaseSalary, last page (Scoped)', SCOPED, { sort: 'annualBaseSalary', comparisonCurrency: 'USD' }],
    ] as const) {
      const page = await lastPage(principal, q);
      scenarios.push([`${label} = page ${page}`, list(principal, { ...q, page })]);
    }
    scenarios.push(['employee detail ACME05000 with history (Admin)', () => directory.detail(ADMIN, 'ACME05000')]);
    scenarios.push(['directory options (Scoped)', () => directory.options(SCOPED)]);
    for (const [name, run] of scenarios) await measure(name, run);
  }

  if (GROUP === 'dashboard') {
    const service = createDashboardService({ pool: recording, exchangeRate, clock });
    for (const [who, principal] of [['Admin', ADMIN], ['Scoped', SCOPED]] as const) {
      await measure(`summary (${who})`, () => service.summary(principal, DashboardSummaryQuery.parse({})));
      for (const breakdown of ['DEPARTMENT', 'COUNTRY', 'CURRENCY', 'LEVEL', 'EMPLOYMENT_STATUS']) {
        await measure(`breakdown ${breakdown} (${who})`, () => service.breakdowns(principal, DashboardBreakdownQuery.parse({ breakdown })));
      }
      await measure(`recent changes 90 days (${who})`, () => service.recentChanges(principal, DashboardRecentChangesQuery.parse({ periodDays: '90' })));
      await measure(`without adjustment 12 months, page 1 (${who})`, () => service.withoutRecentAdjustment(principal, DashboardWithoutAdjustmentQuery.parse({})));
    }
  }

  if (GROUP === 'tools') {
    const directory = createDirectoryService({ pool: recording, exchangeRate, clock });
    const tools = createToolRegistry({ directory, insights: createCompensationInsights({ pool: recording, exchangeRate }), exchangeRate });
    const call = (principal: Principal, name: string, args: unknown) => async () => {
      const outcome = await tools.run(name, args, { principal, asOf: AS_OF, now: NOW });
      if (outcome.status !== 'completed') throw new Error(`${name} ${outcome.status}`);
      return outcome;
    };
    for (const [who, principal] of [['Admin', ADMIN], ['Scoped', SCOPED]] as const) {
      await measure(`search_employees "sneha" limit 5 (${who})`, call(principal, 'search_employees', { query: 'sneha' }));
      await measure(`get_employee_compensation ACME05000 (${who})`, call(principal, 'get_employee_compensation', { employeeCode: 'ACME05000' }));
      await measure(`get_top_compensated_employees ANNUAL_CASH, USD comparison, limit 5 (${who})`, call(principal, 'get_top_compensated_employees', { metric: 'ANNUAL_CASH' }));
      await measure(`get_top_compensated_employees ANNUAL_BASE, INR, limit 10 (${who})`, call(principal, 'get_top_compensated_employees', { metric: 'ANNUAL_BASE', currency: 'INR', limit: 10 }));
      await measure(`get_recent_compensation_changes 90 days limit 10 (${who})`, call(principal, 'get_recent_compensation_changes', { days: 90 }));
      await measure(`get_compensation_summary DEPARTMENT ANNUAL_BASE (${who})`, call(principal, 'get_compensation_summary', { groupBy: 'DEPARTMENT', metric: 'ANNUAL_BASE' }));
    }
  }

  if (GROUP === 'ai-summary') {
    const repo = createAdminObservabilityRepository(recording);
    const windows = {
      '24h': { from: '2026-07-15 00:00:00.000', to: '2026-07-16 00:00:00.000', bucket: 'HOUR' as const },
      '7d': { from: '2026-07-09 00:00:00.000', to: '2026-07-16 00:00:00.000', bucket: 'DAY' as const },
      '30d': { from: '2026-07-01 00:00:00.000', to: '2026-07-31 00:00:00.000', bucket: 'DAY' as const },
    };
    for (const [label, window] of Object.entries(windows)) await measure(`AI monitoring summary ${label}`, () => repo.summary(window));
  }
} finally {
  await pool.end();
}
