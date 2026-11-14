# Task 04 review fixes

**Status:** READY

Task 04 passed its main implementation and test review. Apply only the approved corrections below.

## Approved product rules

### Password length

A newly created HR user password must contain at least 12 characters and at most 1,024 characters.

Apply the same creation rule to normal HR users and demo HR users.

Password verification must continue to fail safely for malformed input.

### Last active administrator

Do not allow deactivation of the last active `ADMIN` HR user.

Self-deactivation is allowed only when another active administrator exists.

The check and status update must occur in the same transaction. Lock the relevant administrator rows so two concurrent requests cannot both deactivate the last active administrators.

Return a stable domain error. Do not expose SQL details.

### Administrator scopes

An `ADMIN` HR user must have empty country and department scope lists.

- Reject creation of an `ADMIN` user with non-empty scopes.
- Reject country-scope assignment to an existing `ADMIN` user.
- Reject department-scope assignment to an existing `ADMIN` user.
- A `SCOPED` user can have empty scope lists.
- Empty scope lists grant no employee access.

Do not silently store and ignore administrator scopes.

## Confirmed decisions

- Initial system-created demo users use `actor_hr_user_id = NULL` in audit events.
- Demo email addresses remain unchanged.
- Access audit events remain immutable.
- Expected-version checks are deferred to the HR management API task.

## Required tests

Add tests that prove:

- An 11-character new password is rejected.
- A 12-character new password is accepted.
- A password longer than 1,024 characters is rejected.
- The last active administrator cannot be deactivated.
- An administrator can deactivate themselves when another active administrator exists.
- Two concurrent deactivation attempts cannot leave zero active administrators.
- Creating an administrator with a country or department scope is rejected.
- Assigning a country scope to an administrator is rejected.
- Assigning a department scope to an administrator is rejected.
- A scoped user with empty lists remains valid and has no employee access.
- Rejected operations do not change the HR user version or write an audit event.

Use real MySQL for transaction and concurrency tests.

## Verification

Run:

```text
npm run lint
npm test
DATABASE_URL=<test database URL> npm run test:db
```

Do not modify routes or frontend code. Do not start the TypeScript migration.

## Response

Append the result to:

```text
builder_docs/responses/04-hr-access-control-fix.md
```

Include files changed, tests, red failures actually observed, exact commands and results, and confirmation that no Git command or later task ran.
