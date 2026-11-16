# Response 11a: temporary-password recovery

**Task:** `builder_docs/parent_instructions/11a-temporary-password-recovery.md`

**Status:** Complete and verified. Not committed.

**What changed:**
- An Admin-only **Regenerate temporary password** operation (preview and confirmation). It recovers an account whose creation response, or an earlier regeneration response, was lost.
- Both creation and regeneration results now carry `credentialRecoveryRequired`, so the frontend can tell a first response (which has the password) from a replay (which does not).
- No plaintext or encrypted password is kept, and no password is derived from the idempotency key.

## 1. Reproduced failing test

Before any implementation change, I added the required recovery journey and ten more real-MySQL tests to `test/db/hr-access.test.ts`, in a new block `temporary-password recovery (11a)`. I ran the file against the Task 11 code:

- **Result:** 46 tests, 35 pass, **11 fail**. All 11 new tests failed; every existing test passed.
- **Recovery journey failure:** the test failed at its first new assertion. The original create response has no `credentialRecoveryRequired` field: the expected value was `false`, the actual value `undefined`.
- **The gap behind it:** a same-key retry of the create returned only `temporaryPassword: null`. The regeneration endpoint did not exist, so there was no way to obtain a usable credential.

## 2. Files changed

All paths are in `express-backend/`:

| File | Change |
|---|---|
| `db/migrations/006_temporary_password_regeneration.sql` | **New.** Adds the audit action `TEMPORARY_PASSWORD_REGENERATED`. Adds the check `chk_access_audit_regeneration`: this action must record a reason, a revoked-session count, and the resulting version. No new table. |
| `src/access/hr-users.ts` | New `regenerateTemporaryPassword` on the existing `changeHrUser` path, so it reuses the lock order, actor check, replay, expected version, preview confirmation, session revocation, version increment, and audit. The new action is added to the audit actions and to the session-revoking set. The operation refuses any hash that is not Argon2id. |
| `src/access/access-command.ts` | New operation kind `REGENERATE_PASSWORD`, covered by the existing fingerprint and preview digest. |
| `src/access/hr-access-service.ts` | New `previewPasswordRegeneration` and `regeneratePassword`. The create result gains `credentialRecoveryRequired`. |
| `src/http/hr-access-routes.ts` | The two routes, behind the same authentication, Admin check, strict body, and `Idempotency-Key` rules. |
| `src/http/contract.ts` | Paths; request schemas (`expectedVersion`, `reason` of 1 to 2,000 characters after trimming, `previewToken`); `HrUserPasswordRegenerationPreview` and `HrUserPasswordRegenerationResult`; `credentialRecoveryRequired` on `HrUserCreateResult`; the new audit action; the warning and notice texts. |
| `src/http/openapi.ts`, `openapi/openapi.json` | The two operations, with the contract regenerated. |
| `test/db/hr-access.test.ts` | The 11 new tests. The existing creation tests now also assert `credentialRecoveryRequired` (`false` on the first response, `true` on the replay). |
| `test/http-openapi.test.ts` | Endpoint list (38); request and response schemas for both operations; `credentialRecoveryRequired` required on both result schemas; strict bodies and the reason limits; the new audit action; no `$argon2id$` text and no `example` in the published contract. |
| `test/db/access-schema.test.ts`, `test/db/salary-adjustment-schema.test.ts` | `006` added to the migration lists. These lists already included the other agent's `005`. |
| `test/support/http.ts` | `fakeHrAccess()` gains the two methods. |

I did not edit the other agent's observability files or `docs_human/`.

## 3. API and transaction behaviour

```text
POST /api/v1/hr-users/:hrUserId/regenerate-temporary-password/preview
POST /api/v1/hr-users/:hrUserId/regenerate-temporary-password
```

