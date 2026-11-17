# Frontend Task 07a: more artifact pages

**Status:** Implemented. Seven pages are added under `/artifacts`, with the same Admin-only server check as Task 07 (`ArtifactsGate`, using the backend's `getCurrentUser` on every request).
- Performance and Testing show "Coming soon", because `docs/performance.md` and `docs/testing.md` do not exist yet.
- `npm run check` passes: 21 files, 354 passed.
- `npm run build` passes, with no warnings.
- `tests/e2e/artifacts.spec.ts` in the lane: 10 passed (desktop and mobile).

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_artifacts`, with master merged in by the operator. No Git commands were run.

## Approach

- **No markdown library.** There is no markdown library in `next-frontend` or `express-backend`, so every page is a hand-written summary with GitHub links. I added no dependency.
- **No run-time reads of `docs/`.** Railway builds `next-frontend` on its own, so `docs/` is not there at run time. Reading markdown at run time would break in production.
- **Content lives in data.** All content is in `src/lib/artifacts-more.ts`, and every claim names its source file.
- **Path test.** `tests/unit/artifacts-more.test.ts` checks that every cited path exists. That covers the content module and every `<RepoPath>` or `path: "…"` written inline on any artifact page: more than 60 paths in all.
- **Overview.** It now has 13 entries in reading order: F1, F2, F3, Database, Requirements, Decisions, Specs, Tech stack, How it was built, AI evaluation, Testing, Performance, Evolution. Testing and Performance are plain text marked Coming soon (`pending: true`), not links.

## Pages

| Route | Content | Sources |
|---|---|---|
| `/artifacts/requirements` | An info box, "Written before implementation", linking the full text and Prakhar's original note. Then a summary of the goal, core workflow, in-scope items, exclusions, and quality and success criteria. Then "What changed after it was written". | `docs/requirements.md`, `docs_human/requirements.md`. Changes: `builder_docs/parent_instructions/08-ai-assistant-mcp.md`, `builder_docs/shared/ai-assistant-contract.md`, `README.md` (Known limitations). |
| `/artifacts/decisions` | 13 numbered decisions, each with four labelled parts (Decision, Options considered, Why, Cost) and its sources. | Listed below. |
| `/artifacts/specs` | A table pairing each of the 14 `docs_human/*.md` files with the agent documents built from it, plus a column saying how the pairing is shown. Then the salary-adjustments example: what the human decided, and three things the agents added. | Every cell is a link. |
| `/artifacts/ai-evaluation` | The method (two passes; hard gates kept apart from 0–3 quality scores; independent oracles). The run (model, prompt version, corpus, personas). A hard-gate results table and the verdict. D1 and D2, each with what was found and the fix. The re-check status. | The evaluator report §§1–4, 8 and 11; the evaluator task (two-pass rule, independent oracle, hard gates); `handoff.md`; `oracle-fixture-manifest.json`; AI task 05 and its response; README. |
| `/artifacts/performance`, `/artifacts/testing` | Coming soon, naming the missing document and linking this task. | `builder_docs/frontend-builder/tasks/07a-more-artifacts.md` |
| `/artifacts/evolution` | One ruled row per entry in `src/artifacts/evolution.json`: index, date, title (merges in bold), and the short hash, linked to `https://github.com/prakhar-parashar-au5/incubye_assignment/commit/<hash>`. | The JSON file; `docs/24` for the checkpoint definitions. |

**The 13 decisions and their main sources:**
1. MySQL 8 with raw SQL: `docs_human/04`, `docs_human/11` (row lock), `docs/06`, `docs/18`.
2. The Next server is the only API caller, with an HttpOnly cookie: `docs/20`, `docs/18`.
3. Scope comes from MySQL on every request: `docs/18`, `docs/10`.
4. Versioned compensation, stale checks and idempotency keys: `docs/18`, `docs_human/11`, `parent_instructions/09a`.
5. Exact decimal money, one currency at a time: `docs_human/11`, `docs/18`, `docs/requirements.md`.
6. USD only as a dated comparison: `docs/18`.
7. Existence privacy: `docs_human/08`, `docs_human/13`.
8. Zod as the contract source: `docs/14`, `docs/20`, `express-backend/src/http/openapi.ts`.
9. AI recording fails closed: `docs_human/13` (Trace lifecycle).
10. Option C, withholding saved answers when scope narrows: `ai-builder/issues/03-saved-content-after-scope-change.md` (options A, B and C and the planner's resolution) and `ai-builder/responses/03a`.
11. A read-only assistant and read-only MCP tools: the shared AI contract, `docs_human/11`, `ai-builder/responses/05`.
12. MCP uses the app's Bearer JWT, with no OAuth: the shared AI contract (§MCP), `docs_human/13`, README.
13. What was left out on purpose (payroll, SSO, and others): `docs/requirements.md`, `builder_docs/responses/11-hr-access-management-api.md`, `docs_human/11`.

## Claims I could not source, and how they are worded

- **"Why not SQLite."** SQLite is not mentioned anywhere in the repository. The MySQL card records the choice that is documented, an ORM versus raw SQL in `docs_human/04`. It says plainly that SQLite was not discussed, and gives MySQL's documented reasons: row locks, DECIMAL, and real-MySQL tests.
- **"No OAuth for MCP."** OAuth is not discussed either. The card states what is documented: MCP authenticates with the same Bearer JWT and the same database access check, which the shared AI contract specifies. It says that OAuth is not discussed.
- **AI evaluation re-check.** There is no re-check report yet; `tester_docs/ai-assistant-tester/responses/` holds only report 01. The page says it has not run yet and cites the README ("D1 and D2 stay open until that re-check passes") and AI task 05.
- **Spec pairings.** The repository shows them in different ways, so the specs table says which applies to each row:
  - "docs/18 pairs it with the design" when `docs/18` lists both files under "Affected documents";
  - "The tasks cite it" when a task file names the `docs_human` file;
  - "Same topic" when only the title and number match.
- **Performance and Testing.** Backend Task 13 appears only in this task's text. The card summaries say "planned for docs/performance.md" and "planned for docs/testing.md", and the pages link this task.

## Evolution page

- **Input file.** The operator supplied `src/artifacts/evolution.json`, which I did not create.
  - The first version had 12 merges.
  - The operator replaced it at 23:14 with 56 commits and merges, dated 2026-11-14 to 2026-11-17, oldest first.
  - The page follows the current file: "Commits and merges on master, oldest first". Titles are shown exactly as given, apart from trimming leading spaces.
- **Read at build time.** The file is imported statically, so it is bundled when the app is built. `readMilestones` validates every entry: a hash of 7 to 40 lowercase hex characters, a `YYYY-MM-DD` date, and a title of 1 to 200 characters. It throws on a malformed entry, so a bad file fails the build or the tests instead of rendering.
- **Unit tests:**
  - six malformed shapes are rejected;
  - hashes are unique;
  - dates never go backwards;
  - at least one merge is present;
  - the commit URL format is correct.
- **Not verified:** I did not check that each hash exists on GitHub, because I ran no Git and made no network calls. The links work only once these commits are pushed to the GitHub repo.

## Tests

- **Unit** (`tests/unit/artifacts-more.test.ts`, 14 tests):
  - **Paths:** every cited path exists, including the inline links on all artifact pages (more than 60 unique paths).
  - **Specs table:** it pairs exactly the `docs_human/*.md` files that exist, and no agent column holds a `docs_human` path.
  - **Decision cards:** there are 10 to 14, each with four non-empty parts and a source. They cover every required topic: MySQL, SQLite, HttpOnly, per-request scope, versions, idempotency, decimal, currency, same 404, Zod, fails closed, Option C, read-only, OAuth, SSO and payroll. The overview's count word matches the number of cards.
  - **Pending docs:** each pending document is still absent, and its card is still `pending`. This fails on purpose once `docs/performance.md` or `docs/testing.md` lands, as a reminder to write the summary.
  - **Evolution file:** the parse and validation cases above.
- **Component** (`tests/component/artifacts.test.tsx`): the 13 entries in order, 11 links, and Testing and Performance not linked. The test for unsynced pages now expects 4 Coming soon labels: F3, Database, Testing and Performance.
- **Playwright** (`tests/e2e/artifacts.spec.ts`, desktop and mobile, 10 runs, all passed):
  - **"Admin HR opens every Task 07a page from the overview":** Requirements, Decisions, Specs, AI evaluation and Evolution. For each it checks:
    - the page opens from its overview link and shows the h1 and a key heading or text;
    - it has more than 3 external links, and every one goes to `github.com/prakhar-parashar-au5/incubye_assignment/blob/master/…` or `/commit/<hash>`;
    - there is no horizontal overflow;
    - axe finds no serious or critical issues;
    - a full-page screenshot is taken.
  - **Testing and Performance:** no overview link; the page shows Coming soon with the missing document named; no overflow; axe clean.
  - **Evolution:** more than 10 rows, and the `b801680` link points at its commit URL.
  - **The Scoped HR test now covers all 12 page routes.** Each shows only "Admin HR only", with no iframe. Its text contains none of the new pages' content: "Written before implementation", "Options considered", "What the agents added", "Hard-gate results", "Commits and merges", or `github.com`. The raw route still returns 403.
  - **The Task 07 journey** now expects 13 overview entries.
- **Screenshots checked:** Specs at 1440 px (the table stays inside the column) and Decisions at 390 px (each label sits above its text, and nothing scrolls sideways).

## Commands and results

| Command | Result |
|---|---|
| `npm run check` | API contract current; lint and typecheck clean; 21 files, 354 passed, 0 skipped. |
| `npm run build` | Passed, no warnings. All 13 page routes plus the raw route built; pages are partially prerendered, and `/artifacts/raw/[name]` is dynamic. |
| `npx playwright test tests/e2e/artifacts.spec.ts` (lane) | 10 passed. |

**Lane.**
- MySQL 8.4 container `acme-artifacts-e2e-mysql` on `127.0.0.1:3325`, tmpfs, database `acme_artifacts_e2e_test`, migrated through 008. It was seeded with 10,000 employees and the demo users; the synthetic lane password is elided.
- The backend was this worktree's freshly built `dist` on 4225, with a random JWT key and no OpenAI key.
- **Teardown:** I stopped the backend, the `next start -p 39xx` servers and the test proxies. I removed the container, `test-results/` and the `/tmp` helpers. Ports 3325, 4225 and 3900 to 3909 are free. I did not touch the other lanes' ports.

## Open items

- **Directory options timeout (cross-lane).** Reported in `builder_docs/frontend-builder/issues/07a-directory-options-10s.md`.
  - In the lane, `GET /api/v1/employee-directory/options` took 10.2 to 10.5 s on each of 3 calls. The frontend timeout is 5 s, so `/employees` logs `getDirectoryOptions` TIMEOUT after every sign-in.
  - It does not affect the Artifacts tests.
  - I did not investigate the backend, and I don't know whether it is new since the master merge or specific to the lane.
- **Schema generator source.** `architecture-viz/schema.ts:309` still has the old `.null` colour even though `out/schema.html` was fixed. Details are in `issues/07-schema-page-contrast.md`.
- **When Backend Task 13 lands.** Write the Testing and Performance summaries in `artifacts-more.ts`, then drop `pending`. The unit test fails on purpose until that is done.
- **"Scoped HR gets 403" for pages.** As in Task 07, Artifacts pages render the existing forbidden state, which the task allows. Only the raw file route returns an HTTP 403.

## Files changed

All under `next-frontend/` unless shown:

- **New:**
  - `src/lib/artifacts-more.ts`
  - `src/app/artifacts/requirements/page.tsx`
  - `src/app/artifacts/decisions/page.tsx`
  - `src/app/artifacts/specs/page.tsx`
  - `src/app/artifacts/performance/page.tsx`
  - `src/app/artifacts/testing/page.tsx`
  - `src/app/artifacts/ai-evaluation/page.tsx`
  - `src/app/artifacts/evolution/page.tsx`
  - `tests/unit/artifacts-more.test.ts`
  - `builder_docs/frontend-builder/issues/07a-directory-options-10s.md` (repo root)
- **Changed:**
  - `src/lib/artifacts.ts`: the cards and the `pending` flag.
  - `src/components/artifacts/artifacts-ui.tsx`: `ArtifactSection`, the `pending` handling, and a `ComingSoon` that can show its own text.
  - `tests/component/artifacts.test.tsx`
  - `tests/e2e/artifacts.spec.ts`
- **Not changed:** `src/artifacts/evolution.json`, which the operator owns.

## Confirmations

- No Git commands were run.
- No `.env` file was read or written.
- No backend, `docs_human/**` or `architecture-viz/**` files were changed.

## Follow-up: Performance and Testing pages (after acceptance)

**Starting point:** master is merged into this worktree by the operator; I ran no Git. `docs/performance.md` and `docs/testing.md` now exist, and `architecture-viz/schema.ts:309` has the contrast fix.

### Performance (`/artifacts/performance`)

All content is from `docs/performance.md` and its evidence files in `builder_docs/backend-builder/responses/13-evidence/`. Each section links its source.

- **How it was measured:**
  - date, machine, database, and the data volumes;
  - method: p50 and p95 over 30 runs after 2 warm-up calls, rows examined from `performance_schema`, plans from `EXPLAIN`;
  - the doc's own limits: local, single-user, thin history.
- **Three measured tables, each linking its harness output:**
  - **Directory, 9 rows.** For example, partial name search 10.8 / 12.4 ms, sort by employee code 1.6 / 2.9 ms, name sort on page 400 31.2 / 32.5 ms against 6.6 ms on page 1, and Scoped directory options 11.9 / 12.2 ms.
  - **Dashboard, 5 rows.** For example, the Admin summary at 47.6 / 52.7 ms with 141,160 rows examined.
  - **Assistant tools, 4 rows.**
  - Tables become ruled blocks below 768 px.
- **What the numbers show:**
  - the slowest tool call is 26.0 ms at p95, against the 45 s turn budget;
  - migration 008 cuts the 30-day AI summary from 56,712 to 30,056 rows examined, with no consistent wall-time difference;
  - stale statistics after a fresh seed: the Admin summary takes 10,190.0 ms, and 42.3 ms after `ANALYZE TABLE`;
  - seed times;
  - the cross-check medians.
- **At ten times the data:** five of the doc's actions, labelled as the doc labels them: "Nothing was measured at that size."

### Testing (`/artifacts/testing`)

All content is from `docs/testing.md` and its evidence files.

- **Layers:**
  - backend fast: 464 tests, 4.8 to 5.9 s;
  - backend MySQL: 404 tests, 95.0 s;
  - frontend Vitest: 299 tests in each of 6 runs, 2.1 to 2.6 s;
  - Playwright: 129 passed and 9 skipped, cited by the doc from Task 06.
  - The page says these counts are as recorded in the doc, because later tasks added tests: this worktree's Vitest suite is now 356.
- **Coverage:** backend fast suite 78.5% of lines and 88.8% of branches; MySQL suite 98.3% and 87.0%. Frontend coverage was not measured, because no coverage provider is installed.
- **How the suites stay reliable:** fixed seed, injected clocks, the fake model and fake backend, and the `_test` name guard.
- **Five tests that matter:** each linked to its test file, with what it prevents.
- **The AI evaluation as a separate layer:** a short paragraph pointing to the AI evaluation page.

### Measured numbers only, checked by tests

`tests/unit/artifacts-more.test.ts` replaces the tests that failed on purpose:
- every number shown on the Performance page appears verbatim in `docs/performance.md` (more than 60 numbers);
- every number on the Testing page appears verbatim in `docs/testing.md`;
- each of the five named tests exists under that name in its file;
- both documents exist, and no card is `pending`.

The `pending` mechanism is kept in `ArtifactCard` for later use; no card uses it now. The source-path test also covers the new content, so every link is checked.

### Other changes

- **Overview:** Testing and Performance are now links, with new one-line summaries.
- **Component test:** the full list now has 13 links. The test for unsynced pages expects 2 Coming soon labels, for F3 and Database.
- **e2e:** Testing and Performance are now in the "every Task 07a page" journey: h1, a gated section heading, GitHub-only links, no overflow, and axe. The separate Coming soon block for them is removed.
  - **Test bug found and fixed.** My first check text for Testing, "Five tests that matter", also appears in the page subtitle. The page subtitle is part of the Suspense fallback, so the check could pass before the gated content arrived. I changed it to "How the suites stay reliable", which appears only inside the gated content.
- **Issue status:** `issues/07-schema-page-contrast.md` is marked RESOLVED. `schema.ts:309`, `out/schema.html:29` and the synced copy all use `var(--muted)`.
- **Directory-options issue:** nothing added for it, as instructed. `docs/performance.md` ("Stale statistics after a bulk load") explains it: this lane seeds a fresh database and measures immediately.

### Results

| Command | Result |
|---|---|
| `npm run artifacts:check` | Artifact copy is current. |
| `npm run check` | API contract current; lint and typecheck clean; 21 files, 356 passed. |
| `npm run build` | Passed, no warnings. |
| `npx playwright test tests/e2e/artifacts.spec.ts` (lane 3325/4225, fresh seed, backend rebuilt from merged master) | 10 passed (desktop and mobile). |

**Teardown:** I stopped the backend, the Next servers and the test proxies, removed the container, `test-results/` and the `/tmp` helpers. Ports 3325, 4225 and 3900 to 3909 are free.

No Git commands were run. No `.env` file was read or written. No backend, `docs/`, `docs_human/` or `architecture-viz/` files were changed.
