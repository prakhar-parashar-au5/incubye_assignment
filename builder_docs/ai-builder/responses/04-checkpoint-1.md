# AI Task 04 — checkpoint 1 (priority step 1)

**Date:** 2026-11-17. **Status:** Step 1 is complete and every check is green. Not committed, and no Git command was run.

The OpenAPI document `express-backend/openapi/openapi.json` has been regenerated. It now lists 50 operations, up from 42.

## Before you read further: step 2 work is already in the tree

The planner's stop instruction arrived after I had begun step 2, MCP instrumentation. That code is in the working tree, is covered by tests, and passes in the runs below. Since the instruction arrived, I have done no further step 2 work.

The step 2 files are:
- `src/http/mcp-routes.ts`: records attempts and outcomes, fails closed, and records calls to unknown tools.
- `src/assistant/tool-outcome.ts`: a new classifier for tool outcomes. The assistant loop now uses it for its SUCCEEDED and FAILED outcomes only; nothing else in the loop changed.
- The `mcpStore` dependency in `src/http/app.ts` and `src/server.ts`.
- `fakeMcpStore` in `test/support/http.ts`.
- `test/http-mcp-recording.test.ts` (5 tests).

The MCP list and detail routes belong to step 1's contract, which is why they are already published.

**Decision needed:** should I keep this MCP code for step 2, or back it out before you review step 1? I have not backed anything out, because doing so would undo tested work without an instruction.

## New operations (step 1)

| operationId | Method and path |
|---|---|
| `listAdminAiTraces` | `GET /api/v1/admin/ai-traces` |
| `getAdminAiTraceOptions` | `GET /api/v1/admin/ai-traces/options` |
| `getAdminAiTraceSummary` | `GET /api/v1/admin/ai-traces/summary` |
| `getAdminAiTrace` | `GET /api/v1/admin/ai-traces/{traceId}` |
| `deleteAdminAiTrace` | `DELETE /api/v1/admin/ai-traces/{traceId}` |
| `reviewAdminAiTrace` | `POST /api/v1/admin/ai-traces/{traceId}/review` |
| `listAdminMcpToolCalls` | `GET /api/v1/admin/mcp-tool-calls` |
| `getAdminMcpToolCall` | `GET /api/v1/admin/mcp-tool-calls/{mcpCallId}` |

## Contract decisions the frontend needs

These are all published in OpenAPI. They answer the frontend's Q-T, Q-R, Q-D, and Q-M questions; the full write-up goes into the final Task 04 response.

**Access**
- Every operation requires an active Admin HR user. Scoped HR receives `403 FORBIDDEN`, and this check runs before input validation.
- If observability storage is down, the response is `503 SERVICE_UNAVAILABLE`.

**Trace list**
- Pagination uses `page` and `pageSize`: 25 by default and 100 at most. A `pageSize` over 100 returns 400 instead of being clamped.
- Each response carries `page.totalRows` and `page.totalPages`. Results are newest first.
- Filters: `from` and `to` (UTC calendar dates, both inclusive, applied to start time), `hrUserId`, `status` (including `STARTED`), `model`, `tool`, and `errorCategory`.
- Each row includes `hrUser { id, displayName }`.
- Rows never include prompts, responses, arguments, results, or safe-error JSON.

**Options**
- Returns the HR users, models, tool names, error categories, and failure stages found in stored traces.
- Also returns the closed lists of statuses and stages, and the known category values.

**Trace detail**
- `?view=formatted|raw`, with `formatted` as the default.
- **Formatted view:** each employee is replaced by a stable placeholder that holds for the whole trace. Names become `Employee n`, codes become `EMPLOYEE-n`, and emails become `employee-n@redacted.invalid`. This applies to every string in the trace, prose included. Salary values stay visible. One limit: a first name or surname typed on its own is not recognised and stays visible.
- **Raw view:** the exact stored JSON, plus `warning` set to the specification's sentence about synthetic data.
- Model calls and tool calls each have their own sequence number across the whole trace. Each tool call carries `modelCallSequence` to link it to its model call.
- The detail includes `conversationId`, `turnSequence`, `previousTraceId`, and `nextTraceId`.
- There is no separate "validated arguments" value. The detail returns the requested arguments together with the validation status and errors.