**Requirements on both endpoints:**
- A current, active Admin HR session. Scoped HR gets `403` before the body is read; no session gets `401`.
- A valid target (otherwise `404`).
- A strict body `{ expectedVersion, reason }`. The reason is 1 to 2,000 characters after trimming.
- The confirmation also needs `previewToken` and an `Idempotency-Key` header.

**Preview (writes nothing, contains no password).** It returns:
- `target`: name, email, role, status;
- `expectedVersion`, which must equal the current version (otherwise `409 STALE_VERSION`);
- `sessionsToRevoke`: active sessions that are neither revoked nor expired;
- the fixed `warning`: "Confirming replaces this HR user's password. Every previous password and every active session stops working.";
- the trimmed `reason`;
- a five-minute `previewToken` and `previewExpiresAt`. The token uses the existing token rules and is bound to actor, session, target, version, and reason.

**Confirmation:** the existing Task 11 path, in one `READ COMMITTED` transaction.
- **Before the transaction:** the service checks the preview-token signature and binding, ignoring expiry. It then generates a new random temporary password with `crypto.randomInt` and hashes it with Argon2id.
- **Inside the transaction:**
  1. Lock the actor and target in the established ascending-ID order.
  2. Recheck that the actor is an active Admin.
  3. Check for a replay (same actor and key): the same fingerprint replays, and any other command returns `409 DUPLICATE_OPERATION`. This runs before the stale check.
  4. Check `expectedVersion` (`409 STALE_VERSION`), then the exact preview (`PREVIEW_EXPIRED` or `PREVIEW_MISMATCH`).
  5. Store **only** the new Argon2id hash.
  6. Revoke every active session of the target.
  7. Increment `hr_users.version` once.
  8. Write one `TEMPORARY_PASSWORD_REGENERATED` event with actor, target, reason, resulting version, and revoked-session count. The before and after states hold access fields only.
  9. Commit.
- **After the commit:** the plaintext password is returned in the response, once. Any failure before commit rolls back the hash, the session revocation, the version, and the audit row.

**Confirmation response:**
- the updated `hrUser` detail and version;
- the `auditEvent`;
- `revokedSessionCount`;
- `temporaryPassword` (once) with `credentialRecoveryRequired: false`;
- `temporaryPasswordNotice`: "Share this temporary password through an approved channel. It is shown only once and no email was sent."

**Replay (same key and same command).** Nothing is regenerated, and the freshly generated hash is thrown away unused. The response has the same user and audit outcome, `temporaryPassword: null`, `credentialRecoveryRequired: true`, and the notice "This regeneration already completed. Its temporary password cannot be shown again. Preview and confirm a new regeneration to get a new one." The `Idempotency-Replayed: true` header is set.

**Create replay.** It now returns `credentialRecoveryRequired: true` with the notice "This HR user already exists. The temporary password was shown only in the original response and cannot be shown again. Regenerate a temporary password to get a new one." A first successful create returns `credentialRecoveryRequired: false`.

## 4. Lost-response recovery proof

These are real-MySQL tests over HTTP.

**Recovery journey:**
1. **Given** an Admin creates a user and the `201` response is treated as lost.
2. **When** the Admin retries with the same key, the response is `201`, replayed, `temporaryPassword: null`, `credentialRecoveryRequired: true`, with a notice naming regeneration. The Admin then previews and confirms a regeneration.
3. **Then:**
   - exactly one account has that email;
   - a new temporary password is returned once, with `credentialRecoveryRequired: false`;
   - it signs in;
   - the lost creation password no longer signs in.

**Lost regeneration response.** A first regeneration's password is treated as lost. A fresh preview and a new key return a different password that signs in. The lost one stops working, and the version advances from 1 to 3.

