# Employee directory API test plan

**Status:** Approved before implementation

## Query validation

- Apply defaults: page 1, page size 25, name ascending.
- Reject page 0, negative pages, decimals, and non-numbers.
- Accept page size 100 and reject 101.
- Reject unsupported filters, sort fields, directions, and comparison currencies.
- Reject repeated query values where one value is required.
- Reject salary sorting without `comparisonCurrency=USD`.
- Accept non-salary sorting without a comparison currency.
- Keep SQL control characters and wildcard characters as search text.

## Search

- Find an employee by exact employee code.
- Find employees by employee-code prefix.
- Find employees by partial first name, last name, and combined full name without case sensitivity.
- Find an employee by exact email without case sensitivity.
- Do not treat a partial email as an email match.
- Search does not return an employee outside the current HR scope.
- Search values use SQL parameters.

## Filters

Test each filter alone and in combination:

- Department.
- Country.
- Currency.
- Level.
- Employment status.

A requested filter cannot widen the authenticated scope.

The options endpoint returns only values visible inside the current HR scope.

## Pagination and sorting

- Return 25 rows by default.
- Return no more than the requested page size.
- Return total rows, current page, page size, and page count.
- A page after the last page returns an empty list and correct totals.
- Adjacent pages do not repeat rows when the data is unchanged.
- Every sort has a stable tie-breaker.
- Test ascending and descending order for each approved field.
- Reject a sort-field injection value before SQL execution.

## Compensation selection

Use an injected as-of date.

- `CURRENTLY_WORKING` returns the latest record effective on or before the as-of date as `CURRENT`.
- `SOON_TO_JOIN` returns the earliest future record as `UPCOMING`.
- `LEFT` returns the latest record on or before the employment end date as `HISTORICAL`.
- A future record does not replace current compensation early.
- Two records on one effective date use the higher version.
- Detail history returns every permitted record in effective-date and version order.
- Exact salary and bonus values remain decimal strings.
- Annual cash compensation equals annual base salary plus annual bonus without JavaScript floating-point arithmetic.

## Cross-currency sorting

Use a fixed test exchange-rate snapshot.

- USD values use rate 1.
- INR values use the approved INR-to-USD calculation.
- Salary sorting compares the unrounded USD value before pagination.
- Displayed USD equivalent rounds to two decimal places with the approved policy.
- Base salary and annual cash compensation produce separate sort orders when bonuses differ.
- Native amount and currency remain unchanged.
- Response includes source name, URL, effective date, and retrieval date.
- Missing INR rate rejects cross-currency salary sorting.
- Missing rate never falls back to native numeric sorting.
- No converted salary column exists in employee or compensation tables.

## Authorization and non-disclosure

Using real MySQL and real authentication:

- Admin HR can list and open every seeded employee.
- Rohan sees only India employees in Tech or Support.
- Rohan cannot find an out-of-scope employee by code, name, or email.
- An out-of-scope detail ID and unknown detail ID return identical 404 bodies.
- Totals do not include hidden employees.
- Filter options do not reveal hidden departments or countries.
- Missing, invalid, revoked, expired, and inactive sessions are rejected.

## Response contract

- Directory money values are strings with two decimal places.
- Directory rows include native and USD-equivalent compensation.
- Detail includes employee version and complete compensation history.
- Responses contain no internal database IDs.
- OpenAPI includes query parameters, response schemas, errors, and Bearer security.
- The committed OpenAPI file matches generated output.

## Logging

Confirm logs do not contain:

- Search text.
- Employee names or email addresses.
- Employee IDs from query strings.
- Salary values.
- JWTs or authorization headers.
- SQL text or parameters after an error.

## Performance checks

Against 10,000 seeded employees:

- Record query plans for default page, exact ID, name search, scoped filters, and salary sort.
- Confirm SQL applies permission filters, sorting, limit, and offset.
- Confirm application code does not load all matching employees before pagination.
- Record median and slowest observed time over several local runs.
- Do not create a performance guarantee from local measurements.
- Add an index only when the measured query plan supports it.

## Regression

Run all previous type, lint, fast, MySQL, authentication, migration, seed, and build checks.
