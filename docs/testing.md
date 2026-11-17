# Testing

All counts and times below come from runs on 2026-11-17 in this worktree. The exception is Playwright, which is cited from the latest frontend builder response. Raw output: [`builder_docs/backend-builder/responses/13-evidence/`](../builder_docs/backend-builder/responses/13-evidence/). Machine: Apple M4 Pro, Node v22.23.1, MySQL 8.4.13 in Docker.

## Inventory per layer

| Layer | Command | Files | Tests | Result | Run time |
|---|---|---:|---:|---|---|
| Backend fast (unit, HTTP with fakes, CLI) | `npm test` in `express-backend` | 38 | 464 (87 suites) | 464 pass, 0 fail, 0 skipped | 5.9 s, 5.5 s, 4.8 s (`duration_ms`, 3 runs) |
| Backend MySQL | `npm run test:db` in `express-backend` | 21 | 404 (88 suites) | 404 pass, 0 fail, 0 skipped | 95.0 s (files run one at a time) |
| Frontend unit and component (Vitest) | `npm test` in `next-frontend` | 18 | 299 | 299 pass in each of 6 runs | 2.1–2.6 s (Vitest "Duration") |
| Playwright, desktop (1440×900) and mobile (390×844) | `npm run test:e2e` in `next-frontend` | 7 specs | 138 test runs across both projects | 129 passed, 9 skipped, 0 failed | 5.7 min |

Notes on each layer:

- **Backend MySQL.** The run used `acme_perf_suite_test` on `127.0.0.1:3331`. My first run had **8 tests cancelled**. The demo-import and `demo:mcp-calls` tests need a sibling database, `acme_perf_suite_demo`, which must already exist (`test/support/test-database.ts`), and I had not created it. After creating it, the rerun above passed 404 of 404. This was an environment mistake, not a product failure.
- **Frontend unit.** The intermittent `hr-access-workspace.test.tsx` failure reported in Task 12 did not occur in 6 full runs. The cause and its fix (cancelled focus frames) are in `builder_docs/frontend-builder/responses/06-qa-run-03-fixes.md`.
- **Playwright.** Cited, not rerun: `builder_docs/frontend-builder/responses/06-qa-run-03-fixes.md`, check table, "`npm run test:e2e` (full, lane env, freshly reseeded database) | 129 passed, 9 skipped, 0 failed (5.7 minutes)". The 9 skips are conditional: project-specific layout checks, and tests that need the optional no-rate-limit backend.

## Why the fast suites stay fast and deterministic

- **Fixed data.** The workbook generator uses `DEFAULT_SEED = 20261114` and `DEFAULT_GENERATION_DATE = '2026-11-14'` (`src/source-workbook/constants.ts`). It never reads the computer's date. The same seed always produces the same 10,000 employees.
- **Injected clocks.**
  - The services take a `clock` argument (`createDirectoryService`, `createDashboardService`, the assistant and its rate limiter).
  - The rate limiter's `ClockedMemoryStore` moves time forward without waiting 15 minutes.
  - 22 backend test files (fast and MySQL) reference an injected clock.
- **Fake model.**
  - `test/support/fake-model.ts` replays scripted model replies and records what it was sent. Its header says "No network access; automated tests never call OpenAI."
  - It is used by 7 backend test files.
  - No automated test uses a live key.
- **Fake backend at the frontend boundary.**
  - `next-frontend/tests/support/fake-backend.ts` is a `fetch` stand-in that answers from a queue.
  - The real API client, contract validators, and Server Actions run unchanged.
  - It is used by 8 frontend test files.
- **No network.** CLI tests that need a failing database connect to `127.0.0.1:1`, which is never a MySQL server.
- **Isolated databases with a name guard.**
  - `test/support/test-database.ts` refuses any `DATABASE_URL` whose database name does not match `^[a-z0-9_]+_test$`.
  - Each DB test file drops every table in that database before it runs.
  - `test:db` uses `--test-concurrency=1`, because the files share one database.
  - The fixture and demo commands have their own guard (`src/evaluation/fixture-guard.ts`): only `_test` or `_demo`, with a repeated `--database` that must match.
- **Split by cost.** Anything that needs MySQL lives under `test/db/` and stays out of `npm test`, so the fast suite runs without Docker in about 5 s.

## Coverage

**Backend.** The repo configures no coverage tool, so I used Node's built-in `--experimental-test-coverage`, which needs no new dependency. Scope: `src/**` and `scripts/**` for the fast suite, `src/**` for the MySQL suite. Area totals are summed from the lcov output.

| Area | Fast suite: lines | Fast suite: branches | MySQL suite: lines | MySQL suite: branches |
|---|---:|---:|---:|---:|
| `src/access` | 58.0% | 93.3% | 99.2% | 88.3% |
| `src/assistant` | 90.1% | 88.7% | 98.5% | 86.9% |
| `src/assistant/observability` | 48.0% | 89.1% | 96.3% | 88.0% |
| `src/compensation` | 62.6% | 98.4% | 97.8% | 88.0% |
| `src/dashboard` | 40.7% | 100.0% | 100.0% | 90.7% |
| `src/db` | 88.8% | 91.3% | 98.1% | 91.2% |
| `src/directory` | 60.7% | 92.9% | 100.0% | 98.7% |
| `src/evaluation` | not loaded | not loaded | 99.5% | 90.2% |
| `src/http` | 98.4% | 81.6% | 99.0% | 88.1% |
| `src/money` | 100.0% | 94.3% | 96.9% | 82.4% |
| `src/seed` | 74.1% | 90.9% | 96.6% | 74.2% |
| `src/source-workbook` | 99.6% | 97.0% | 94.9% | 67.7% |
| `scripts` | 99.2% | 42.9% | not measured | not measured |
| **All files** | **78.5%** (10,409 / 13,263) | **88.8%** (1,430 / 1,611) | **98.3%** (13,572 / 13,804) | **87.0%** (2,786 / 3,204) |