**Other tests in the block:**
- Scoped HR gets `403` and no session gets `401`, with nothing written.
- The preview returns the exact body, including 2 active sessions after a third was signed out, and writes nothing. A preview against an old version returns `409`.
- The stored hash changes and matches `$argon2id$v=19$m=19456,t=2,p=1$`. Both sessions are revoked and their tokens return `401`. The old password fails and the new one signs in. Exactly one audit event is written, with the expected fields.
- A stale confirmation returns `409` and changes nothing: hash, scopes, sessions, version, and audit count stay the same. The response has no password field.
- A same-key replay leaves the hash and version unchanged and returns the identical audit event without the password. The same key with another reason, another expected version, or another target returns `DUPLICATE_OPERATION`.
- When the audit insert is forced to fail (a temporary `CHECK`), the request returns `500 INTERNAL_ERROR`. Hash, sessions, version, and audit are unchanged, and the old password still signs in.
- Concurrency:
  - Two Admins confirming with different keys from the same version: one `200` and one `409 STALE_VERSION`. The winner's password works and the version is 2.
  - The same key sent twice at once: both return `200`. Exactly one carries a password, one has `credentialRecoveryRequired: true`, the version is 2, and there is one audit event.
- Validation: a missing, blank, or 2,001-character reason, a missing `expectedVersion`, or an extra field returns `400` on both endpoints. A missing `Idempotency-Key` returns `IDEMPOTENCY_KEY_REQUIRED`, and an unknown user returns `404`.

**Mutation checks** (code broken temporarily and restored; a marker search confirmed the restore):
- With the new action removed from the session-revoking set, the session test and the recovery journey failed. The journey failed because the new database check rejected an event without a revoked-session count.
- With the password returned on replay, the replay test and the same-key concurrency test failed.

## 5. Secret-leak checks

A test searches each of these for the new password, the stored hash, and the text `$argon2id$`, and finds none:
- the replay response;
- the preview;
- the detail and list responses;
- the audit endpoint;
- every captured log entry;
- the checked-in `openapi/openapi.json`.

The audit rows (state JSON and reason) contain neither the password nor the hash. The idempotency key does not appear in the audit endpoint's output. The OpenAPI test also checks that the contract has no `$argon2id$` text and no `example` values, and that the regeneration preview schema has no `temporaryPassword` property. The Task 11 secret, log, and response checks still pass.

## 6. Validation commands and results

All commands run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run openapi:generate` | wrote `openapi/openapi.json` |
| `npm run check` | exit 0. Lint, typecheck, and 381 fast tests pass, 0 fail (the count includes the other agent's observability unit tests). |
| `DATABASE_URL='mysql://acme:…@127.0.0.1:3317/acme_test' npm run test:db` | exit 0. 344 tests, 344 pass, 0 fail, 0 cancelled. This includes `hr-access` (46) and the create, promotion, scope, status, salary, dashboard, and observability suites. |
| `npm run build` | exit 0 |

**Database used:** only the isolated `acme_test` database. Before the final runs, I checked the active connections. One idle `acme_test` connection had been asleep for about 38 minutes, and two connections to `acme_dev` came from someone else's process. None of them was running statements against `acme_test`, and every run completed with no failures. I wrote nothing to `acme_dev`.

**Checks not run:** none of the required checks were skipped. I measured no performance figures; the task does not ask for any.

## 7. Known limits

- **A replay needs the original session.** As with every Task 11 write, a replay is bound to the preview's session. After signing in again, a retry gets `PREVIEW_INVALID`. The recovery path still works: a fresh preview and a new key regenerate again.
- **Regeneration works on any status.** It is allowed for inactive users, who still cannot sign in until reactivated, and for the actor's own account, which then loses its own sessions. The task does not restrict either case.
- **Every regeneration costs one Argon2id hash,** including replays, whose hash is computed and then discarded.

## 8. Confirmations

- No `.env` file was read or created.
- Nothing was written to the development database; only `acme_test` was used.
- No Git command was run, and nothing was committed or pushed.
- No frontend, AI, dashboard, or salary code was changed, and `docs_human/` was not edited.
- Out of scope and not built: self-service reset, forgot-password email, email delivery, password viewing, stored or encrypted plaintext, and deterministic passwords.
- Work stopped after this correction. No frontend HR-access work was started.
