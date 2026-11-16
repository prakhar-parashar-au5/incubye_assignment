# Response: Backend Task 09 review fix 09a, exact direct-operation idempotency

**Status:** Complete. Ready for planner review.

## What changed

Admin direct changes now store a SHA-256 fingerprint of the canonical command in the new `compensation_records.operation_fingerprint` column. Replay is decided by comparing **actor + idempotency key + fingerprint**.

The old outcome-based check (`sameDirectCommand`, which re-ran the calculation from the previous record) is removed.

- Same actor, key, and fingerprint → the original result, with `Idempotency-Replayed: true`.
- Same actor and key with a different fingerprint → 409 `DUPLICATE_OPERATION`, even when the rounded amount is the same.

Request-creation, approval, and cancellation idempotency are unchanged. A new test shows that request creation does not have the defect, because requests already store and compare every command field.

## Migration decision: column added to `003`, not a new `004`

The fix instructions say to edit `003` if it is still uncommitted. I cannot run Git, so I used the evidence available:

- `index.md` has no Task 09 entry. The last entry is Task 08, `ACCEPTED - COMMIT REQUIRED`.
- The 09a instruction says to "fix one confirmed idempotency gap **before commit**".
- `003` exists only in the local `acme_test` database. There is no `acme_dev` in the current container.

So I added the column to `003` and updated its schema tests.

**If `003` has in fact been committed or applied anywhere else, tell me, and I will move this into an additive `004` instead.** A database that already ran the old `003` will not pick up the change, because migrations are recorded by name.

## Fingerprint design

`src/compensation/fingerprint.ts`, `directCommandFingerprint()`:

```text
SHA-256( "acme direct salary-adjustment command v1\n" + JSON.stringify([
  employeeCode, target, method, normalizedValue, effectiveFrom, reason, normalizedNote,
  expectedCompensationVersion, baseCompensationVersion, confirmationMode
]) )  ->  64 lowercase hex characters
```

- **Inputs:** every field the fix requires.
  - The value is normalized: amounts to two decimals (`150000` → `150000.00`), whole percentages as given.
  - The note is trimmed, and blank becomes null.
  - Both versions come from the **signed preview token**. A replay after compensation has moved on therefore still produces the original fingerprint.
- **No ambiguous field boundaries:** the fields are JSON-encoded, so the boundary between two fields cannot shift. A test checks that a reason/note split cannot collide.
- **Domain separation:** the fixed label keeps it distinct from the preview-token digest.
- **No plain text:** only the hash is stored. No amount, note, code, preview token, or idempotency key appears in it.

**Column rules** in `003`:

- `operation_fingerprint CHAR(64) ascii_bin NULL`.
- `chk_compensation_fingerprint_format`: NULL or `^[0-9a-f]{64}$`.
- `chk_compensation_direct_fingerprint`: a record written by an HR user with no source request (a direct change) must have a fingerprint, and a record created from an approved request must not.
- `chk_compensation_initial_import` now also requires a null fingerprint.

**Replay after expiry.** The replay path checks the token with a new `PreviewTokens.verifyIgnoringExpiry()`. This is how the replay obtains the signed versions.

- It checks the signature, audience, issuer, actor, session, employee, and mode, evaluated at the token's own issue time. Only expiry is skipped.
- It is used only to identify the command of a replay, never for a new write.
- A token that fails this check on a reused key is treated as a different command and returns `DUPLICATE_OPERATION`.

## Files changed

- New: `src/compensation/fingerprint.ts`; `test/compensation-fingerprint.test.ts` (5 tests).
- `db/migrations/003_salary_adjustments.sql`: the column and three CHECK changes.
- `src/compensation/preview-token.ts`: `verifyIgnoringExpiry`.
- `src/compensation/salary-adjustment-service.ts`:
  - The direct-apply replay uses the fingerprint.
  - Inserts store the fingerprint (null for approvals).
  - `confirmPreview` returns the verified versions.
  - `sameDirectCommand` is removed.