**Review**
- The request body is `{ verdict, note ≤ 2000, nominated, expectedVersion }`. Send `expectedVersion: 0` for the first review.
- A successful POST returns `{ review }`, including the new `version` and `reviewer { id, displayName }`.
- A stale `expectedVersion` returns `409 STALE_VERSION`. The UI should then re-fetch the detail.
- Reviewing a `STARTED` trace returns `409 ASSISTANT_TURN_IN_PROGRESS`.

**Delete**
- Confirmation goes in the query string, `?confirm=<same traceId>`, with no request body. Without it the response is `400` with reason `DELETE_CONFIRMATION_REQUIRED`.
- Success returns `200 { deleted: { traceId, modelCalls, toolCalls, messages, review } }`.
- Deleting the same trace again returns 404.

**MCP**
- The list takes the same date and page parameters, plus `hrUserId`, `tool`, and `status`.
- The principal is shown as an HR user.
- The detail has the same formatted and raw views as traces.

**Summary**
- `?window=24h|7d|30d`. The window is `[now − length, now]`, inclusive at both ends.
- Duration percentiles are exact, using the nearest-rank method over completed traces only.
- Total tokens are input plus output tokens.
- The time series uses UTC-aligned buckets, zero-filled: hourly for `24h`, daily otherwise.

## Migration 008 (summary index)

I tested the summary queries against 10,000 traces spread over 90 days:

- **Before:** in the 30-day window, the status count did a full index scan (`index`) and the percentile query did a full table scan (`ALL`).
- **Change:** I added the covering index `idx_ai_traces_summary (started_at, status, duration_ms, failure_stage, error_category, input_tokens, output_tokens, reasoning_tokens)`.
- **After:**
  - Every summary query on `ai_traces` alone is an index range scan.
  - The tool-call and model-call joins use one of two plans:
    - range-scan `ai_traces`, then join the child rows by trace key;
    - read the child table and look each trace up by primary key.
  - Both join plans appeared across runs, and the test accepts either.

## Checks (run from `express-backend/` against `acme_ai_backend_test` on 127.0.0.1:3322)

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: **449 tests, 449 pass, 0 fail** (was 438). This includes the 5 MCP recording tests from step 2. |
| `npm run test:db` | exit 0: **378 tests, 378 pass, 0 fail** (was 368) |
| `npm run build` | exit 0 |
| `node --import tsx --test test/http-openapi.test.ts` | 16 pass: no drift, and every documented operation is routed |

## Step 1 files

**New source:**
- `src/assistant/observability/admin-repository.ts`
- `src/assistant/observability/admin-service.ts`
- `src/http/admin-observability-routes.ts`
- `db/migrations/008_ai_trace_summary_index.sql`

**Changed source:**
- `src/http/contract.ts`: admin schemas, `PATHS`, and the `DELETE_CONFIRMATION_REQUIRED` reason.
- `src/http/openapi.ts`
- `src/http/app.ts`
- `src/server.ts`
- `src/assistant/observability/repository.ts`: exports helpers for the admin read model, plus one type cast.
- `openapi/openapi.json`

**New tests:**
- `test/http-admin-observability.test.ts` (6 tests)
- `test/db/admin-observability.test.ts` (10 tests)

**Updated tests:**
- `test/http-openapi.test.ts`: 50 operations, and DELETE is now route-checked.
- The migration lists and the index and check lists in `test/db/access-schema.test.ts`, `test/db/salary-adjustment-schema.test.ts`, and `test/db/observability-storage.test.ts`.
- Every test-built `createApp` now receives `adminObservability` (and `mcpStore`).

## What I need from the planner

1. Keep or back out the step 2 MCP code described at the top.
2. Say when to continue with step 2 and then step 3. I have stopped.
