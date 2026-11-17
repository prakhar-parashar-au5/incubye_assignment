# Backend task 13: performance and test evidence (for the Artifacts section)

## Status

READY. Worktree `/Users/admin/Desktop/Projects/incubyte_take_home_deploy`. First, ask the operator to run `git merge origin/master` in it. Task 12 is accepted and merged.

## Goal

The assignment asks for "performance considerations" and "meaningful tests". Produce two short documents built from **measured** numbers, not estimates. Frontend Task 07a will show them in the web app.

## 1. `docs/performance.md`

Use a fresh local MySQL 8.4 container, `acme-perf-mysql`, on `127.0.0.1:3331`, with database `acme_perf_test`. Migrate it, seed it with 10,000 employees, then run the oracle fixtures and `demo:scenario` so that some history exists.

Measure:
- **Directory.** Run `npm run measure:directory`: search by name, by code, and by exact email; filters; each sort; page 1 and the last page. For each query, record the EXPLAIN access type, the index used, the rows examined, and p50/p95 over at least 20 runs.
- **Dashboard.** Run `npm run measure:dashboard`. Record the same fields for the summary, the breakdowns, recent changes, and "without recent adjustment".
- **Assistant tools.** Time the five tool queries, using the same metrics.
- **AI monitoring summary.** Show the before and after of migration 008 (covering index) on 10,000 traces spread over 90 days. Reuse the existing measurement in `test/db/admin-observability.test.ts`, then quote it and rerun it.
- **Seed.** Time the 10,000-employee seed.
- **Known risks.** Include the stale `ANALYZE TABLE` statistics after a bulk load (about 11 s for the summary before statistics settle), which is already documented. Say what you would do at 10× the data.

Give each query one line: what it serves, the index, the numbers, and a verdict. List every design choice that exists for performance, and point to its file. Examples: keyset or offset pagination (whichever the code actually uses), the lateral selected-compensation join, the covering indexes, bounded tool results, and history bounds. Never present a number you did not measure.

## 2. `docs/testing.md`

- **Test inventory per layer**, with exact counts from real runs:
  - backend fast tests (`npm test`);
  - backend MySQL tests (`npm run test:db`);
  - frontend unit and component tests (`npm test` in `next-frontend`);
  - Playwright on desktop and mobile. Take the Playwright count from the latest builder response, and cite it.
- **Run time per layer.** The fast suites must stay fast and deterministic. Show how: the fixed `SEED`, the injected clocks, fake models, no network, and isolated `_test` databases with the name guard.
- **Coverage.** Run the backend fast suite and the frontend unit suite with coverage, using the tool the repo already supports. If none is configured, use Node's `--experimental-test-coverage` and Vitest's `--coverage` with the installed provider. Report line and branch coverage per area. Don't add coverage thresholds or new dependencies without asking. If coverage needs a new dependency, report that and skip it.
- **Five example tests that matter.** For each, give the file and test name and say what failure it prevents. Examples: the stale version 409, existence privacy (identical results for an out-of-scope code and an unknown code), the Option C withholding, fail-closed MCP recording, and the OpenAPI drift test.
- **The AI evaluation as a separate layer.** In one paragraph, say how it differs from unit tests: live model, two-pass grading, hard gates. Link the evaluator report.

## Rules

- No product code changes.
- No Git, no `.env`.
- Remove `acme-perf-mysql` at the end.
- Don't touch other lanes' ports: 3224, 4224, 3324, 3228, 4228, 3328, 3322, 3325, 4225.

Write `builder_docs/backend-builder/responses/13-performance-and-test-evidence.md` and stop.
