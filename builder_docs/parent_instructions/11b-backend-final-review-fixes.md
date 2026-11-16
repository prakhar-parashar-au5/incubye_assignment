# Backend Task 11b: final dashboard and HR-access review fixes

**Status:** READY

## Goal

Close the remaining independently confirmed backend findings before dashboard and HR-access frontend work is accepted.

Do not add new product areas. Fix only:

1. Soon-to-join future-adjustment commitment accounting.
2. Temporary-password self-regeneration lockout.
3. Sign-in racing password regeneration.
4. Missing dashboard service-unavailable test coverage.
5. Dashboard measurement evidence mismatch.

## Read first

```text
docs_human/10-compensation-dashboard.md
docs_human/12-hr-access-management.md
builder_docs/parent_instructions/10-dashboard-analytics-api.md
builder_docs/responses/10-dashboard-analytics-api.md
builder_docs/parent_instructions/11a-temporary-password-recovery.md
builder_docs/responses/11a-temporary-password-recovery.md
semantic-review/2026-11-16-210208-pr-backend-10.md
semantic-review/2026-11-16-205936-pr-backend-11a.md
```

Reproduce each behavioral finding with a failing test before changing implementation.

## 1. Soon-to-join future commitment

A `SOON_TO_JOIN` employee can have their initial future compensation record and a later approved future adjustment. The dashboard currently lists the later adjustment but totals only the selected initial compensation because future-change impact is restricted to `CURRENTLY_WORKING`.

The commitment formula is:

```text
For SOON_TO_JOIN:
  selected initial annual cash compensation
  + signed impact of the one approved later future adjustment, when present

For CURRENTLY_WORKING:
  signed impact of the approved future adjustment

LEFT contributes nothing.
```

Keep each native currency separate.

Add a real-MySQL fixture where a soon-to-join employee has:

- Initial future compensation.
- A later approved increase or decrease.

Prove that:

- The upcoming list contains the adjustment once.
- The soon-to-join count remains one employee.
- Initial annual cash is counted once.
- Signed future impact is counted once.
- Total commitment equals initial cash plus signed impact.
- Scope and currency filters apply before aggregation.
- A `LEFT` employee never contributes.

Do not change the response schema unless a proven correctness requirement makes it unavoidable.

## 2. Prevent self-regeneration lockout

An Admin must not regenerate their own temporary password. Self-regeneration revokes the current session; if the response is lost, a sole Admin cannot authenticate to recover.

Reject self-regeneration at both preview and confirmation, before password hashing or any write.

Use one explicit public error code and message. Recommended behavior:

```text
409 SELF_PASSWORD_REGENERATION_FORBIDDEN
Ask another active Admin HR user to regenerate your temporary password.
```

Update runtime contract and OpenAPI. Do not reuse the last-active-Admin deactivation message.

Prove that rejection changes no password hash, session, version, or audit row. Test both a sole Admin and an Admin when another Admin exists.

## 3. Serialize sign-in with password replacement

Confirmed race:

1. Sign-in reads and verifies the old hash.
2. Regeneration replaces the hash and revokes existing sessions.
3. Sign-in inserts a new session after the revocation statement.
4. The session created from the old password remains active.

Remove this race.

A valid design is to run known-user sign-in on one connection and transaction, lock the HR-user row while verifying the password and inserting the session, then commit. Regeneration already obtains an update lock on that row. The required ordering is:

- If sign-in locks first, regeneration later revokes the newly inserted session.
- If regeneration locks first, sign-in reads the new hash and the old password fails.

Preserve:

- One Argon2 verification for known and unknown-email paths.
- Generic invalid-credential behavior.
- Current ACTIVE-status check.
- Two-hour JWT/database-session behavior.
- No plaintext password logging or storage.
- Existing authentication API contract.

Add a deterministic concurrency test with a controlled barrier. Do not rely only on timing or repeated probabilistic loops.

## 4. Dashboard unavailable behavior

Add focused route tests proving recognized database connectivity or lock-timeout failures become:

```text
503 SERVICE_UNAVAILABLE
```

The body and logs must not contain SQL, connection URLs, credentials, stack traces, or query parameters with sensitive values.

Do not weaken unexpected-error handling.

## 5. Measurement evidence

The Task 10 report claims fifteen-run ranges while the saved measurement file records three runs.

Resolve this honestly by either:

- Rerunning the documented scenarios with fifteen measured runs and replacing the saved evidence; or
- Correcting the response documentation to match the actual three-run evidence and clearly marking the earlier fifteen-run statement as incorrect.

Do not fabricate measurements. If rerunning, use only synthetic data in `acme_test`, record setup and run count, and reset the test database afterward.

The previously observed 11.9-second stale-statistics outlier remains a documented risk unless the new evidence disproves its cause. Do not add an index or `ANALYZE TABLE` hook without measured evidence.

## Regression tests

Run:

```text
cd express-backend
npm run check
DATABASE_URL=<isolated acme_test URL> npm run test:db
npm run build
```

All salary, dashboard, HR access, assistant, MCP, and observability tests must remain green.

## Scope limits

Do not modify:

```text
next-frontend/**
docs_human/**
express-backend/src/assistant/observability/**
```

Do not implement frontend pages, general password reset, email delivery, MFA, SSO, dashboard caching, new dashboard endpoints, or AI integration.

Never read or create `.env`. Never run Git commands. Do not commit or push. Use only the isolated automated test database for database tests and measurement fixtures.

## Response

Write:

```text
builder_docs/responses/11b-backend-final-review-fixes.md
```

Include:

- Each reproduced failure.
- Files changed.
- Exact query and transaction correction.
- Deterministic sign-in/regeneration race proof.
- Self-regeneration rejection proof.
- Dashboard commitment fixture and expected arithmetic.
- 503 test evidence.
- Honest measurement evidence resolution.
- Exact validation commands and results.
- Confirmation that no frontend, AI-observability, `.env`, development-database, Git, commit, or push action occurred.

Stop after these corrections.