# Response: Task 07, employee directory API

**Status:** Complete. Ready for planner review.

## Task completed

I added three authenticated endpoints:

```text
GET /api/v1/employees
GET /api/v1/employees/:employeeCode
GET /api/v1/employee-directory/options
```

The endpoints include:

- SQL scope enforcement.
- Search, filters, allowlisted sorting, and SQL pagination.
- CURRENT, UPCOMING, and HISTORICAL compensation selection with an injected as-of date.
- Exact decimal money values.
- Salary sorting by USD equivalent, converted in MySQL from a saved official rate.
- Identical 404 responses for unknown and out-of-scope employees.
- OpenAPI updates.
- Measured query plans on the 10,000-employee seed.

I confirmed in `index.md` that Task 06 is `ACCEPTED AND COMMITTED` before starting.

## Official exchange-rate evidence

| Field | Value |
| --- | --- |
| Source | Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates. These are noon buying rates in New York, certified by the Federal Reserve Bank of New York. |
| Source URL | `https://www.federalreserve.gov/releases/h10/20261109/` (the dated release, not `/current/`, which changes) |
| Release date | November 9, 2026 |
| Rate effective date | 2026-11-06 (column "Nov. 6", the latest column in that release) |
| Row | INDIA / RUPEE, with no asterisk |
| Quote direction | The page says "Rates in currency units per U.S. dollar except as noted by an asterisk". So the rate means 1 USD = 93.9100 INR. |
| Rate | `93.9100` |
| Retrieved | 2026-11-14T18:47:36Z |

The fixture is `express-backend/data/exchange-rates/usd-inr.json`. It records the base and quote currencies, the rate as a decimal string, a `meaning` line, the source name, URL, effective date, retrieval time, and the quoted evidence.

The loader validates the direction. It rejects anything other than base `USD` with quote `INR`, a numeric or zero rate, a non-https URL, and an invalid date. The conversion rule is therefore fixed: USD = INR ÷ rate. No request or test calls a live rate API.

## Files changed

New:

- `express-backend/data/exchange-rates/usd-inr.json`: the saved rate snapshot.
- `express-backend/src/money/decimal.ts`: exact money arithmetic using BigInt cents (`parseMoney`, `formatMoney`, `addMoney`, `convertToUsd`, `isPositiveDecimal`).
- `express-backend/src/directory/exchange-rate.ts`: snapshot schema, `parseExchangeRateSnapshot`, `loadExchangeRate`.
- `express-backend/src/directory/directory-repository.ts`: SQL builders, `scopeCondition`, `escapeLike`, `buildListQueries`, `createDirectoryService`, `SalarySortUnavailableError`.
- `express-backend/src/http/directory-routes.ts`: the three routes.
- `express-backend/scripts/measure-directory.ts`: read-only EXPLAIN ANALYZE and timing script.
- `express-backend/test/money.test.ts`: 7 tests.
- `express-backend/test/directory-query.test.ts`: 12 tests.
- `express-backend/test/db/employee-directory.test.ts`: 37 tests.
- `builder_docs/responses/07-employee-directory-measurements.txt`: full plan output from one measurement run.

Changed:

- `src/http/contract.ts`: new paths, the `DirectoryQueryParams` query schema, response schemas registered for OpenAPI, sort/state constants, and the employee 404 message.
- `src/http/openapi.ts`: three new operations with query and path parameters, Bearer security, and error responses.
- `src/http/app.ts`: required `directory` dependency; directory routes mounted.
- `src/http/request-log.ts`: logs the matched route pattern instead of `req.path`. See "Logging" below.
- `src/server.ts`: loads the snapshot at startup and creates the directory service.
- `src/paths.ts`: `EXCHANGE_RATE_FILE`.
- `package.json`: `measure:directory` script.
- `openapi/openapi.json`: regenerated.
- `test/http-openapi.test.ts`: eight endpoints; new tests for parameters, responses, and security; the routed-operations test fills in the path parameter.
- `test/support/http.ts`: `fakeDirectory()`, used by `buildTestApp`.
- `test/http-app.test.ts`, `test/db/auth-api.test.ts`: pass the new required `directory` dependency.

No migration was added. No file under `docs_human/` or `docs/` was edited.

## Main implementation decisions

### Query validation

`DirectoryQueryParams` is a strict Zod object, so unknown parameters are rejected.

