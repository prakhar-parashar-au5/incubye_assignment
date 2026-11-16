# Response: Backend Task 09, salary adjustments and approval requests

**Status:** Complete. Ready for planner review.

## Task completed

I built the backend workflow in `docs_human/11-salary-adjustments.md`:

- An exact calculator, replacing the floating-point starting implementation.
- Salary bands, with deterministic initial data.
- The `compensation_change_requests` table and the approved `compensation_records` columns.
- A signed five-minute preview token.
- Admin direct apply; Scoped HR requests; Admin list, detail, approval, and cancellation.
- Stale-version handling, employee-row locking, and idempotency.
- Pending-request and future-change rules.
- Express routes, Zod schemas, OpenAPI, and tests.

There is no compensation audit table. The history is `compensation_records` plus `compensation_change_requests`.

**Checkpoint caveat:** the task status says "READY AFTER CURRENT CHECKPOINT COMMITS". `index.md` still shows Task 08 as `ACCEPTED - COMMIT REQUIRED`. Without Git I cannot confirm that commit. I proceeded because you asked me to execute the task.

## Prakhar's starting files

### `src/compensation/adjustment.ts`

I replaced the implementation. The defects in the original were:

- **Floating point:** `Number(...) * Number(...) / 100` with `toFixed(2)` on binary doubles.
- **Formatting:** `String(changeAmount)` returns `'50'` instead of `'50.00'`.
- **Debug output:** two `console.log` calls.
- **Equality:** `==` instead of `===`. Lint reported `eqeqeq`.
- **Coverage:** only `PERCENTAGE_INCREASE`, with no limits, and `throw new Error('Not yet')` for everything else.

The new version uses BigInt cents for all five methods. Percentage results are calculated exactly and rounded once, half-up, as the spec requires. It enforces the product percentage limits (1–200 for increases, 1–50 for decreases, whole numbers only), allows at most two decimals in amounts, and rejects negative and no-change results.

### `test/compensation-adjustment.test.ts`

I kept Prakhar's test unchanged in content (1000.10 + 5% → 1050.11, change 50.01) and reformatted it to the project style. I added 11 tests with the same intent.

**Which candidate-written test first failed:**

- Run exactly as written against the original implementation, the one candidate test **passed**. The output also showed the two debug lines `50.01 changeAmount12` and `1050.1100000000001 changeAmount123`. So the original test alone did not catch the floating-point defect: 1000.10 × 5 happens to round correctly in binary.
- The defect surfaced in the first tests I added to that file, run against the original implementation: **10 failed, 2 passed**. The candidate test passed, and so did the 4,999,999,999,999.99 case.
- The first failure was `rounds an exact half cent up where floating point rounds down`. 1.15 + 50% gave change `'0.57'` instead of `'0.58'`, because 1.15 × 50 / 100 is 0.574999… as a double. That is the floating-point defect.
- The second failure, `returns two-decimal money strings`, gave `'50'` instead of `'50.00'`. That is the `String(number)` defect.

## Schema: migration `003_salary_adjustments.sql`

### `salary_bands`

- **Key:** one row per (`job_title_id`, `country_code`, `currency`), as a unique key.
- **Columns:** minimum and maximum annual base salary, maximum annual bonus, minimum and maximum percentage for increases and for decreases, `created_at`, `updated_at`.
- **Checks:** minimum base > 0, maximum ≥ minimum, bonus ≥ 0, increases within 1..200, decreases within 1..50.
- **Initial data:** 88 rows (44 titles × 2 countries), from the approved `SALARY_RANGES` and `BONUS_CAPS`. JUNIOR uses the JUNIOR cap and every other level uses OTHER. The percentage limits use the product limits.
- **Where the data is inserted:** by the seed's reference-data step, `ensureSalaryBands` inside `ensureReferenceData`. Job titles do not exist when migrations run, so the migration cannot insert them.
- **Existing bands are never overwritten:** bands are policy and may be edited after the first seed.

### `compensation_change_requests`

Columns:

- Identity and target: `id`, `public_id` (a UUID, the only identifier the API exposes), employee, requester, target, method, `input_value` (DECIMAL), `currency`.
- Values: previous and proposed target values.
- Versions: `requested_against_version` (the highest version, i.e. the expected version) and `base_compensation_version` (the record the calculation used).
- Change details: effective date, reason (the five allowed reasons; `INITIAL_IMPORT` is not accepted), note.
- Status: `PENDING`, `APPROVED`, `CANCELLED`, or `STALE`.
- Decision: the deciding Admin, decision time, decision note or stale reason.
- Idempotency: the request key and the decision key.
- Times: `created_at`, `updated_at`, written from the injected clock.

