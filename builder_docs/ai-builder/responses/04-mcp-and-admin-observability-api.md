# AI Task 04: MCP instrumentation and Admin observability APIs

**Task:** `builder_docs/ai-builder/tasks/04-mcp-and-admin-observability-api.md`

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`

**Date:** 2026-11-17

**Status:** All three priority steps are done and every check passes. Nothing after the step 1 checkpoint is committed, and I ran no Git command.

| Step | What it covers | Result |
|---|---|---|
| 1 | Admin traces: list, options, summary, detail, review, delete; MCP list and detail | Accepted at checkpoint 1 (`04-checkpoint-1.md`). The 8 operationIds are frozen, and steps 2 and 3 did not change them or any schema. |
| 2 | MCP instrumentation | Complete, fail-closed |
| 3 | Evaluator oracle fixtures (`issues/04-evaluator-oracle-fixtures.md`) | Complete; see section 4 for where the manifest goes |

**Issues for this task:**
- `builder_docs/ai-builder/issues/03-observability-frontend-contract-questions.md`: the Task 04 questions are answered in section 5.
- `builder_docs/ai-builder/issues/04-evaluator-oracle-fixtures.md`: implemented in step 3.
- `builder_docs/ai-builder/issues/04-frontend-deterministic-trace-fixtures.md`: **new, NEEDS_DECISION** (Q-E1 and Q-E2).

## 1. Architecture

| Layer | File | Role |
|---|---|---|
| Admin read model | `src/assistant/observability/admin-repository.ts` | SQL over the existing tables and typed columns: paged lists with totals, filter options, the complete detail (actor and reviewer names, next trace), compare-and-set review, aggregate delete with counts, MCP list and detail, and the summary. |
| Views | `src/assistant/observability/admin-service.ts` | Formatted and raw views, the identity placeholder pass, the summary window and buckets. No SQL. |
| Admin routes | `src/http/admin-observability-routes.ts` | Order on every request: `requireAuth` (role and status loaded from MySQL), then active Admin HR or 403, then input validation, then storage. A storage failure returns 503 and logs only the operation name. |
| Outcome classifier | `src/assistant/tool-outcome.ts` | One mapping from a registry outcome to a recorded REJECTED, SUCCEEDED, or FAILED row. The assistant loop and MCP both use it. |
| MCP recording | `src/http/mcp-routes.ts` | Attempt, outcome, fail-closed behaviour, and unknown-tool rejection (section 3). |
| Oracle fixtures | `src/evaluation/oracle-fixtures.ts`, `scripts/eval-oracle-fixtures.ts` | Guarded fixture command for the evaluator (section 4). |
| Contract | `src/http/contract.ts`, `src/http/openapi.ts`, `openapi/openapi.json` | 50 operations (42 before this task). |

There is no new framework, queue, service, or persistence model.

## 2. Admin APIs (step 1, frozen)

The full description is in `04-checkpoint-1.md`. In brief:

| operationId | Behaviour |
|---|---|
| `listAdminAiTraces` | Newest first, `page` and `pageSize` (25, at most 100; above 100 is a 400). Server-side filters: `from` and `to` (UTC dates, both inclusive, on start time), `hrUserId`, `status` (STARTED, COMPLETED, FAILED), `model`, `tool`, `errorCategory`. Responses carry a total and never include content fields. |
| `getAdminAiTraceOptions` | Stored HR users, models, tools, error categories, and stages, plus the closed status and stage lists and the known category values. |
| `getAdminAiTraceSummary` | `window=24h\|7d\|30d`. See the summary section below. |
| `getAdminAiTrace` | `view=formatted\|raw`: header, ordered model and tool calls, message sequences, review. |
| `reviewAdminAiTrace` | Compare-and-set on `expectedVersion`. A stale version returns `409 STALE_VERSION`; reviewing a STARTED trace returns `409 ASSISTANT_TURN_IN_PROGRESS`. |
| `deleteAdminAiTrace` | Needs `?confirm=<traceId>`. Removes one aggregate and returns the removed counts. Repeating it returns 404. |
| `listAdminMcpToolCalls`, `getAdminMcpToolCall` | The same paging and views. |

Scoped HR gets 403 on every operation. An unknown or deleted record gets 404.

**Summary details.**
- The window is `[now − length, now]`, inclusive at both ends.
- It returns:
  - counts by status;
  - failures by stage and category;
  - exact nearest-rank p50, p95, and max duration over COMPLETED traces;
  - token totals (total = input + output);
  - model calls by model;
  - tool calls and MCP calls by name and status;
  - reviews by verdict, plus unreviewed finished traces;
  - a zero-filled series in UTC buckets (hourly for 24h, daily otherwise).

**Query plans.** Measured on 10,000 traces over 90 days; the test `query plans with 10,000 traces over 90 days` prints them. Before migration 008, the 30-day window showed:
- the status count as a full index scan: `t:index:idx_ai_traces_status`;
- the percentiles as a full table scan: `t:ALL:null`.

Migration `008_ai_trace_summary_index.sql` adds a covering index, `idx_ai_traces_summary (started_at, status, duration_ms, failure_stage, error_category, input_tokens, output_tokens, reasoning_tokens)`. After it:
- every summary query on `ai_traces` alone is an index range (`idx_ai_traces_summary`, or `idx_ai_traces_status` for the failure breakdown);
- MySQL joins tool calls and model calls in one of two ways:
  - it ranges over `ai_traces` and joins children by the trace key;
  - in the 30-day window, it reads the child table and looks up each trace by primary key.
- Both join plans appeared across runs, and the test accepts either. In production, 30-day retention means a 30-day window covers almost every row anyway.

## 3. MCP instrumentation (step 2)

**Every authenticated tool request** follows this sequence:
1. **Attempt.** An `mcp_tool_calls` row is written first, before validation or execution. It holds the server principal's HR user ID (never one taken from arguments), the request ID, the tool name, and the arguments. The arguments go through the repository's scrubber, so a `password` key is stored as `[REDACTED]`.
2. **Validation or execution.** The shared registry validates with the same Zod schema as the assistant. Invalid input is not executed.
3. **Outcome.** The outcome is persisted as REJECTED (reason kept, no result), SUCCEEDED (complete `{ data, cards, limitations }`), or FAILED (`TOOL_FAILED` and the error class name only). Classification is `tool-outcome.ts`, the same as the assistant.
4. The result is returned only after that outcome write succeeds.

**Keeping the SDK out of validation.** MCP SDK v2 normally validates input before calling the handler. That would make invalid input unrecordable. Each tool is therefore registered with a pass-through schema that publishes the same JSON Schema (`recordFirstSchema`). Validation happens in the registry, after the attempt is recorded.

**Unknown tools.** The SDK answers these itself, before any handler runs. The route therefore records any `tools/call` to an unknown name as REJECTED `UNKNOWN_TOOL` first, then lets the SDK reply.

**Fail closed.**
- If the attempt write fails, the tool does not run.
- If the outcome write fails, no result is returned.
- In both cases the client gets the tool error `MCP_RECORDING_UNAVAILABLE` and nothing else.
- Each failure logs `mcp_recording_failure` with the request ID, tool, and stage only.
- If recording an unknown-tool call fails, the response is HTTP 503.

**Unchanged:**
- requests with an `Origin` header are rejected;
- the same Bearer authentication and per-request database scope apply;
- the five read-only, closed-world tools;
- MCP writes no AI trace, model-call, or tool-call row.

**Shared flow (rule 7).** In the assistant loop, only the SUCCEEDED and FAILED outcome objects now come from `recordedToolOutcome`, and they are field-for-field identical. Every existing assistant test passes unchanged.

## 4. Evaluator oracle fixtures (step 3)

**Command:**

```text
APP_ENV=test DATABASE_URL=mysql://…/acme_ai_eval_test \
  npm run eval:oracle-fixtures -- --database acme_ai_eval_test [--apply] > <manifest path>