- **Repeated parameters:** each value must be a single string. Express 5's default query parser turns a repeated parameter into an array, and the array fails validation.
- **Page and page size:** both must match `^[1-9][0-9]{0,6}$`, which rejects `0`, `-1`, `1.5`, `1e2`, `01`, and leading spaces. Page size is capped at 100. Page is capped at 1,000,000 to bound OFFSET.
- **Search text:** `q` is trimmed. Blank text counts as absent. The maximum length is 100.
- **Salary sorts:** a refinement requires `comparisonCurrency=USD`.

### Search

All values are SQL placeholders.

- **Employee code:** prefix match with `LIKE 'X%'` on the upper-cased text. It runs only when the text is alphanumeric, because `employee_code` is ASCII with a binary collation.
- **Names:** `LIKE '%x%'` on first name, last name, and `CONCAT(first, ' ', last)`. The column collation, `utf8mb4_0900_ai_ci`, makes the match case-insensitive.
- **Email:** `e.email = ?` under the same case-insensitive collation. A partial email does not match.
- **Wildcards:** `escapeLike` escapes `\` first, then `%` and `_`, using MySQL's default LIKE escape character.

### Scope

`scopeCondition` returns:

- `TRUE` for an ACTIVE Admin.
- `e.country_code IN (?) AND d.name IN (?)` for an ACTIVE Scoped user with both lists non-empty.
- `FALSE` for everything else, including an empty list, INACTIVE, or an unknown role.

The condition goes into the WHERE clause of the page query, the count query, the options query, and the detail query. History is read only after the scoped detail query has found the employee. Requested filters are ANDed with the scope, so they cannot widen it.

### Compensation selection

A single `LEFT JOIN LATERAL (… LIMIT 1)` subquery picks one record per employee:

- CURRENTLY_WORKING: latest `effective_from <= asOf`.
- SOON_TO_JOIN: earliest `effective_from > asOf`.
- LEFT: latest `effective_from <= employment_end_date`.
- Ties on the same date go to the higher version.

The state label comes from the employment status. The list and the detail use the same subquery, so they cannot disagree. The as-of date is the UTC calendar date of the injected clock.

### Sorting

Sort fields map to fixed column lists. Every sort ends with `e.employee_code ASC` as the tie-breaker.

- Name sorts by first name, then last name.
- Level sorts by ENUM declaration order: JUNIOR < MID < SENIOR < LEAD < MANAGER.
- Direction is either `ASC` or `DESC`, chosen from the validated value.

### Salary sort

The page query selects:

```sql
CASE sc.currency WHEN 'USD' THEN amount WHEN 'INR' THEN amount / CAST(? AS DECIMAL(20, 10)) END AS sort_usd
```

Then it orders by `sort_usd IS NULL, sort_usd <dir>, e.employee_code` before LIMIT and OFFSET. The amount is the base salary for `annualBaseSalary`, and base plus bonus for `annualCashCompensation`.

MySQL's DECIMAL division keeps only `div_precision_increment` extra digits, which defaults to 4. The query therefore carries `/*+ SET_VAR(div_precision_increment = 30) */`, which applies to that statement only. I checked this in the container: `1600000.01 / 93.9100` returns `17037.589288` by default and `17037.5892876158023639654989` with the hint.

The rate is sent as a decimal string and cast to DECIMAL. Without the cast, MySQL would compare it as a DOUBLE.

### Missing rate

If no snapshot is loaded, a salary sort returns 400 `VALIDATION_ERROR` with the message "Salary sorting is unavailable: no saved INR exchange rate." There is no fallback to native sorting.

- With a `currency=USD` filter, every row is USD, so no rate is needed and the sort is allowed.
- INR rows show `usdEquivalent: null`.
- The options endpoint omits the salary sort fields and returns an empty `comparisonCurrencies` list.

### Money

MySQL returns DECIMAL values as strings (`decimalNumbers: false`).

- **Cash compensation:** computed in Node.js as base plus bonus, using BigInt cents.
- **USD equivalent for display:** cents × 10^scale ÷ rate numerator, rounded half-up to cents, using BigInt only. JavaScript `number` is never used for money.
- **Native values:** returned unchanged.
- **Stored conversions:** no converted value is stored anywhere.

### Responses

Responses contain no internal IDs. The detail response includes the employee `version` and every history record ordered by `effective_from ASC, version ASC`.

The list response includes:

- `page`: number, size, totalRows, totalPages.
- `sort`: field, direction, and `comparison`. For salary sorts, `comparison` holds the currency and the full rate context (source name, URL, effective date, retrieval time). Otherwise it is null.
- `exchangeRate`: the snapshot used for USD equivalents.

All three routes set `Cache-Control: no-store`. Every response passes through its Zod schema before it is sent.

### Detail 404

A malformed code, an unknown code, and an out-of-scope code all return 404 with `{"error":{"code":"NOT_FOUND","message":"Employee not found."}}`.

### Logging

Before this task, the request log recorded `req.path`. For `/api/v1/employees/ACME00001` that path contains the employee code, which the task forbids in logs.

The logger now records the matched route pattern, for example `/api/v1/employees/:employeeCode`. A request that matches no route logs `UNMATCHED`, because its path is arbitrary user text. The existing Task 06 logging test still passes, because matched auth routes log the same paths as before.

### Startup

The server loads the snapshot at startup. If the file cannot be read or fails validation, the server logs `exchange_rate_unavailable` with the error class name only and continues, using the missing-rate behaviour described above.

## Indexes and measured plans

**Conditions:**

- Local MacBook, MySQL 8.4.13 in Docker on tmpfs.
- `acme_test` reseeded to exactly 10,000 employees and 10,000 compensation records (`APP_ENV=development npm run db:seed -- --replace`).
- As-of date 2026-11-14.
- One connection from `npm run measure:directory`.
- Each timing is the page query plus the count query, i.e. one request's SQL, over 15 runs after one warm-up.
- I ran the script three times.

These are local observations, not a service-level target.

| Request | Run 1 median / slowest | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Default first page (Admin) | 6.9 / 8.4 ms | 6.4 / 9.1 ms | 6.7 / 9.0 ms |
| Exact employee code `ACME05000` | 10.2 / 12.4 ms | 10.0 / 10.5 ms | 10.1 / 12.1 ms |
| Partial name `sneha` | 9.5 / 11.4 ms | 9.4 / 10.2 ms | 9.4 / 10.0 ms |
| Rohan scope + `department=Tech&country=IN` | 8.4 / 10.2 ms | 8.9 / 9.6 ms | 8.3 / 8.9 ms |
| Salary sort, base, desc (Admin, all 10,000) | 29.1 / 30.2 ms | 29.4 / 31.1 ms | 28.8 / 30.3 ms |
| Salary sort, cash, page 150 (Rohan, 4,599 rows) | 18.2 / 19.6 ms | 18.6 / 21.2 ms | 18.7 / 20.0 ms |

What the plans show (full output in `07-employee-directory-measurements.txt`):

- **Default page:** table scan of `employees` (10,000 rows), then a sort on first name, last name, employee code (about 5 ms), then `Limit: 25`. The joins and the lateral compensation lookup run only 25 times (`loops=25`). The count uses covering index lookups on `idx_employees_job_title`.
- **Exact code and partial name:** table scan plus filter. The search is an OR across a code prefix, `%x%` name patterns, and email equality. A leading-wildcard LIKE cannot use a B-tree index, and the OR prevents index merge on the code and email unique keys. About 2–4 ms per query at 10,000 rows.
- **Scoped filters:** `idx_employees_country` (country `IN`, 7,000 rows), then the department filter through `job_titles`. The count starts from `uk_job_titles_department_name_level` and `idx_employees_job_title`.
- **Salary sort:** the lateral lookup runs once per scoped row (`loops=10000` for Admin, `loops=4599` for Rohan) through `uk_compensation_employee_version`. Then a sort on the computed `sort_usd`, then `Limit/Offset`. This is the required design: the order depends on a value computed per row, and the task forbids a stored converted column. So no index can supply this order.
- **Unbounded reads:** no query loads all matching employees into Node.js. The page query returns at most `pageSize` rows.

**Index decision: no new index and no migration.**

- An index on `(first_name, last_name, employee_code)` could remove the 5 ms filesort for the default name sort. The measured total is about 7 ms, so I did not judge it justified.
- A search index cannot help leading-wildcard LIKE.
- The salary sort cannot use an index without a stored converted value.

I discarded one earlier measurement run. It ran on 10,007 employees left by the test suite, because my first seed command omitted `APP_ENV` and the seed refused to run.

## Tests added

Fast tests: `money.test.ts` (7) and `directory-query.test.ts` (12).

| Test | Defect it detects |
| --- | --- |
| adds two-decimal strings exactly | Float addition in annual cash compensation |
| accepts only exact two-decimal strings | DB values with the wrong scale accepted silently |
| converts INR by dividing, half-up | Inverted quote direction (multiplying) or float rounding. Expected values computed with `bc`. |
| USD uses rate 1 / INR without a rate is null | INR shown as USD without a rate |
| saved fixture holds the recorded H.10 values | Fixture drift from the recorded evidence |
| rejects wrong direction, numeric, zero, http, bad date | Ambiguous or inverted snapshot accepted |
| defaults; parses filters | Unbounded pages, wrong default order |
| rejects bad pages; page size 100/101/0 | Negative or fractional OFFSET; cap off by one |
| rejects unknown params and values; rejects sort injection | Unvalidated text reaching ORDER BY or WHERE |
| rejects repeated params | Arrays reaching SQL |
| salary sort requires comparisonCurrency=USD | Native INR and USD compared directly |
| keeps wildcard and control characters; trim and length | Search text altered or rejected |
| LIKE escaping | `%` or `_` acting as a wildcard |

OpenAPI tests: four changed or new, plus the existing drift test.

| Test | Defect it detects |
| --- | --- |
| documents exactly the eight endpoints | An endpoint missing from, or added to, the contract |
| directory query parameters match the runtime schema | Wrong enums, defaults, or bounds published |
| responses documented | Missing money, state, or rate schemas, or missing error responses |
| Bearer on every protected endpoint | Directory endpoints documented without authentication |
| every documented operation is routed | A documented path with no route |

MySQL tests: `test/db/employee-directory.test.ts` (37). They run against the full 10,000 seed plus 7 marker employees, with real sessions and real login. Expected counts come from independent SQL.

| Area | Main defects detected |
| --- | --- |
| Authorization (8 tests) | Admin limited by empty lists; scope applied after pagination; empty list read as unrestricted; search bypassing scope; filters widening scope; different 404 bodies for out-of-scope, unknown, and malformed codes; options leaking hidden values; missing, invalid, revoked, expired, or inactive sessions accepted on any of the three endpoints |
| Search (4) | Code search not exact or prefix; case-sensitive names; email matched as a substring; wildcards or quotes changing results (including the seeded `D'Souza` and `O'Brien`) |
| Filters (3) | Each filter alone and combined, checked against independent SQL counts; scope combined with OR |
| Pagination and sorting (5) | Missing default limit; wrong metadata; partial last page; empty page past the end; repeated rows across pages; ignored direction or missing tie-breaker for each non-salary sort |
| Compensation selection (7) | Future raise shown early; as-of date ignored; same-date tie resolved by insertion order; wrong UPCOMING record; record after the end date shown for a leaver; list and detail disagreeing; seeded values altered |
| Detail (3) | Missing version or history; wrong history order; internal IDs in any response key |
| Cross-currency sorting (6) | Rounding before sorting; native sorting; cash sort reusing base; display rounding; sort applied per page; native fallback when the rate is missing; a stored converted column |
| Logging (1) | Search text, codes, names, emails, salaries, tokens, or SQL in logs; route pattern and `UNMATCHED` paths |

The salary-sort markers are designed so that a wrong implementation gives a different order:

- ACME90005: USD 17037.59.
- ACME90006: INR 1600000.00, which is 17037.5891811 USD.
- ACME90007: INR 1600000.50, which is 17037.5945054 USD.

Rounding first would tie ACME90005 and ACME90006. Native sorting would put both INR rows after the USD row.

## Failed tests actually observed before implementation

1. `node --import tsx --test test/money.test.ts` failed with `SyntaxError: The requested module '../src/money/decimal.js' does not provide an export named 'addMoney'`. The stub modules contained only `export {};`. This is a file-level red, not an assertion red.
2. `node --import tsx --test test/directory-query.test.ts` first failed at import: `does not provide an export named 'DirectoryQueryParams'`. I then added temporary permissive stubs (`z.looseObject({})` and an identity `escapeLike`) and re-ran: **10 failed, 2 passed**. The two that passed were "non-salary sorts accept no comparison currency" and "keeps SQL control and wildcard characters", which a permissive stub satisfies by construction.
3. `test/db/employee-directory.test.ts`, with a stub `createDirectoryService` and the routes not mounted: **36 failed, 1 passed**. The one that passed was the guard that no converted salary column exists, which the existing schema already satisfies.
4. `test/http-openapi.test.ts`, after the tests were updated and before the paths were added: **5 failed, 6 passed**. The failures were the endpoint list, parameters, responses, security, and the committed-file drift check.

After the implementation, the first MySQL run had one failure: **36 passed, 1 failed**. The wildcard test expected a bare `'` search to return only the 228 `D'Souza` rows, but it returned 302. The seed also contains `O'Brien`. The test's expectation was wrong, not the code. I changed it to an independent SQL count of names containing `'`.