Constraints:

- `pending_employee_id`, a virtual generated column equal to `employee_id` only while `PENDING`, with a **unique key that allows one pending request per employee**.
- Unique keys on (requester, request key) and (decider, decision key).
- A CHECK on state consistency for each status. For example, CANCELLED needs a note, and STALE has no decider.
- CHECKs that a correction has a note, proposed ≠ previous, and all values ≥ 0.
- Every foreign key is RESTRICT.

### `compensation_records`: the approved additions only

All five are nullable, because historical import rows have no actor:

- `previous_compensation_record_id`
- `changed_by_hr_user_id`
- `source_request_id`
- `change_note`
- `operation_idempotency_key`

Constraints:

- Unique keys on (actor, key) and on `source_request_id`.
- Foreign keys are RESTRICT.
- `chk_compensation_initial_import`: an `INITIAL_IMPORT` row has no actor, request, previous record, or key.
- `chk_compensation_correction_note`: an actor-written CORRECTION has a note.

I did not add a CHECK requiring an actor on every non-import row. The Task 07 and 08 tests insert historical PERFORMANCE rows without one, and the application always sets the actor.

### Seed replacement

The destructive reseed now deletes compensation records newest first (`ORDER BY id DESC`, so a record is never deleted before the one that references it), then the requests, then the employees, in one transaction. HR users and bands are kept.

## Operation flow

| Endpoint | Who | Flow |
| --- | --- | --- |
| `POST /employees/:code/salary-adjustments/preview` | Admin, Scoped | Scope (unknown and out-of-scope both get 404) → eligibility (LEFT → 422) → for Scoped HR, an existing pending request → 409 → validation and exact plan → sign token. **Writes nothing.** |
| `POST /employees/:code/salary-adjustments` | Admin only (Scoped → 403) | Transaction: lock the employee → idempotency lookup → verify the token → version check → recalculate → compare the digest → insert one version → mark pending requests STALE → commit. |
| `POST /employees/:code/salary-adjustment-requests` | Scoped only (Admin → 403) | Transaction: lock → idempotency lookup → pending check → token, version, recalculation, digest → insert a PENDING request. No compensation write. |
| `GET /salary-adjustment-requests` | Admin (all), Scoped (current scope) | Scope in SQL. Filters: `q`, `department` (Admin only; Scoped → 400), `status`. Sort by `createdAt` ascending or descending, with the row ID as tie-breaker. Paginated. |
| `GET /salary-adjustment-requests/:requestId` | Admin, Scoped | The same 404 for unknown and out-of-scope requests. |
| `POST …/:requestId/approve` | Admin only | Transaction: lock the employee → lock the request → idempotency → must be PENDING → recheck → insert a version (actor = the approving Admin, source = the request) → APPROVED → commit. |
| `POST …/:requestId/cancel` | Admin only; note required | Transaction: lock the employee → lock the request → idempotency → must be PENDING → CANCELLED with the note. No compensation change. |

**Approval recheck,** in this order:

1. The requester exists and is ACTIVE.
2. The employee is inside the requester's *current* scope.
3. The employee is eligible.
4. The highest version and the base version are unchanged.
5. The effective date is not past.
6. No other future change exists.
7. The salary band still permits the result, and recalculating gives the same proposed value.

A failure caused by changed state sets the request to STALE with a reason, **commits that**, and then returns 409 `STALE_VERSION` (or 422 `EMPLOYEE_INELIGIBLE` when the employee has left).

**Selection and dates:**

- **Base record:** the adjustment uses the same record the directory shows. For CURRENTLY_WORKING that is the latest record effective on or before today; for SOON_TO_JOIN it is the earliest future record. On the same date, the higher version wins.
- **"Approved future change":** a non-`INITIAL_IMPORT` record effective after today.
- **Dates:**
  - Before today → `PAST_EFFECTIVE_DATE`.
  - Before the base record's effective date (a joiner's start) → `EFFECTIVE_BEFORE_CURRENT`.
  - A future date while a future change exists → `FUTURE_CHANGE_EXISTS`.
  - An immediate change while a future change exists is allowed. The scheduled record is not modified, and the preview returns a `futureChange` warning.
- **Business date:** the UTC date of the injected clock.

## Lock order

Every write follows the same order: **employee row first, then the request row.**

1. `SELECT id FROM employees WHERE id = ? FOR UPDATE`. This is the only lock for direct apply and request submission.
2. Approval and cancellation only: `SELECT * FROM compensation_change_requests WHERE id = ? FOR UPDATE`.

