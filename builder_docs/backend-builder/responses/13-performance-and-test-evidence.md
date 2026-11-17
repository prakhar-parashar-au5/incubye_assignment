# Backend task 13: performance and test evidence

**Task:** `builder_docs/backend-builder/tasks/13-performance-and-test-evidence.md`
**Worktree:** `/Users/admin/Desktop/Projects/incubyte_take_home_deploy`, after the operator's `git merge origin/master`
**Date:** 2026-11-17
**Status:** Complete. No product code changed. No Git command was run, and nothing was committed.

## Deliverables

- `docs/performance.md`
- `docs/testing.md`
- `builder_docs/backend-builder/responses/13-evidence/`: the raw output behind every number, plus the measurement harness `perf-harness.mts`.
  - The harness is evidence tooling. It lives outside `express-backend/`, so it is not linted, built, or shipped. It imports the real services and only reads; the one schema change in this task was the index drop and re-add I ran by hand in the scratch database.
  - I added it because the existing `measure:*` scripts report median and slowest only, with no p95 and no rows examined. Both scripts were still run, and their output is cited as a cross-check.

## Environment

- **Container:** `acme-perf-mysql`, `mysql:8.4` (8.4.13), `127.0.0.1:3331`, tmpfs. It was **removed** at the end; `docker ps -a` shows nothing matching.
- **Databases:**
  - `acme_perf_test`: the measurements.
  - `acme_perf_obs_test`: the rerun of the admin-observability plan test.
  - `acme_perf_suite_test` and `acme_perf_suite_demo`: the full `test:db` run and the fresh-seed stale-statistics experiment.
- **Data on `acme_perf_test`:**
  1. Migrate 001–008.
  2. Seed 10,000 employees (5 timed runs).
  3. Demo users.
  4. `eval:oracle-fixtures --apply`.
  5. `demo:scenario --apply`.
  6. 10,000 bulk AI traces over 90 days, with the SQL from `test/db/admin-observability.test.ts`.

  Result: 10,000 employees, 10,012 compensation records (12 non-import), 6 requests, 10,000 traces.
- **No other lane's port** was touched.
- `npm ci` was run in both packages, which restores the backend dev dependencies that Task 12 had pruned.

## Headline numbers (all measured)

Full tables are in `docs/performance.md`. Timings are p50 / p95 over 30 runs.

**Directory**
- Searches by name, code, or email: 9.4–11.5 ms p50. All scan the table (`e:ALL`, about 20k rows examined); the `OR` keeps MySQL off the unique indexes.
- Detail lookup: 0.7 ms (const).
- Sorts, page 1: 1.6 ms (employee code) to 32.0 ms (cash).
- Last page (400), name sort: 31.2 ms, against 6.6 ms on page 1.

**Dashboard**
- Admin summary: 47.6 / 52.7 ms. It sends 8 statements and examines 141,160 rows.
- Breakdowns: 33.7–43.1 ms (Admin) and 18.9–23.4 ms (Scoped).

**Assistant tools:** 0.4–25.1 ms p50; the highest p95 is 26.0 ms.

**AI summary and migration 008**
- The rerun test passes, and its plans match the AI builder's recorded "after".
- For the 30-day window, dropping the index brings back the full index scan and full table scans: 56,712 rows examined, against 30,056 with the index.
- Wall-time effect: at 7 days, p50 roughly doubles without the index (1.8–1.9 → 3.8 ms). At 30 days there is no clear difference (5.9–6.4 vs 6.0 ms).

**Seed:** 1.03–1.20 s wall from `dist`, and 1.25–1.32 s through `tsx`.

**Stale statistics: reproduced.**
- On a freshly seeded database, the Admin summary median was 10,190.0 ms. After `ANALYZE TABLE compensation_records, employees`, it was 42.3 ms.
- On `acme_perf_test` the slowdown did not occur. I did not determine why, and I say so in the doc.

**Tests**
- Backend fast: 464/464, about 5 s.
- Backend MySQL: 404/404, 95.0 s.
- Frontend: 299/299 in each of 6 runs, 2.1–2.6 s.
- Playwright: 129 passed, 9 skipped, 0 failed, 5.7 min. Cited from `builder_docs/frontend-builder/responses/06-qa-run-03-fixes.md`, not rerun.

**Coverage**
- Backend, with Node's built-in coverage: the fast suite covers 78.5% of lines and 88.8% of branches; the MySQL suite covers 98.3% and 87.0%.
- Frontend: not measured.

## Things the orchestrator should know

1. **Frontend coverage was skipped.** It needs `@vitest/coverage-v8` (or `-istanbul`), which is not installed, and the task forbids adding a dependency without asking. Decide whether to add it as a dev dependency.
2. **My first `test:db` run had 8 cancelled tests.** The demo-import tests need a pre-existing sibling `<name>_demo` database, and I had not created one. The rerun with the database created passed 404/404. The doc records both runs.
3. **Thin history.** The specified seeding yields only 12 non-import changes, so the history-heavy queries (recent changes, "without recent adjustment") were measured at that volume. Both recent-changes queries scan `compensation_records` (`c:ALL`), so they will grow with history.
4. **Code comment versus plan.** The `SELECTED_COMPENSATION` comment says the lateral join is served by `idx_compensation_employee_effective`. Every measured plan uses `uk_compensation_employee_version` instead. Not changed (no product code changes).
5. **Root `README.md` is now stale on D1/D2.** Since the merge, this build has the AI Task 05 fixes (`assistant-instructions-v2`), but the README written in Task 12 still says D1 and D2 are open in this build. `docs/testing.md` states the current status. I did not edit the README, because it is outside this task.

## Checks

| Command | Result |
|---|---|
| `express-backend`: `npm test` (3 runs) | 464 pass, 0 fail each time; `duration_ms` 5,909 / 5,547 / 4,770 |
| `express-backend`: `npm run test:db` on `acme_perf_suite_test` | 404 pass, 0 fail, 0 cancelled (second run; see item 2 above) |
| `express-backend`: fast and MySQL suites with `--experimental-test-coverage` | 464/464 and 404/404 pass |
| `admin-observability.test.ts`, "query plans with 10,000 traces…", on `acme_perf_obs_test` | 1 pass |
| `next-frontend`: `npm test` (6 runs) | 299/299 each time |
| `npm run measure:directory -- --runs 25`, `npm run measure:dashboard -- --runs 25 --plans` | Ran. Output is in the evidence folder. |

I made no changes to the product, so I did not rerun lint, typecheck, or build.

## Confirmations

- No product code changes: nothing under `express-backend/src`, `express-backend/scripts`, `express-backend/db`, `next-frontend/src`, or any test changed.
- No Git command, no commit, no `.env` read or written. All database credentials were synthetic placeholders for the throwaway container.
- MySQL used only `127.0.0.1:3331`, and the container was removed.
- Work stopped after Task 13.
