# AI Task 04a: guarded trace fixtures for the traces UI

**Task:** `builder_docs/ai-builder/tasks/04a-trace-ui-fixtures.md`. This implements Option B of `issues/04-frontend-deterministic-trace-fixtures.md`, which is now marked RESOLVED.

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`

**Date:** 2026-11-17

**Status:** Complete and verified. Not committed, and I ran no Git command.

OpenAPI did not change: `openapi/openapi.json` has the same SHA-256 before and after regeneration, `fe42c8c5…b838374`.

## Command for the traces UI builder

Run this against the traces UI lane database, after migrations and the demo-user seed:

```text
cd express-backend
APP_ENV=test DATABASE_URL='mysql://<user>:<password>@127.0.0.1:<port>/acme_ai_traces_e2e_test' npm run db:migrate
APP_ENV=test DATABASE_URL='…/acme_ai_traces_e2e_test' DEMO_MEERA_PASSWORD=… DEMO_ROHAN_PASSWORD=… npm run db:seed-demo-users
APP_ENV=test DATABASE_URL='…/acme_ai_traces_e2e_test' npm run eval:trace-fixtures -- --database acme_ai_traces_e2e_test            # dry run
APP_ENV=test DATABASE_URL='…/acme_ai_traces_e2e_test' npm run eval:trace-fixtures -- --database acme_ai_traces_e2e_test --apply > trace-fixtures.json
```

- **Credentials:** the lane's own, set in its environment. I don't need them and haven't seen them.
- **Output:** the manifest goes to stdout as JSON.
- **Re-runs:** running it again writes nothing and returns the same IDs.
- **Freshness:** start times are relative to the moment of the first `--apply`. Recreate the database if the 24h data needs to be current again.

## What it does

**Guards.** These are shared with `eval:oracle-fixtures` through the new `src/evaluation/fixture-guard.ts`; the oracle command now uses it too, and nothing was copied. They run before any write. The command refuses:
- `APP_ENV=production`;
- an `APP_ENV` outside development, test, or demo;
- a database name not ending in `_test` or `_demo`;
- a missing or mismatched `--database`;
- a connection whose `SELECT DATABASE()` is a different database;
- a database without the demo HR users.

It is a dry run by default, and it never reads `.env`.

**Write path.** Every fixture goes through the real observability repository via `src/evaluation/trace-seed.ts`, step by step, as the recorded assistant would write it.
- The trace write records the trace-time actor scope.
- Arguments are scrubbed, so a `password` key is stored as `[REDACTED]`.
- The repository's ordering guards apply.

That helper is the old `seedTrace` from `test/db/admin-observability.test.ts`, moved and generalised to accept several tools. The test now imports it through a thin adapter, so there is one copy.

**Marking.** Each fixture's request ID is `trace-fixture:v1:<shape>`. A re-run finds the existing rows and writes nothing.

**Shapes.** All are owned by the demo users: Meera Iyer (Admin) and Rohan Mehta (Scoped).

| Shape | Owner | Age | Content |
|---|---|---|---|
| `completed-no-tool` | Meera | 10 min | 1 model call, no tool |
| `in-progress` | Rohan | 25 min | `STARTED` |
| `completed-one-tool` | Rohan | 3 h | 1 tool, SUCCEEDED |
| `completed-multi-tool` | Meera | 20 h | 2 tools over 2 model rounds, then the answer (3 model calls) |
| `rejected-tool-argument` | Rohan | 2 d | REJECTED; arguments include `password`, stored `[REDACTED]`; the trace still COMPLETED |
| `tool-failed` | Meera | 4 d | FAILED `TOOL_FAILED`; the turn still COMPLETED |
| `provider-timeout` | Rohan | 6 d | FAILED at `MODEL_CALL` with `timeout`, no answer |
| `persistence-failure` | Meera | 9 d | FAILED at `TOOL_TRACE_WRITE` with `persistence_unavailable`; the tool child is closed as `FAILED / OUTCOME_NOT_RECORDED` |
| `reviewed` | Rohan | 12 d | A review by Meera: PARTIAL, nominated, version 1. A POST with `expectedVersion: 0` returns `409 STALE_VERSION`. |
| `two-turn-first`, `two-turn-second` | Meera | 18 d | One conversation; turn 2's `previousTraceId` is turn 1, and turn 1's `nextTraceId` is turn 2 |
| `load-01` … `load-12` | both | 2 h to 27 d | Volume for the summary (see below) |
| `mcp-succeeded`, `mcp-rejected`, `mcp-failed` | Rohan, Meera, Rohan | 1 h, 2 d, 9 d | One MCP call for each terminal status |

**Volume and timing.**
- Durations range from 950 ms to 8.8 s, with the timeout at 45 s.
- Token counts range from about 700 to 2,300 input and 40 to 190 output, with some reasoning counts.
- As a result, p50 and p95 are meaningful, and the 24h, 7d, and 30d totals differ.

**Manifest.** Each shape maps to its `traceId` or `mcpCallId`, its owner's display name, its status, and whether this run created it. The manifest has no credentials or connection details.

**No runtime path.**
- Nothing under `src/` outside `src/evaluation/` imports `src/evaluation/`. A test walks the source tree to check this.
- The built `dist/src` outside `dist/src/evaluation/` has no such import. I checked this with `grep` after the build.
- There is no scripted model adapter and no new route.

## Tests

`test/db/trace-fixtures.test.ts`, 5 tests against MySQL:
- **Guards:** missing demo users, production, an unknown `APP_ENV`, an unsafe name, a missing or mismatched `--database`, and a different connected database are all refused, with every table count unchanged.
- **Dry run:** writes nothing and lists every shape with a null ID.
- **Apply:** creates every shape, and the real Admin API reads each one back correctly:
  - the detail of each shape;
  - `status=STARTED` in the list;
  - the raw view showing `[REDACTED]`;
  - the stale review returning 409;
  - previous/next navigation;
  - the MCP list with all three statuses;
  - 24h < 7d < 30d totals;
  - p50 < p95 ≤ max.
- **Re-run:** writes nothing and returns the same IDs.
- **No runtime import:** the source-tree check above.

**Also changed:**
- `test/db/admin-observability.test.ts` now uses the shared helper, and all 10 of its tests still pass.
- The oracle-fixture tests pass unchanged on the shared guard. The old names are re-exported, so their imports still work.

**Red-to-green evidence:** none. This is a new command with no earlier behaviour to show failing, so the tests were written alongside the code.

## Checks (run from `express-backend/` against `acme_ai_backend_test` on 127.0.0.1:3322)

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0; the file is byte-identical (same SHA-256) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: **449 tests, 449 pass, 0 fail, 0 cancelled** |
| `npm run test:db` | exit 0: **389 tests, 389 pass, 0 fail, 0 cancelled** (was 384; +5) |
| `npm run build` | exit 0 |
| `node --import tsx --test test/http-openapi.test.ts` | 16 pass, 0 fail (no drift) |

## Files changed (all under `express-backend/` unless noted)

**New:**
- `src/evaluation/fixture-guard.ts`
- `src/evaluation/trace-seed.ts`
- `src/evaluation/trace-fixtures.ts`
- `scripts/eval-trace-fixtures.ts`
- `test/db/trace-fixtures.test.ts`

**Changed:**
- `src/evaluation/oracle-fixtures.ts`: uses the shared guard.
- `test/db/admin-observability.test.ts`: uses the shared seed helper.
- `package.json`: adds the `eval:trace-fixtures` script.

**Docs:**
- `builder_docs/ai-builder/issues/04-frontend-deterministic-trace-fixtures.md`: resolved.
- This file.

Not changed: any route, schema, OpenAPI operation, the 8 frozen Admin operations, `next-frontend/**`, or `docs_human/**`.

## Confirmations

- No Git command was run, and nothing was committed.
- No `.env` file was read or created, and no live API key was used.
- Only the 3322 / `acme_ai_backend_test` database was used. I did not run the command against `acme_ai_traces_e2e_test`; that belongs to the traces UI lane.
- Work stopped after Task 04a.
