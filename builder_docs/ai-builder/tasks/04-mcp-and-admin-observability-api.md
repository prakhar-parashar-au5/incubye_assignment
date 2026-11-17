# AI builder task 04: MCP and Admin observability APIs

## Status

READY. Task 03 and 03a were accepted on 2026-11-17 (planner reran typecheck and the fast suite: 438 pass).

## Priority order

The traces frontend builder is waiting on this contract. Deliver it in this order and regenerate OpenAPI after each step, so the contract is usable early:

1. Admin trace list, detail, review, delete, plus the new **summary** endpoint below.
2. Admin MCP list and detail, plus MCP instrumentation.
3. Evaluator oracle fixtures from `builder_docs/ai-builder/issues/04-evaluator-oracle-fixtures.md`. Last; skip and report if time runs out.

## Goal

Complete backend observability by instrumenting MCP calls and exposing Admin-only trace, MCP, review, deletion, and monitoring-summary APIs.

## Monitoring summary (planner addition, approved by Prakhar 2026-11-17)

`docs_human/13` defines trace list and detail but no aggregate view. Add one read-only Admin endpoint that powers an AI monitoring dashboard:

```text
GET /api/v1/admin/ai-traces/summary?window=24h|7d|30d   (default 24h)
```

Return, for the window, computed in SQL from the existing typed columns (never by scanning JSON):

- Trace counts by terminal status, plus `STARTED` still open.
- Failure counts by failure category and reason.
- Duration p50 and p95 and max (ms) for completed traces. If exact percentiles are awkward in MySQL 8.4, compute them over the bounded window with a window function, or document the approximation.
- Token totals: input, output, reasoning, total.
- Model-call count, and counts by model name.
- Tool-call counts by tool name and status (`SUCCEEDED`, `FAILED`, `REJECTED`).
- MCP call counts by tool name and status.
- Review counts by verdict, and unreviewed count.
- A time series of trace count and failure count, hourly for `24h`, daily for `7d` and `30d`.
- `generatedAt` and the window bounds.

Rules: Admin only (Scoped HR 403), no prompt, response, argument, result, or identity content, strict Zod schema and OpenAPI like every other operation. Add an index only if `EXPLAIN` shows a full scan over the 30-day window, and record the plan in the response. Tests: empty window, mixed statuses, percentile correctness on a known set, window boundaries, 403 for Scoped HR.

Do not modify frontend code.

## Read first

```text
docs_human/13-ai-observability.md
docs/24-parallel-worktree-and-ai-evaluation-plan.md
builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md
express-backend/src/http/mcp-routes.ts
express-backend/src/assistant/observability/
```

## MCP instrumentation

For every authenticated MCP tool request:

1. Create `mcp_tool_calls` attempt before validation or execution.
2. Persist invalid input as `REJECTED` with no result.
3. Persist successful complete structured result as `SUCCEEDED`.
4. Persist safe execution failure as `FAILED`.
5. Return only after required outcome persistence succeeds.

Keep:

- Server-derived principal.
- Current database-backed scope.
- Existing browser-Origin rejection.
- Existing read-only closed-world tools.
- No AI trace or model-call row for MCP.

Share outcome classification and persistence helpers with the assistant where practical. Do not create a parallel tool registry.

## Admin APIs

Implement current-Admin-only endpoints:

```text
GET    /api/v1/admin/ai-traces
GET    /api/v1/admin/ai-traces/:traceId
POST   /api/v1/admin/ai-traces/:traceId/review
DELETE /api/v1/admin/ai-traces/:traceId
GET    /api/v1/admin/mcp-tool-calls
GET    /api/v1/admin/mcp-tool-calls/:mcpCallId
```

Requirements:

- Scoped HR receives 403.
- Current role/status is checked through existing authentication on every request.
- Trace list defaults to 25, max 100, newest first.
- Approved date, actor, status, model, tool, and error filters run server-side.
- List never includes prompts, responses, arguments, results, or safe-error JSON.
- Detail returns ordered model/tool/message timeline.
- Formatted detail uses redacted employee identities by default.
- Raw JSON requires an explicit view parameter and remains Admin-only.
- Raw response includes the synthetic-data warning metadata required by the frontend.
- Review accepts `CORRECT`, `PARTIAL`, or `INCORRECT`, bounded note, nomination, and expected review version.
- Stale review returns 409.
- Delete requires explicit confirmation data and removes only the approved trace aggregate.
- Unknown/deleted trace or MCP record returns 404.

No trace content may enter application logs.

## Contract and tests

Add strict runtime schemas and OpenAPI for every operation.

Prove:

- MCP attempt/outcome ordering and fail-closed persistence.
- Invalid MCP input never executes.
- MCP scope and Origin policy remain intact.
- Admin list filters/pagination and raw-field exclusion.
- Complete ordered trace detail.
- Formatted identity redaction versus warned raw synthetic JSON.
- Scoped HR 403 for every Admin operation.
- Review compare-and-set.
- Controlled deletion cascade and later-trace readability.
- No secret fields in API responses or logs.
- OpenAPI drift.
- Non-AI routes remain independent of observability failures.

Run all backend fast, MySQL, MCP, assistant, auth, salary, dashboard, HR-access, and production-build checks.

## Scope limits

Do not implement frontend UI, AI mutation, arbitrary SQL, scheduled cleanup, external tracing vendor, or new framework.

Do not modify `next-frontend/**` or `docs_human/**`.

Never read or create `.env`, handle a live API key, run Git commands, commit, or push.

## Response

Write:

```text
builder_docs/ai-builder/responses/04-mcp-and-admin-observability-api.md
```

Stop after backend contract generation and validation. The accepted OpenAPI becomes Checkpoint B for the AI-traces frontend builder.