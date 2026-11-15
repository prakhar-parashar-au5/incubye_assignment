# Code review: Employee directory API

**Task:** 07, Employee directory API  
**Builder response:** `builder_docs/responses/07-employee-directory-api.md`  
**Review status:** Approved. The current version uses one organization-wide UTC business date.

## Scope reviewed

The review covered:

- Employee list endpoint.
- Employee detail endpoint.
- Permission-filtered directory options.
- Search, filters, sorting, and pagination.
- Compensation-state selection.
- Compensation history.
- Cross-currency salary comparison.
- Saved exchange-rate evidence.
- Exact money arithmetic.
- OpenAPI updates.
- Request logging.
- Tests and measured query plans.

## Independent checks

The planner ran:

```text
npm run check
npm run build
DATABASE_URL=<local test database> npm run test:db
```

Observed results:

```text
Lint: passed
Type check: passed
Fast tests: 284 passed
MySQL tests: 174 passed
Production build: passed
```

The MySQL test run took about 221 seconds during this review. The tests passed. Another active agent was probably using the same test database. This supports the existing rule that database suites require exclusive use of the shared test database.

## Correct behavior verified

### Authorization

- Admin HR can access all employees.
- Scoped HR access uses country AND department.
- Scope is applied inside SQL before pagination and counting.
- Search and filter options do not reveal hidden employees.
- Unknown, malformed, and inaccessible employee codes use the same public 404 response.
- Compensation history is loaded only after the scoped employee query succeeds.

### Query safety

- Query values use SQL parameters.
- Sort fields map through fixed allowlists.
- Search escapes `%`, `_`, and backslash for literal matching.
- Invalid and repeated query parameters fail runtime validation.
- Limit and offset run in MySQL.
- Application code receives only the requested page.

### Compensation selection

- Currently working employees use the latest effective record on or before the as-of date.
- Soon-to-join employees use the earliest future record.
- Employees who left use the latest record on or before the end date.
- Higher version wins when two records have the same effective date.
- Detail history uses effective-date and version order.

### Money and currency

- Native salary remains authoritative.
- Salary and bonus remain exact decimal strings.
- Annual cash compensation uses exact BigInt minor-unit arithmetic.
- INR-to-USD display conversion uses BigInt and half-up rounding.
- Cross-currency sorting happens in MySQL before pagination.
- Sorting uses the unrounded converted value.
- No converted salary column was added to employee or compensation tables.
- Missing INR rate rejects cross-currency salary sorting.

### Exchange-rate evidence

Saved snapshot:

```text
Source: Board of Governors of the Federal Reserve System, H.10
Rate: 1 USD = 93.9100 INR
Effective date: 2026-11-06
Dated release: 2026-11-09
```

The planner independently checked the dated [Federal Reserve H.10 release](https://www.federalreserve.gov/releases/h10/20261109/). The India row contains `93.9100` in the latest column.

Content was rephrased for compliance with licensing restrictions.

### Logging

- Matched routes log route patterns instead of employee IDs.
- Query strings are not logged.
- Unmatched paths use `UNMATCHED`.
- Tests check for employee identity, salary, token, SQL, and parameter leakage.

## Performance evidence

Builder measurements on 10,000 seeded employees:

| Query | Approximate local time |
|---|---:|
| Default first page | 7 ms |
| Exact employee-code search | 10 ms |
| Partial name search | 9 ms |
| Admin salary sort across 10,000 rows | 29 ms |
| Scoped deep salary page | 19 ms |

These are local measurements. They are not production service-level targets.

No additional index was added. The measured table size and query times do not justify one yet. Leading-wildcard name search and computed currency sorting cannot use a normal B-tree index for their complete order.

## Accepted implementation decisions

- Currency filtering uses the selected compensation-record currency.
- Missing exchange rate uses the existing validation error.
- Server startup continues when the rate fixture is unavailable. Native directory operations continue, while cross-currency sorting is unavailable.
- Name sorting uses first name and then last name.
- The options endpoint returns supported sort fields and comparison currencies.
- Offset pagination is acceptable for the current 10,000-row data set.

## Product decision

### Compensation business date

The implementation uses the UTC calendar date to classify compensation as current or upcoming.

At some times, an employee's local date differs from UTC. The current employee model does not contain a payroll time zone, and the United States contains multiple time zones.

Current policy:

> Compensation effective dates use one organization-wide UTC business date.

This policy is simple, deterministic, and consistent with the current data model. Country-specific or employee-specific payroll time zones can be added later if the product requires them.

## Known limitations

- Partial-name search scans the current 10,000-row table.
- Computed salary sorting grows linearly with the permitted employee count.
- The saved exchange rate has no refresh process.
- An employee can have no selected compensation if employment status and effective dates become inconsistent.
- UTC can differ from the employee's local calendar date.
- Unmatched route logging protects identity but gives less diagnostic path detail.
- Database tests share one database and must not run concurrently with another destructive suite.

## Verdict

**Approved.**

No confirmed code defect blocks the task. The current version uses one organization-wide UTC business date and records local-time activation as a known limitation.