Transactions run at READ COMMITTED, so every read after the lock sees all commits made before the lock was granted. That includes the latest compensation version. Bands and HR users are read without locks.

The consistent order means two operations on one employee cannot deadlock. A lock-wait timeout or deadlock maps to 503 `SERVICE_UNAVAILABLE`, which is safe to retry with the same key.

## Idempotency design

- **Required header:** `Idempotency-Key`, 16–128 characters from `[A-Za-z0-9_-]`, on direct apply, request submission, approval, and cancellation. A missing or malformed key → 400 with reason `IDEMPOTENCY_KEY_REQUIRED`.
- **Scope of a key:** keys belong to one actor.
  - Direct apply: `compensation_records(changed_by_hr_user_id, operation_idempotency_key)`.
  - Request submission: `(requested_by, request_idempotency_key)`.
  - Approval and cancellation: `(decided_by, decision_idempotency_key)`.
  - An approval also stores its key on the record it creates.
- **When the key is checked:** under the employee lock, before the token and version checks. A retry after success therefore returns the original result, even after the preview has expired or the version has moved.
- **Same key, same command:** returns the original body with an `Idempotency-Replayed: true` header.
- **Same key, different data:** 409 `DUPLICATE_OPERATION`.
  - For requests, every stored command field is compared.
  - For direct changes, the stored record's employee, date, reason, and note are compared. The calculation is also re-run from the stored previous record, to confirm the same target value would result. There is no separate fingerprint column, because only the approved columns were allowed.
- **Concurrent races on different employees with one key:** the unique keys catch them, and the database error maps to `DUPLICATE_OPERATION`.
- **Separate responsibilities:** idempotency handles retries of one operation. The employee lock and expected version handle different concurrent operations.

## Preview-token design

- **Format:** HS256 JWT. The key is HMAC-SHA256(`JWT_SIGNING_KEY`, "acme salary-adjustment preview token v1"), with audience `acme-salary-adjustment-preview` and issuer `acme-backend`. A preview token can never verify as a session token, or the reverse.
- **Lifetime:** five minutes. It is checked with the injected clock, with zero tolerance, so the token is expired at exactly 5:00.
- **Claims:** `sub` (actor), `sid` (session), `emp` (employee code), `mode` (DIRECT_APPLY or SUBMIT_REQUEST), `ver` (expected version), `bv` (base version), and `dig`.
  - `dig` is the SHA-256 of every bound field: actor, session, employee, mode, both versions, target, method, normalized value, effective date, reason, note, and the exact proposed base and bonus.
  - **No salary value, note, or reason is in the token**, so nothing sensitive sits in the browser-held string.
- **Confirmation:** the client resends the exact command. The backend verifies the token and its binding, checks the versions, recalculates under the lock, and compares digests. Any changed field → 400 `PREVIEW_MISMATCH`.

## Public errors

The new codes are `FORBIDDEN` 403, `STALE_VERSION` 409, `DUPLICATE_OPERATION` 409, `PENDING_REQUEST_EXISTS` 409, `REQUEST_NOT_PENDING` 409, `EMPLOYEE_INELIGIBLE` 422 (with the exact spec message), and `SERVICE_UNAVAILABLE` 503. HTTP 402 is not used.

`ErrorResponse.error` has a new **optional** `reason` field for VALIDATION_ERROR on salary routes:

- Preview: `PREVIEW_EXPIRED`, `PREVIEW_INVALID`, `PREVIEW_MISMATCH`.
- Calculation: `PERCENTAGE_RANGE`, `INVALID_AMOUNT`, `NEGATIVE_RESULT`, `NO_CHANGE`, `ZERO_BONUS_PERCENTAGE`, `BASE_NOT_POSITIVE`.
- Band and dates: `SALARY_BAND`, `PAST_EFFECTIVE_DATE`, `EFFECTIVE_BEFORE_CURRENT`, `FUTURE_CHANGE_EXISTS`.
- Request: `NOTE_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`.

It lets the frontend show the page states in the spec. Existing error bodies are unchanged because `reason` is omitted when unset.

## Files changed

New:

- `db/migrations/003_salary_adjustments.sql`.
- `src/compensation/plan.ts`: target-aware plan, band checks, cash impact.
- `src/compensation/preview-token.ts`.
- `src/compensation/salary-adjustment-service.ts`.
- `src/http/salary-routes.ts`.
- Tests:
  - `test/compensation-plan.test.ts` (10)
  - `test/preview-token.test.ts` (6)
  - `test/db/salary-adjustment-schema.test.ts` (13)
  - `test/db/salary-adjustments.test.ts` (41)

Replaced:

