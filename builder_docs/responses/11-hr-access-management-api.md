# Response 11: HR access-management API

**Task:** `builder_docs/parent_instructions/11-hr-access-management-api.md`

**Status:** Complete and verified. Not committed.

**Checkpoint caveat:** the task status is "READY AFTER CURRENT BACKEND COMMIT". I cannot check that without Git, so I built on the working tree as it stands, with Tasks 09, 09a, and 10 included. I added a new migration, `004`, rather than editing `003`, on the assumption that `003` is now committed.

**Concurrent work in the same workspace (not mine).** While I worked, another agent added AI-observability files and did not touch Task 11 code:
- `db/migrations/005_ai_observability.sql`;
- `src/assistant/observability/*`;
- `test/observability-storage.test.ts` and `test/db/observability-storage.test.ts`.

That agent also updated the migration lists in `test/db/access-schema.test.ts` and `test/db/salary-adjustment-schema.test.ts` to include `005`, and kept my `004` entries. I did not edit any of their files. Both agents use the same `acme_test` database. Section 9 shows the interference this caused.

## 1. Route design

The routes are exactly the ones in `docs_human/12`. Nothing was renamed. All of them are under `/api/v1`, and all require a Bearer session for an **active Admin HR** user.

| Method and path | `operationId` | Result |
|---|---|---|
| `GET /hr-users` | `listHrUsers` | `HrUserListResponse` |
| `POST /hr-users/preview` | `previewHrUserCreation` | `HrAccessPreview` |
| `POST /hr-users` | `createHrUser` | `201 HrUserCreateResult` |
| `GET /hr-users/{hrUserId}` | `getHrUser` | `HrUserDetailResponse` |
| `GET /hr-users/{hrUserId}/access-audit` | `listHrUserAccessAudit` | `AccessAuditResponse` |
| `POST /hr-users/{hrUserId}/profile/preview` and `POST …/profile` | `previewHrUserProfile`, `updateHrUserProfile` | preview, `HrUserChangeResult` |
| `POST …/promote/preview` and `POST …/promote` | `previewHrUserPromotion`, `promoteHrUser` | preview, `HrUserChangeResult` |
| `POST …/scopes/preview` and `PUT …/scopes` | `previewHrUserScopes`, `replaceHrUserScopes` | preview, `HrUserChangeResult` |
| `POST …/deactivate/preview` and `POST …/deactivate` | `previewHrUserDeactivation`, `deactivateHrUser` | preview, `HrUserChangeResult` |
| `POST …/reactivate/preview` and `POST …/reactivate` | `previewHrUserReactivation`, `reactivateHrUser` | preview, `HrUserChangeResult` |

That makes 15 new operations, and the published contract now has 36. Internally, one route table and one service method handle all five change operations, so the shared rules are written once.

**Shared rules for every write:**
- **Authentication and role.** The route checks authentication first, then the role. Scoped HR gets `403 FORBIDDEN` before the body is read.
- **Strict bodies.** Bodies are strict Zod objects, so unknown, malformed, or extra fields return `400`.
- **Required fields.** An `Idempotency-Key` header is required. Every write to an existing user also needs `expectedVersion` and the `previewToken` from its preview.
- **Preview body.** Each preview takes the same body without `previewToken`. `expectedVersion` is required here too, so a preview against an old version already returns `409`.
- **No client-chosen password.** The create body has no `password` field: the server generates it.

**Bodies:**

| Operation | Body |
|---|---|
| Create | `{ email, displayName, role, countries, departments }` |
| Profile | `{ expectedVersion, displayName }` |
| Promote | `{ expectedVersion }` |
| Scopes | `{ expectedVersion, countries, departments }` (both lists replaced together) |
| Deactivate | `{ expectedVersion, reason }` (1 to 2,000 characters after trimming) |
| Reactivate | `{ expectedVersion, reason }` (1 to 500 characters, my reading of "short") |

