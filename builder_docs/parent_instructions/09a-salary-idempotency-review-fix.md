# Backend Task 09 review fix: Exact direct-operation idempotency

**Status:** READY

Task 09 passes its main checks. Fix one confirmed idempotency gap before commit.

## Problem

The approved rule is:

```text
same idempotency key + same command = replay original result
same idempotency key + different command = DUPLICATE_OPERATION
```

A direct Admin change currently stores the idempotency key but not the exact command fingerprint. Replay detection reconstructs the result from the previous compensation record. Two different methods or input values that round to the same outcome can therefore be treated as the same command.

Idempotency compares commands, not only outcomes.

## Required change

Add a non-sensitive SHA-256 fingerprint of the canonical direct command to `compensation_records`.

The fingerprint must bind at least:

- Employee stable code or internal target identity.
- Adjustment target.
- Adjustment method.
- Normalized input value.
- Effective date.
- Reason.
- Normalized note.
- Expected compensation version.
- Base compensation version.
- Confirmation mode.

Store only the hash, not a duplicate raw command or preview token.

Rules:

- `INITIAL_IMPORT` records have a null fingerprint.
- Application-created direct records have a fingerprint.
- A replay with the same actor, idempotency key, and fingerprint returns the original result.
- The same actor and key with a different fingerprint returns 409 `DUPLICATE_OPERATION`, even when the final amount is equal after rounding.
- Keep request-creation and approval/cancellation idempotency behavior unchanged unless a test proves the same defect there.

Use an additive corrective migration if migration `003` has already been committed. If it is still uncommitted, add the column to migration `003` and update its schema tests. Do not create a compensation audit table.

## Additional coverage

Add:

- Same direct idempotency key, different method, same rounded outcome → conflict.
- Same direct idempotency key, different normalized input, same rounded outcome → conflict.
- Same direct idempotency key and exact command → original result.
- Fingerprint does not contain salary, note, preview token, or idempotency key in plain text.
- One valid US employee direct adjustment, preserving USD and the US salary band.

## Verification

Run:

```text
npm run check
npm run build
npm run openapi:generate
full real-MySQL test suite
focused salary concurrency and idempotency tests
```

Do not modify frontend files. Do not start dashboard or HR access work. Do not run Git commands.

## Response

Write:

```text
builder_docs/responses/09-salary-adjustments-backend-fix.md
```
