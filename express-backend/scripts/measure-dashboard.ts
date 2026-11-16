#!/usr/bin/env node
// Read-only measurement of the dashboard queries on a seeded database.
// The service runs against a pool wrapper that records each SQL statement it
// sends, so EXPLAIN ANALYZE covers exactly the production SQL. Timings are
// local observations, not a service-level target.
//
// Usage: DATABASE_URL=... npm run measure:dashboard [-- --runs 15] [-- --plans]
import { performance } from 'node:perf_hooks';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../src/access/sessions.js';
import { createDashboardService } from '../src/dashboard/dashboard-service.js';
import { createPool } from '../src/db/connection.js';
import { loadExchangeRate } from '../src/directory/exchange-rate.js';
import {
  DashboardBreakdownQuery,
  DashboardRecentChangesQuery,
  DashboardSummaryQuery,
  DashboardWithoutAdjustmentQuery,
} from '../src/http/contract.js';

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 15;
const PLANS = process.argv.includes('--plans');
const NOW = new Date('2026-11-15T10:00:00.000Z');

const base = { email: 'x', displayName: 'x', status: 'ACTIVE' as const, sessionId: 'x', sessionExpiresAt: new Date(0) };
const ADMIN: Principal = { ...base, hrUserId: 1, role: 'ADMIN', countries: [], departments: [] };
const SCOPED: Principal = { ...base, hrUserId: 2, role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };

const pool = createPool(process.env.DATABASE_URL, { connectionLimit: 8 });
const captured: { sql: string; params: unknown }[] = [];
let capturing = false;
const recording = new Proxy(pool, {
  get(target, prop, receiver) {
    if (prop === 'query') {
      return (sql: string, params?: unknown) => {
        if (capturing) captured.push({ sql, params });
        return target.query(sql, params as never);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as Pool;

try {
  const exchangeRate = await loadExchangeRate();
  const service = createDashboardService({ pool: recording, exchangeRate, clock: () => NOW });
  const [[counts]] = await pool.query<RowDataPacket[]>(
    `SELECT VERSION() AS v, (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM compensation_records) AS records,
            (SELECT COUNT(*) FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT') AS changes,
            (SELECT COUNT(*) FROM compensation_change_requests) AS requests`,
  );
  console.log(`MySQL ${String(counts?.v)}; employees=${String(counts?.employees)}; compensation_records=${String(counts?.records)} (non-import ${String(counts?.changes)}); requests=${String(counts?.requests)}; runs=${RUNS}\n`);

  const scenarios: { name: string; run: () => Promise<unknown> }[] = [];
  for (const [who, principal] of [['Admin', ADMIN], ['Scoped', SCOPED]] as const) {
    scenarios.push(
      { name: `summary (${who})`, run: () => service.summary(principal, DashboardSummaryQuery.parse({})) },
      { name: `breakdown DEPARTMENT, with median (${who})`, run: () => service.breakdowns(principal, DashboardBreakdownQuery.parse({ breakdown: 'DEPARTMENT' })) },
      { name: `breakdown COUNTRY (${who})`, run: () => service.breakdowns(principal, DashboardBreakdownQuery.parse({ breakdown: 'COUNTRY' })) },
      { name: `breakdown CURRENCY (${who})`, run: () => service.breakdowns(principal, DashboardBreakdownQuery.parse({ breakdown: 'CURRENCY' })) },
      { name: `recent changes 90 days (${who})`, run: () => service.recentChanges(principal, DashboardRecentChangesQuery.parse({ periodDays: '90' })) },
      { name: `without adjustment 12 months (${who})`, run: () => service.withoutRecentAdjustment(principal, DashboardWithoutAdjustmentQuery.parse({})) },
    );
  }

  for (const scenario of scenarios) {
    captured.length = 0;
    capturing = true;
    await scenario.run();
    capturing = false;
    const statements = [...captured];
    if (PLANS) {
      console.log(`=== ${scenario.name}: ${statements.length} statement(s)`);
      for (const [i, s] of statements.entries()) {
        const [plan] = await pool.query<RowDataPacket[]>(`EXPLAIN ANALYZE ${s.sql}`, s.params as never);
        console.log(`--- statement ${i + 1}\n${String(plan[0]?.EXPLAIN)}`);
      }
    }
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      await scenario.run();
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log(`${scenario.name}: ${statements.length} statement(s); median ${(times[Math.floor(times.length / 2)] ?? NaN).toFixed(1)} ms, slowest ${(times.at(-1) ?? NaN).toFixed(1)} ms over ${RUNS} runs`);
  }
} finally {
  await pool.end();
}
