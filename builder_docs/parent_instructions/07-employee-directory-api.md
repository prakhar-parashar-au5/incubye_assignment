# Builder task 07: Employee directory API

**Status:** READY

## Goal

Add authenticated employee directory, filter-options, and employee-detail endpoints with SQL pagination, scope enforcement, compensation states, and documented USD comparison.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs_human/08-employee-directory-apis.md`
- `docs/16-employee-directory-api-design.md`
- `docs/17-employee-directory-api-test-plan.md`
- `docs/10-access-control-design.md`
- `docs/14-authentication-api-design.md`
- `builder_docs/responses/06-authentication-api.md`
- `builder_docs/responses/06-authentication-api-fix.md`

## Included endpoints

```text
GET /api/v1/employees
GET /api/v1/employees/:employeeCode
GET /api/v1/employee-directory/options
```

## Work order

1. Confirm Task 06 is accepted.
2. Research one official USD/INR reference-rate source. Record exact source URL, rate date, retrieval date, and quote direction. Stop and ask if the official evidence is unclear.
3. Save one deterministic exchange-rate fixture. Do not call a live rate API during requests or tests.
4. Write query-validation, compensation-selection, authorization, conversion, and API tests.
5. Implement the exchange-rate policy and exact decimal calculations.
6. Implement permission-filtered SQL queries, stable sorting, and pagination.
7. Add directory, options, and detail routes.
8. Extend runtime schemas and OpenAPI.
9. Seed 10,000 employees and measure representative query plans and times.
10. Run all regression checks and the production build.
11. Write the response and stop.

## Rules

- Use strict TypeScript, Express, Zod, raw SQL, and `mysql2`.
- Do not add an ORM.
- Enforce current HR scope in application operations and SQL queries.
- Do not load all employees into Node.js for sorting or pagination.
- Parameterize all query values.
- Map sort fields through an allowlist.
- Keep money as exact decimal strings.
- Keep native compensation authoritative.
- Do not store per-employee converted salary.
- Use SQL conversion for cross-currency salary sorting before pagination.
- Use the unrounded converted value for ordering.
- Round only the displayed USD equivalent.
- Return identical public 404 responses for unknown and inaccessible employees.
- Do not log query text, employee identity, compensation, JWTs, SQL, or parameters.
- Never read `.env` files.
- Do not run Git commands.

## Exchange-rate evidence

The fixture must contain:

```text
base currency
quote currency
rate
source name
source URL
rate effective date
retrieval date
```

The builder must not invent a rate, source, date, or quote. Use an official source. Tests use the saved fixture.

## Scope limits

Do not create frontend pages, employee mutations, salary changes, user-facing workbook import, live exchange-rate refresh, AI, or MCP.

## Response

Write:

```text
builder_docs/responses/07-employee-directory-api.md
```

Include official rate evidence, files changed, query design, indexes and measured plans, tests, red failures actually observed, commands and results, limitations, and confirmation that no Git or later task ran.
