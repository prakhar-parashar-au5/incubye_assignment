# Response 11b: final dashboard and HR-access review fixes

**Task:** `builder_docs/parent_instructions/11b-backend-final-review-fixes.md`, read after `builder_docs/parent_instructions/index.md`.

**Status:** Complete and verified. Not committed.

**What was fixed:**

| # | Finding | Result |
|---|---|---|
| 1 | Soon-to-join future-adjustment commitment | Fixed in SQL |
| 2 | Self-regeneration lockout | Rejected with a new `409` code |
| 3 | Sign-in racing password regeneration | Sign-in now runs in one locking transaction |
| 4 | Missing dashboard `503` coverage | Tests added |
| 5 | Measurement evidence mismatch | Remeasured with 15 runs; evidence saved; Task 10 report corrected |

## 1. Reproduced failures (before any implementation change)

| Finding | Test | Observed red |
|---|---|---|
| 1. Joiner commitment | `test/db/dashboard-commitment.test.ts` (new, 2 tests) | **2 of 2 failed.** INR `approvedFutureChangeCount` was 1 instead of 3, and `approvedFutureChangeAnnualCashImpact` was `50000.00` instead of `150000.00`. Only the working employee's change was counted. |
| 2. Self-regeneration | `hr-access.test.ts`: "an Admin cannot regenerate their own temporary password…", plus a sole-Admin check added to "last active Admin" | **2 failed.** Self-preview returned `200` with a token, both with another Admin active and as the sole Admin. Expected `409`. |
| 3a. Sign-in first | `hr-access.test.ts`: "sign-in first: the regeneration waits…" | **Failed.** The regeneration finished while the sign-in was paused after verifying the old password, so the sign-in then inserted an unrevoked session. |
| 3b. Regeneration first | `hr-access.test.ts`: "regeneration first: the sign-in waits…" | **Failed.** The old password produced `{ ok: true, token: … }`, a live session, instead of `INVALID_CREDENTIALS`. |
| 4. Dashboard 503 | `test/http-dashboard-errors.test.ts` (new, 7 tests) | **Not red: 7 of 7 passed on the existing code.** The finding was missing coverage, not a behaviour defect. I proved detection with a mutation instead: with the 503 mapping disabled in `dashboard-routes.ts`, 6 of 7 failed. The unrecognized-error test kept passing, as it should. |

Full HR file before the fixes: 49 tests, 45 pass, 4 fail (the four rows above for findings 2 and 3).

**Test seam added before the red runs.** The race tests need to pause sign-in at an exact point. I first added an optional `afterPasswordCheck` hook to `createAuthService`. It runs after the password and status pass and before the session insert, and nothing in production sets it. It changes no behaviour, so the reds above are against the original sign-in logic.

## 2. Files changed

All paths are in `express-backend/` unless noted.

| File | Change |
|---|---|
| `src/dashboard/dashboard-service.ts` | Impact query and commitment definition text (section 3) |
| `src/http/contract.ts` | Public code `SELF_PASSWORD_REGENERATION_FORBIDDEN` with its message; impact field description now says "scheduled minus selected" |
| `src/access/hr-users.ts` | Domain code `SELF_PASSWORD_REGENERATION`; `regenerateTemporaryPassword` refuses actor = target |
| `src/access/hr-access-service.ts` | `rejectSelfRegeneration` runs first in preview and confirmation; maps the domain code |
| `src/http/hr-access-routes.ts` | `SELF_PASSWORD_REGENERATION_FORBIDDEN` → `409` |
| `src/access/sessions.ts` | Sign-in runs in one locking transaction (section 4); the `afterPasswordCheck` test seam |
| `src/http/openapi.ts`, `openapi/openapi.json` | `409` descriptions for both regeneration operations; regenerated |
| `test/db/dashboard-commitment.test.ts` | **New** (2 tests) |
| `test/http-dashboard-errors.test.ts` | **New** (7 tests) |
| `test/db/hr-access.test.ts` | Self-regeneration test, two race tests, and the sole-Admin assertions |
| `test/http-openapi.test.ts` | Code list includes the new code; both regeneration `409`s document it |
| `builder_docs/responses/11b-dashboard-measurements.txt` | **New.** Plans and two fifteen-run timing runs |
| `builder_docs/responses/11b-dashboard-statistics-experiment.txt` | **New.** Before and after `ANALYZE TABLE` |
| `builder_docs/responses/11b-dashboard-measurement-data.sql` | **New.** The measurement data script, copied unchanged from `/tmp` |
| `builder_docs/responses/10-dashboard-timings-15-runs.txt` | **New.** The original Task 10 fifteen-run outputs, recovered unchanged from `/tmp` |
| `builder_docs/responses/10-dashboard-analytics-api.md` | Correction note in section 7 |

