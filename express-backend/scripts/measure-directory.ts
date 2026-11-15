#!/usr/bin/env node
// Read-only measurement of the directory queries against a seeded database.
// Prints EXPLAIN ANALYZE plans and wall-clock timings for representative
// requests. Uses exactly the SQL the service builds (buildListQueries).
// Local timings are observations, not a service-level target.
//
// Usage: DATABASE_URL=... npm run measure:directory [-- --runs 15]
import { performance } from 'node:perf_hooks';
import type { RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../src/access/sessions.js';
import { createPool } from '../src/db/connection.js';
import { buildListQueries } from '../src/directory/directory-repository.js';
import { loadExchangeRate } from '../src/directory/exchange-rate.js';
import { DirectoryQueryParams } from '../src/http/contract.js';

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 15;
const AS_OF = '2026-11-14';

const base = { email: 'x', displayName: 'x', status: 'ACTIVE' as const, sessionId: 'x', sessionExpiresAt: new Date(0) };
const ADMIN: Principal = { ...base, hrUserId: 1, role: 'ADMIN', countries: [], departments: [] };
const SCOPED: Principal = { ...base, hrUserId: 2, role: 'SCOPED', countries: ['IN'], departments: ['Support', 'Tech'] };

const SCENARIOS: { name: string; principal: Principal; query: Record<string, string> }[] = [
  { name: 'default first page (Admin)', principal: ADMIN, query: {} },
  { name: 'exact employee code (Admin)', principal: ADMIN, query: { q: 'ACME05000' } },
  { name: 'partial name (Admin)', principal: ADMIN, query: { q: 'sneha' } },
  { name: 'scoped country and department filters (Rohan)', principal: SCOPED, query: { department: 'Tech', country: 'IN' } },
  { name: 'salary sort, base, desc (Admin)', principal: ADMIN, query: { sort: 'annualBaseSalary', direction: 'desc', comparisonCurrency: 'USD' } },
  { name: 'salary sort, cash, page 150 (Rohan)', principal: SCOPED, query: { sort: 'annualCashCompensation', comparisonCurrency: 'USD', page: '150' } },
];

const pool = createPool(process.env.DATABASE_URL, { connectionLimit: 1 });
try {
  const exchangeRate = await loadExchangeRate();
  const [[version]] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS v, (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM compensation_records) AS records');
  console.log(`MySQL ${String(version?.v)}; employees=${String(version?.employees)}; compensation_records=${String(version?.records)}; runs=${RUNS}; asOf=${AS_OF}\n`);

  for (const scenario of SCENARIOS) {
    const query = DirectoryQueryParams.parse(scenario.query);
    const built = buildListQueries(scenario.principal, query, { asOf: AS_OF, exchangeRate });
    console.log(`=== ${scenario.name}  ${JSON.stringify(scenario.query)}`);
    for (const [label, fragment] of [['rows', built.rows], ['count', built.count]] as const) {
      const [plan] = await pool.query<RowDataPacket[]>(`EXPLAIN ANALYZE ${fragment.sql}`, fragment.params);
      console.log(`--- ${label} plan\n${String(plan[0]?.EXPLAIN)}`);
    }
    // Warm-up, then timed runs of the two queries one request performs.
    await pool.query(built.rows.sql, built.rows.params);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      await pool.query(built.rows.sql, built.rows.params);
      await pool.query(built.count.sql, built.count.params);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? NaN;
    const slowest = times[times.length - 1] ?? NaN;
    console.log(`--- rows+count: median ${median.toFixed(1)} ms, slowest ${slowest.toFixed(1)} ms over ${RUNS} runs\n`);
  }
} finally {
  await pool.end();
}