```

**Guards.** All of these run before any write; each refusal exits 1:
- `APP_ENV=production` is refused.
- An `APP_ENV` outside `development`, `test`, `demo` is refused.
- A database name not ending in `_test` or `_demo` is refused.
- `--database` must repeat the name exactly.
- The connected database (`SELECT DATABASE()`) must match.

The command reads only the injected environment and never `.env`.

**Dry run is the default.** It previews each change, which writes nothing, and prints a planned manifest. In that manifest the new version has `planned: true` and `recordedAt: null`.

**`--apply`** makes the changes through the product's salary-adjustment service: preview, then Admin direct apply. Salary bands, version links, the one-future-change rule, and exact decimal money therefore all apply. The changes are marked with the change note `EVAL-ORACLE-FIXTURE v1 <fixture>`.

**Re-running finds the marked rows and writes nothing.** The normal workbook seed is not touched.

**Fixtures.** Each one picks the lowest-coded employee who is currently working, in India Tech (visible to Admin HR and the demo Scoped HR user), has only the initial import, and passes the preview. The selection is therefore deterministic.

| Fixture | Change | Cases |
|---|---|---|
| `MULTI_VERSION_CURRENT` | +5% base salary, effective on the evaluation date, so version 2 is CURRENT. Recorded at the evaluation clock. | E01, E08, E09, E18 |
| `RECENT_FUTURE_EFFECTIVE` | +8% base salary, effective 45 days later. Recorded at the evaluation clock, so version 1 stays CURRENT and version 2 is UPCOMING. | E09, E10 |

**Manifest fields.** No credentials, connection URL, or internal database IDs:
- the evaluation clock and date, the 30-day window, the database name, and the applied migration list;
- for each fixture: employee code and name, country, department, status, and the active HR users who can see it (display name and role);
- every version with its reason, `effectiveFrom`, `recordedAt`, state, and exact native base, bonus, cash, and currency;
- `oracle { selectedVersion, recordedAt, effectiveFrom, recordedWithinRecentWindow }`;
- `placeholders` for the evaluation corpus.

**Manifest location.** The command writes to stdout. The orchestrator saves it next to the frozen Checkpoint C evaluator handoff when preparing `acme_ai_eval_test`. That database does not exist in this lane, so no evaluator manifest was produced here.

On this lane's test database, the smoke run gave:
- MULTI_VERSION_CURRENT = `ACME00002` (selected version 2, effective 2026-11-17);
- RECENT_FUTURE_EFFECTIVE = `ACME00003` (selected version 1, effective 2027-01-01).

That database is reset by every suite, so these codes are not stable evidence.

## 5. Frontend contract questions for Task 04

| ID | Answer |
|---|---|
| Q-T1 | Each row and the detail carry `hrUser { id, displayName }`. |
| Q-T2 | `GET /admin/ai-traces/options`. Filters match exactly. |
| Q-T3 | Offset paging with `page` and `pageSize`, 25 by default and 100 at most. Above 100 is a 400, not clamped. `totalRows` and `totalPages` are returned. |
| Q-T4 | `from` and `to` are UTC calendar dates, both inclusive, applied to start time. |
| Q-T5 | Stable per-record placeholders: `Employee n`, `EMPLOYEE-n`, `employee-n@redacted.invalid`. They apply to every string in the formatted view, including prompts, model text, arguments, results, and the final answer. Salary values stay. Limit: a first name or surname typed on its own is not recognised. |
| Q-T6 | Generic JSON with identities replaced. Money keeps its stored shape (`{ amount, currency }` in cards, exact strings in data). |
| Q-T7 | `conversationId`, `turnSequence`, `previousTraceId`, `nextTraceId`. |
| Q-T8 | There is no separate validated value: `requestedArguments` plus `validationStatus` and `validationErrors`. Unparseable text appears as `{ invalidJson: true }`. |
| Q-T9 | `view=formatted\|raw`. Raw is the same step structure with the exact stored JSON, plus `warning` (the spec sentence) and `redaction.identities = NONE`. |
| Q-T10 | Closed enumerations are published in the schemas and in `options.enums`. A model-call `failureCategory` is a separate field from the trace `errorCategory`. Known category values are listed, and stored values are returned verbatim. An attempt left without an outcome is closed as `FAILED / OUTCOME_NOT_RECORDED`; `STARTED` children occur only in STARTED traces. |
| Q-T11 | Yes: `status=STARTED`. |
| Q-T12 | Model-call and tool-call sequences are each numbered across the whole trace. Every tool call carries `modelCallSequence`. |
| Q-T13 | There is no total cap. The detail is bounded by the per-field storage limits (in the worst case a few MB across 4 rounds and 16 tools). Values come from MySQL JSON columns, so they always parse. |
| Q-R1 | `review.version` is an integer, `review` is null when none exists, and the first review sends `expectedVersion: 0`. |
| Q-R2 | `reviewer { id, displayName }`, plus `createdAt` and `updatedAt`. |
| Q-R3 | `409 STALE_VERSION`, using the existing code. The body is the error only, so re-fetch the detail. |
| Q-R4 | No. A STARTED trace returns `409 ASSISTANT_TURN_IN_PROGRESS`. |
| Q-R5 | `200 { review }`, with the new version. |
| Q-D1 | `?confirm=<same traceId>` in the query, with no body. A missing or mismatched value returns `400 DELETE_CONFIRMATION_REQUIRED`. |
| Q-D2 | `200 { deleted: { traceId, modelCalls, toolCalls, messages, review } }`. For the consequence text before deleting, use the counts from the detail. |
| Q-M1 | The HR user (`hrUser`). MCP requires an HR JWT, so there is no other principal type. |
| Q-M2 | Newest first, 25 by default and 100 at most, filtered by `from`, `to`, `hrUserId`, `tool`, `status`. |
| Q-M3 | Yes: the same formatted and raw views and warning as traces. |
| Q-E1, Q-E2 | Not built. NEEDS_DECISION in `issues/04-frontend-deterministic-trace-fixtures.md`. |

## 6. Tests

| Area | Tests |
|---|---|
| Admin access and validation (fast) | `test/http-admin-observability.test.ts`, 6 tests: 401, and 403 for Scoped HR on all 8 operations before any storage access, even with bad input; storage down gives 503 with a safe log while auth and the directory keep working; 400 for invalid filters, views, review bodies, and delete confirmations; 404 for malformed IDs; the placeholder pass; summary buckets; failure-stage list parity. |
| Admin against MySQL | `test/db/admin-observability.test.ts`, 10 tests: filters and inclusive dates; paging with totals; no content in the list; options; a complete ordered detail with `nextTraceId`; formatted placeholders compared with the exact raw view and its warning; compare-and-set review (stale, in progress, unknown, Scoped 403); controlled delete (needs confirmation, removes children, keeps the conversation, later trace readable with `previousTraceId` null, repeat gives 404); MCP list and detail; empty and mixed summaries with exact percentiles and inclusive window edges; query plans on 10,000 traces. |
| MCP recording (fast, real SDK client) | `test/http-mcp-recording.test.ts`, 5 tests: attempt before execution and SUCCEEDED before return; invalid input REJECTED, no result, never executed; unknown tool REJECTED; attempt-write and outcome-write failures fail closed; listing still publishes the exact schemas. |
| MCP against MySQL | `test/db/assistant-tools.test.ts`, "MCP calls are recorded in mcp_tool_calls only …": rows and statuses; scrubbed `password`; every recorded employee is in Rohan's scope; no new `ai_traces`, `ai_model_calls`, or `ai_tool_calls` rows. The existing MCP Origin, auth, and tool-list tests still pass. |
| Oracle fixtures against MySQL | `test/db/eval-oracle-fixtures.test.ts`, 5 tests: every refusal case writes nothing; credentials never leave the URL parser; the dry run writes nothing and matches apply; the applied manifest has separate `recordedAt` and `effectiveFrom`, sits inside the 30-day window, has exact cents (cash = base + bonus), agrees with the stored rows, and the product directory does not select the future change early; scope (`visibleTo`), and Scoped HR can read both employees; no credentials or IDs in the manifest; re-run is idempotent; the seed is unchanged (exactly 2 non-import records, one import per employee). |
| OpenAPI | 50 operations; every documented operation is routed (DELETE included); no drift. |

**Red and mutation evidence.**
- These were new features, so the tests were written alongside the code. There is no earlier behaviour to show red against.
- Mutation checks, each broken temporarily and then restored, with no backup files left:

| Broken | Test that failed |
|---|---|
| The MCP outcome write not awaited | "attempt-write failure … outcome-write failure: no result is returned" |
| The SDK's own schema restored, so validation runs before recording | "invalid input is recorded REJECTED …" |

**Defects caught while writing the tests (all fixed):**
- The summary query-plan test first asserted one join plan, and a full-suite run showed the other plan. The assertion now accepts both observed plans; that is described in section 2.
- My summary token expectation was wrong: failed model calls report no tokens.
- The fixture manifest field `id` looked like a database ID, so I renamed it `fixture`.

## 7. Checks and exact results

All commands run from `express-backend/` against the isolated `acme_ai_backend_test` database (container `acme-ai-backend-mysql`, `127.0.0.1:3322`).

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: **449 tests, 449 pass, 0 fail, 0 cancelled** |
| `node --import tsx --test test/http-*.test.ts` (MCP, assistant, auth, salary, dashboard, and HR-access HTTP; a subset of the line above) | **112 pass, 0 fail** |
| `npm run test:db` (salary, dashboard, HR access, auth, directory, assistant, MCP, observability, admin, fixtures) | exit 0: **384 tests, 384 pass, 0 fail, 0 cancelled** |
| `npm run build` | exit 0 |
| `node --import tsx --test test/http-openapi.test.ts` (drift) | 16 pass, 0 fail |
| CLI smoke: dry run on the lane database / `APP_ENV=production` / missing `--database` | exit 0 / exit 1, refused / exit 1, refused |

Totals over the Task 03a baseline (438 fast, 368 MySQL): +11 fast tests and +16 MySQL tests.

## 8. Files changed (all under `express-backend/` unless noted)

**Step 1** (committed at the checkpoint):
- `src/assistant/observability/admin-repository.ts`, `src/assistant/observability/admin-service.ts`, `src/http/admin-observability-routes.ts`
- `db/migrations/008_ai_trace_summary_index.sql`
- `src/http/contract.ts`, `src/http/openapi.ts`, `src/http/app.ts`, `src/server.ts`, `src/assistant/observability/repository.ts`, `openapi/openapi.json`
- Tests: `test/http-admin-observability.test.ts`, `test/db/admin-observability.test.ts`, plus updates to the OpenAPI, schema, and migration-list tests and to the test app dependencies.

**Step 2:**
- `src/http/mcp-routes.ts`, `src/assistant/tool-outcome.ts`, `src/assistant/assistant-service.ts` (outcome objects only)
- `src/http/app.ts` and `src/server.ts` (the `mcpStore` dependency)
- `src/assistant/observability/repository.ts` (one type cast)
- Tests: `test/http-mcp-recording.test.ts`; `test/support/http.ts` (`fakeMcpStore`); `test/db/assistant-tools.test.ts` (+1 test).

**Step 3:**
- `src/evaluation/oracle-fixtures.ts`, `scripts/eval-oracle-fixtures.ts`
- `package.json` (the `eval:oracle-fixtures` script)
- Tests: `test/db/eval-oracle-fixtures.test.ts`.

**Docs:**
- `builder_docs/ai-builder/responses/04-checkpoint-1.md`
- this file
- `builder_docs/ai-builder/issues/04-frontend-deterministic-trace-fixtures.md`

## 9. Known limits and open items

- **Redaction.** The formatted view's placeholder pass misses a first name or surname typed on its own. The raw view is unredacted by design, behind the warning.
- **Trace detail size.** There is no response cap beyond the per-field storage limits.
- **Rate limiting.** The Admin routes have no rate limit; they are Admin-only reads plus two controlled writes.
- **Q-E1 and Q-E2.** Waiting on the planner's choice of A, B, or C (`issues/04-frontend-deterministic-trace-fixtures.md`).
- **Evaluator manifest.** It is produced only when the orchestrator runs the command against `acme_ai_eval_test`.

## 10. Confirmations

- No Git command was run, and nothing after checkpoint 1 is committed.
- No `.env` file was read or created, and no live API key was used; tests use fake models.
- Only the isolated AI backend test database (3322 / `acme_ai_backend_test`) was used.
- No `next-frontend/**` or `docs_human/**` file was changed.
- The 8 frozen Admin operationIds and their schemas were not changed after the checkpoint.
- There is no AI mutation, arbitrary SQL, scheduled cleanup, external tracing vendor, or new framework.
- Work stopped after Task 04.
