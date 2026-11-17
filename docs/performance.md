# Performance

Measured numbers only. Every figure here came from a run on 2026-11-17. The raw output is in [`builder_docs/backend-builder/responses/13-evidence/`](../builder_docs/backend-builder/responses/13-evidence/). Where a section gives no number, nothing was measured.

## Setup

| Item | Value |
|---|---|
| Machine | Apple M4 Pro, 12 cores, 24 GB. Docker 29.7.2 VM: 12 CPUs, 7.7 GB. |
| Database | Fresh `mysql:8.4` (8.4.13) container `acme-perf-mysql` on `127.0.0.1:3331`, tmpfs, database `acme_perf_test`. Removed afterwards. |
| Data | Migrations 001–008; seed of 10,000 employees; oracle fixtures (`eval:oracle-fixtures --apply`); `demo:scenario --apply`; then 10,000 synthetic AI traces spread over 90 days (with one model call and one tool call each). |
| Resulting rows | 10,000 employees, 10,012 compensation records (12 non-import changes), 6 salary requests, 5 HR users, 10,000 traces. |
| Node | v22.23.1 |
| Harness | [`perf-harness.mts`](../builder_docs/backend-builder/responses/13-evidence/perf-harness.mts) calls the real services (directory, dashboard, assistant tools, AI summary) through a pool wrapper that records each SQL statement. |

What the columns mean:

- **Access**: from `EXPLAIN`, given as `table:type:key`. It shows the table that drives the query; join lookups are in the raw files.
- **Rows examined**: MySQL's `ROWS_EXAMINED` from `performance_schema.events_statements_history`. Each recorded statement was re-run once on a dedicated connection, and the counts are summed over every statement the call sends.
- **p50 / p95**: nearest-rank wall time of the whole service call, in ms, over 30 runs after 2 warm-up calls. It includes the Node-to-MySQL round trips.

Two caveats:

- The history is thin. The oracle fixtures and the demo scenario add only 12 non-import compensation changes. History-heavy queries (recent changes, "without recent adjustment") were measured at that volume, not at a realistic one.
- These are local, single-user timings, not a service-level target. There was no concurrency.

## Directory (`GET /employees`, detail, options)

Every list request runs 2 statements: the page and a count.

| Query | Serves | Access (page query) | Rows examined | p50 | p95 | Verdict |
|---|---|---|---:|---:|---:|---|
| Partial name `sneha`, Admin | Search box | `e:ALL` | 20,149 | 10.8 | 12.4 | OK. `LIKE '%…%'` cannot use an index, so it scans all employees. |
| Exact code `ACME05000`, Admin | Search box | `e:ALL` | 20,053 | 11.4 | 12.1 | Works, but the `OR` with the name conditions stops MySQL from using `uk_employees_employee_code`. Detail (below) does the same lookup in 0.7 ms. |
| Code prefix `ACME050`, Admin | Search box | `e:ALL` | 20,149 | 11.5 | 12.4 | Same as exact code. |
| Exact email, Admin | Search box | `e:ALL` | 20,053 | 9.6 | 10.7 | `uk_employees_email` is unused, for the same reason. |
| Partial name, Scoped (IN × Support/Tech) | Search box | `e:ref:idx_employees_country` | 13,641 | 9.4 | 10.1 | Scope in SQL narrows the scan. |
| Filter department Tech + country IN, Admin | Filters | `d:const:uk_departments_name` → `e:ref:idx_employees_country` | 11,170 | 9.7 | 10.7 | OK |
| Filter level SENIOR + status working, Admin | Filters | `d:index` → `jt:ref:uk_job_titles_department_name_level` → `e:ref:idx_employees_job_title` | 7,242 | 8.8 | 11.8 | OK |
| Filter currency USD, Admin | Filters | `e:ALL` + lateral `<derived>:ref:<auto_key0>` | 25,933 | 27.9 | 28.7 | 3× an ordinary filter. Currency lives on the selected compensation record, so the count query must also run the lateral join. |
| Scope only, page 1, Scoped | Default list | `e:ref:idx_employees_country` | 13,668 | 10.5 | 12.3 | OK |
| Sort name, page 1 | Sort | `e:ALL` | 20,149 | 6.6 | 7.3 | OK |
| Sort employee code, page 1 | Sort | `e:index:uk_employees_employee_code` | 10,149 (page query: 100) | 1.6 | 2.9 | Best case. The page is read in index order and stops after 25 rows. |
| Sort department, page 1 | Sort | `d:index` → `jt:ref` → `e:ref:idx_employees_job_title` | 30,097 | 27.6 | 28.5 | OK |
| Sort country, page 1 | Sort | `e:ALL` | 20,149 | 4.6 | 5.1 | OK |
| Sort level, page 1 | Sort | `d:index` → `jt:ref` → `e:ref` | 30,097 | 27.3 | 28.8 | OK |
| Sort hire date, page 1 | Sort | `e:ALL` | 20,149 | 5.3 | 6.3 | OK |
| Sort annual base salary (USD comparison), page 1 | Sort | `d:index` → `jt:ref` → `e:ref` + lateral | 30,097 | 31.6 | 32.9 | Slowest page-1 sort. Each employee's selected record and its USD value are computed before sorting. |
| Sort annual cash compensation, page 1 | Sort | same | 30,097 | 32.0 | 33.0 | Same |
| Sort name, **last page (400)** | Deep paging | `d:index` → `jt:ref` → `e:ref` | 40,072 | 31.2 | 32.5 | Offset cost: 4.7× page 1 of the same sort (6.6 ms), with 2× the rows examined. |
| Sort cash, **last page (400)** | Deep paging | same | 40,072 | 34.9 | 36.4 | Close to page 1 (32.0). The salary sort already reads everything. |
| Sort base, last page (184), Scoped | Deep paging | `d:range` → `jt:ref` → `e:ref` | 22,234 | 20.3 | 21.0 | OK |
| Employee detail `ACME05000` with history | Detail page, `get_employee_compensation` | `e:const:uk_employees_employee_code`; history `ref:idx_compensation_employee_effective` | 2 | 0.7 | 0.8 | Best case |
| Directory options, Scoped | Filter choices | `d:range` → `jt:ref` → `e:ref` + lateral | 11,112 | 11.9 | 12.2 | OK |

