# Builder task: Initial MySQL migration

**Status:** Ready after this task and test plan are committed

## Context

This is the second implementation milestone. The workbook generator is complete.

The candidate selected raw SQL, MySQL 8, and JavaScript. Do not introduce an ORM or TypeScript.

## Read first

- `docs/05-initial-database-schema.md`
- `docs/06-schema-test-plan.md`
- `docs/01-source-workbook.md`
- `docs/02-synthetic-data-rules.md`
- `builder_docs/responses/01-workbook-generator.md`

Do not change approved schema rules without a candidate decision.

## Task

Create:

- A local MySQL 8 Docker Compose service.
- A raw SQL migration under `express-backend/db/migrations/`.
- A small JavaScript migration runner.
- Real MySQL integration tests for the approved schema behavior.

Do not write the workbook seed script yet.

## Required order

1. Read the approved schema and tests.
2. Read the relevant Matt Pocock TDD instructions again. Record only new effects on this task.
3. Propose the exact files and test database safety rule.
4. Write a failing real-MySQL test for a small schema behavior.
5. Implement the migration runner and first SQL migration in small steps.
6. Run all existing workbook tests to prevent regression.
7. Run the schema integration tests against MySQL 8.
8. Run lint.
9. Stop before workbook import or Express API work.

## SQL requirements

Use explicit SQL for:

- Column types.
- Primary keys.
- Unique constraints.
- Foreign keys.
- Check constraints.
- Indexes.
- Delete behavior.
- Timestamp defaults.
- Character set and collation where needed.

Use `InnoDB`.

Use restrictive foreign key delete behavior for reference data, employees, and compensation records.

Use MySQL `ENUM` for the controlled values approved by the candidate.

Use `DECIMAL(15,2)` for salary and bonus.

Do not store monthly salary.

Do not store a second current-salary value in `employees`.

## Migration runner

The runner must:

- Discover ordered `.sql` migration files.
- Create `schema_migrations` when needed.
- Apply only pending migrations.
- Record a migration only after its SQL completes.
- Use parameterized queries for migration records.
- Close database connections.
- Use only `process.env.DATABASE_URL` or an explicit function argument.
- Never read `.env` files.

Do not create a migration rollback framework. MySQL data definition statements can commit automatically. Use forward-only corrective migrations.

## Test database safety

Integration tests must refuse destructive setup unless the database name ends with `_test`.

Tests may recreate objects only in that dedicated test database.

Do not use the workbook's 10,000 rows in schema tests. Use small hand-written fixtures.

## Scope limits

Do not create:

- Workbook import or seed logic.
- Express routes.
- Authentication.
- Access control.
- General audit events.
- Frontend code.
- AI or MCP code.

## Builder report

Write:

```text
builder_docs/responses/02-initial-migration.md
```

Include:

- Files changed.
- SQL decisions.
- Test database safety.
- Tests and defects they detect.
- Red tests actually observed.
- Exact commands and results.
- MySQL version used.
- Migration repeat-run result.
- Known limitations.
- Confirmation that no Git command was run.
- Confirmation that workbook import was not started.

Do not run Git commands. Stop after the migration milestone passes.