- `src/compensation/adjustment.ts`.
- `test/compensation-adjustment.test.ts`: the candidate test plus 11.

Changed:

- `src/http/contract.ts`: paths, error codes, `reason`, salary schemas.
- `src/http/openapi.ts` and `openapi/openapi.json`: seven operations.
- `src/http/errors.ts`: `ApiError.reason`.
- `src/http/app.ts`: `salaryAdjustments` dependency and routes.
- `src/server.ts`: wiring.
- `src/money/decimal.ts`: unchanged; reused.
- `src/directory/directory-repository.ts`: `export` added to `EMPLOYEE_CODE` and `searchCondition`; no logic change.
- `src/seed/reference-data.ts`: bands.
- `src/seed/replace-employees.ts`: delete order.
- Existing tests:
  - `test/db/initial-schema.test.ts` and `test/db/access-schema.test.ts`: expected lists now include the 003 objects.
  - `test/db/seed-database.test.ts`: +3 tests for bands, band preservation, and reseed with salary history.
  - `test/http-openapi.test.ts`: endpoint list, codes, salary operations, routed check.
  - `test/support/http.ts`: `fakeSalaryAdjustments`.
  - `test/http-app.test.ts`, `test/db/auth-api.test.ts`, `test/db/employee-directory.test.ts`, `test/db/assistant-tools.test.ts`: pass the new dependency.

No frontend file was modified.

**Frontend builder:** `openapi/openapi.json` changed. Regenerate the API types: there are seven new operations, new error codes, and the optional `error.reason`.

## Tests and the defects they detect

| Area | Main defects detected |
| --- | --- |
| Calculator (12) | Float rounding (1.15 + 50%), `'50'` formatting, precision loss above 2^53 cents, rounding the change instead of the result, off-by-one percentage limits, decimal/negative/exponent inputs, negative results, no-change results |
| Plan (10) | Base change altering the bonus or the reverse, zero-bonus percentage, base ≤ 0, band edges (inclusive) and violations, a band narrowing the percentages, a currency mismatch |
| Preview token (6) | Accepted after five minutes, used by another actor/session/employee/mode, tampered or foreign or session JWT accepted, salary or note readable from the token, a digest that ignores any bound field |
| Schema (13) | An audit table, missing columns, keys, or RESTRICT foreign keys, two pending requests per employee, a reused request or operation key, inconsistent states, a correction without a note, an INITIAL_IMPORT row with an actor, the repeat migration run |
| Seed (+3) | Missing or wrong bands (88 checked against the ranges and caps), the seed overwriting edited bands, reseed blocked by salary history |
| HTTP on MySQL (41) | All the "Tests I expect" items in the spec for calculation, preview, direct changes, requests, approval and cancellation, stale and concurrent operations, effective dates, and API and permissions. Details below. |
| OpenAPI (+1, 3 changed) | Missing operations, Idempotency-Key header, error responses, schemas, list parameters, `reason` |

Selected MySQL tests:

- Preview writes nothing.
- Unknown and out-of-scope employees get identical 404s.
- A changed field, an expired token, and another actor are all rejected.
- Scoped tokens cannot direct-apply, and Admin tokens cannot submit requests.
- Direct apply produces one immutable version, with actor, previous record, and note.
- A duplicate direct confirmation creates one version, and so do **three concurrent identical confirmations**.
- **Two concurrent direct changes against one version give one 201 and one 409**, and a fresh preview is needed afterwards.
- A direct change makes the pending request stale.
- **Compensation and the stale update roll back together**, tested with a real temporary CHECK failure.
- A request creates no compensation, a retry returns the same request, and a second pending request is rejected.
- Scoped HR can view in-scope requests from other requesters, and gets 404 for out-of-scope ones.
- Approval writes the exact values, with the approving Admin as actor.
- Repeated approval returns the original result.
- **Two Admins approving concurrently give one 200 and one 409.**
- **A compensation-insert failure leaves the request pending, and a status-update failure rolls back the insert**, both tested with real CHECK failures.
- Cancellation requires a note and is idempotent.
- An approval key reused on another request is a duplicate.
- Each of these makes a request stale: an inactive requester, a removed scope, an employee who left, a passed effective date, and a band change.
- A future change becomes current only on its date.
- A second future change is rejected, and an immediate change keeps the scheduled amount and warns.
- A joiner cannot get a change effective before the start date.
- List filters and sorting are allowlisted and parameterized.
- Responses contain no internal IDs.
- Logs contain no salary, note, token, key, or employee code.

## Red failures actually observed

