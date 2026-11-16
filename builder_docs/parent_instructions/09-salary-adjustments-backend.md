# Backend Task 09: Salary adjustments and approval requests

**Status:** READY AFTER CURRENT CHECKPOINT COMMITS

## Goal

Implement the complete backend workflow in `docs_human/11-salary-adjustments.md`.

Use the candidate's existing files as a starting point:

```text
express-backend/src/compensation/adjustment.ts
express-backend/test/compensation-adjustment.test.ts
```

The current implementation is incomplete and uses floating-point arithmetic. Replace it with exact money logic and complete tests.

## Read first

- `docs_human/11-salary-adjustments.md`
- `docs/05-initial-database-schema.md`
- `docs/10-access-control-design.md`
- `docs/17-employee-directory-api-test-plan.md`
- `docs/23-code-reading-guide.md`
- `builder_docs/responses/08-ai-assistant-mcp-fix.md`

## Included work

- Pure adjustment calculator for base salary and annual bonus.
- Salary-band schema and deterministic initial band data.
- `compensation_change_requests` schema.
- Required additions to `compensation_records` for actor, source request, previous record, note, and operation idempotency.
- Signed five-minute preview token.
- Admin direct-apply operation.
- Scoped HR request operation.
- Admin request list, detail, approval, and cancellation operations.
- Stale-version handling.
- Employee-row locking.
- Idempotency.
- Pending-request and approved-future-change rules.
- Express endpoints, Zod schemas, OpenAPI, and tests.

Do not add a separate compensation audit table. The immutable compensation record and `compensation_change_requests` provide the required history.

## Required safety rules

- Strict TypeScript.
- Exact money with BigInt or reviewed decimal helpers. No JavaScript floating-point salary arithmetic.
- Backend salary-band enforcement.
- Preview writes nothing.
- Admin direct apply creates compensation immediately.
- Scoped HR submission creates only a pending request.
- Scoped HR cannot approve, cancel, or call direct apply.
- Approval rechecks requester, scope, employee eligibility, salary band, effective date, and compensation version.
- Lock the employee row before reading the latest compensation version for a write.
- Idempotency and version checks have separate responsibilities.
- Other pending requests become `STALE` after a successful compensation change.
- Compensation write and request state changes commit together.
- No past effective dates.
- Keep one approved future change.
- Do not remove an existing future absolute amount after an immediate change.
- Never log salary values, notes, preview tokens, request bodies, JWTs, or idempotency keys.
- Never read `.env` files.
- Do not run Git commands.

## Database

Use migration `003` unless another committed migration already owns that number.

Use only:

```text
salary_bands
compensation_change_requests
```

plus approved columns on `compensation_records`.

Do not create a compensation audit table.

Use real MySQL tests for locks, concurrent writes, idempotency, request approval, stale transitions, and rollback.

## Existing manual code

Preserve the candidate's test intent, but do not preserve incorrect implementation details.

Remove debug logging. Use strict equality. Match the existing project formatting.

Record which candidate-written test first failed and which defect it caught.

## Verification

Run check, build, all real-MySQL tests, OpenAPI generation and drift checks, migration repeat test, and focused concurrency tests.

Do not modify frontend files.

## Response

Write:

```text
builder_docs/responses/09-salary-adjustments-backend.md
```

Include schema, operation flow, lock order, idempotency design, preview-token design, tests, observed red failures, commands, results, known limits, and confirmation that no Git or frontend work ran.
