# Builder task 06: Express authentication API

**Status:** NOT READY. Task 05 must pass review and be committed first.

## Goal

Create the Express server foundation and authentication endpoints defined in the approved design.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs_human/07-auth-api-raw.md`
- `docs/14-authentication-api-design.md`
- `docs/15-authentication-api-test-plan.md`
- `docs/10-access-control-design.md`
- `builder_docs/responses/04-hr-access-control.md`
- `builder_docs/responses/04-hr-access-control-fix.md`
- `builder_docs/responses/05-typescript-migration.md`

## Included endpoints

```text
GET  /health
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/logout
GET  /api/v1/openapi.json
```

## Required rules

- Use TypeScript and Express.
- Use Zod for runtime input validation.
- Generate OpenAPI from the backend contract.
- Use the existing session and access operations.
- Return one approved public error shape.
- Keep internal authentication reasons private.
- Apply the approved failed-login rate limit.
- Verify Railway proxy behavior before trusting client IP headers.
- Do not enable browser CORS access by default.
- Do not set browser cookies in Express. The later Next.js server owns the cookie.
- Do not log request bodies, credentials, tokens, cookies, salary data, database URLs, or SQL parameters.
- Use an application factory with injected dependencies.
- Use a separate server process entry point with graceful shutdown.
- Never read `.env` files.
- Do not run Git commands.

## Work order

1. Confirm the TypeScript migration is accepted.
2. Check current official Express, Zod, OpenAPI integration, rate-limit, and Railway proxy documentation.
3. Write endpoint and middleware tests.
4. Create the application factory and public error mapping.
5. Add authentication middleware.
6. Add login, current-user, and logout endpoints.
7. Add the failed-login rate limit.
8. Generate and test the OpenAPI contract.
9. Add the process entry point and graceful shutdown.
10. Run lint, type check, build, fast tests, and real-MySQL tests.
11. Run the compiled server health smoke test.
12. Write the builder response and stop.

## Scope limits

Do not create Next.js code, browser cookies, employee endpoints, HR management endpoints, salary endpoints, spreadsheet upload, AI, or MCP.

## Response

Write:

```text
builder_docs/responses/06-authentication-api.md
```

Include sources checked, files changed, API contract choices, rate-limit and proxy decisions, tests, red failures actually observed, commands and results, known limits, and confirmation that no Git or later feature work ran.