No migration was added and no response schema changed.

## 3. Dashboard commitment: query correction, fixture, and arithmetic

**Query.** Only the impact aggregate changed:

```sql
-- before
WHERE <scope + filters> AND e.employment_status = 'CURRENTLY_WORKING' AND sc.version IS NOT NULL
-- after
WHERE <scope + filters> AND e.employment_status IN ('CURRENTLY_WORKING', 'SOON_TO_JOIN') AND sc.version IS NOT NULL
  AND f.version <> sc.version
```

**How the formula works:**
- `f` is an approved non-import record with `effective_from > as-of`. `sc` is the directory's selected record: the current one for working employees, and the earliest future one for joiners.
- The impact is `(f base + bonus) − (sc base + bonus)`.
- For a joiner, `sc` is the initial compensation, which the joiner aggregate counts once.
- **Same-day case.** The salary workflow allows an adjustment effective on the joining date. In that case the adjustment *is* `sc`, because the higher version wins on the same date. `f.version <> sc.version` keeps it from being counted a second time.
- `LEFT` employees stay excluded.
- Scope and filters remain inside each statement's `WHERE`, so they apply before `GROUP BY`. Currencies stay grouped by `f.currency`.

**Fixture** (as of 2026-11-15):

| Code | Placement | Records |
|---|---|---|
| 501 | IN Tech, joiner | import 1,000,000 (2027-01-15); later 1,100,000 + 50,000 bonus (2027-04-01) → **+150,000** |
| 502 | IN Support, joiner | import 900,000 (2027-02-01); later 850,000 (2027-03-01) → **−50,000** |
| 503 | US Tech, joiner | import USD 120,000 (2027-01-04); later 126,000 (2027-02-01) → **+6,000 USD** |
| 504 | IN HR, joiner | import 700,000 and a same-day 750,000 (2027-01-10) → initial cash 750,000, no extra impact |
| 505 | IN Tech, working | 1,000,000; future 1,050,000 (2026-12-01) → **+50,000** |
| 506 | IN Tech, `LEFT` | has a future 900,000 record, which must never count |

**Expected arithmetic, all asserted exactly:**

| Case | Joiners (count, cash) | Changes (count, impact) | Total |
|---|---|---|---|
| Admin INR | 3: 1,000,000 + 900,000 + 750,000 = 2,650,000.00 | 3: +150,000 − 50,000 + 50,000 = 150,000.00 | **2,800,000.00** |
| Admin USD | 1: 120,000.00 | 1: +6,000.00 | **126,000.00** |
| Rohan (IN × Tech, Support) | 2: 1,900,000.00 | 3: 150,000.00 | **2,050,000.00** (no USD row) |
| `currency=USD` | the USD row only | | |
| `employmentStatus=SOON_TO_JOIN`, INR | 3: 2,650,000.00 | 2: 100,000.00 | **2,750,000.00** |
| `department=Support` | 1: 900,000.00 | 1: −50,000.00 | **850,000.00** |
| `employmentStatus=LEFT` | no currency rows | no upcoming items | |

**Other assertions:**
- `soonToJoin` headcount is 4.
- The upcoming list has exactly employees 501–505, each once, and `total` is 5. Employee 506 is absent.
- Joiner 501's item shows previous `1000000.00` and scheduled `1150000.00`.

**Count difference to know about:** for employee 504 (the same-day case), `approvedFutureChangeCount` excludes the adjustment because its amount is already the initial cash. It still appears in the upcoming list. The INR currency row therefore counts 3 changes while the list shows 4 INR items.

The existing `test/db/dashboard.test.ts` fixture has no joiner adjustment, and all 19 of its tests pass unchanged.

## 4. Sign-in and regeneration: transaction correction and race proof

**Correction in `signIn`.** One pooled connection runs one `READ COMMITTED` transaction:
1. `SELECT id, password_hash, status FROM hr_users WHERE email = ? FOR SHARE`.
2. Argon2 verification and the `ACTIVE` check.
3. Session insert.
4. Commit.
5. JWT signing, after the commit.

The shared row lock is held from the read until the commit.

