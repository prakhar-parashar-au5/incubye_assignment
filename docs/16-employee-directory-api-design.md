# Employee directory API design

**Status:** Approved design. Implementation waits for authentication API acceptance.

## Goal

Let an authenticated HR user search and inspect 10,000 employees without loading the complete data set into the application process.

Every query, count, filter option, compensation value, and history record must follow the current HR access scope.

## Endpoints

```http
GET /api/v1/employees
GET /api/v1/employees/:employeeCode
GET /api/v1/employee-directory/options
```

All three endpoints require Bearer authentication.

## Directory query

Supported query fields:

```text
q
department
country
currency
level
status
sort
direction
page
pageSize
comparisonCurrency
```

Defaults:

```text
page = 1
pageSize = 25
sort = name
direction = asc
```

Maximum page size is 100.

Reject invalid and repeated single-value parameters with the standard validation error.

## Search

Search supports:

- Exact and prefix employee-code matching.
- Case-insensitive partial first-name matching.
- Case-insensitive partial last-name matching.
- Case-insensitive partial combined-name matching.
- Case-insensitive exact email matching.

Escape SQL wildcard characters so user text does not change the matching rule. Use parameterized values.

Search must never return or count an inaccessible employee.

## Filters

Support:

- Department.
- Country.
- Currency.
- Level.
- Employment status.

Requested filters narrow the authenticated scope. They cannot widen it.

The options endpoint returns only filter values that occur inside the caller's current scope.

## Sorting

Support ascending and descending sorting by:

- Employee name.
- Employee ID.
- Department.
- Country.
- Level.
- Hire date.
- Annual base salary.
- Annual cash compensation.

Every sort uses a stable internal tie-breaker. Do not return the internal database ID.

## Compensation state

Use an injected as-of calendar date for deterministic application tests.

### Currently working

Select the latest compensation record effective on or before the as-of date.

Return:

```text
CURRENT
```

### Soon to join

Select the earliest future compensation record.

Return:

```text
UPCOMING
```

### Left

Select the latest compensation record effective on or before the employment end date.

Return:

```text
HISTORICAL
```

A future salary does not become current before its effective date. If two versions share an effective date, the higher version wins for current or historical selection.

## Directory response

Each row includes:

- Employee code.
- Name.
- Email.
- Department.
- Job title.
- Level.
- Country.
- Employment status.
- Selected compensation state.
- Annual base salary.
- Annual bonus.
- Annual cash compensation.
- Native currency.
- USD-equivalent annual base salary.
- USD-equivalent annual cash compensation.

Money values use exact two-decimal strings.

The response also includes total rows, page, page size, page count, sort field, and direction.

A page beyond the final page returns an empty list with correct totals.

## Employee detail

Detail includes:

- Current employee fields.
- Employee version.
- Selected compensation and state.
- Complete compensation history in effective-date and version order.

Do not expose internal employee, job-title, department, compensation, or session IDs.

An unknown employee and an inaccessible employee return the same status and response body.

## Cross-currency comparison

USD is the only comparison currency in the first version.

Native salary remains authoritative. Do not add a converted salary column to employee or compensation tables.

Use a saved official exchange-rate snapshot. The snapshot records:

- Base currency.
- Quote currency.
- Decimal rate.
- Source name.
- Source URL.
- Effective date.
- Retrieval date.

The implementation must define the quote direction clearly. It must not infer whether a value means INR per USD or USD per INR.

For salary sorting:

1. Load the required saved rate.
2. Convert inside the MySQL query.
3. Sort all permitted and filtered rows by the unrounded USD result.
4. Apply limit and offset.
5. Round USD equivalents to two decimal places only for response display.

Salary sort requests require:

```text
comparisonCurrency=USD
```

If a required rate is missing, reject the salary sort. Do not compare unconverted native values.

Return a sort context with the comparison currency, source, source URL, effective date, and retrieval date.

The initial implementation uses no live exchange-rate request. A live refresh is a later feature.

## Exact arithmetic

Perform authoritative application arithmetic with decimal strings, integer minor units, or a reviewed decimal library. Do not use JavaScript `number` for salary arithmetic.

MySQL can calculate the sortable conversion with `DECIMAL` expressions and a decimal rate parameter.

Annual cash compensation is:

```text
annual base salary + annual bonus
```

## Authorization

Admin HR can access all employees.

Scoped HR requires:

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

An empty country or department list returns no employees.

Apply scope to:

- Directory rows.
- Total count.
- Search.
- Filter options.
- Detail.
- Compensation history.

Do not fetch an unrestricted result and filter it after pagination.

## SQL and performance

Use raw SQL and `mysql2`.

Queries must apply scope, filters, selected compensation, stable sorting, limit, and offset in MySQL.

Add indexes only after examining representative MySQL plans against the 10,000-row seed.

Measure:

- Default first page.
- Exact employee code.
- Partial name.
- Scoped country and department filters.
- Cross-currency salary sort.

Record conditions and results. Do not claim a production service-level target from local measurements.

## Logging

Do not log:

- Search terms.
- Employee codes from query strings.
- Names or email addresses.
- Compensation values.
- JWTs.
- SQL text or parameters.

The existing request logger records the path without the query string.

## Scope limits

This task does not include:

- Frontend pages.
- Employee creation or editing.
- Salary adjustments.
- User-facing spreadsheet import.
- Live exchange-rate refresh.
- AI or MCP.
