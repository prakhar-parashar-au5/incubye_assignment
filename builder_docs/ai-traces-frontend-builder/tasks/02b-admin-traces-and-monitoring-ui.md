# AI traces frontend task 02b: Admin traces, MCP, and monitoring dashboard

## Status

READY after Task 02a, once this worktree has merged AI Backend Task 04 checkpoint 1 (accepted 2026-11-17). Read `builder_docs/ai-builder/responses/04-checkpoint-1.md` for the contract decisions: pagination, filters, `options` endpoint, formatted vs raw view, `expectedVersion: 0` for first review, `409 STALE_VERSION`, delete via `?confirm=<traceId>`, and summary semantics. The 8 admin operationIds are frozen; if anything in them looks wrong, report it, don't work around it.

Known redaction limit from the backend: a first name or surname typed alone in prose is not redacted. Do not try to fix this in the UI; list it under limitations in your response.

## Required work

The Admin half of Task 02, plus a monitoring dashboard:

- Add the Task 04 operation IDs to the contract allowlist and regenerate.
- Admin-only navigation entry "AI monitoring" with three views:
  1. **Overview:** built only from `GET /api/v1/admin/ai-traces/summary`. Window switch 24h / 7d / 30d. Status counts, failure breakdown, p50/p95/max duration, token totals, per-model and per-tool counts, MCP counts, review verdicts, and the time-series chart of traces and failures. Every number links to the trace list pre-filtered where a matching filter exists.
  2. **Traces:** filters, pagination, formatted timeline, warned raw JSON view, review with stale-version handling, deletion with confirmation.
  3. **MCP calls:** list and detail.
- Keep formatted identity redaction and raw-data restrictions exact, per your accepted shape and `docs_human/13`.
- Handle 403, 404 (unknown or deleted), stale review, partial failure, unavailable backend, session expiry, and large JSON.
- Desktop, mobile, keyboard, focus, zoom, and accessibility per the accepted shape.

Use the same lane (3326 / 4226) as Task 02a. All other rules, tests, and the response format follow Task 02. Write `responses/02b-admin-traces-and-monitoring-ui.md`.