**List query** (strict; a repeated or unknown parameter returns `400`):
- `q`: partial display name, ignoring case, or exact email, ignoring case. Wildcards are treated as literal characters.
- `role`.
- `status`: `ACTIVE`, `INACTIVE`, or `ALL`. The default is `ACTIVE`, and `ALL` is "Include inactive users".
- `country` and `department`: Admin HR always matches, as "All employees".
- `sort`: `updatedAt` (default), `name`, or `email`.
- `direction`: defaults to `desc` for `updatedAt` and `asc` otherwise. Ties break on ID.
- `page` and `pageSize` (default 25, maximum 100).

Filtering, ordering, `LIMIT`, and `OFFSET` all run in MySQL.

**Responses:**
- **Detail** returns the user's current scope, `accessSummary`, `accessibleEmployeeCount`, and `noAccessMessage`. The message is "This HR user currently has access to no employees." whenever the count is 0.
- **No-change confirmation** returns `200` with `changed: false` and `auditEvent: null`.
- **Errors** follow the spec: `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 STALE_VERSION | DUPLICATE_OPERATION | LAST_ACTIVE_ADMIN | EMAIL_TAKEN`, `422 INVALID_SCOPE`, `503 SERVICE_UNAVAILABLE`.
- **New public codes.** I added `LAST_ACTIVE_ADMIN`, `EMAIL_TAKEN`, and `INVALID_SCOPE`. The approved message texts are used for the last-Admin block and for a duplicate email. The stale-version message for HR users is "This HR user changed after your preview. Review the current state and preview again."

## 2. Migration changes

The new migration is `db/migrations/004_hr_access_management.sql`. It only extends the existing `access_audit_events` table. There is no new table and no second audit model.

**New audit actions:** `DISPLAY_NAME_CHANGED`, `SCOPES_REPLACED`, `HR_USER_PROMOTED`. The five existing actions stay valid.

**New columns:**

| Column | Purpose |
|---|---|
| `reason VARCHAR(2000)` | Deactivation and reactivation notes |
| `resulting_version` | `hr_users.version` after the change |
| `revoked_session_count` | A count only, never session IDs |
| `operation_idempotency_key` | The actor's `Idempotency-Key` |
| `operation_fingerprint CHAR(64)` | SHA-256 hex of the command |

**New key:** a unique key `uk_access_audit_operation_key (actor_hr_user_id, operation_idempotency_key)`.

**New checks:**
- The key and the fingerprint must both be set or both be NULL.
- A key requires an actor.
- The fingerprint must be lowercase hex.
- A reason cannot be blank.
- An API status change must carry a reason.

**Backfill:** creation events get `resulting_version = 1`. Other events written before `004` keep NULL, meaning "not recorded", rather than a guessed version.

**Audit state** now always includes `displayName`, alongside `role`, `status`, `countries`, and `departments`, so a name change has a meaningful before and after. Older rows lack it, and the API returns `displayName: null` for them.

## 3. Reuse of the existing operations

`src/access/hr-users.ts` is still the single authority. I extended it rather than writing a parallel layer:

- **Shared change path.** `changeHrUser` (one locked, audited change) now handles the lock order (section 5). In order, it takes the optional `expectedVersion`, the idempotent replay, an optional `confirm` hook that runs under the locks, session revocation for promotion and deactivation, the version increment, and the extended audit row.
- **New operations** built on that path:
  - `replaceScopes`: both scope lists and one `SCOPES_REPLACED` event.
  - `setDisplayName`.
  - `promoteToAdmin`: removes the scope rows and revokes sessions.
- **Extended operations:**
  - `setHrUserStatus` gains a reason, and deactivation now revokes sessions.
  - `createHrUserOperation` (idempotent create) sits under the unchanged `createHrUser`, which still returns the new user's ID.
- **Error marking.** `AccessError` gains an `invalidScope` flag, so scope errors become `422 INVALID_SCOPE` while the domain code stays `INVALID_INPUT`. Existing tests depend on that code.
- **Unchanged.** Existing call signatures still work, with every new option optional. The API service always passes them all. A no-op still returns exactly `{ changed: false }`.
- **New files:**
  - `src/access/hr-access-service.ts`: the application service (reads, previews, writes, views).
  - `src/access/access-command.ts`: the canonical fingerprint and preview digest.
  - `src/access/access-preview-token.ts`: five-minute signed preview tokens, with their own audience and key label.
  - `src/http/hr-access-routes.ts`.