How to read the table:

- **The two suites cover different code.** SQL-heavy modules (the dashboard, directory, salary-adjustment, and HR-access services, and the observability repositories) have low fast-suite line coverage because their SQL runs only against MySQL. The MySQL suite covers them at 96–100% of lines.
- **Branch percentages are computed only over code that ran.** V8 counts a branch only inside functions that executed. A file the suite never loads (`src/evaluation` in the fast suite) is not listed at all, rather than counted as 0%. Read the branch column next to the line column.
- **Per-file reports:** [`backend-fast-coverage.txt`](../builder_docs/backend-builder/responses/13-evidence/backend-fast-coverage.txt) and [`backend-db-coverage.txt`](../builder_docs/backend-builder/responses/13-evidence/backend-db-coverage.txt).

**Frontend: not measured.** Vitest's `--coverage` needs a provider package (`@vitest/coverage-v8` or `@vitest/coverage-istanbul`), and neither is installed in `next-frontend/node_modules`. The task forbids adding a dependency without asking, so I skipped it. Adding `@vitest/coverage-v8` as a dev dependency would enable it.

## Five tests that matter

1. **Lost-update protection.**
   - Test: `express-backend/test/db/salary-adjustments.test.ts` › "Admin direct change" › "two concurrent direct changes against one version: one success, one stale conflict".
   - Two Admins confirm different raises from the same compensation version at the same moment. Exactly one gets `201`, and the other gets `409 STALE_VERSION`.
   - Exactly one new version is stored, and the loser's fresh preview shows version 2.
   - **Prevents:** a silently lost salary update, where the second write overwrites the first.
   - Siblings: the HR-access equivalent (`test/db/hr-access.test.ts` › "a stale expected version returns 409 and changes no user, scope, session, version, or audit row") and the trace-review compare-and-set (`test/db/admin-observability.test.ts`).
2. **Existence privacy.**
   - Test: `express-backend/test/db/employee-directory.test.ts` › "out-of-scope, unknown, and malformed detail requests return identical 404 bodies".
   - Rohan asks for an employee outside his scope, a code that does not exist, and a malformed code. All three return the same `404` with byte-identical bodies, and Meera can still open the out-of-scope employee.
   - **Prevents:** a Scoped HR user learning that a hidden employee exists from a different status or message.
   - The same rule is tested for salary adjustments, sign-in, and conversations.
3. **Option C withholding.**
   - Test: `express-backend/test/db/assistant-conversations.test.ts` › "recorded turns in MySQL" › "a saved answer is withheld once the current scope stops covering the trace-time scope; storage is unchanged".
   - Rohan gets an answer while scoped to India × Support and Tech. Then the Support scope is removed in MySQL. Re-reading the conversation keeps his question but withholds the whole saved answer, and the stored trace is not modified.
   - **Prevents:** saved assistant answers becoming a way to keep seeing data after HR Access narrows someone's scope.
4. **Fail-closed MCP recording.**
   - Test: `express-backend/test/http-mcp-recording.test.ts` › "attempt-write failure: the tool never runs; outcome-write failure: no result is returned".
   - If the attempt row cannot be written, the tool never executes. If the outcome row cannot be written, the client gets only `MCP_RECORDING_UNAVAILABLE` and no result.
   - The failure log has exactly `event`, `requestId`, `stage`, and `tool`, and no content.
   - **Prevents:** an unaudited data read through the MCP endpoint.
5. **OpenAPI drift.**
   - Test: `express-backend/test/http-openapi.test.ts` › "the committed openapi/openapi.json matches the generated contract".
   - The committed contract must equal the one generated from the runtime Zod schemas.
   - On the frontend, `npm run api:check` fails when `src/generated/` is stale relative to that file. A neighbouring test, "every documented operation is routed", catches documented routes that don't exist.
   - **Prevents:** the frontend's generated types and validators drifting from what the API actually returns.

## The AI evaluation: a separate layer

The unit and MySQL tests prove the assistant's machinery with a fake model:
- recording order;
- scope in SQL;
- bounds;
- idempotency;
- fail-closed writes.

They cannot show that a real model chooses the right tool or describes the result honestly. That is done by a separate, manual, live evaluation, which differs from the unit tests in four ways:

- **Live model.** It runs against the deployed stack on a real OpenAI model (`gpt-6-luna`).
- **Fixed corpus.** It uses 28 live prompt cases from the evaluation designer's corpus, plus 4 deterministic-only fault cases, with oracle values taken from the frozen UI and the fixture manifest.
- **Two-pass grading.** For every prompt, the evaluator first records a black-box judgment of the visible answer, cards, and limitations, without looking at the trace. Only then do they open the Admin trace and reconcile model calls, tool calls, arguments, results, and tokens.
- **Hard gates.** Gates such as scope, existence privacy, exact money, no mutation, and no secrets are pass/fail, and one failure blocks acceptance whatever the quality score.

The first run found two hard-gate failures:
- **D1:** scoped answers described as "company-wide".
- **D2:** mutation refusals without a safe next action.

The AI builder fixed both in AI Task 05, and this build runs prompt version `assistant-instructions-v2` with the scope limitation on tool results. No live re-evaluation report is in the repository yet.

Report: [`tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md`](../tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md).