- **Ordering.** Regeneration (and deactivation) lock the row `FOR UPDATE`. A sign-in that locked first makes the regeneration wait, so its revocation covers the new session. A regeneration that locked first makes the sign-in wait, and the locking read then returns the **new** hash.
- **Unknown email.** It rolls back first, then does the dummy Argon2 verification. `READ COMMITTED` means the lookup takes no gap lock (a lock on the empty key range around the missing email).
- **Unchanged:**
  - one Argon2 verification on both the known-email and unknown-email paths;
  - the generic `INVALID_CREDENTIALS` error;
  - the `ACTIVE` check;
  - two-hour session times, with the database expiry equal to the JWT `exp`;
  - the auth API contract;
  - no logging or storage of passwords.
- **Deadlock check.** The sign-in only ever holds a shared lock on its own user's row. A second shared lock is compatible with it. Exclusive lockers (HR changes) take no lock that the sign-in waits for while they hold the row. I found no lock cycle.

**Deterministic proof.** Both tests use barriers. The real `SHOW FULL PROCESSLIST` state confirms that a statement is blocked before the barrier is released, instead of relying on timing loops.
- **Sign-in first.** The hook pauses sign-in after it verifies the old password, while it holds the lock. The test then confirms the regeneration and waits until its `FROM hr_users … FOR UPDATE` statement is visible and unfinished. Then it releases the hook. Results:
  - the regeneration had waited (`'waiting for the sign-in'`);
  - `revokedSessionCount` is 1;
  - the old-password token gets `401`;
  - no unrevoked session remains;
  - the new password signs in.
- **Regeneration first.** The test holds an exclusive lock on the target's existing session row, which stops the real regeneration at `UPDATE hr_sessions SET revoked_at` after it has locked the user row and written the new hash. The old-password sign-in then starts, and the test waits until it is blocked on the user row. After the test releases its lock:
  - the regeneration commits (`200`);
  - the sign-in fails with `INVALID_CREDENTIALS`;
  - no unrevoked session remains;
  - the new password signs in.
- **Stability.** Each race test passed 5 of 5 repeated runs after the fix.
- **Mutation check.** With `FOR SHARE` removed from the sign-in query, both race tests failed; then I restored it.

## 5. Self-regeneration rejection

**Response:** `409 SELF_PASSWORD_REGENERATION_FORBIDDEN`, message "Ask another active Admin HR user to regenerate your temporary password.". It is a separate code and does not reuse the last-active-Admin message.

**Where it is checked:**
- **Service.** In both preview and confirmation, right after parsing the HR user ID: before the token check, the password generation and hashing, any read of the target, and any write. A confirmation with a fake token gets the same `409`.
- **Domain.** `regenerateTemporaryPassword` also refuses actor = target, as defence in depth.

**Proof:**
- **Another Admin active.** Preview and confirmation both return `409`, and the direct domain call rejects. The user row (hash, role, status, version), scopes, open sessions, and audit count are unchanged, and the session still works.
- **Sole active Admin** (in the "last active Admin" test). Preview and confirmation both return `409`, the state is unchanged, and the session still works.

## 6. Dashboard 503 evidence

`test/http-dashboard-errors.test.ts` drives all four dashboard routes through the real Express app with a stubbed service. The stub throws mysql2-shaped errors whose message, `sql`, `sqlMessage`, and stack contain an SQL statement, a URL with a password, a host, and an employee code.

