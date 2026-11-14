# Builder response 04: HR access-control foundation

**Task:** `builder_docs/parent_instructions/04-hr-access-control.md`
**Status:** Complete and verified. Not committed. Waiting for review.
**Scope kept:** no Express routes, frontend pages, directory API, salary routes, upload, AI, or MCP.

## Task completed

- Migration `002` adds HR users, country scopes, department scopes, sessions, and access audit events.
- A pure access policy implements country AND department, with OR within each list.
- Argon2id password hashing.
- Two-hour session JWTs.
- Sign-in, per-request authentication, and sign-out over database sessions.
- Admin HR-user changes, each committed with its audit event in one transaction.
- A documented, environment-guarded command that creates the synthetic Meera and Rohan demo users.

## Files changed (all in `express-backend/`)

| File | Change |
|---|---|
| `db/migrations/002_hr_access_control.sql` | New. Five tables. |
| `src/access/access-policy.js` | New. `canAccessEmployee`, `canManageHrUsers`, `ROLES`, `HR_STATUSES`. |
| `src/access/passwords.js` | New. `hashPassword`, `verifyPassword`, `ARGON2_OPTIONS`. |
| `src/access/session-tokens.js` | New. `createSessionTokens` (sign and verify), `readSigningKey`, `SESSION_TTL_SECONDS = 7200`. |
| `src/access/sessions.js` | New. `createAuthService` with `signIn`, `authenticate`, `signOut`. |
| `src/access/hr-users.js` | New. `createHrUser`, `setCountryScopes`, `setDepartmentScopes`, `setHrUserStatus`, `bootstrapHrUser` (system setup only), `loadHrUserState`. |
| `src/access/demo-users.js` | New. `ensureDemoUsers`, `DEMO_USERS`. |
| `scripts/seed-demo-users.js` | New. Thin command, `npm run db:seed-demo-users`. |
| `test/access-policy.test.js` | New. 16 unit tests. |
| `test/passwords.test.js` | New. 7 unit tests. |
| `test/session-tokens.test.js` | New. 10 unit tests. |
| `test/seed-demo-users-cli.test.js` | New. 4 command tests (no database). |
| `test/db/access-schema.test.js` | New. 18 real-MySQL tests. |
| `test/db/access-control.test.js` | New. 29 real-MySQL tests. |
| `test/db/initial-schema.test.js` | Changed (see below). |
| `package.json`, `package-lock.json` | Added `argon2@0.45.2` and `jose@6.2.17` (both MIT). New script `db:seed-demo-users`. |
| `README.md` | Access-control and demo-user sections; layout rows. |

**Change to a Task 02 test.** Three tests in `test/db/initial-schema.test.js` asserted the complete list of tables, keys, and foreign keys in the database. After migration 002 they failed by design: 4 failures observed. I scoped them to the five tables that migration 001 owns. The complete 11-table list is now asserted in `access-schema.test.js`. The repeat-run test now checks that `001_initial_schema.sql` is the first applied migration and that nothing new applies. No 001 rule assertion was weakened.

## Migration decisions

- **`hr_users`.**
  - `email VARCHAR(254)` uses the case-insensitive `utf8mb4_0900_ai_ci` collation, with unique key `uk_hr_users_email`.
  - `display_name` has a non-blank check.
  - `password_hash` is ASCII with `CHECK (password_hash LIKE '$argon2id$%')`, so a plain-text password is refused even if application code is bypassed.
  - `role ENUM('ADMIN','SCOPED')`, `status ENUM('ACTIVE','INACTIVE')` defaulting to `ACTIVE`.
  - `version` defaults to 1, with `CHECK (version >= 1)`.
  - `created_at` and `updated_at` are `DATETIME(3)`.
- **Scope tables.** `hr_user_country_scopes` and `hr_user_department_scopes` have composite primary keys `(hr_user_id, country_code)` and `(hr_user_id, department_id)`, plus an index on the second column. Country codes use the same ASCII binary type as `countries.code`.
- **`hr_sessions`.**
  - `id CHAR(36)` is a random UUID from `crypto.randomUUID()`, which the JWT carries as `sid`.
  - `created_at` and `expires_at` are written by the application from the injected clock, so they have no defaults. `revoked_at` is nullable.
  - `CHECK (expires_at > created_at)`.
