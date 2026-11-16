# Backend Task 11: HR access-management API

**Status:** READY AFTER CURRENT BACKEND COMMIT

## Goal

Implement the Admin-only HR access-management API defined in:

```text
docs_human/12-hr-access-management.md
```

Reuse and extend the existing HR user, scope, session, and access-audit operations. Do not create a second authorization model.

## Read first

- `docs_human/12-hr-access-management.md`
- `docs/10-access-control-design.md`
- `docs/11-access-control-test-plan.md`
- `builder_docs/responses/04-hr-access-control.md`
- `builder_docs/responses/04-hr-access-control-fix.md`
- `builder_docs/responses/10-dashboard-analytics-api.md`

## Required API areas

- List HR users with server-side search, filters, sorting, and pagination.
- Get one HR user and current scope.
- Preview new HR user creation.
- Create HR user and return a generated temporary password once.
- Preview and update display name.
- Preview and apply Scoped-to-Admin promotion.
- Preview and replace country and department scopes together.
- Preview and apply deactivation or reactivation.
- List immutable access-audit events.

Use the routes in the human specification unless a smaller consistent REST shape reduces duplication. Record any route change before implementation.

## Authorization

- Every endpoint requires current authentication.
- Only ACTIVE Admin HR can use these operations.
- Scoped HR receives 403.
- Backend application operations remain authoritative.
- Frontend visibility is not authorization.

## Rules

- Email is immutable and unique without case sensitivity.
- Admin users have no scope rows.
- Scoped users created through this workflow require at least one country and one department.
- Existing empty-scope users still load safely and have no employee access.
- Scoped-to-Admin promotion clears all scopes and revokes all active sessions.
- Admin-to-Scoped demotion is not supported.
- Scope updates replace countries and departments in one transaction.
- Deactivation and reactivation require a reason.
- Deactivation revokes all sessions in the same transaction.
- Reactivation restores role and scopes but not sessions.
- Last active Admin cannot be deactivated.
- Every target update uses expected `hr_users.version`.
- Every write uses idempotency and an exact command fingerprint.
- Same key and command replays; same key with different command conflicts.
- Preview writes nothing and expires after five minutes.
- Change, session revocation, version increment, and audit event commit atomically.
- No-change submissions write no audit event or version.

## Temporary password

Generate a cryptographically random temporary password of at least 12 characters. Return it only in the successful creation response.

Store only Argon2id hash. Never write the plain password to logs, audit, later reads, or error responses.

Do not claim email delivery. No email service exists.

## Access preview

Return old and proposed role, status, countries, departments, access summary, and estimated accessible employee count. Return the number of sessions that will be revoked where relevant.

Use permission-aware SQL for the estimated employee count.

## Concurrency

Lock target HR user before version comparison. Reuse established active-Admin lock ordering for deactivation and future role operations.

A stale operation returns 409 and changes no user, scope, session, version, or audit row.

## Audit

Extend the existing immutable `access_audit_events` as needed. Do not create another access audit table.

Audit records include actor, target, action, before and after access state, reason, resulting version, and time. Never include password, hash, JWT, session ID, cookie, or authorization header.

## Tests

Implement the tests in the human specification. Include real MySQL tests for:

- Admin-only API access.
- Creation and one-time password.
- Combined scope transaction.
- Scope preview count.
- Promotion scope removal and session revocation.
- Deactivation session revocation.
- Last-Admin concurrency.
- Expected-version conflicts.
- Idempotency command fingerprints.
- Audit rollback.
- No secret storage or logging.
- Search, filters, pagination, and OpenAPI.

Run all existing salary and dashboard regression tests.

## Scope limits

Do not implement frontend HR access pages, password reset, email delivery, SSO, MFA, custom roles, Admin demotion, paired scopes, dashboard UI, salary UI, AI traces, or agent mutations.

Never read `.env` files. Do not run Git commands.

## Response

Write:

```text
builder_docs/responses/11-hr-access-management-api.md
```

Include route design, migration changes, preview and idempotency design, transaction and lock order, tests, failures, commands, results, and known limits.