1. The candidate test file as written: **1 passed** (see above), with the debug lines printed.
2. `test/compensation-adjustment.test.ts`, with my additions, against the original implementation: **10 failed, 2 passed**. The first failures are listed above.
3. `test/compensation-plan.test.ts` against an `export {}` stub: `SyntaxError … does not provide an export named 'planAdjustment'`, an import-level red.
4. `test/db/salary-adjustment-schema.test.ts` before migration 003: **10 failed** (all).
5. `test/db/seed-database.test.ts` after adding the band and reseed tests: **4 failed, 13 passed**. The reseed failed with `ER_ROW_IS_REFERENCED_2`.
6. `test/preview-token.test.ts` against a stub: `SyntaxError … 'PREVIEW_TTL_SECONDS'`, an import-level red.
7. `test/db/salary-adjustments.test.ts` with a stub service and no routes: **40 failed, 0 passed**.
8. `test/http-openapi.test.ts` after the test changes: **3 failed, 10 passed**.
9. **Concurrency check, a deliberate defect.** I removed `FOR UPDATE` from the employee lock and from the request lock. "Two Admins approving one request concurrently" then failed in **3 of 3** runs. With both locks restored, the concurrency tests passed in **5 of 5** runs, and again 5 of 5 after adding the same-key concurrency test.

These failures were in my own tests, not the code:

- My hand count of titles per level was wrong (MID has 10 titles, SENIOR 13). I corrected the expected band list.
- The first "request-status failure" rollback test used the same temporary-CHECK cutoff time as the previous test, so the ALTER failed on an existing row. I moved its cutoff one second later.
- After the schema existed, `initial-schema` and `access-schema` failed on their expected table, index, and FK lists. I updated those lists to include the 003 objects.
- I once ran three DB test files in parallel against one database, which produced unrelated failures. I re-ran them with `--test-concurrency=1`, as `test:db` does.

## Commands and results

From `express-backend/`:

```text
npm run check                                lint and typecheck clean; # tests 365  # pass 365  # fail 0   (was 336)
npm run build                                exit 0
npm run openapi:generate                     Wrote openapi/openapi.json; drift test passes
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
                                             # tests 255  # pass 255  # fail 0   (was 199)
DATABASE_URL=… node --import tsx --test test/db/salary-adjustments.test.ts      # pass 41  # fail 0 (after the last added test)
DATABASE_URL=… node --import tsx --test --test-name-pattern="concurrent" test/db/salary-adjustments.test.ts   x5: 3/3 pass each run
Migration repeat run: salary-adjustment-schema and access-schema assert applied: [] with 001, 002, 003 already applied.
```

## Known limits

- **One business date for everyone:** the effective date and "today" use the UTC calendar date of the server clock, as the spec says ("organization-wide UTC business date").
- **Joiners:** a joiner's change must be effective on or after the start compensation date. After one adjustment, that record counts as the one future change, so further changes wait until it takes effect.
- **Direct-change replay check:** it compares the outcome (target value, date, reason, note) recalculated from the stored previous record. Two different methods that produce the same amount count as the same command, because there is no fingerprint column.
- **Not built:** there is no endpoint for reading or editing salary bands. The preview returns the band so the frontend can show the limits.
- **Session binding:** a preview token is tied to one session. Signing in again invalidates outstanding previews.
- **Lock waits:** they use the MySQL default `innodb_lock_wait_timeout`. A timeout returns 503.
- **Stale reason storage:** only the one employee's pending request can exist, so "other pending requests become STALE" affects at most one row.
- **Not covered by a test:** "Admin can directly change any eligible employee" is exercised only for India employees. No US-employee direct change test exists.

## Open decisions

1. **Optional `error.reason` field:** an additive change to the shared error shape, so the frontend can distinguish page states.
2. **Approval stale responses:** 409 `STALE_VERSION` for every changed-state cause, and 422 `EMPLOYEE_INELIGIBLE` for an employee who left. The request is marked STALE in both cases.
3. **Admin and the request endpoint:** Admin HR calling the request endpoint gets 403. The spec describes requests only for Scoped HR.
4. **Extra request columns:** `currency` and `base_compensation_version` were added to `compensation_change_requests` beyond the listed fields. They are needed to recheck the exact base record at approval.
5. **Band application:** a bonus-only change is still rejected if the unchanged base salary is outside the band, because the whole resulting compensation must fit the band.
6. **Effective-date ceiling:** there is no maximum future effective date. The spec sets none.

## Confirmations

- No Git command ran.
- No frontend file was modified.
- No `.env` file was read.
- No separate compensation audit table was created.
- No assistant mutation tool, bulk adjustment, or other excluded feature was added.
- `docs_human/` and `docs/` were not edited.
- Nothing was committed, and no later task started.