- **`access_audit_events`.**
  - `action ENUM('HR_USER_CREATED','COUNTRY_SCOPES_CHANGED','DEPARTMENT_SCOPES_CHANGED','HR_USER_ACTIVATED','HR_USER_DEACTIVATED')`.
  - `before_state JSON NULL` (null on creation), `after_state JSON NOT NULL`. MySQL rejects invalid JSON with `ER_INVALID_JSON_TEXT`.
  - Indexes on `(target_hr_user_id, created_at)` and `(actor_hr_user_id, created_at)`.
  - `actor_hr_user_id` is nullable. NULL means a system action, used only by the demo-user command. See open decision 1.
- **Foreign keys.** All seven are `ON UPDATE RESTRICT ON DELETE RESTRICT`: a referenced HR user, country, or department cannot be deleted. HR users are deactivated, not deleted.
- **Engine.** InnoDB, utf8mb4, forward-only, as in 001.

## Hashing choice

- **Method.** Argon2id with `m=19456` KiB (19 MiB), `t=2`, `p=1`, a random salt per hash, and the PHC string format (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`).
- **Source of the parameters.** The [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) recommends Argon2id, and these are its first listed minimum configuration.
- **Library.** `argon2@0.45.2` (https://github.com/ranisalt/node-argon2), MIT, last pushed 2026-11-09, not archived.
- **Railway compatibility.** The package ships prebuilt binaries for `linux-x64` and `linux-arm64`, each in glibc and musl builds (checked in `node_modules/argon2/prebuilds`), so a Railway build needs no compiler.
- **Alternatives considered.**
  - Node 22 has no built-in Argon2: `crypto.argon2` is `undefined` here.
  - OWASP describes bcrypt as for legacy systems, and it has a 72-byte input limit.
  - `@node-rs/argon2` is also maintained. I chose `argon2`, the more widely used package with an equivalent API.
- **Verification.** Uses `argon2.verify` (constant-time). `verifyPassword` returns `false` for a wrong password or a malformed stored hash, and never throws.
- **Input limit.** At most 1,024 characters, so a request cannot make the server hash a huge string. Error messages never include the password.
- **Measured locally** (Apple M4 Pro): hash 15 ms, verify 11 ms. OWASP advises benchmarking on the target system, so Railway timing is not measured.
- **Unknown emails.** Sign-in verifies against a dummy hash when the email doesn't exist, so unknown and known emails cost about the same time.

## JWT choice

- **Library.** `jose@6.2.17` (https://github.com/panva/jose), MIT, no native code, last pushed 2026-11-12. JWT signing and parsing are not hand-written.
- **Algorithm and key.** HS256, with the key from `JWT_SIGNING_KEY` in the injected environment.
  - `readSigningKey` rejects a missing key, or one shorter than 32 bytes, without printing it.
  - No key exists in source code. Tests use labelled synthetic keys.
- **Claims.** Exactly `sub` (HR user ID as a string), `sid`, `iat`, and `exp`, with `exp = iat + 7200`. The header is `{ alg: 'HS256' }`. No `iss`, `aud`, role, status, or scopes, as the design specifies.
- **Verification rejects:**
  - Another algorithm, including `none` and HS512.
  - A bad signature.
  - `exp` at or before the injected current time.
  - A missing or extra claim.
  - A non-numeric `sub`, a non-UUID `sid`, or a lifetime other than two hours.
- **Per-request lookup.** `authenticate` verifies the token, then loads the session by both `sid` and `sub`. It rejects a missing, revoked, or expired session (database expiry checked with the injected clock), then an inactive user. Only then does it load the current country and department scopes. Every failure has the public message `authentication required`; an internal `reason` is kept for logs and tests.
- **Sign-in errors.** Unknown email, wrong password, and inactive user all return `invalid email or password`. Email matching ignores case and surrounding spaces.
- **Session times.** Truncated to whole seconds, so the database `expires_at` equals the JWT `exp`.

## HR-user operations

- `createHrUser`, `setCountryScopes`, `setDepartmentScopes`, and `setHrUserStatus` each run in one transaction:
  1. Re-read the actor's row (`FOR SHARE`) and require an ACTIVE ADMIN. Otherwise throw `FORBIDDEN`.
  2. Lock the target (`FOR UPDATE`).
  3. Apply the change, increment `version`, and write the audit event with full before and after states.
  4. Commit.
- An unchanged value returns `{ changed: false }` and writes nothing.
- Scope inputs are validated: arrays of unique strings, known country codes, and exact department names. The `ai_ci` collation alone would have accepted `tech`.
- **Audit state keys.** Exactly `role`, `status`, `countries`, and `departments`, with sorted lists. Passwords, hashes, tokens, and session IDs are never written.
- `bootstrapHrUser` creates a user without an HR actor. It is used only by the demo-user command and test setup.

## Demo users

- `npm run db:seed-demo-users`, run after `db:seed`, requires:
  - `APP_ENV` set to `development`, `test`, or `demo`; anything else, including `production`, is refused.
  - `DATABASE_URL`.
  - `DEMO_MEERA_PASSWORD` and `DEMO_ROHAN_PASSWORD`, each at least 12 characters.
- It creates:
  - Meera Iyer (`meera.iyer@acme.com`, ADMIN).
  - Rohan Mehta (`rohan.mehta@acme.com`, SCOPED, `IN`, `Tech` and `Support`).
- Each creation is audited with a NULL actor.
- A rerun creates nothing and keeps the existing password hashes. It fails if an existing demo user's role, status, or scopes have drifted.
- No password exists in source code, and none is printed.

## Tests and the defects they detect

**Access policy (16 unit tests)**

| Test | Detects |
|---|---|
| Admin can access every employee | Admin access limited by empty scope lists |
| Both match → allowed; only country, only department, or neither → denied | OR across dimensions instead of AND |
| Multiple countries; multiple departments | Only the first list entry checked |
| Full IN/US × five-department grid for `[IN, US] × [Tech, HR]` | Pairing instead of the approved cross product |
| Empty country list; empty department list | An empty list treated as "no restriction" |
| INACTIVE admin or scoped user; unknown role | A caller skipping the session check; a typo role allowed |
| `in` / `tech` denied | Case-insensitive or substring matching |
| Admin can manage; scoped and inactive admin cannot | Privilege escalation |

**Passwords (7)**

| Test | Detects |
|---|---|
| Hash is Argon2id and does not contain the password | Plain or reversible storage |
| Exact parameter prefix `$argon2id$v=19$m=19456,t=2,p=1` | Parameters below the OWASP minimum |
| Two hashes of one password have different salts | Fixed or missing salt |
| Rejects empty, non-string, and over-long input without echoing it | Empty passwords; CPU exhaustion; leaks |
| Correct password verifies; four near-miss wrong passwords fail | A verifier ignoring or truncating input |
| Malformed stored hash returns false | Sign-in crashing, or a malformed hash verifying as true |

**Session tokens (10)**

| Test | Detects |
|---|---|
| TTL is 7,200 s | A wrong session length |
| Exact decoded payload `{sub, sid, iat: 1794650400, exp: 1794657600}` and header `{alg: HS256}` | Authority claims leaking into the token. The epoch values were computed independently with `date -u` |
| Valid token round trip | A broken sign/verify pair |
| Wrong signing key | Accepting any signer |
| Fails at exactly +2 h and +24 h (injected clock) | Expiry not checked, or checked against the computer clock |
| `alg: none` and HS512 rejected | Algorithm confusion |
| A signed token with an extra `role` claim, a missing `sid`, or a non-numeric `sub` is rejected (control token accepted) | Trusting extra authority claims |
| Malformed input fails closed | Crashes on garbage input |
| Key read from the injected env; a short key is rejected without being printed | Default keys in source; weak keys; key leaks |

**Demo-user command (4, no database)**

| Test | Detects |
|---|---|
| Production refused before connecting | Demo accounts with published passwords in production |
| Missing password refused | A hard-coded fallback password |
| Missing `DATABASE_URL` refused | A default connection |
| Output contains no password, user, or URL | Secrets in logs |

**Access schema, real MySQL (18)**

| Test | Detects |
|---|---|
| Exact list of 11 tables (InnoDB); both migrations recorded | Missing access tables or early later-task tables |
| Exact keys and indexes; seven RESTRICT foreign keys | Missing composite keys; CASCADE deletes |
| Version starts at 1; case-insensitive unique email; enum rejections; non-Argon2 hash rejected; blank name and version 0 rejected | Each column rule |
| Scope rows: unknown user (both tables), unknown country and department, duplicate rows | Missing foreign or primary keys |
| Referenced user, country, and department cannot be deleted | Silent loss of access rows |
| Session expiry and revocation stored with milliseconds; expiry not after creation is rejected | Lost precision; inverted sessions |
| Audit JSON round trip; invalid JSON and unknown action rejected; audited user cannot be deleted | Unparseable audit; audit loss |

**Access control, real MySQL (29)**

| Area | Tests | Detects |
|---|---|---|
| Sign-in | Two-hour session row with the injected times; only approved JWT claims; one generic error for unknown email, wrong password, and inactive user; email matched ignoring case | Wrong expiry; authority in the token; account enumeration |
| Authenticate | Current principal returned; invalid signature; expiry at 11:59:59.999 accepted and at 12:00:00.000 rejected; missing session; a token naming another user's session; session expired in the database; sign-out revokes the session and the token then fails | Each step of the per-request lookup |
| Current access | Adding a scope grants the next check; removing a scope denies it; an old JWT does not keep old scopes; deactivation blocks the next request | Cached authority |
| Management authorization | Scoped HR: all four operations `FORBIDDEN`, and no rows or audit written; admin succeeds; deactivated admin `FORBIDDEN`; invalid inputs rejected with value-free messages, duplicate email → `EMAIL_TAKEN` | Privilege escalation; stale actor authority; bad input reaching SQL |
| Audit | Creation writes 1 event with actor and after-state; country and department changes write exact before/after states and version 3; deactivate/activate events; no-op writes nothing; audit JSON keys exactly role/status/countries/departments, with no hash, token, or session ID | Missing or incomplete history; secrets in audit |
| Audit rollback | A temporary CHECK on `access_audit_events` makes the audit insert fail. The user creation and the scope change both roll back: no user row, scopes still `['IN']`, version still 1 | Changes committed without their audit event |
| Demo users | Created with the approved roles and scopes, Argon2id hashes, and NULL-actor audit; rerun leaves IDs and hashes unchanged; drifted scopes refused; production, missing `APP_ENV`, and short passwords refused | Wrong demo data; password reset on rerun |

## Red tests actually observed

| Slice | Red before implementation |
|---|---|
| Access policy | 11 of 16 failed against an allow-all stub. The 5 "allowed" cases passed by construction |
| Passwords | 6 of 7 failed against a stub. "Correct password verifies" passed, because the stub returned `true` |
| Session tokens | 10 of 10 failed against a stub |
| Access schema | 18 of 18 failed before migration 002 existed (missing tables) |
| Access control | 28 of 29 failed against stubs. "Audit state never contains a password hash…" passed vacuously, because there were no audit rows |
| Task 02 schema tests | 4 failed after migration 002 was added (the complete-list assertions). Fixed by scoping them to the 001 tables |

**Mutation checks** (code changed temporarily, test run, then restored; a search for the marker confirmed the restore):
- With the inactive-user check removed from `authenticate`, "changing an HR user to inactive blocks the next request" failed (28 pass, 1 fail).
- With `createHrUser` changed to write the audit event in a separate transaction, "a forced audit insert failure rolls back…" failed. The invalid-input test also failed, because the mutation dropped the duplicate-email mapping.

**Never red:**
- The 4 demo-user command tests, written after the script.
- Lint failed once (`Buffer`, `TextEncoder`, `crypto` undefined for ESLint). Fixed with explicit `node:buffer`, `node:util`, and `node:crypto` imports.

## Commands and results

Run from `express-backend/`, with `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test'` where needed:

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | 196 tests, 196 pass, 0 fail |
| `npm run test:db` (run alone, twice) | 113 tests, 113 pass, 0 fail each time, about 5 s: access-control 29, access-schema 18, initial-schema 47, migration-runner 5, seed-database 14 |
| Reset, `npm run db:migrate` | `Applied 2 migration(s)`: `001_initial_schema.sql`, `002_hr_access_control.sql` |
| `APP_ENV=development npm run db:seed -- --replace` | `Seeded 10000 employees and 10000 compensation records.` |
| `APP_ENV=demo DEMO_MEERA_PASSWORD=… DEMO_ROHAN_PASSWORD=… npm run db:seed-demo-users` | `meera.iyer@acme.com: created`, `rohan.mehta@acme.com: created`, exit 0 |
| Same command again | Both `already present`, exit 0 |
| Same command with `APP_ENV=production` | `Error: refusing to create demo users: APP_ENV must be one of development, test, demo`, exit 1 |
| Database check | Meera: ADMIN, ACTIVE, no scopes. Rohan: SCOPED, ACTIVE, `IN`, `Support,Tech`. Both hashes start `$argon2id$v=19$m=19456,t=2,p=1$` |

**One failed run, explained.** One `npm run test:db` run showed 111 pass and 2 fail ("replaces existing data…" and "rolls back…" in `seed-database.test.js`). In that run, the DB tests ran at the same time as the end-to-end commands above, which reset and seeded the same `acme_test` database. Both solo runs afterwards passed 113 of 113. The suites assume exclusive use of the test database; see known limitations.

## Known limitations

- **No routes yet.** There are no HTTP routes, cookies, or rate limiting; those belong to the later API task. Cookie flags, generic HTTP errors, and sign-in rate limiting are not implemented here.
- **Shared test database.** The DB suites assume nothing else uses `acme_test` while they run.
- **Expired sessions.** Expired sessions are never deleted, so the table grows. A cleanup job is not designed.
- **Key rotation.** One signing key, no rotation. Rotating `JWT_SIGNING_KEY` invalidates every session.
- **Argon2 cost.** Each sign-in costs about 19 MiB of memory and around 10–15 ms locally. Without the later rate limit, many parallel sign-ins could pressure a small Railway instance.
- **Scopes on admins.** They are stored but ignored by the policy.
- **Email format.** A simple pattern only, with no deliverability check.
- **Demo-user command.** It does not reset passwords. Changing a demo password needs a later operation or a fresh database.

## Open decisions

1. **System actor.** The demo-user audit events use `actor_hr_user_id = NULL`. The design says "who made the change" but the first admin has no creator. Confirm NULL, or prefer a dedicated system HR row.
2. **Last active admin.** Deactivating the last active ADMIN, including self-deactivation, is allowed and would lock out management. Should it be blocked?
3. **Optimistic concurrency.** `version` is incremented on each change, but no operation accepts an expected version yet. Wire it into the later API?
4. **Scopes on ADMIN users.** Allowed and ignored by the policy. Should they be rejected instead?
5. **Demo emails.** `meera.iyer@acme.com` and `rohan.mehta@acme.com` use the same synthetic domain as the employees. Confirm.

## Skill use

- Source: https://github.com/mattpocock/skills, revision `5863806dd4e15c63174bee4e7515a4256792ecfa`. Files: `skills/engineering/tdd/SKILL.md`, `tests.md`, `mocking.md`, read through `gh api` in Tasks 01 and 02. I did not re-fetch them for this task.
- Effects on this task:
  - **Real database, injected clock.** Following `mocking.md`, sessions, scopes, and transactions run against real MySQL. Only time is injected (a `clock` function), so expiry tests are deterministic and never wait for real time.
  - **No tautological tests.** Following `SKILL.md`, the JWT test compares against literal epoch values computed with `date -u`, not values recomputed with the code's own arithmetic.
- No frontend skill was used; this task has no frontend work.

## Confirmations

- No Git command was run.
- No `.env` file was read, and no code reads one.
- No later task was started: no Express routes, frontend, directory API, salary routes, upload, AI, or MCP.
- `index.md`, `docs/`, and `docs_human/` were not edited.
