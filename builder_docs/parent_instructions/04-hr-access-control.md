# Builder task 04: HR access-control foundation

**Status:** NOT READY. Task 03 must be accepted and committed first.

## Goal

Add the HR user, scope, session, and access-audit database foundation. Add the pure access policy and its tests.

Do not add sign-in routes or frontend pages in this task.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs_human/05-access-control-raw.md`
- `docs/10-access-control-design.md`
- `docs/11-access-control-test-plan.md`
- `docs/05-initial-database-schema.md`
- `builder_docs/responses/02-initial-migration.md`
- `builder_docs/responses/03-workbook-database-seed.md`

## Included work

- Migration `002` for HR users, country scopes, department scopes, sessions, and access audit events.
- Pure country-and-department access rule.
- Password hashing module and focused tests.
- Session token creation and verification foundations.
- Database operations needed to load current HR status and scopes.
- Seeded synthetic Meera and Rohan demo users through a safe, documented method.
- Real MySQL schema and behavior tests.

## Required rules

- Use JavaScript.
- Use raw SQL and `mysql2`.
- Do not use an ORM.
- Use `ADMIN` and `SCOPED` roles.
- Use `ACTIVE` and `INACTIVE` HR status.
- Use OR within each scope list and AND across country and department.
- Empty country or department scope grants no access.
- Use two-hour sessions.
- JWT contains only HR user ID, session ID, issued time, and expiry time.
- Load current session, HR status, and scopes for every authenticated operation.
- Store only password hashes.
- Store JWT signing keys only in injected process environment values.
- Never read `.env` files.
- Keep access and audit changes transactional.
- Do not run Git commands.

## Builder choice

Select the password hashing implementation after checking current official documentation, maintenance, Railway compatibility, and test behavior. Record the method and parameters. Prefer a standard maintained implementation over custom cryptography.

Select a maintained JWT library. Do not implement JWT signing or parsing by hand.

## Scope limit

Do not create:

- Express sign-in routes.
- Frontend sign-in pages.
- Employee directory API.
- Salary update routes.
- Spreadsheet upload.
- AI or MCP features.

## Response

Write:

```text
builder_docs/responses/04-hr-access-control.md
```

Include files changed, migration decisions, hashing and JWT choices, tests, red tests actually observed, commands and results, known limits, and confirmation that no later task or Git command ran.