Before that run, I also corrected one expected value while checking it with `bc`. Sneha's cash compensation in USD is `3557885.85 / 93.91 = 37886.1234…`, which rounds to `37886.12`. My first draft had `37886.13`.

After all tests were green, I extracted `buildListQueries` from the service so the measurement script runs the same SQL. The full MySQL suite was re-run after that change (see below).

## Exact verification commands and results

From `express-backend/`:

```text
npm run check
  lint: no problems; typecheck: no errors
  # tests 284  # pass 284  # fail 0          (was 263)

npm run build
  exit 0

DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
  # tests 174  # pass 174  # fail 0          (was 137; 37 new)

npm run openapi:generate
  Wrote .../openapi/openapi.json

APP_ENV=development DATABASE_URL=... npm run db:seed -- --replace
  Seeded 10000 employees and 10000 compensation records.

DATABASE_URL=... npm run measure:directory      (three times; table above)
```

I also ran a smoke test of the compiled server: `node dist/src/server.js` with synthetic `JWT_SIGNING_KEY`, `PORT=4517`, and the test `DATABASE_URL`.

- `/health` returned 200.
- `/api/v1/employees?q=secret-smoke` and `/api/v1/employees/ACME00001` without a token both returned 401 `UNAUTHENTICATED`.
- The OpenAPI document served `/api/v1/employees` and `/api/v1/employees/{employeeCode}`.
- The process log showed paths `/api/v1/employees` and `/api/v1/employees/:employeeCode`, with no query text or code.
- The log had no `exchange_rate_unavailable` event, so the compiled build found the fixture through `PACKAGE_ROOT`.
- SIGTERM shut the server down cleanly.

