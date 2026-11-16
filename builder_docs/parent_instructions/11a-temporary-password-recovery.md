# Backend Task 11a: temporary-password recovery

**Status:** READY

## Why this correction is required

Backend Task 11 creates an active HR account and returns its generated temporary password once. If the database transaction commits but the HTTP response is lost, retrying the same create command returns the account with `temporaryPassword: null`. The email is occupied, the account cannot sign in, and version 1 has no recovery operation.

Fix this without storing recoverable plaintext credentials and without building general self-service password reset.

This task-specific correction permits one narrow Admin operation that Task 11 previously excluded: regenerate a temporary password for an HR user.

## Read first

```text
builder_docs/parent_instructions/11-hr-access-management-api.md
builder_docs/responses/11-hr-access-management-api.md
docs_human/12-hr-access-management.md
semantic-review/2026-11-16-200606-pr-backend-11.md
express-backend/src/access/hr-access-service.ts
express-backend/src/access/hr-users.ts
express-backend/src/access/passwords.ts
express-backend/src/http/hr-access-routes.ts
```

Reproduce the lost-response gap with a failing real-MySQL API test before changing implementation.

## Product decision

Add an explicit Admin-only **Regenerate temporary password** operation.

This is an account-recovery action for Admin HR. It is not email delivery, self-service password reset, a permanent password viewer, or plaintext credential storage.

A replayed create response with no password must clearly report that the account exists and requires password regeneration before the Admin can obtain a new temporary credential.

## API

Add preview and confirmation endpoints consistent with existing HR-access operations:

```text
POST /api/v1/hr-users/:hrUserId/regenerate-temporary-password/preview
POST /api/v1/hr-users/:hrUserId/regenerate-temporary-password
```

Both endpoints require:

- A current active Admin actor.
- A valid target HR user.
- `expectedVersion`.
- A required reason from 1 to 2,000 characters after trimming.
- Existing five-minute preview-token rules.
- An idempotency key on confirmation.

The preview writes nothing and shows:

- Target name, email, role, and status.
- Current target version.
- Number of active sessions that confirmation will revoke.
- Warning that every previous password and active session will stop working.
- Exact reason.
- Preview expiry.

The confirmation response returns:

- Updated HR-user detail and version.
- Audit event.
- Revoked-session count.
- New temporary password once.
- Honest notice that no email was sent and the password must be shared through an approved channel.

The password must never be returned by list, detail, audit, preview, or unrelated responses.

## Lost-response and replay behavior

A new regeneration command creates a new temporary password and invalidates the previous password hash.

A replay with the same idempotency key and same command must not regenerate again. It returns the same user and audit outcome with:

```text
temporaryPassword: null
credentialRecoveryRequired: true
```

and a message that the original credential cannot be shown and the Admin can perform a fresh regeneration.

A fresh preview and a new idempotency key can regenerate again. This is the recovery path if either the create response or a regeneration response is lost.

A create replay that returns no password must also include `credentialRecoveryRequired: true`. A first successful create response with a password returns `credentialRecoveryRequired: false`.

Do not derive a password deterministically from an idempotency key. Do not encrypt and retain plaintext for replay.

## Transaction and audit

Extend the existing access-management transaction path. Do not create another authorization or audit model.

Confirmation must atomically:

1. Lock actor and target using the established ordering.
2. Recheck that the actor is an active Admin.
3. Check idempotent replay before stale-version rejection.
4. Verify expected target version and exact preview.
5. Store only the new Argon2id password hash.
6. Revoke all active target sessions.
7. Increment `hr_users.version` once.
8. Write one immutable `TEMPORARY_PASSWORD_REGENERATED` access audit event.
9. Commit before returning the plaintext temporary password.

The audit event stores actor, target, reason, resulting version, and revoked-session count. It must not contain plaintext password, password hash, JWT, cookie, session ID, idempotency key in public output, or authorization header.

Any failure rolls back hash change, session revocation, version increment, and audit insert.

## Required tests

### Recovery journey

```text
Given: Admin creates an HR user but the successful response is treated as lost.
When: Admin retries create with the same idempotency key, receives recovery-required state, then previews and confirms password regeneration.
Then: One account exists, a new temporary password is returned once, and that password can sign in.
Plausible bug caught: A committed create with a lost response strands an unusable active account.
```

### Additional real-MySQL tests

Cover:

- Scoped HR receives 403 on preview and confirmation.
- Unauthenticated requests receive 401.
- Preview writes nothing and reports exact session count.
- Confirmation stores an Argon2id hash and never plaintext.
- Every active target session is revoked in the same transaction.
- The old password stops working and the new temporary password works.
- Expected-version conflict writes nothing.
- Same key and same command replays without changing the hash or version again.
- Same key with different target, reason, or expected version returns duplicate-operation conflict.
- A fresh regeneration after a lost regeneration response returns another usable password and invalidates the earlier one.
- Audit failure rolls back every change.
- Password and hash are absent from logs, audit JSON, OpenAPI examples, list/detail reads, and replay output.
- Concurrent regeneration attempts produce one valid version transition and one stale conflict unless they are the same idempotent command.
- Existing create, promotion, scope, status, salary, dashboard, and observability tests remain green.

### Contract tests

Update runtime validation and OpenAPI for both endpoints and the recovery-required result fields. Regenerate the checked contract.

The frontend must be able to distinguish:

- First response contains a temporary password.
- Replay contains no password and requires regeneration.

Do not expose implementation errors or hashes.

## Scope limits

Do not implement:

- Self-service password reset.
- Forgot-password email.
- Email delivery.
- Password viewing.
- Stored or encrypted plaintext passwords.
- Deterministic passwords.
- MFA, SSO, custom roles, or Admin demotion.
- Frontend HR-access pages.
- AI, dashboard, or salary changes.

Do not edit `docs_human/**`.

Never read or create `.env`. Never run Git commands. Do not commit or push. Use only the isolated automated test database.

## Validation

Run:

```text
cd express-backend
npm run check
DATABASE_URL=<isolated acme_test URL> npm run test:db
npm run build
```

## Response

Write:

```text
builder_docs/responses/11a-temporary-password-recovery.md
```

Include:

- Reproduced failing test.
- Files changed.
- API and transaction behavior.
- Lost-response recovery proof.
- Secret-leak checks.
- Exact validation commands and results.
- Any check not run and why.
- Confirmation that no `.env` read, development-database write, Git command, commit, or push occurred.

Stop after this correction. Do not begin frontend HR-access work.