**Lateral join plan.** In every plan, the selected-compensation lateral join reads `compensation_records` through `uk_compensation_employee_version` (`employee_id, version`), about 1 row per lookup. The code comment names `idx_compensation_employee_effective`. MySQL chooses the unique key instead, because both start with `employee_id`.

**Cross-check with `npm run measure:directory -- --runs 25`.** This existing script runs at as-of date 2026-11-14 and reports medians, not p95 ([`measure-directory.txt`](../builder_docs/backend-builder/responses/13-evidence/measure-directory.txt)). Medians from its six scenarios:

| Scenario | Median |
|---|---:|
| default page 1 | 6.5 ms |
| exact code | 11.2 ms |
| partial name | 10.2 ms |
| scoped filters | 9.3 ms |
| base-salary sort | 30.7 ms |
| scoped cash sort, page 150 | 20.1 ms |

These agree with the table above.

## Dashboard

| Query | Serves | Statements | Access (driving) | Rows examined | p50 | p95 | Verdict |
|---|---|---:|---|---:|---:|---:|---|
| Summary, Admin | Headcount, spending, joiners, impacts, upcoming list, requests, recent count, "without" count | 8 (in parallel) | `e:ALL`, `f:ALL`, `c:ALL` + lateral; requests via `idx_ccr_status_created` | 141,160 | 47.6 | 52.7 | OK at 10k, but the heaviest call in the app. It examines 14× the employee count. |
| Summary, Scoped | same | 8 | `e:ref:idx_employees_country` / `d:range` → `e:ref` | 88,522 | 33.3 | 35.5 | OK |
| Breakdown DEPARTMENT (with median), Admin | Concentration table | 1 | `e:ALL` + lateral, window function | 8,500 | 37.7 | 38.6 | OK |
| Breakdown COUNTRY, Admin | same | 1 | same | 8,500 | 33.7 | 34.1 | OK |
| Breakdown CURRENCY, Admin | same | 1 | same | 8,500 | 34.7 | 35.1 | OK |
| Breakdown LEVEL, Admin | same | 1 | same | 8,500 | 35.6 | 37.0 | OK |
| Breakdown EMPLOYMENT_STATUS, Admin | same | 1 | same | 9,974 | 43.1 | 44.0 | OK |
| Breakdowns, Scoped (5 kinds) | same | 1 each | `e:ref:idx_employees_country` | 3,901–4,589 | 18.9–23.4 | 20.0–23.7 | OK |
| Recent changes 90 days, Admin | Recorded salary changes | 2 | `c:ALL` (`compensation_records`) | 20,134 | 2.9 | 3.1 | Fast today. It is a full scan of `compensation_records` with no `created_at` index, so it grows with history. |
| Recent changes 90 days, Scoped | same | 2 | `c:ALL` | 20,111 | 2.6 | 3.0 | same |
| Without adjustment 12 months, page 1, Admin | "No recorded adjustment" list | 2 | page `e:index:uk_employees_employee_code`; count `e:ALL` + 3 lookups per employee | 44,239 | 25.0 | 25.8 | OK. The count does most of the work (44,012 rows). |
| Without adjustment, page 1, Scoped | same | 2 | `d:range` → `e:ref` | 32,581 | 27.4 | 33.3 | OK |

