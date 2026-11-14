# Task 02 review fix: Disable automatic `.env` loading

**Status:** READY

## Problem

Task 02 passed code and test review.

One project rule remains unresolved. Docker Compose automatically looks for a `.env` file unless default environment-file loading is disabled. The current `db:up` and `db:down` commands call Docker Compose without disabling that behavior.

The project rule is stricter than normal Docker Compose behavior:

- No agent may read an `.env` file.
- No project command used by an agent may automatically read an `.env` file.

No `.env` file currently exists. The command must still be safe if one appears later.

## Required change

1. Check current official Docker Compose documentation for the supported method that disables automatic default `.env` loading.
2. Update `package.json` database lifecycle commands to use that method.
3. Update the database commands and explanation in `express-backend/README.md`.
4. Do not create, inspect, or read an `.env` file during verification.
5. Keep the change limited to this issue.

Do not change SQL, migration behavior, schema tests, or Task 03 code.

## Required verification

Run:

```text
npm run lint
npm test
DATABASE_URL=<local test URL> npm run test:db
```

Verify the database start and stop commands without creating or reading an `.env` file.

## Response

Append the result to:

```text
builder_docs/responses/02-initial-migration-fix.md
```

Include:

- Official documentation checked.
- Exact mechanism selected.
- Files changed.
- Commands run.
- Results.
- Confirmation that no `.env` file was read.
- Confirmation that Task 03 was not started.
- Confirmation that no Git command was run.