- **Changed files:**
  - `src/access/passwords.ts`: `generateTemporaryPassword`.
  - `contract.ts`, `openapi.ts`, `app.ts`, and `server.ts`: wiring.
  - `openapi/openapi.json`: regenerated.
- **Permissions model.** The employee count uses the directory's existing `scopeCondition` SQL, so the access policy has one implementation.

## 4. Preview and idempotency design

**Preview (writes nothing).** The preview:
1. Loads the target and checks `expectedVersion`.
2. Validates scope values against `countries` and `departments`.
3. Applies the workflow rules: an Admin has no scopes, and a new Scoped user needs at least one country and one department.
4. Rejects a taken email (`EMAIL_TAKEN`) and a last-Admin deactivation (`LAST_ACTIVE_ADMIN`).

It returns:
- the old and proposed display name, role, status, countries, departments, access summary, and estimated employee count;
- `changed` and `changedFields`;
- `sessionsToRevoke`: active, unrevoked sessions, counted only for promotion and deactivation;
- the trimmed `reason`, and the token with its expiry.

The access summary lists the exact cross-product, for example `India + Support, India + Tech`. An empty list shows "This scope grants access to no employees.".

**Preview token.** The token is a JWT signed with an HMAC (keyed hash) key derived from `JWT_SIGNING_KEY` under its own label, so it cannot verify as a session or salary token. It lasts 5 minutes and carries the actor, session ID, operation, target, expected version, and a SHA-256 digest. The digest covers the normalized command plus the exact proposed state. The token holds no email, name, reason, or password.

**Fingerprint.** A separate SHA-256, under its own label, over the operation, target, expected version, and normalized command: email in lower case, trimmed text, sorted lists. It is stored on the audit event the operation wrote.

**Confirmation order:**
1. Strict body.
2. Scope values checked (`422`).
3. Token signature and binding, ignoring expiry (`400 PREVIEW_INVALID`).
4. Inside the transaction, under the locks:
   - **Actor check:** the actor must be an active Admin (`403`).
   - **Replay check:** the same actor and key with the same fingerprint returns the original result, with an `Idempotency-Replayed: true` header. A different fingerprint (other data, another operation, or another target) returns `409 DUPLICATE_OPERATION`.
   - **Version check:** `expectedVersion` must equal the current version (`409 STALE_VERSION`).
   - **Full token check:** expiry (`PREVIEW_EXPIRED`), then the token's version against the body, then the digest. The digest is recomputed from the **locked** current state, which catches `PREVIEW_MISMATCH`.
   - **Last-Admin check:** applies to deactivation.
5. The change.

The replay check comes before the version check, so a retry after a success returns the original result rather than a stale conflict. As in Task 09, a replay still works after the token has expired.

**Replay result.** The response is rebuilt from the stored audit event (exact before, after, and version) plus the user's current detail. A no-change confirmation stores nothing, so a replay of it is simply evaluated again.

## 5. Transaction and lock order

Every write runs one `READ COMMITTED` transaction. Its first statement is a single locking read:

```sql
SELECT id, role, status FROM hr_users
WHERE id IN (actor, target) [OR (role = 'ADMIN' AND status = 'ACTIVE')]
ORDER BY id FOR UPDATE
```

- **Which rows.** The bracketed part applies to deactivation and promotion, which reuses the active-Admin ordering for role changes as instructed.
- **Why one statement.** All HR-user row locks are taken in ascending ID order. Two access-management writes therefore never deadlock on HR rows, and concurrent last-Admin checks run one after another.
- **Why it replaces the earlier pattern.** The previous pattern was actor `FOR SHARE`, then target `FOR UPDATE`. It could deadlock in two cases: two Admins changing each other at the same time, or two concurrent self-edits.
- **After the lock,** in order: actor check, target state, replay, expected version, preview confirmation, the change, then:
  - `UPDATE hr_sessions SET revoked_at = now` for that user's active sessions (promotion and deactivation only);
  - `version = version + 1`;
  - the audit insert;
  - commit.
