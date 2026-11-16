# AI builder task 02: observability storage review fixes

## Status

Ready.

Fix only the confirmed review findings in Task 01. Do not start live assistant, MCP, HTTP, or frontend integration.

## Read first

```text
builder_docs/ai-builder/handoff.md
builder_docs/ai-builder/tasks/01-observability-storage-foundation.md
builder_docs/ai-builder/responses/01-observability-storage-foundation.md
docs_human/13-ai-observability.md
semantic-review/2026-11-16-195743-pr-01.md
```

Read the actual implementation and tests before changing them. A review finding is not accepted until you reproduce it with a failing test.

## Required corrections

### 1. Return the complete Admin trace summary

`listTraces` must return the fields required by the human specification:

- Trace ID.
- Start time.
- HR user ID.
- Status.
- Model.
- Distinct tool names used by the trace.
- Duration.
- Input, output, and reasoning-token counts.
- Model-call and tool-call counts.
- Error category.
- Failure stage.

Keep list responses free of prompts, responses, arguments, results, and safe-error JSON.

Return a defined typed summary. Fetch tool names without an N+1 query. Preserve server-side filters, newest-first ordering, default page size 25, and maximum 100.

Add a real-MySQL test that asserts the complete returned object, distinct ordered tool names, and absence of raw payload fields.

### 2. Make terminal tool states internally consistent

A `REJECTED` assistant or MCP tool call means validation prevented execution. It must not accept or persist a result.

Use discriminated terminal input types or equally strong runtime validation so:

- `REJECTED` accepts validation errors and safe error metadata, but no result.
- `SUCCEEDED` can persist the complete scrubbed result.
- `FAILED` records the safe execution failure shape defined by the current specification without pretending the call was rejected.

Move the existing synthetic employee/salary result preservation assertion to a successful tool call. Keep the rejected-argument and secret-scrubbing assertion on the rejected call.

Add equivalent assistant-tool and MCP tests.

### 3. Require the idempotency pair and return the real replay identity

`idempotencyKey` and `commandHash` must be supplied together or both omitted.

Validate this before opening a transaction. Reject:

- Key without hash.
- Hash without key.
- Empty values.
- A command hash that is not 64 lowercase hexadecimal characters.

For the same key and same hash, return the existing trace ID and its real conversation sequence. Do not return the impossible sequence `0`.

For the same key and a different hash, return `ConflictError` without creating a message or trace.

Add tests for both missing-pair cases, same-command replay, conflicting reuse, exact trace/message counts, and returned sequence.

### 4. Enforce model-before-tool ordering

A tool call can begin only after its parent model call has reached `SUCCEEDED` and belongs to the active trace.

Reject attempts to start a tool call under a `STARTED` or `FAILED` model call. This protects the fail-closed rule that the model outcome must be persisted before external tool execution begins.

Add real-MySQL tests for the permitted and rejected states.

### 5. Verify the complete migration contract

Replace sampled migration assertions with complete expected maps for the observability migration:

- Every foreign key and referenced table.
- Every delete rule, including `SET NULL`, `CASCADE`, and `RESTRICT` boundaries.
- Every ordered unique-key column list.
- Every required Admin-filter and retention index with column order.
- Required check constraints and their effective enforcement.

Keep assertions scoped to the seven Task 01 tables so unrelated migrations do not make the test brittle.

Do not weaken existing access or salary schema tests.

## Regression and validation

Run:

```text
cd express-backend
npm run check
DATABASE_URL=<isolated acme_test URL> npm run test:db
npm run build
```

Use only the established isolated test database. Never read `.env` and never write to the development database.

The following must remain true:

- Existing live assistant and MCP behavior is unchanged.
- No HTTP route or OpenAPI contract is added.
- Complete synthetic employee names, codes, and salary values remain stored for successful tool results.
- Forbidden credential fields remain scrubbed.
- Trace deletion and 30-day retention behavior remain intact.
- No ORM, queue, tracing vendor, agent framework, or new connection pool is added.

## Scope limits

Do not modify:

```text
docs_human/**
next-frontend/**
express-backend/src/compensation/adjustment.ts
express-backend/test/compensation-adjustment.test.ts
```

Do not run Git commands. Do not commit or push. Do not read or create `.env` files. Do not call OpenAI.

## Response

Write:

```text
builder_docs/ai-builder/responses/02-observability-storage-review-fixes.md
```

Report:

- Each reproduced failure and its failing assertion.
- Files changed.
- Exact correction for each finding.
- Exact fast, database, and build results.
- Any check not run and why.
- Confirmation that no live integration, Git command, `.env` read, development-database write, OpenAI call, commit, or push occurred.

Stop after this correction task.