Cross-check with `npm run measure:dashboard -- --runs 25 --plans` (now = 2026-11-15, medians; [`measure-dashboard.txt`](../builder_docs/backend-builder/responses/13-evidence/measure-dashboard.txt)):

| Scenario | Median |
|---|---:|
| Admin summary | 40.1 ms |
| Admin DEPARTMENT breakdown | 38.2 ms |
| Admin COUNTRY breakdown | 33.3 ms |

## Assistant tools

The tool registry is the same code path that the OpenAI loop and MCP use. Timings cover the tool only, not the model.

| Tool call | Statements | Access (driving) | Rows examined | p50 | p95 | Verdict |
|---|---:|---|---:|---:|---:|---|
| `search_employees` "sneha", limit 5, Admin | 2 | `e:ALL` | 20,069 | 10.6 | 11.3 | OK (same SQL as the directory search) |
| `search_employees`, Scoped | 2 | `e:ref:idx_employees_country` | 13,549 | 9.4 | 9.9 | OK |
| `get_employee_compensation` ACME05000, Admin | 2 | `e:const:uk_employees_employee_code` | 2 | 0.9 | 1.5 | Best case |
| `get_employee_compensation` ACME05000, Scoped (out of scope) | 1 | `EXPLAIN` lists no table access: the constant lookup finds no permitted row, and the history query is skipped | 0 | 0.4 | 0.6 | Out of scope stops at the first statement. |
| `get_top_compensated_employees` ANNUAL_CASH, USD comparison, limit 5, Admin | 1 | `e:ALL` + lateral | 35,505 | 25.1 | 26.0 | OK. It ranks every current employee in SQL and returns 5. |
| `get_top_compensated_employees` ANNUAL_BASE, INR, limit 10, Admin | 1 | same | 35,510 | 21.9 | 23.9 | OK |
| Top compensated, Scoped (both variants) | 1 | `d:range` → `e:ref` | 10,429–10,434 | 12.1–13.2 | 13.0–13.6 | OK |
| `get_recent_compensation_changes` 90 days, limit 10, Admin | 2 | `c:ALL` | 20,110 | 4.2 | 4.8 | Same scan as the dashboard recent list |
| `get_recent_compensation_changes`, Scoped | 2 | `c:ALL` | 20,097 | 3.9 | 4.4 | same |
| `get_compensation_summary` DEPARTMENT, ANNUAL_BASE, Admin | 1 | `e:ALL` + lateral | 35,510 | 21.8 | 23.0 | OK |
| `get_compensation_summary`, Scoped | 1 | `d:range` → `e:ref` | 10,426 | 11.2 | 12.1 | OK |

The assistant's turn budget is 45 s (`LIMITS.turnTimeoutMs`). The slowest tool call measured here is 26.0 ms at p95.

## AI monitoring summary and migration 008

**Earlier evidence.** From `builder_docs/ai-builder/responses/04-mcp-and-admin-observability-api.md`, quoted. The test `query plans with 10,000 traces over 90 days` showed this before migration 008, for the 30-day window:

> the status count as a full index scan: `t:index:idx_ai_traces_status`; the percentiles as a full table scan: `t:ALL:null`.

After 008, it showed:

> every summary query on `ai_traces` alone is an index range (`idx_ai_traces_summary`, or `idx_ai_traces_status` for the failure breakdown).

**Rerun of that test.** On `acme_perf_obs_test` (same container), 1 test passed. Its printed plans ([`admin-observability-query-plans.txt`](../builder_docs/backend-builder/responses/13-evidence/admin-observability-query-plans.txt)), for both 24h and 30d:

| Summary query | Access |
|---|---|
| statuses, percentiles, tokens, series | `t:range:idx_ai_traces_summary` |
| unreviewed | `t:range:idx_ai_traces_summary` + `r:eq_ref:PRIMARY` |
| failures | `t:range:idx_ai_traces_status` |
| tool calls and model calls | `t:range:idx_ai_traces_started` + child `ref` by trace key |
| MCP calls | `m:range:idx_mcp_started` |