## Known limitations

- **UTC as-of date:** the as-of date is the UTC date of the server clock. Between 00:00 and 05:30 IST, India's calendar date is one day ahead of it.
- **Null compensation:** an employee whose records do not fit the state rule gets `compensation: null`. Example: a SOON_TO_JOIN employee whose hire date has passed while the status was not updated. Such rows sort last in salary sorts in both directions.
- **Search performance:** search scans the table. That costs about 4 ms at 10,000 rows. At much larger sizes it would need a different search design, such as a code or email fast path, or full-text search.
- **Salary sort cost:** salary sorting computes the lateral selection for every scoped row (about 25 ms for 10,000). It grows linearly with the employee count.
- **Rate age:** the snapshot is the 2026-11-06 rate. There is no refresh; that is a later feature.
- **Unmatched routes:** the log shows `UNMATCHED` instead of the path, so mistyped URLs are harder to diagnose from logs.
- **Paging:** paging uses OFFSET. Deep pages cost more, but at 10,000 rows the worst page is bounded.

## Open decisions for review

1. **As-of time zone:** is the UTC date the right as-of date, or should it be IST, or per employee country?
2. **Currency filter:** it uses the currency of the selected compensation record, not the country's currency. These are the same in the seed. They would differ only after a future country change.
3. **Missing-rate error:** it uses the existing 400 `VALIDATION_ERROR` with a specific message. I did not add a public error code.
4. **Startup without a rate:** the server continues without a rate instead of failing startup. Should a missing or invalid fixture stop the deploy instead?
5. **Name sort:** it orders by first name, then last name. The design does not say which.
6. **Options:** it also returns `sortFields` and `comparisonCurrencies`, so the frontend can hide salary sorts when no rate is loaded. This field is not in the design.

## Confirmations

- No Git command ran.
- No `.env` file was read, and no code loads one.
- No frontend, mutation, salary-change, import, live-rate, AI, or MCP work started.
- `docs_human/` and `docs/` were not edited. That includes the parallel task to copy `docs/19-frontend-directory-spec-draft.md` into `docs_human/09-frontend-directory.md`, which is Prakhar's.
- Nothing was committed.
