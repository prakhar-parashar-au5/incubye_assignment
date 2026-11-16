# Response 10: Compensation dashboard analytics API

**Task:** `builder_docs/parent_instructions/10-dashboard-analytics-api.md`

**Checkpoint caveat:** the task status is "READY AFTER TASK 09 IS COMMITTED". I cannot verify that without Git, so I built on the working tree as it stands (Task 09 and 09a included).

**Result:**
- Four read-only endpoints. All aggregation runs in MySQL with raw SQL through `mysql2`.
- Money is exact. There is no caching. No frontend or salary-adjustment code changed.
- `npm run check`: 373 pass. `npm run build`: exit 0. `npm run test:db`: 282 pass.

## 1. Endpoint design

| Method and path | `operationId` | Purpose |
|---|---|---|
| `GET /api/v1/dashboard/summary` | `getDashboardSummary` | Headcount, current spending, upcoming commitment (with the 10 soonest upcoming changes), request counts, recent-change count, without-adjustment count, USD comparison |
| `GET /api/v1/dashboard/breakdowns` | `getDashboardBreakdown` | One breakdown per call |
| `GET /api/v1/dashboard/recent-changes` | `getDashboardRecentChanges` | Paginated recent changes |
| `GET /api/v1/dashboard/without-recent-adjustment` | `getDashboardWithoutRecentAdjustment` | Paginated list of working employees without an adjustment |

All four require a Bearer token. The dashboard can request them in parallel, and one section can fail without hiding the others. I kept the proposed split, with two deviations:
- **Upcoming changes are inside the summary.** They form part of the commitment figure (at most 10 items, plus `total`), so I added no fifth endpoint.
- **No separate options endpoint.** The dashboard filters are the directory filters, so the frontend reuses `GET /api/v1/employee-directory/options`, which is already permission-filtered.

**Shared envelope on every response:**
- `asOf`: the UTC business date.
- `generatedAt`.
- `access`: `{ hasEmployeeAccess, message, scope: { kind: ALL|SCOPED, countries, departments } }`.
- `filters`: the applied filter values, with `null` for unset filters.

### Query parameters (strict Zod)

| Parameter | Values | Default | Endpoints |
|---|---|---|---|
| `department`, `country`, `currency`, `level`, `employmentStatus` | Same enums as the directory | none | all |
| `periodDays` | `7`, `30`, `90` | `30` | summary, recent-changes |
| `noAdjustmentMonths` | `3`, `6`, `12`, `24` | `12` | summary, without-recent-adjustment |
| `breakdown` | `DEPARTMENT`, `COUNTRY`, `CURRENCY`, `LEVEL`, `EMPLOYMENT_STATUS` | `DEPARTMENT` | breakdowns |
| `page`, `pageSize` | positive integer; `pageSize` at most 100 | 1, 25 | the two list endpoints |

- Unknown keys, repeated keys (which arrive as arrays), values outside an enum, and parameters that do not belong to the endpoint all return `400 VALIDATION_ERROR`.
- The status parameter is named `employmentStatus` to match the API field. The frontend brief used `status` and `recentDays`, so the frontend must map its URL names to these.
- `currency` filters the currency of the record each section reads:
  - selected compensation (`sc.currency`) for spending, breakdowns, and without-adjustment;
  - the new record (`c.currency`) for recent changes;
  - the request (`r.currency`) for request counts;
  - the future record (`f.currency`) for upcoming changes.

### Filter applicability

Every section returns `notApplied: [{ filter, reason }]`, so no filter is ignored silently. Current spending, the without-adjustment list, and the non-status breakdowns cover currently working employees only. When `employmentStatus` is `SOON_TO_JOIN` or `LEFT`, those sections return 0 rows and report `{ filter: "employmentStatus", reason: "This section includes currently working employees only." }`. Headcount, requests, recent changes, upcoming commitment, and the status breakdown apply every filter.

### Answers to the frontend questions (04a, section 18)

