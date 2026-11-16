# Backend Task 10: Compensation dashboard analytics API

**Status:** READY AFTER TASK 09 IS COMMITTED

## Goal

Implement the permission-aware dashboard analytics defined in:

```text
docs_human/10-compensation-dashboard.md
```

Do not modify salary-adjustment behavior.

## Read first

- `docs_human/10-compensation-dashboard.md`
- `docs_human/11-salary-adjustments.md`
- `docs/16-employee-directory-api-design.md`
- `docs/18-review-findings-and-decisions.md`
- `builder_docs/responses/09-salary-adjustments-backend.md`
- `builder_docs/responses/09-salary-adjustments-backend-fix.md`
- `builder_docs/frontend-builder/responses/04a-dashboard-shape.md`

## Proposed endpoints

```text
GET /api/v1/dashboard/summary
GET /api/v1/dashboard/breakdowns
GET /api/v1/dashboard/recent-changes
GET /api/v1/dashboard/without-recent-adjustment
```

Use a small number of endpoints that the dashboard can request in parallel. If a different split is simpler, explain it before implementation without changing product behavior.

## Filters

Support the compatible subset of:

```text
department
country
currency
level
employmentStatus
periodDays
breakdown
page
pageSize
```

Validate with strict Zod schemas. Reject repeated, unknown, or unsupported values. Filters must narrow current HR scope and never widen it.

## Required results

### Summary

- Currently working count.
- Soon-to-join count.
- Left count.
- Annual base and annual cash totals by native currency.
- Upcoming approved compensation commitment by native currency.
- Pending request count.
- Stale request count.
- Recent recorded change count.
- Count without recorded adjustment in the selected period.
- Optional USD comparison with full rate context.

### Breakdowns

Support department, country, currency, level, and employment status.

Where meaningful, return count, total annual base, total annual cash, average, median, minimum, and maximum. Keep native currency groups separate.

### Recent changes

Use `compensation_records.created_at`, not effective date. Exclude `INITIAL_IMPORT`. Include future-effective changes recorded in the period. Return a bounded paginated list.

### Without recent adjustment

Use currently working employees only. Initial import is not an adjustment. Return count plus a paginated list. Wording and API context must not claim knowledge before the initial import.

## Money and currency

- Use exact DECIMAL SQL and existing exact-money helpers.
- Never add INR and USD natively.
- USD comparison is informational.
- Include rate, quote direction, source, URL, and effective date.
- If the rate is absent, return native results and mark USD comparison unavailable.
- Do not fail the complete dashboard because optional conversion is unavailable.

## Permissions

Apply current scope to every count, total, average, median, min, max, request count, recent-change row, and employee list.

Admin sees all permitted data. Scoped HR uses country IN list AND department IN list. Empty scope returns empty results.

Do not filter after aggregation or pagination.

## SQL and performance

Run aggregates in MySQL. Do not load 10,000 employees into Node.js to calculate dashboard values.

Use raw SQL and `mysql2`; no ORM.

Median must be deterministic for odd and even group sizes. Add small fixture tests with hand-calculated expected values.

Measure summary, breakdown, median, recent-change, no-adjustment, and Scoped HR variants against 10,000 rows. Add indexes only when plans show a need.

Do not add caching in this task.

## Tests

Implement the tests from the human specification, including:

- Active, upcoming, and left counts.
- Current spending status rules.
- Native currency separation.
- Exact average and median.
- Missing exchange rate degradation.
- Recent changes by creation time.
- Initial import exclusion.
- No-adjustment wording and count.
- Pending and stale requests.
- Scoped HR on every metric.
- Empty scope.
- Filters cannot widen scope.
- Strict query validation.
- No internal IDs or sensitive logs.
- OpenAPI drift.
- Query plans and measured timings.

Use real MySQL for aggregate and permission behavior.

## Scope limits

Do not build frontend dashboard code, caching, custom reports, live rates, predictions, payroll, tax, pay-equity conclusions, AI changes, or HR access APIs.

Never read `.env` files. Do not run Git commands.

## Response

Write:

```text
builder_docs/responses/10-dashboard-analytics-api.md
```

Include endpoint design, SQL strategy, median method, permission proof, query plans, timings, tests, actual failures, known limits, and confirmation that no Git or frontend work ran.