- **Failure handling.** Any throw rolls back all of these steps together.
- **Create.** Creation locks the actor row `FOR UPDATE`, so two concurrent retries with the same key run one after the other. The second sees the first's audit row and replays instead of failing with `EMAIL_TAKEN`.
- **Other features.** Salary and sign-in only take shared foreign-key locks on `hr_users` while holding nothing these transactions wait for, so I found no lock cycle across features.

## 6. Temporary password

- **Generation.** 20 characters drawn by `crypto.randomInt` from 56 symbols with no look-alikes (`0 O 1 l I`), about 116 bits of randomness.
- **Storage.** It is hashed with the existing Argon2id parameters before the transaction. Only the hash is stored.
- **Delivery.** It is returned once, as `temporaryPassword` in the `201` response, with the notice: "Share this temporary password through an approved channel. It is shown only once and no email was sent."
- **Replay.** A replay of the same creation returns `temporaryPassword: null` and a notice that it cannot be shown again.
- **Never elsewhere.** It never appears in logs, audit rows, URLs, later reads, or error bodies, and tests check each of these.

## 7. Tests and the defects they detect

**`test/db/hr-access.test.ts`: 35 tests on real MySQL over HTTP.** The fixture has 13 employees with hand-counted scope totals.

| Area | Tests | Detects |
|---|---|---|
| Permissions | Admin lists and views; Scoped HR gets `403` on all 15 operations with nothing written (users, audit, scopes, sessions); `401` without a session; an inactive Admin's session fails (`401`), and a principal loaded before deactivation is rejected by the service (`FORBIDDEN`) with no change | Scoped access; authority taken from request context instead of the current row |
| Creation | Exact preview with combinations and count (10) that writes nothing; Scoped and Admin creation; the password signs in, is stored as an Argon2id hash only, and gets one audit event at version 1; Admin with scopes, Scoped with an empty list, and unknown values return `422`; duplicate email ignoring case returns `409 EMAIL_TAKEN`, including a preview made before the email was taken; password absent from later reads, a replay, logs, and audit; same key returns one user, also under concurrent retry, while the same key with other data returns `DUPLICATE_OPERATION` | Plain storage; password leaks; double creation |
| Scope | Counts for IN×Tech (3), IN×(Tech, Support) (5), (IN, US)×Tech (7), (IN, US)×(Tech, Support) (10), US×HR (1), which checks OR within a list and AND across lists; one `SCOPES_REPLACED` event with exact states; the same session sees the new scope on its next request; an empty stored scope loads with count 0 and the approved messages; unknown values (`GB`, `Legal`, `tech`) return `422` and malformed or repeated values return `400` | Two-step replacement; cached scope; empty scope treated as "all" |
| Role | Promotion removes scope rows, revokes 2 of 2 sessions, logs the old token out, and audits the removed scopes; demotion via profile returns `400`; scopes on an Admin return `422`; promoting an Admin changes nothing | Leftover scopes or sessions; a demotion path |
| Status | Deactivation revokes every session and reactivation restores role and scopes but no sessions (old tokens stay `401`); reason required within limits; 5 rounds of two Admins deactivating each other concurrently each leave exactly 1 active Admin | Sessions surviving deactivation; zero Admins |
| Concurrency and idempotency | Expected version and key required on all five operations; a stale confirmation returns `409` and leaves the user, scopes, sessions, version, and audit unchanged; replay returns the identical audit event, also after the token expired; same key with another command, operation, or target conflicts; a new key with an old preview is stale; two concurrent scope changes give one `200` and one `409`; mismatched body returns `PREVIEW_MISMATCH`, while a tampered token, another actor's token, another target, or another operation returns `PREVIEW_INVALID`; expiry at exactly 5 minutes returns `PREVIEW_EXPIRED` | Double application; lost updates; preview substitution |
| Audit | Newest-first list with actor, target, before and after states, reason, version, and pagination; no-change writes nothing; a forced audit insert failure rolls back promotion, deactivation, scope change, profile change, and creation (all `500`, state unchanged); no update or delete route exists, and no `UPDATE`/`DELETE` of `access_audit_events` appears anywhere in `src`; no secret appears in audit rows, and the state keys are exact | Missing history; changes committed without their audit event; secrets in audit |
| API | Search (partial name, exact email ignoring case, literal `%`), role, status, country and department filters (Admin matches all), the three sorts, pagination totals, empty-result message, and rejected parameters; strict bodies reject extra and malformed fields, including a client-chosen `password`; responses contain no hash, session ID, or token; logs hold only the six safe keys with route patterns, and never the email, reason, password, or token | Injection through sort or filters; leaks |
| Migration 004 | Only `access_audit_events` exists as an audit table; exact new columns; each new check rejects a bad row | Second audit table; malformed operations |
| Last Admin | Self-deactivation of the last active Admin returns `409` with the approved message, at preview and at confirmation (a preview made while another Admin was active), with no change; self-deactivation succeeds when another Admin is active, and the session ends | Lockout |