| # | Answer |
|---|---|
| D1 | Several endpoints. Paths and `operationId`s are in the table above. |
| D2 | Yes. `asOf` is the UTC business date and appears on every response, together with `generatedAt`. |
| D3 | `figures.headcount` gives counts by status. `figures.currentSpending.byCurrency[]` gives `{ currency, employeeCount, annualBaseSalary, annualCashCompensation, usdEquivalent }` for `CURRENTLY_WORKING`. `figures.upcomingCommitment.byCurrency[]` is defined in section 5. The summary also has `requests.{pending, stale}`, `recentChanges.count`, and `withoutRecentAdjustment.count`. Money values are exact decimal strings and each row carries its currency. |
| D4 | Reuse `/employee-directory/options`. The period option lists are published as enums in OpenAPI. |
| D5 | Same enums as the directory. The names are `employmentStatus`, `periodDays`, and `noAdjustmentMonths`. A repeated parameter returns `400 VALIDATION_ERROR`. |
| D6 | Yes. Every section has `notApplied` with a reason (see above). Applied filters are echoed in `filters`. |
| D7 | Each group in each currency has `employeeCount`, `annualBaseSalary`, `annualCashCompensation`, and the average, median, minimum, and maximum of annual cash. Average and median round half-up to cents. `basis` is `CURRENT_SPENDING`, `FUTURE_COMMITMENT` (soon to join), or `COUNT_ONLY` (left: all money fields are `null`). `group` holds the code (department name, ISO country code, currency, level, or status enum). `label` holds the display text: the country name, a title-case level, or "Soon to join", "Currently working", "Left". |
| D8 | Each currency row and group has `usdEquivalent: { annualBaseSalary, annualCashCompensation }`, or `null`. `usdComparison` holds `{ available, unavailableReason, exchangeRate (full ExchangeRateContext), quoteDescription, disclaimer }`. When no rate is saved: `available: false`, `exchangeRate: null`, every `usdEquivalent` is `null`, the native figures are unchanged, and the status is 200. |
| D9 | Recent changes: 7, 30, or 90 days. Without adjustment: 3, 6, 12, or 24 months. **I chose the 3, 6, and 24 options**, because the spec names only 12. Both windows are measured back from the current time, as in the 08a recent changes: `created_at` in (now − period, now]. |
| D10 | **Recent changes:** `employee{employeeCode, name, department, country}`, `currency`, `previous` (or `null`), `new` (base, bonus, cash), `changeReason`, `recordedAt`, `effectiveFrom`, `effectiveInFuture`, `changedBy.displayName`, `requestId`. Ordered newest first, with `page{number, size, totalRows, totalPages}`. **Upcoming changes:** the same kind of fields, with `scheduled` in place of `new`, plus `approvedBy` and the employee's status. Soonest `effectiveFrom` first, at most 10, plus `total`. **Without adjustment:** the employee with `level`, `currency`, base, cash, and `lastRecordedAdjustmentAt` (or `null`), plus `page`. **Request summary:** counts only. For oldest pending or recent stale requests, call `GET /api/v1/salary-adjustment-requests` (a second call). |
| D11 | Filters that match nothing return zero counts and empty arrays. An empty scope returns a distinct result: `access.hasEmployeeAccess: false`, `message: "Your HR account has no employee access."`, `figures: null` on the summary, and empty `groups`, `changes`, or `employees` on the other endpoints. |
| D12 | Yes. `requestId` (the public UUID) is returned to Scoped HR, because the rows are already limited to their scope and they can view those requests. |
| D13 | `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `500 INTERNAL_ERROR`, `503 SERVICE_UNAVAILABLE` (database unavailable). There is no rate limit. For latency, see section 7: on 10,000 employees, the median is about 45 ms for the Admin summary and 25 ms for without-adjustment. |
| D14 | Missing rate: the API reads the saved rate file through the existing `exchangeRate` dependency. The DB tests inject `null`. Against a running server there is no flag; it needs the rate file absent. Seed data has **no** non-import changes, requests, or future changes (see section 10). |

## 2. SQL strategy

- **Selected compensation record.** This uses the same status rule as the directory, as a `LEFT JOIN LATERAL (... ORDER BY ... LIMIT 1)` per employee through `uk_compensation_employee_version`:
  - currently working: the latest record with `effective_from <= asOf`;
  - soon to join: the earliest future record;
  - left: the latest record on or before the end date.
- **Scope and filters are SQL predicates.** The scope is `e.country_code IN (...) AND d.name IN (...)` and goes in the `WHERE` clause of each statement, before `GROUP BY`, `COUNT`, window functions, and `LIMIT`/`OFFSET`. No statement filters after aggregation or pagination.
- **The summary runs 8 statements in parallel:** headcount, spending, soon-to-join commitment, approved future changes (aggregate and top 10), upcoming total, requests, recent count, and without-adjustment count. A test bounds this at 10 statements and asserts that no statement returns per-employee rows for the aggregates.
- **Money.** Sums use SQL `SUM` over `DECIMAL(14,2)`. Values are read as strings and never converted to JS floats. Signed commitment arithmetic uses new BigInt helpers in `src/money/decimal.ts`: `parseSignedMoney`, `formatSignedMoney`, and `addSignedMoney`. USD equivalents use the existing exact conversion from Task 07, once per currency group. The summary's USD total is the sum of the rounded per-currency equivalents.
- **Recent changes:** `c.created_at > now − periodDays AND c.created_at <= now AND c.change_reason <> 'INITIAL_IMPORT'`. Ordered `created_at DESC, id DESC`, with `LIMIT`/`OFFSET`. The previous record comes from a lateral lookup on `version < c.version`. A future-effective change recorded in the period is included and flagged `effectiveInFuture`.
- **Without adjustment:** currently working employees with `NOT EXISTS` a non-import record whose `created_at` is in `(DATE_SUB(now, INTERVAL ? MONTH), now]`. `lastRecordedAdjustmentAt` is the latest non-import `created_at` up to now, or `null`. The wording is the constant `NO_ADJUSTMENT_DEFINITION`: "No recorded salary adjustment since import or during the selected period." It makes no claim about anything before the import.
- **Requests:** `COUNT(*) ... WHERE status IN ('PENDING','STALE') GROUP BY status`, joined to employees so the scope applies.
- **Errors:** pool and connection errors (`ECONNREFUSED`, `PROTOCOL_CONNECTION_LOST`, lock wait timeout, and similar) map to `503 SERVICE_UNAVAILABLE` in `dashboard-routes.ts`.

## 3. Median method

Per group and currency, in SQL:

```sql
ROW_NUMBER() OVER (PARTITION BY grp, currency ORDER BY cash) AS rn,
COUNT(*)     OVER (PARTITION BY grp, currency)                     AS n
...
SUM(CASE WHEN rn IN (FLOOR((n+1)/2), FLOOR((n+2)/2)) THEN cash END) AS mid_sum,
COUNT(CASE WHEN rn IN (FLOOR((n+1)/2), FLOOR((n+2)/2)) THEN 1 END)  AS mid_count
```

- For odd `n`, both positions are the same row, so the median is that value.
- For even `n`, it is the two middle rows.
- `mid_sum / mid_count` and `total / count` are divided in BigInt by the existing `averageMoney`, rounding half-up to cents.
- Ties in `cash` can swap row numbers between runs, but tied rows hold equal values, so the median value stays the same.

The fixture verifies an odd group (Tech median 1200000.00), an even group (Rohan's India median 1150000.00), an average that needs rounding (1203333.33), and a half-cent case (Finance average and median 142500.01).

## 4. Permission proof

Tested against real MySQL with fixture employees ACME00301–ACME00312 and NOW = 2026-11-15T10:00Z:
- **Rohan (Scoped HR: India; Tech and Support)** sees only in-scope employees on every metric: headcount, spending, commitment, upcoming list, pending and stale counts, recent-change count and rows, without-adjustment count and rows, and every breakdown group. The test also checks that no USD currency row or out-of-scope employee code appears anywhere in his responses.
- **Empty scope:** `hasEmployeeAccess: false`, the no-access message, `figures: null`, and empty lists on all four endpoints.
- **No widening:** Rohan with `country=US` or `department=Finance` gets zeros and empty lists, not US or Finance data. For Admin, filters narrow each compatible metric.
- **Before aggregation:** the scope is in each statement's `WHERE` clause (section 2). The fixture includes out-of-scope rows that would change the counts, sums, and medians if the scope were applied later.

## 5. Upcoming commitment definition

Per native currency:

```text
totalAnnualCashCommitment =
    Σ annual cash of SOON_TO_JOIN employees (their selected future record)
  + Σ (scheduled − current) annual cash of approved future records for CURRENTLY_WORKING employees