- `test/preview-token.test.ts`: +1 test.
- `test/db/salary-adjustment-schema.test.ts`: column list, fingerprints on fixture rows, +1 rules test.
- `test/db/salary-adjustments.test.ts`: +6 tests.

The OpenAPI contract is unchanged; it was regenerated and the drift test passes. No frontend files changed.

## Tests added

| Test | Defect it detects |
| --- | --- |
| Same key, **different method**, same rounded outcome (+10% vs +150000 on 1,500,000) → 409 | Replay decided by outcome. **This was a real red before the fix: 201.** |
| Same key, **different input**, same rounded outcome (bonus 0.03: +20% and +30% both round to 0.04) → 409 | Same defect with inputs. **Real red before the fix: 201.** |
| Same key and exact command → original body, `Idempotency-Replayed: true`, after the preview expired, with `150000.00` / trimmed note equal to `150000` / `"  same note "` | A replay that breaks after expiry or after normalization |
| Direct records store only a 64-hex fingerprint; the import record and the approved-request record store null; no salary, note, token, key, code, or reason in the hash | Plain-text command data stored; a missing or extra fingerprint |
| **US employee direct adjustment** (Senior Accountant, 150,000.00 + 10%) | USD kept, `ANNUAL` pay frequency kept, the US SENIOR band shown (120,000–190,000, bonus ≤ 10,000), 190,000.01 base and 10,000.01 bonus rejected, 190,000.00 accepted. Detects the India band or currency being applied to US compensation. |
| Request: same key, different method, same outcome → 409 | Confirms request idempotency does not have the defect; no change needed there |
| Fingerprint unit tests (5) | A field ignored, boundary shifting, plain text in the hash, collision with the preview digest |
| `verifyIgnoringExpiry` (1) | Skipping signature or binding checks along with expiry |
| Schema rules (1) | A direct change without a fingerprint, a non-hex or uppercase fingerprint, a fingerprint on an import row |

## Red failures actually observed

1. `test/compensation-fingerprint.test.ts` against an `export {}` stub: `SyntaxError … does not provide an export named 'directCommandFingerprint'`. This was an import-level red.
2. The new MySQL tests, run against the unchanged Task 09 service: **3 failed, 2 passed.**
   - "Different method": `[201, undefined]` instead of `[409, 'DUPLICATE_OPERATION']`. This is the confirmed defect.
   - "Different input": the same, `201` instead of `409`.
   - "Fingerprint stored": `Unknown column 'c.operation_fingerprint'`.
   - The exact-replay test and the US test passed already.
3. After the column was added, the existing schema test "INITIAL_IMPORT has no actor" failed with `chk_compensation_direct_fingerprint` instead of `chk_compensation_initial_import`, because its row broke both rules. I gave that row a valid fingerprint so it isolates the import rule again.

## Commands and results

From `express-backend/`:

```text
npm run check                        lint and typecheck clean; # tests 371  # pass 371  # fail 0   (was 365)
npm run build                        exit 0
npm run openapi:generate             Wrote openapi/openapi.json; test/http-openapi.test.ts 13/13 pass (no drift)
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
                                     # tests 263  # pass 263  # fail 0   (was 255)
Focused concurrency and idempotency tests (pattern "concurrent|same key|duplicate|idempoten|Idempotency"),
  test/db/salary-adjustments.test.ts, 5 runs: 12/12 pass each run
```

## Known limits

- **Session-bound replay:** a replay must come from the same login session, because the preview token is session-bound. A retry after signing in again returns `DUPLICATE_OPERATION`; the original change is still recorded once.
- **Existing databases:** a database that already applied the earlier `003` needs to be reset (`acme_test` is reset by the tests) or given a `004`. See the migration decision above.

## Confirmations

- No Git command ran.
- No frontend files were modified.
- No `.env` file was read.
- No compensation audit table was created.
- No dashboard, HR-access, or other feature work started.
- Nothing was committed.
