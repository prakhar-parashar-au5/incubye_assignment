# AI builder task 04a: guarded trace fixtures for the traces UI

## Status

READY. Planner decision on `issues/04-frontend-deterministic-trace-fixtures.md`: **Option B**. Mark that issue RESOLVED with this choice.

Task 04 is accepted (planner reran lint, typecheck, 449 fast tests, build; OpenAPI unchanged since checkpoint 1).

## Why

The traces UI lane runs without an OpenAI key, so the only real traces it can produce are `FAILED / not_configured`. The monitoring dashboard, timeline, raw view, review and delete screens need every trace shape to be tested against a real backend.

## Build

`npm run eval:trace-fixtures -- --database <name> [--apply]`, in `scripts/eval-trace-fixtures.ts` and `src/evaluation/trace-fixtures.ts`.

- **Same guards as `eval:oracle-fixtures`** (reuse the guard code, don't copy it): refuse `APP_ENV=production`, `APP_ENV` outside development/test/demo, database names not ending `_test` or `_demo`, `--database` mismatch, connected-database mismatch. Dry run by default. Never read `.env`.
- **Write through the real observability repository** (the same path as `seedTrace` in `test/db/admin-observability.test.ts`; move that helper into `src/evaluation/` and have the test import it, rather than having two copies).
- **Shapes**, owned by the seeded demo users (Meera for Admin, Rohan for Scoped, plus at least one trace from each):
  - completed, no tool
  - completed, one tool
  - completed, multi-tool across two model rounds
  - rejected tool argument, including a `password` key (stored `[REDACTED]`)
  - tool failed
  - provider timeout
  - persistence failure with `FAILED / OUTCOME_NOT_RECORDED` children
  - `STARTED` (in progress)
  - one trace with an existing review (so stale review can be tested)
  - two turns in one conversation (so previous/next navigation works)
  - MCP calls: one each of SUCCEEDED, REJECTED, FAILED
- **Spread `started_at`** across the last 30 days, with at least one in the last hour, so 24h / 7d / 30d summaries all have data and differ. Use realistic durations and token counts, so p50/p95 are meaningful.
- **Mark** every fixture so a re-run finds them and writes nothing (idempotent), like the oracle fixtures.
- Print a short manifest to stdout: shape → traceId / mcpCallId. No credentials or connection strings.

## Tests

Guard refusals write nothing; dry run writes nothing; apply creates every shape; re-run is idempotent; the admin list, detail, and summary endpoints return the shapes correctly; no new runtime code path (the server never imports `src/evaluation/`).

Run lint, typecheck, `npm test`, `npm run test:db`, build, and the OpenAPI drift test. The OpenAPI must not change.

## Rules

Only DB lane 3322 / `acme_ai_backend_test`. No Git, no `.env`, no live key, no `next-frontend/**` or `docs_human/**`. Do not change the 8 frozen admin operations or any schema.

Write `responses/04a-trace-ui-fixtures.md`, including the exact command the traces UI builder should run against `acme_ai_traces_e2e_test`. Stop.