```

- The second term is signed, because a scheduled decrease reduces the commitment.
- Left employees contribute nothing.
- The definition text is returned in `upcomingCommitment.definition`.
- Fixture values: INR 1110000.00, USD 127000.00.
- This is my reading of the human spec's "upcoming approved compensation commitment". If product means "new annual amounts" rather than "deltas", this formula changes (see open decisions).

## 6. USD handling

- Never added natively. Each currency row and group converts separately, and there is no total row across currencies.
- Rate context comes from the Task 07 saved rate: Fed H.10, 93.9100 INR per USD, effective 2026-11-06, with source name and URL. `quoteDescription` reads "1 USD = 93.9100 INR (INR per one US dollar)".
- With no rate: native figures, `available: false`, and the reason "USD comparison is unavailable: no saved exchange rate. Native totals are unaffected." The status is still 200.

## 7. Query plans and timings

**Data:** I reseeded `acme_test` with `APP_ENV=development npm run db:seed -- --replace`, then added measurement rows:
- about 850 `PERFORMANCE` changes recorded 0–119 days before 2026-11-15 (employees with id % 10 = 0);
- about 169 approved future `MARKET_ADJUSTMENT` changes, recorded 2026-11-10 and effective 2026-12-01.

This gives 10,000 employees, 11,019 compensation records (1,019 non-import), and 0 requests, on MySQL 8.4.13. The script is `npm run measure:dashboard` (`scripts/measure-dashboard.ts`). The `EXPLAIN ANALYZE` output is saved at `builder_docs/responses/10-dashboard-measurements.txt`.

The later `test:db` run reset `acme_test`, so the measurement rows are gone.

> **Correction (review fix 11b).** The saved `10-dashboard-measurements.txt` is the `--plans` run with `--runs 3`; its timing lines say "over 3 runs". The fifteen-run figures in the table below came from two separate runs without `--plans`. Their outputs were written only to `/tmp` and were not saved in the workspace, so this report's evidence did not match its claim. Those two outputs are now saved unchanged in `10-dashboard-timings-15-runs.txt`. Fresh fifteen-run measurements after the 11b commitment fix are in `11b-dashboard-measurements.txt`.

**Timings,** 15 runs each, median / slowest in ms, across two clean runs (outputs: `10-dashboard-timings-15-runs.txt`):

| Query | Admin | Scoped HR |
|---|---|---|
| Summary (8 statements) | 43.4 / 50.8; 42.7 / 55.7 | 35.5 / 38.4; 35.7 / 37.9 |
| Breakdown, department (median) | ~37.5 / 41 | ~21 / 23.8 |
| Breakdown, country | ~33.3 / 34.5 | ~19.2 / 22 |
| Breakdown, currency | ~34.8 / 37.8 | ~19.5 / 26.7 |
| Recent changes, 90 days | ~3.6 / 5 | ~3.7 / 5.7 |
| Without adjustment, 12 months | ~25.3 / 26.9 | ~23 / 53.5 |

**Plans:**
- **Summary.** Statements 1, 2, and 8 (headcount, spending, without-adjustment) cost about 30–37 ms each. Each runs one lateral lookup per employee through `Index lookup on c using uk_compensation_employee_version`, at about 2 µs per loop for 10,000 loops.
- **Breakdowns.** The selection is the same, plus a window sort over about 8,500 working rows.
- **Recent changes.** A table scan of `compensation_records` (11,019 rows, about 2 ms), then a sort limited to the page.

**One outlier.** On the first measurement run, one Admin summary took **11,874.8 ms**. Its plan used `Table scan on c` inside the lateral subquery with loops = 10,000 (15.5 s in the `EXPLAIN ANALYZE`). This happened immediately after the bulk INSERT, so stale table statistics are the likely cause. On the second plan run, the same query used the unique index and the outlier did not recur. I did not run `ANALYZE TABLE` deliberately, so stale statistics remain the most likely explanation, not a proven one.

**No index added.** The hot paths already use `uk_compensation_employee_version`. The only scan is about 2 ms. An index on `created_at` would help recent changes only at much larger record counts.

## 8. Tests

**`test/db/dashboard.test.ts` (19 tests, real MySQL, hand-calculated fixture):**
- **Summary:** Admin figures match the fixture (counts; INR base 8100000.00 and cash 8270000.00 for 7 employees; USD base 280000.00 and cash 285000.01; commitment; pending 2; stale 1; recent 2; without adjustment 5). Rohan is checked on every metric. Also: empty scope; filters narrow and cannot widen; status filter applied or reported; missing rate degrades; the periods change only the time-based figures.
- **Breakdowns:** exact sums, half-up average, odd and even medians; an even INR group; currency and level kept separate; status basis (`CURRENT_SPENDING`, `FUTURE_COMMITMENT`, `COUNT_ONLY`); a non-working status filter reported.
- **Recent changes:** filtered by `created_at` rather than effective date; newest first; previous and new compensation; `INITIAL_IMPORT` excluded; future-effective change included; 7 and 90 days; pagination; Rohan's rows.
- **Without adjustment:** working employees only; count equals the list total; exact wording.
- **Validation, privacy, logging:** strict queries on every endpoint (unknown, repeated, out-of-enum, wrong-endpoint parameters); no internal IDs, keys, or notes in responses; logs contain route patterns only; bounded statement count with no per-employee fetch.

**Other changes:**
- `test/money.test.ts`: +1 test for signed addition.
- `test/http-openapi.test.ts`: the endpoint list now has 21 endpoints; a new test checks the dashboard operations (Bearer auth, exact parameters, schemas); the drift test passes against the regenerated `openapi/openapi.json`.
- `test/support/http.ts`: added `fakeDashboard()`. Five existing app tests pass it as the new dependency.

**Defects these tests detect:** filtering by effective date instead of creation date, counting imports as adjustments, summing INR with USD, float rounding, applying the scope after aggregation, widening the scope through filters, ignoring a filter silently, failing the dashboard when the rate is missing, leaking internal IDs, and OpenAPI drift.

## 9. Actual failures observed

- `dashboard.test.ts` against the stub service: **19 of 19 failed**.
- `money.test.ts` before the helper existed: `SyntaxError: ... does not provide an export named 'addSignedMoney'`.
- `http-openapi.test.ts` before the OpenAPI work: **3 failed** (endpoint list, dashboard operations, drift).
- First run against the real service: **2 failed**. Both were mistakes in my tests, not in the code:
  - The Rohan "no USD" regex `/...USD"/` matched `"baseCurrency":"USD"` in the rate context. I narrowed it to `"currency":"USD"`.
  - The privacy walk bans keys ending in `note`, and it flagged `usdComparison.note`. I renamed the field to `disclaimer`. The ban stays.