- **Recognized codes.** `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `PROTOCOL_CONNECTION_LOST`, `ER_CON_COUNT_ERROR`, and `ER_LOCK_WAIT_TIMEOUT` each return exactly `503 {"error":{"code":"SERVICE_UNAVAILABLE","message":"The service is temporarily unavailable. Try again."}}` with `Cache-Control: no-store`. Neither the body nor the logs contain any of the sensitive text, and logs hold only `request` entries with status 503.
- **Unexpected errors.** A `TypeError`, `ER_PARSE_ERROR`, and `ER_ACCESS_DENIED_ERROR` still return `500 INTERNAL_ERROR`. The log records only the error class and code.

## 7. Measurement evidence: honest resolution

**What was wrong.** The Task 10 claim of fifteen runs was based on two real fifteen-run outputs, but they were written only to `/tmp`. The saved file was the `--plans` run with `--runs 3`.

**What I did:**
1. Copied those two outputs unchanged into `10-dashboard-timings-15-runs.txt`.
2. Added a correction note to the Task 10 report.
3. Remeasured after the 11b fix.

**Setup.** `acme_test` only: reset, migrate 001–006, `APP_ENV=development npm run db:seed -- --replace`, then `11b-dashboard-measurement-data.sql`. This gives 10,000 employees, 11,008 compensation records (1,008 non-import), and 0 requests on MySQL 8.4.13. The seed now yields 11 fewer non-import rows than in Task 10.

**Runs, saved in `11b-dashboard-measurements.txt`:**
- Run A: `npm run measure:dashboard -- --runs 15 --plans`.
- Run B: `npm run measure:dashboard -- --runs 15`.

**Results** (median / slowest, ms):

| Query | Admin A | Admin B | Scoped A | Scoped B |
|---|---|---|---|---|
| Summary (8 statements) | 51.5 / **11,774.3** | 48.1 / 53.3 | 35.7 / 40.3 | 35.0 / 37.3 |
| Breakdown, department | 37.9 / 39.2 | 38.0 / 46.5 | 22.1 / 23.3 | 21.5 / 22.4 |
| Breakdown, country | 34.2 / 35.1 | 34.1 / 39.3 | 19.5 / 21.4 | 19.3 / 19.8 |
| Breakdown, currency | 35.2 / 36.2 | 34.9 / 36.8 | 19.7 / 20.4 | 20.0 / 20.6 |
| Recent changes, 90 days | 3.6 / 4.3 | 3.3 / 4.4 | 3.2 / 5.2 | 3.2 / 3.9 |
| Without adjustment, 12 months | 25.4 / 26.4 | 25.9 / 26.6 | 14.0 / 16.7 | 25.0 / 32.9 |

**The slow summary recurred.** Run A's `EXPLAIN ANALYZE` of the Admin summary, taken right after the bulk load, shows `Table scan on c … rows=11008 loops=10000` inside the lateral selection (about 15.5 s for the first statement). This is the same shape seen in Task 10.

**Controlled experiment** (`11b-dashboard-statistics-experiment.txt`, 3 runs per case, a fresh load each time):
- **Case 1, measured immediately:** Admin summary median **11,446.7 ms**, slowest 11,509.0 ms. Every run was slow.
- **Case 2, `ANALYZE TABLE compensation_records, employees` and then measured:** Admin summary median **50.0 ms**.

This supports stale table statistics after a bulk insert as the cause. I measured it once per case: strong evidence, but not a repeated study. The `acme` user cannot read `mysql.innodb_index_stats`, so I could not record the index statistics themselves. As instructed, I added **no index and no `ANALYZE TABLE` hook**; see open decision 1.

**Clean-up.** The subsequent `npm run test:db` reset `acme_test`, so the measurement data is gone.

## 8. Validation commands and results

All commands run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run openapi:generate` | wrote `openapi/openapi.json` |
| `npm run check` | exit 0. Lint and typecheck pass; 388 fast tests, 388 pass, 0 fail (was 381; +7 dashboard-error tests) |
| `DATABASE_URL='mysql://acme:…@127.0.0.1:3317/acme_test' npm run test:db` | exit 0. 349 tests, 349 pass, 0 fail, 0 cancelled (was 344; +2 commitment, +1 self-regeneration, +2 race). Salary, dashboard, HR access, auth, assistant, MCP, and observability suites all pass |
| `npm run build` | exit 0 |

Before the full database run, `SHOW FULL PROCESSLIST` showed no other active statements on the test database.

**Checks not run:** none of the required ones.

## 9. Known limitations

- **Sign-in holds a connection and a row lock during Argon2 verification** (about 11–15 ms locally). Under very high parallel sign-in volume this uses pool connections for longer. The existing failed-login limiter bounds abuse.
- **The same-day joiner adjustment** is counted through the initial cash, not as an approved change (section 3), so the per-currency change count can be lower than the number of listed items.
- **Stale statistics after bulk loads** can still make the first Admin summaries take about 11 s until MySQL recalculates statistics.

## 10. Open decisions

1. **Statistics after bulk loads.** Run `ANALYZE TABLE compensation_records, employees` at the end of the seed/import command? The experiment shows it removes the about 11 s summaries after a bulk load. I did not add it, because the task forbids a hook without approval of the measured evidence.

## 11. Confirmations

- No frontend file (`next-frontend/**`), AI-observability file (`src/assistant/observability/**`), or `docs_human/**` file was modified.
- No `.env` file was read or created.
- Nothing was written to the development database. All measurement and test data used `acme_test` only.
- No Git command was run, and nothing was committed or pushed.
- No later task was started. Work stopped after these corrections.