**New before/after timing.** The full `summary()` call runs 10 statements in parallel. Data: 10,000 traces, 2026-06-01 to 2026-08-29. I dropped `idx_ai_traces_summary` to get "before", then re-added it. Each state was followed by `ANALYZE TABLE ai_traces`.

| Window | Index 008 | Statement access that differs | Rows examined | p50 | p95 |
|---|---|---|---:|---:|---:|
| 24h | present | `t:range:idx_ai_traces_summary` | 1,025 | 1.5 | 2.7 |
| 24h | dropped | `t:range:idx_ai_traces_started` | 1,025 | 1.4 | 3.7 |
| 24h | re-added | `t:range:idx_ai_traces_summary` | 1,025 | 1.0 | 1.3 |
| 7d | present | `idx_ai_traces_summary` | 7,011 | 1.9 | 2.4 |
| 7d | dropped | `idx_ai_traces_started` | 7,011 | 3.8 | 6.4 |
| 7d | re-added | `idx_ai_traces_summary` | 7,011 | 1.8 | 2.4 |
| **30d** | **present** | statuses, percentiles, tokens, series, unreviewed: `t:range:idx_ai_traces_summary` | **30,056** | 6.4 | 11.6 |
| **30d** | **dropped** | statuses `t:index:idx_ai_traces_status` (full index scan); percentiles and tokens `t:ALL` (full table scan) | **56,712** | 6.0 | 8.1 |
| **30d** | **re-added** | back to `t:range:idx_ai_traces_summary` | **30,056** | 5.9 | 6.9 |

**Verdict.** The rerun reproduces the plan difference the AI builder recorded: without 008, the 30-day window falls back to full scans and examines 1.9× the rows. The wall-time effect at 10,000 traces is small and not consistent:

- 7d: p50 was 1.8–1.9 ms with the index and 3.8 ms without it.
- 30d: p50 was 5.9–6.4 ms with the index and 6.0 ms without it. The spread between runs of the same state is as large as that difference.

Each state was measured once (30 runs). The index removes the scans that would grow with table size. Retention keeps the table to about 30 days of traces.

## Seed

`db:seed -- --replace` loads 10,000 employees and 10,000 compensation records. Wall time of the whole process (`/usr/bin/time -p`, Node startup and workbook read included):

| Command | Runs |
|---|---|
| `npm run db:seed` (tsx) | 1.25 s, 1.32 s, 1.29 s |
| `node dist/scripts/seed-database.js` | 1.20 s, 1.09 s, 1.04 s, 1.06 s, 1.03 s |

Related timings:

- `eval:oracle-fixtures --apply`: wall time not captured (my output filter cut that line); CPU user time 0.41 s.
- `demo:scenario --apply`: 0.70 s wall.

## Known risks

### Stale statistics after a bulk load (measured)

On a fresh database (`acme_perf_suite_test`: migrate, one seed, then measure immediately), the dashboard ran far slower until statistics were refreshed ([`stale-statistics-fresh-seed.txt`](../builder_docs/backend-builder/responses/13-evidence/stale-statistics-fresh-seed.txt), [`stale-statistics-after-analyze.txt`](../builder_docs/backend-builder/responses/13-evidence/stale-statistics-after-analyze.txt)). Both columns are medians over 5 runs.

| Scenario | Right after seed | After `ANALYZE TABLE compensation_records, employees` |
|---|---:|---:|
| Admin summary | 10,190.0 ms (slowest 10,397.1) | 42.3 ms |
| Admin DEPARTMENT breakdown | 8,850.7 ms | 37.2 ms |
| Admin COUNTRY breakdown | 8,349.4 ms | 34.6 ms |

This matches the about 11 s already documented in `builder_docs/responses/10-dashboard-analytics-api.md` (11,874.8 ms) and `11b-backend-final-review-fixes.md`. There, the plan showed `Table scan on c … loops=10000` inside the lateral join.

On `acme_perf_test`, which had five consecutive seeds plus the fixture writes before measuring, the slowdown did **not** occur: the first run's Admin summary median was 45.9 ms. I did not determine what refreshed the statistics there. Nothing in the code runs `ANALYZE TABLE` today, and no hook was added (decision 1 in 11b is still open).

### Other measured risks

- **Search cannot use the unique indexes.** Exact code and exact email go through the same `OR` condition as name search, so both scan the table (`e:ALL`, about 20k rows examined).
- **Deep offset pages cost more.** Name sort, page 400: 31.2 ms, against 6.6 ms for page 1.
- **Recent changes scan the history table.** Both the dashboard and the tool read every compensation record (`c:ALL`).
- **The dashboard summary is the heaviest call.** It examines 141k rows per Admin call.