- Before the first run, I changed two things in my own test: the ACME00310 v2 `created_at` (2024 → 2025-06-01) so that the 12-month and 24-month windows differ, and the statement-count bound (8 → 10).

## 10. Commands and results

```text
npm run check                                              373 pass, 0 fail
npm run build                                              exit 0
DATABASE_URL=mysql://acme:…@127.0.0.1:3317/acme_test npm run test:db    282 pass, 0 fail
npm run measure:dashboard  (acme_test, measurement data)   section 7
```

## 11. Known limits

- The `noAdjustmentMonths` options 3, 6, and 24 are my choice. The spec names only 12.
- The summary's USD spending total is a sum of rounded per-currency equivalents, so it can differ by a cent from converting the unrounded total.
- No dashboard options endpoint; the frontend reuses the directory options.
- The seed has no non-import changes, requests, or future changes, so recent changes, upcoming commitment, and request counts are empty against seeded data. Browser tests need fixture data (D14).
- Plans can degrade after bulk loads until MySQL refreshes its statistics (the 11.9 s outlier). Consider running `ANALYZE TABLE` after bulk imports.
- The measurement data lived in `acme_test` only, and `test:db` has since reset it. The script and saved plans make the measurement repeatable.
- No caching (as instructed). Each request recomputes, at about 45 ms per Admin summary on 10,000 rows.

## 12. Open decisions

1. **Commitment formula:** deltas for working employees plus full cash for joiners (implemented), or full new annual amounts?
2. **No-adjustment period options** beyond 12 months.
3. **Seed activity data** for browser tests: a separate fixture task, or extend the seed?
4. **Frontend:** regenerate types from `openapi/openapi.json`, and map `status` → `employmentStatus` and `recentDays` → `periodDays`.

## 13. Confirmations

- No Git commands ran.
- No frontend files changed.
- No `.env` file was read.
- No caching was added.
- Salary-adjustment behaviour is unchanged. The only shared file touched is `src/money/decimal.ts`, which gained new exports; no existing function changed.
- `docs_human/` and `docs/` were not edited.
