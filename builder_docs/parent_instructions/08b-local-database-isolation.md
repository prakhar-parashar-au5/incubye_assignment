# Backend infrastructure fix: Isolate preview and test databases

**Status:** READY

## Problem

Local preview servers and destructive integration tests use `acme_test`. Running the database suite resets tables, invalidates browser sessions, and changes demo-user passwords.

## Required result

Use:

```text
acme_dev  for local frontend/backend preview
acme_test for destructive integration tests
```

Both can run in the local MySQL 8 container. Keep tests guarded so they accept only a database ending in `_test`.

## Requirements

- Update Docker initialization so a fresh local container creates both databases and grants the local test user access to both.
- Keep project commands from reading `.env` files.
- Document separate injected database URLs.
- Keep migration and seed commands explicit. Do not seed on server startup.
- Add a safe local setup command only if it does not hide destructive behavior.
- Do not weaken the `_test` guard.
- Do not change production schema or application behavior.
- Do not modify frontend files.

## Verification

- Recreate the local synthetic container only with explicit user approval. If approval is not present, test using a separate temporary container.
- Apply migrations and seed `acme_dev`.
- Create demo users in `acme_dev`.
- Run the destructive integration suite against `acme_test`.
- Confirm `acme_dev` employee counts and demo sessions remain unchanged after tests.
- Run backend check and build.

Do not run Git commands.

## Response

Write:

```text
builder_docs/responses/08b-local-database-isolation.md
```