### At 10× (100,000 employees) — what I would do

These are actions, not predictions. Nothing was measured at 10×.

1. Run `ANALYZE TABLE employees, compensation_records` at the end of the seed and any bulk import. This is the measured fix above.
2. Add exact-match fast paths: when the search text is a full employee code or an email, query `uk_employees_employee_code` / `uk_employees_email` alone.
3. Replace `LIKE '%…%'` name search with a prefix match on indexed name columns, or a FULLTEXT (ngram) index.
4. Use keyset pagination (`WHERE (sort_key, employee_code) > (?, ?)`) for deep pages, and cache or approximate totals instead of counting on every page.
5. Store the selected compensation per employee: for example a `current_compensation_record_id` column kept in the same transaction as each salary write, or a summary table. This removes the per-employee lateral join from the dashboard, the breakdowns, the top-N tools, and salary sorting.
6. Index `compensation_records (created_at)`, or `(change_reason, created_at)`, for recent changes.
7. Cache the dashboard summary per scope for a short time, and invalidate it on salary writes.
8. For AI traces, keep the 30-day retention running on a schedule. Consider monthly partitions on `started_at` if traces outgrow that.

## Design choices that exist for performance

| Choice | Where |
|---|---|
| Offset pagination (`LIMIT ? OFFSET ?`); page size default 25, max 100 | `express-backend/src/directory/directory-repository.ts` (`buildListQueries`), `src/http/contract.ts` (`DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`); the dashboard lists use `DASHBOARD_LIST_MAX_PAGE_SIZE` = 100 |
| Sorting, `LIMIT`, and `OFFSET` in MySQL; Node maps only the page | `directory-repository.ts` header comment |
| One selected compensation record per employee by `LEFT JOIN LATERAL … LIMIT 1` | `SELECTED_COMPENSATION` in `directory-repository.ts`; reused by `src/assistant/compensation-insights.ts` |
| The count query skips the lateral join unless the currency filter needs it | `needsCompensation` in `directory-repository.ts` |
| Scope as a SQL `WHERE` condition (it also narrows the scan for Scoped HR) | `scopeCondition` in `directory-repository.ts` |
| Indexes `idx_compensation_employee_effective`, `uk_compensation_employee_version`, `uk_employees_employee_code`, `uk_employees_email`, `idx_employees_country`, `idx_employees_job_title`, `uk_job_titles_department_name_level` | `db/migrations/001_initial_schema.sql` |
| `idx_ccr_status_created`, `idx_ccr_employee_status`, one-pending unique key | `db/migrations/003_salary_adjustments.sql` |
| AI trace indexes (`idx_ai_traces_started`, `_status`, `_actor`, `_model`, `_error`, MCP `idx_mcp_started`) | `db/migrations/005_ai_observability.sql` |
| Covering summary index `idx_ai_traces_summary` | `db/migrations/008_ai_trace_summary_index.sql` |
| Dashboard summary and AI summary send their statements in parallel (`Promise.all`) | `src/dashboard/dashboard-service.ts`, `src/assistant/observability/admin-repository.ts` |
| Percentiles and medians computed in SQL with window functions | `admin-repository.ts` (`summary`), `dashboard-service.ts` (breakdowns) |
| Bounded tool results: search ≤ 10 (default 5), top ≤ 10 (default 5), recent ≤ 20 (default 10), days ≤ 365 | `src/assistant/tool-schemas.ts` |
| Bounded assistant turn: 4 tool rounds, 4 calls per round, 24,000-character tool output, 4,000-character answer, 8 cards, 45 s deadline | `LIMITS` in `src/assistant/assistant-service.ts` |
| Bounded conversation history sent to the model: last 4 turns, 16,000 characters | `HISTORY_POLICY` in `src/assistant/conversation-service.ts` |
| Dashboard upcoming list capped at 10 | `UPCOMING_LIST_LIMIT` in `dashboard-service.ts` |
| 10 kB JSON body limit | `JSON_BODY_LIMIT` in `src/http/app.ts` |
| Seed: one transaction, batch inserts of 1,000 rows | `DEFAULT_BATCH_SIZE` in `src/seed/replace-employees.ts` |
| Exchange rate loaded once at startup, not per request | `src/server.ts` |
| One MySQL pool per process | `src/server.ts`, `src/db/connection.ts` |
| 30-day AI retention command (keeps trace tables small) | `scripts/ai-retention.ts`, `src/assistant/observability/retention.ts` |