**Other test changes:**
- `test/passwords.test.ts`: +1. It generates 2,000 passwords and checks length, alphabet, uniqueness, symbol spread (every symbol appears, each 500 to 950 times against about 714 expected), and the absence of look-alikes.
- `test/http-openapi.test.ts`: endpoint list now 36; a new HR-operations test (auth, `Idempotency-Key`, request and response schemas, error codes, strict bodies with no `password`, list parameters); the routed-operations check now handles `PUT` and `{hrUserId}`; three new error codes added to the code list; drift test against the regenerated `openapi.json`.
- `test/db/access-control.test.ts`: 3 assertions now expect `displayName` in the audit state. This is a deliberate extension of the audit format; no other part of those assertions changed.
- `test/db/access-schema.test.ts` and `test/db/salary-adjustment-schema.test.ts`: the migration lists include `004`, and the index list includes `uk_access_audit_operation_key`.
- `test/support/http.ts`: `fakeHrAccess()` added. Seven `createApp` callers pass it. Salary and dashboard tests changed only in that one line.

## 8. Failures actually observed

**Before implementation (red):**
- `hr-access.test.ts` against a stub service: **31 of 34 failed**. The 3 that passed check behaviour that sits outside the service: the Scoped HR `403` from the route role check, the `401`s, and the absence of audit update/delete routes.
- `http-openapi.test.ts` before the OpenAPI entries: **3 failed** (endpoint list, HR operations, drift).
- **Never red:**
  - The password-generator test: I wrote the generator before its test.
  - The migration-004 test: added after the implementation.

**Existing tests failing after my change:** 7, all of them intended changes to the contract:
- 3 in `access-control`: `displayName` in the audit state.
- 1 in `access-schema`: the new unique key.
- `records every migration` in `access-schema` and the migration list in `salary-adjustment-schema`: these listed migrations 001 to 003 only. My `004` and the other agent's `005` both broke them.
- `migration 002 creates the five approved access tables`: caused only by the other agent's `ai_*` tables. I did not edit that assertion. That agent later updated the shared lists.

**First run against the real implementation:** all 34 passed. Because nothing failed, I checked that the tests can fail by mutating the code temporarily, running the tests, and restoring the file (a marker search returned 0 after each restore):
- **No `FOR UPDATE` in the lock statement:** "same key creates one user… concurrently" and the cross-deactivation race failed, followed by a cascade (16 of 35 failed).
- **No session revocation:** both promotion and deactivation tests failed.
- **No expected-version check:** the stale test and the concurrent-scope test failed.
- **No digest comparison:** the "must match an unexpired preview" test failed.

## 9. Commands and results

