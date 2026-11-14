# Builder task 03: Seed MySQL from the workbook

**Status:** READY

## Context

The generated workbook contains 10,000 synthetic employees. Task 02 creates the initial MySQL schema. This task will load the workbook into those tables.

The candidate selected destructive replacement for development, test, and demo environments.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs/01-source-workbook.md`
- `docs/02-synthetic-data-rules.md`
- `docs/05-initial-database-schema.md`
- `docs/08-workbook-seed-design.md`
- `docs/09-workbook-seed-test-plan.md`
- `docs_human/04-workbook-database-seed-raw.md`
- `builder_docs/responses/01-workbook-generator.md`
- `builder_docs/responses/02-initial-migration.md`

Do not start if the Task 02 response or accepted migration is missing.

## Task

Create a JavaScript seed command that reads the approved `.xlsx` workbook and replaces employee and compensation data in MySQL.

Use raw SQL and `mysql2`. Do not add an ORM or TypeScript.

## Required order

1. Confirm that Task 02 is accepted and the migration tests pass.
2. Write workbook parser tests.
3. Implement workbook parsing and exact decimal conversion.
4. Write seed safety and transaction tests.
5. Implement reference-data setup.
6. Implement parameterized batch inserts.
7. Implement the destructive replacement transaction.
8. Test rollback after a failure inside the transaction.
9. Run all workbook generator tests.
10. Run all schema and seed integration tests.
11. Measure one local 10,000-row seed.
12. Write the builder response and stop.

## Rules

- Require `--replace`.
- Permit only `APP_ENV=development`, `test`, or `demo`.
- Refuse `APP_ENV=production`.
- Never read `.env` files.
- Use `process.env.DATABASE_URL` or an explicit function argument.
- Use `DELETE`, not `TRUNCATE`.
- Validate the complete workbook before the transaction.
- Use one connection for the transaction.
- Roll back all replacement work after any failure.
- Do not reset auto-increment values.
- Do not log salary values or credentials.
- Do not run Git commands.

## Scope limits

Do not create Express routes, frontend code, authentication, HR access control, import preview, AI, or MCP.

Do not turn the seed command into the later user-facing import feature.

## Response

Write:

```text
builder_docs/responses/03-workbook-database-seed.md
```

Include:

- Files changed.
- Parser and transaction design.
- Batch size and reason.
- Tests added and defects they detect.
- Red tests actually observed.
- Exact commands and results.
- MySQL version and local seed measurement conditions.
- Final employee and compensation counts.
- Rollback test evidence.
- Known limitations.
- Confirmation that no Git command ran.
- Confirmation that no later feature started.
