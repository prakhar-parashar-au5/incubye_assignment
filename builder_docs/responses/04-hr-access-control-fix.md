# Fix 04a: Access-control review corrections

**Instruction:** `builder_docs/parent_instructions/04a-access-control-review-fix.md`
**Result:** Applied and verified. Not committed.
**Scope kept:** no routes, no frontend, no TypeScript migration, no expected-version checks (deferred by the instruction).

## Files changed (all in `express-backend/`)

| File | Change |
|---|---|
| `src/access/passwords.js` | Exports `MAX_PASSWORD_LENGTH = 1024` and the new `NEW_PASSWORD_MIN_LENGTH = 12`. `verifyPassword` is unchanged: malformed input still returns `false`. |
| `src/access/hr-users.js` | Three rule changes, described below. New domain error code `LAST_ACTIVE_ADMIN`. `changeHrUser` gains an optional `prelock` step. |
| `src/access/demo-users.js` | The demo minimum now uses `NEW_PASSWORD_MIN_LENGTH` (still 12), so the demo and normal creation rules cannot drift apart. |
| `test/db/access-admin-rules.test.js` | New. 10 real-MySQL tests. |

The migration, the policy module, sessions, and all other tests are unchanged.

## Implementation

- **Password length.** `validateNewUser`, used by both `createHrUser` and the demo/system path `bootstrapHrUser`, rejects any password shorter than 12 or longer than 1,024 characters. It throws `AccessError('INVALID_INPUT', 'password must be 12 to 1024 characters')` before hashing. The message never includes the password.
- **Administrator scopes.**
  - `assertAdminHasNoScopes` rejects creating an `ADMIN` with any country or department.
  - `setCountryScopes` and `setDepartmentScopes` reject a non-empty list for an existing `ADMIN` target. The check uses the target's role as read under its `FOR UPDATE` row lock.
  - All three return `INVALID_INPUT`. The error is thrown inside the transaction, so it rolls back with no version change, no scope rows, and no audit event.
  - A `SCOPED` user with empty lists is still accepted, and the existing policy gives no access.
- **Last active administrator.** For `status = 'INACTIVE'`, `setHrUserStatus` runs these steps in one transaction:
  1. Lock every active admin row: `SELECT id FROM hr_users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`. This runs before the actor and target locks, so every deactivation takes locks in the same order and two of them cannot deadlock.
  2. Check that the actor is an active admin, and lock the target.
  3. If the target is an `ADMIN` and no other active admin remains, throw `AccessError('LAST_ACTIVE_ADMIN', 'cannot deactivate the last active Admin HR')`. That is a stable code and a plain message with no SQL detail.
  4. Otherwise update the status, increment `version`, write the audit event, and commit.

  A concurrent second deactivation waits on the step 1 lock. It then re-reads the committed state (InnoDB locking reads see the latest committed rows), finds one active admin, and fails. Self-deactivation succeeds when another active admin exists.

## Tests added (`test/db/access-admin-rules.test.js`, real MySQL)

The file resets the test database and creates its own two admins, so the number of active admins is fully controlled.

| Test | Detects |
|---|---|
| 11-character password rejected | Weak passwords accepted at creation |
| 12-character password accepted | An off-by-one that also rejects the minimum |
| 1,024 accepted; 1,025 rejected with `INVALID_INPUT` | Over-long input reaching the hasher, or failing with a non-domain error |
| `bootstrapHrUser` rejects an 11-character password | The demo/system path bypassing the rule |
| Creating an ADMIN with `['IN']` countries, or with `['Tech']` departments, is rejected; user count unchanged | Admin scopes silently stored and ignored |
| Assigning a country, then a department, to an existing ADMIN is rejected; version, audit count, and scope rows unchanged | Scope assignment ignoring the target's role; rejected changes that still bump the version or audit |
| A SCOPED user with empty lists signs in, has `[]`/`[]`, and is denied IN/Tech and US/HR | Empty lists rejected as invalid, or treated as "all access" |
| The last active admin's self-deactivation fails with `LAST_ACTIVE_ADMIN`; version and audit unchanged; still 1 active admin | Management lockout; side effects from a rejected change |
| Self-deactivation succeeds when another active admin exists | A rule so strict it blocks valid self-deactivation |
| Two concurrent self-deactivations, repeated 15 rounds: each round exactly one succeeds, one fails with `LAST_ACTIVE_ADMIN`, and 1 active admin remains | A check-then-update race leaving zero admins |

Every rejection asserts the domain error code, and that the message contains no `ER_`, `SQL`, `SELECT`, `UPDATE`, or `hr_users` text.

## Red failures actually observed

**Before implementation** (the new file against the Task 04 code): 8 of 10 failed.
- Password: 11 characters accepted; 1,025 characters failed with a non-domain error; the bootstrap path accepted 11 characters.
- ADMIN create and assign: no rejection.
- Last admin: deactivation succeeded, leaving zero active admins.
- Self-deactivation: failed with `only an active Admin HR can manage HR users`, because the earlier test had left zero active admins.
- Concurrency: both deactivations succeeded.

Two tests passed against the old code, as expected: "12-character password accepted" and "SCOPED user with empty lists has no access", which Task 04 already supported.

**Mutation check on the concurrency test:** with `FOR UPDATE` removed from the admin pre-lock, the test failed in round 1 with zero active admins. With the lock restored, it passes all 15 rounds. I confirmed the restore with a search for the marker (0 matches) and the lock text (1 match).

## Commands and results

Run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | 196 tests, 196 pass, 0 fail |
| `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` | 123 tests, 123 pass, 0 fail, about 5.2 s |

Per-file DB counts:
- `access-admin-rules`: 10
- `access-control`: 29
- `access-schema`: 18
- `initial-schema`: 47
- `migration-runner`: 5
- `seed-database`: 14

All existing Task 04 tests still pass unchanged. Their test passwords were already at least 12 characters.

## Confirmed decisions applied without change

- Demo-user audit events keep `actor_hr_user_id = NULL`.
- Demo email addresses are unchanged.
- Audit events stay immutable; there is no update or delete path.
- Expected-version checks are not added (deferred to the HR management API task).

## Known limitations

- The last-admin rule guards only status changes. No operation changes a user's role yet, so demoting an admin cannot bypass it today. A future role-change operation must reuse the same pre-lock.
- Every admin deactivation locks all active admin rows. That is negligible with a handful of admins.

## Confirmations

- No Git command was run.
- No `.env` file was read.
- No routes, frontend code, or TypeScript migration were started.
- `index.md`, `docs/`, and `docs_human/` were not edited.