All commands run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run openapi:generate` | wrote `openapi/openapi.json` |
| `npm run check` (lint, typecheck, unit tests) | exit 0; 381 pass, 0 fail. 375 are mine (373 before, plus 1 password test and 1 OpenAPI test); 6 are in the other agent's `test/observability-storage.test.ts` |
| `npm run build` | exit 0 |
| `DATABASE_URL='mysql://acme:…@127.0.0.1:3317/acme_test' npm run test:db` | **326 pass, 0 fail, 0 cancelled**. This includes `hr-access` (35) and every salary and dashboard regression test. The remaining 9 belong to the other agent's observability DB file |

**Interference in the shared test database, explained.** Earlier full and partial runs showed failures in `assistant-tools.test.ts`: 8 failed and 15 were cancelled in one run, and other files failed in another. Assistant code is unchanged. Running the same tool directly against the database afterwards succeeded. A watcher on `SHOW PROCESSLIST` during one failing run recorded `DROP TABLE` statements from other connections. The other agent's test resets were dropping the shared `acme_test` tables during my run. I then waited until the database had been idle for 90 seconds and ran the full suite with no interference: the 326/0 result above. The `acme` user only has privileges on `acme_test`, so I could not isolate the runs in a second database.

**Typecheck timing.** At one point `npm run typecheck` failed only on the other agent's `test/db/observability-storage.test.ts`, which imported a `repository.ts` that did not exist yet. Their later file fixed it. The final `check` above passes.

## 10. Known limits

- **A lost creation response loses the password.** If the `201` response never reaches the browser, a retry with the same key returns the user but not the password, because only the hash exists. With no password reset (out of scope), that account cannot sign in until a reset feature exists. The email is then taken, and the account can only be deactivated. This is a real product gap; see open decision 1.
- **Replays are bound to one session.** Like Task 09, a replay needs the original session. After signing in again, a retry gets `PREVIEW_INVALID`, and a fresh preview shows the current, already-changed state.
- **No-change confirmations store no idempotency record,** so the same key used afterwards for a different command is not detected as a duplicate. Nothing was written under it, so nothing is lost.
- **Sign-in racing a role change.** A sign-in that starts before a promotion or deactivation and inserts its session afterwards gets a new session. After deactivation that session fails on the next request, because the user check reads status. After promotion it is a sign-in at the new role, which is what "sign in again" means.
- **Locking on deactivation and promotion** locks every active Admin row and, through the scan, briefly waits on any locked HR row. That is negligible with tens of HR users; it would need a narrower lock at thousands.
- **Audit immutability is enforced in the application,** with no update or delete path in code, not by a database trigger. Creating triggers can require extra privileges when binary logging is on, which I could not confirm for Railway.
- **Promoting an inactive Scoped user** is allowed and produces an inactive Admin. The spec is silent; see open decision 3.
- **Choices of mine:** the 500-character limit for a reactivation reason, and the `status=ALL` list value for "Include inactive users".
- **The employee count** covers every employee in scope (all employment statuses), matching the directory totals.

## 11. Open decisions

1. **Recovering a lost temporary password.** Accept the gap until password reset exists, or add an Admin "regenerate temporary password" operation in a later task?
2. **Reactivation reason limit:** confirm 500 characters.
3. **Promotion of an inactive user:** allow (implemented) or reject?
4. **Frontend:** regenerate types from `openapi/openapi.json`. The list "Include inactive users" maps to `status=ALL`.
5. **Coordination with the observability task:** separate test databases, or sequential runs, would stop the two task streams resetting each other's `acme_test` tables.

## 12. Confirmations

- No Git command was run, and nothing was committed.
- No `.env` file was read.
- No frontend pages were built, and no frontend files were changed.
- Salary and dashboard behaviour is unchanged. Their source files were not edited. Their tests changed only to pass the new `hrAccess` dependency, plus `004` in the shared salary-schema migration list. All salary and dashboard regression tests pass.
- Out of scope and not built: password reset, email delivery, SSO, MFA, custom roles, demotion, paired scopes, AI traces, and agent mutations.
- I did not edit `docs_human/`, `docs/`, or the other agent's observability files.
