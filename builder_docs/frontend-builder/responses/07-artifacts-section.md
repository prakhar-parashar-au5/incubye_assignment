# Frontend Task 07: Artifacts section

**Status:** Implemented with F1 and F2. F3 and `schema.html` are not generated yet, and they show a "Coming soon" state.
- `npm run check` passes: 339 passed, 1 skipped.
- `npm run build` passes, with no warnings.
- The full real-backend Playwright suite passes in the lane: 137 passed, 9 skipped, 0 failed.
- One cross-lane defect is reported: the generated pages fail axe colour contrast. See "Open items".

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_artifacts`, branch `feat/artifacts-section`. The task says it is from master `d7fb50f`; I did not check this with Git.

## What was built

### Navigation and access

- **Rail item.** An Admin-only "Artifacts" rail item comes right after "AI monitoring" and links to `/artifacts`. Hiding it is presentation only.
- **Server check on every request.** The `ArtifactsGate` server component (`src/components/artifacts/artifacts-gate.tsx`) uses the shared session (`getSession` → backend `getCurrentUser`) on each request.
  - Signed-out and expired sessions redirect, as on other pages.
  - A backend outage shows the unavailable state.
  - Scoped HR sees the existing `ForbiddenState` ("Admin HR only").
  - Page content is passed as a function, so for a non-admin it is never rendered, and nothing is read from the file system.
- **Proxy matcher.** `src/proxy.ts` now covers `/artifacts/:path*`, so a request with no session cookie is redirected to `/sign-in` before any rendering.

### Pages

| Route | Content |
|---|---|
| `/artifacts` | A ruled list of 6 entries, each with a title link, one sentence, and a label (flow code, Database, or Written). An entry whose generated file is not synced is plain text marked "Coming soon", not a link, following DESIGN.md's rule that unbuilt items are non-interactive. |
| `/artifacts/flows/[flow]` | `employees-click` (F1), `assistant-tool-call` (F2), and `salary-request` (F3, Coming soon). An unknown slug returns 404. |
| `/artifacts/database` | `schema.html` when it exists, Coming soon until then. |
| `/artifacts/tech-stack` | A table on desktop and ruled blocks below 1024 px, so there is no sideways scroll. Below it, 6 key decisions with their trade-offs. |
| `/artifacts/how-it-was-built` | Roles, isolation, contracts between agents, safety rules, the worked example (5 steps), and the flaky-test example (4 steps). |

The layout follows the AI monitoring pages: ruled records, no card wall, no eyebrow labels, no emoji, and the existing heading and type scale.

### Embedding (security)

- **Sync script.** `npm run artifacts:sync` (`scripts/sync-artifacts.mjs`) copies `../architecture-viz/out/` into `src/artifacts/generated/`.
  - It copies only the names in `src/artifacts/files.json`: `F1.html`, `F2.html`, `F3.html`, `schema.html`.
  - It removes a copy whose source file has gone.
  - `npm run artifacts:check` exits 1 on any difference. It skips when the source directory is absent, which is the standalone `next-frontend` build on Railway.
  - The source and destination can be overridden with `--from` and `--to`.
  - This worktree has no `architecture-viz/` yet, so I ran `npm run artifacts:sync -- --from /Users/admin/Desktop/Projects/incubyte_take_home_arch_viz/architecture-viz/out`, which copied F1 and F2. `--check` against that source reports the copy current.
- **Not in `public/`.**
- **Raw route.** `src/app/artifacts/raw/[name]/route.ts` handles each request in this order:
  1. It checks Admin HR through `getCurrentUser`, before it looks at the name. Responses are 401 (signed out or expired), 503 (backend unavailable), and 403 (Scoped HR).
  2. It checks the allowlist. A name outside it returns 404 and is never joined into a path, so `../`, encoded separators, case changes, and `files.json` cannot reach the file system.
  3. It reads the file. A missing allowlisted file also returns 404.
- **Response headers.** Every response, including errors, sends:
  - `Content-Type: text/html; charset=utf-8` (plain text for errors);
  - `Cache-Control: no-store`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: no-referrer`;
  - `Cross-Origin-Resource-Policy: same-origin`;
  - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`.
- **CSP basis.** The pages use only an inline `<style>`, `style=` attributes, and inline SVG. There are no images, fonts, or links to other files, so `img-src` is left out. A unit test fails if a synced page starts using `<script>`, `<img>`, `<link>`, `<iframe>`, `<form>`, `@import`, or `url(`.
- **Iframe.** The frame is `<iframe sandbox="">` with no tokens, so no scripts run and the frame gets an opaque origin. It is `75vh` tall with a 28rem minimum and has a descriptive `title`. Above it is an "Open full page" link to the same raw route.

## Written content: how accuracy is kept

- **Content module.** All claims live in `src/lib/artifacts-content.ts`, and each one names the files that show it. Each source links to `https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/<path>`.
- **Path test.** A unit test checks that every cited path exists in this worktree. It also checks the `<RepoPath>` links written inline on the how-it-was-built page.
- **Version test.** A unit test checks that every version shown appears in the `package.json` it names.
- **Facts I confirmed in the code:**
  - **Frontend:** Next 16.4.6 and React 19.3.1, with `cacheComponents: true`.
  - **UI kit:** shadcn "base-nova" on `@base-ui/react` 1.9.0, Tailwind 4.3.5 and Lucide.
  - **Contract:** Zod 4.6.7 with `z.toJSONSchema` produces OpenAPI. The frontend generates types with openapi-typescript and validates responses at runtime with Ajv. The frontend does not use Zod.
  - **Database:** `mysql:8.4`.
  - **Assistant model:** the OpenAI Responses API (`responses.create`). The default model is `gpt-6.1-sol`, overridden by `OPENAI_MODEL`.
  - **MCP:** the server is `@modelcontextprotocol/server` 2.4.0, Streamable HTTP, stateless. The client package is used only by the demo command.
  - **Passwords and sessions:** Argon2id with m=19456, t=2, p=1. Sessions are a two-hour HS256 `jose` JWT carrying only `sub` and `sid`, checked against `hr_sessions` on each request.
  - **TypeScript:** 6.0.3 in the backend and 5.9.3 in the frontend.
  - **Railway:** dashboard-configured from `docs/deploy/railway-runbook.md`, with no `railway.json`.
- **Not on master yet:** the evaluator report, `tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md`, is only in the `incubyte_take_home_ai_eval_run` worktree.
  - It is shown as plain text marked "(not on master yet)" instead of a link that would 404.
  - A test fails once the file appears here, as a reminder to make it a link. To do that, remove it from `NOT_ON_MASTER`.
- **What I did not claim:**
  - **Evaluator re-check (worked example, step 5).** There is no record of the evaluator's re-check yet. The step says the re-check is scheduled after the merge, citing AI Task 05 ("Not in scope").
  - **Orchestrator rerun (step 4).** No repo file records the actual rerun. The step cites the orchestrator's rule (docs/26, item 7) and the checks AI Task 05 names, plus `PROMPT_VERSION = 'assistant-instructions-v2'`.
  - **Flaky-test counts.** The orchestrator's "2 of 6" and "0 of 5" are not in any review file. They are cited to this task file, which records them.
- **Not linked:** the Impeccable skill is at `.kiro/skills/impeccable/`, which is gitignored. The page cites `docs/20-frontend-architecture.md` (Impeccable design process) instead.

## Files changed

All under `next-frontend/` unless shown:

- **New:**
  - `scripts/sync-artifacts.mjs`
  - `src/artifacts/files.json`
  - `src/artifacts/generated/F1.html` and `F2.html` (copied unchanged)
  - `src/lib/artifacts.ts`
  - `src/lib/artifacts-content.ts`
  - `src/server/artifacts.ts`
  - `src/components/artifacts/artifacts-ui.tsx`
  - `src/components/artifacts/artifacts-gate.tsx`
  - `src/app/artifacts/page.tsx`
  - `src/app/artifacts/flows/[flow]/page.tsx`
  - `src/app/artifacts/database/page.tsx`
  - `src/app/artifacts/tech-stack/page.tsx`
  - `src/app/artifacts/how-it-was-built/page.tsx`
  - `src/app/artifacts/raw/[name]/route.ts`
  - `tests/unit/artifacts.test.ts`
  - `tests/component/artifacts.test.tsx`
  - `tests/e2e/artifacts.spec.ts`
  - `builder_docs/frontend-builder/issues/07-generated-flow-pages-contrast.md` (repo root)
- **Changed:**
  - `package.json`: the `artifacts:sync` and `artifacts:check` scripts.
  - `src/components/shell/app-shell.tsx`: the `artifacts` section and the Admin-only rail item.
  - `src/proxy.ts`: the matcher.

No backend, `docs_human/`, or generated API files changed.

## Tests

- **Unit** (`tests/unit/artifacts.test.ts`, 36 passed and 1 skipped):
  - **Allowlist:** exactly 4 names are accepted. 17 others are rejected, including `../`, `%2e%2e`, a backslash, a trailing slash or space, a NUL byte, a case change, `files.json` and `F1.png`.
  - **File reads:** `readArtifact` never reads a name outside the allowlist, even when the file exists.
  - **CSP:** the policy contains no script or connect directive.
  - **Raw route, Admin HR:** 200 with all the headers above.
  - **Raw route, everyone else:** 401, 503 or 403 for every name, checked before the name is looked at.
  - **Raw route, unknown or unsynced names:** 404 for Admin HR.
  - **Sync drift check:** run on temporary directories, it covers copy, a differing copy, a missing copy, a stale copy, and an absent source.
  - **Content checks:** the cited paths exist and the shown versions match `package.json`.
  - **The skip:** the comparison with the real `architecture-viz/out`, which is absent in this worktree. It runs once that directory exists.
- **Component** (`tests/component/artifacts.test.tsx`, 4 tests):
  - The overview cards show a title, one sentence, and a link, in order.
  - Unsynced entries are plain text marked Coming soon.
  - The iframe has `sandbox=""` and the same src as Open full page.
  - Sources render as links, and a path not on master renders as text.
- **Playwright** (`tests/e2e/artifacts.spec.ts`, desktop and mobile, 8 runs, all passed):
  - **Meera:**
    - The rail item sits right after AI monitoring and is current on `/artifacts`.
    - The overview has 6 entries.
    - F1 and F2: the raw response is 200, the sandboxed frame shows the generated page's h1, Open full page opens the raw page, and that page is scanned.
    - F3 and database show Coming soon with no iframe.
    - Tech stack and How it was built: every source link points at the GitHub master URL.
    - No horizontal overflow at 390 px or 1440 px.
  - **Raw headers:** CSP, nosniff, no-store and content type. Off-list and unsynced names return 404.
  - **Rohan:** no Artifacts link anywhere in the DOM.
    - Five `/artifacts` pages show only "Admin HR only", with no iframe or content.
    - The raw route returns 403 for `F1.html`, `F2.html`, `F3.html` and `..%2Fpackage.json`.
  - **Signed out:** pages and raw files return 307 to `/sign-in`.
  - **Axe:** no serious or critical findings on any app page. Pages with a frame are scanned after the frame is swapped for an empty box, because axe hangs on a sandboxed frame that cannot run scripts. The frame's `title` and `sandbox` are asserted separately, and the generated pages are scanned on their own raw URL.
  - **Screenshots:** I checked the desktop and mobile overview, the F1 frame, Tech stack at 390 px, and How it was built at 1440 px. After reviewing them I made "Coming soon" its own line in the overview label column, where it had wrapped mid-label.

## Commands and results

| Command | Result |
|---|---|
| `npm ci` (next-frontend, express-backend) | Installed. This worktree had no `node_modules`. |
| `npm run artifacts:sync -- --from …/incubyte_take_home_arch_viz/architecture-viz/out` | Copied F1.html and F2.html. |
| `npm run artifacts:check -- --from …/arch_viz/architecture-viz/out` | Artifact copy is current. |
| `npm run check` | API contract current; lint and typecheck clean; 20 files, 339 passed, 1 skipped. |
| `npm run build` | Passed with no warnings. |
| `npx playwright test tests/e2e/artifacts.spec.ts` (lane) | 8 passed. |
| `npm run test:e2e` (full, lane, fresh seed) | 137 passed, 9 skipped, 0 failed (6.1 minutes). |

**Build warnings.** The first build showed Turbopack's warning that "dynamic filesystem access causes tracing of the whole project". I fixed it with `/* turbopackIgnore: true */` on the runtime paths in `src/server/artifacts.ts`. I also checked that no prerendered page shell contains the Admin-only content; it is only in the server bundle.

**Skips.** The 9 skips are the existing conditional skips: one project only, or they need `E2E_NO_RATE_API_BASE_URL`. No Artifacts test was skipped.

**Lane:**
- MySQL 8.4 container `acme-artifacts-e2e-mysql` on `127.0.0.1:3325`, tmpfs, database `acme_artifacts_e2e_test`.
- Migrated through 008 and seeded with 10,000 employees plus the two demo users. The lane-only synthetic password is elided.
- The backend was this worktree's built `express-backend/dist` on 4225, with a random `openssl rand -hex 32` JWT key and no OpenAI key.
- **Teardown:** I stopped the backend, every `next start -p 39xx`, the failing proxy and the fake assistant backend. I removed the container, `test-results/` and the `/tmp` helpers. Ports 3325, 4225 and 3900 to 3909 are free.
- I did not touch ports 3224, 4224, 3324, 3228, 4228, 3328 or 3322.

## Open items

- **Generated pages fail axe colour contrast.** This is a cross-lane defect, reported in `builder_docs/frontend-builder/issues/07-generated-flow-pages-contrast.md`.
  - The `.payload` text in F1 and F2 is `#6b7280` on `#f7f5f1`, 4.43:1, below the 4.5:1 minimum. It comes from `architecture-viz/render.ts:199`.
  - The fix belongs to the architecture-viz lane. Using `var(--muted)` (`#4a5467`) would clear it.
  - Until then, `generatedPageAxe` in the spec sets aside only that exact finding and annotates the test. Any other serious or critical finding still fails.
- **F3 and `schema.html`.** When they land, run `git merge origin/master` (operator), then `npm run artifacts:sync` and `npm run artifacts:check`. The overview, flow and database pages switch from Coming soon to the embedded page with no code change.
  - Two summaries were written before the pages exist, so check them against the generated pages: the F3 summary ("A Scoped HR salary request and the Admin HR approval that applies it.") and the database summary.
  - The Playwright Coming soon assertions for F3 and database will then fail on purpose and need updating.
- **Deploy assumption.** The raw route reads `src/artifacts/generated/` at run time, relative to `process.cwd()`. This matches the runbook (`npm start` from the full `next-frontend` checkout on Railpack). It would need a different approach if `output: 'standalone'` were adopted.

## Confirmations

- No Git commands were run and nothing was committed.
- No `.env` file was read or written.
- No backend or `docs_human/**` files were changed.

## Follow-up: F3 and schema synced (after acceptance)

**Starting point:** master is merged into this worktree by the operator; I ran no Git. `architecture-viz/out/` now holds F1, F2, F3 and `schema.html`, and the evaluator report is on master.

**1. Sync.**
- `npm run artifacts:sync` copied all four pages: F1.html, F2.html, F3.html and schema.html.
- `npm run artifacts:check` reports the copy is current.
- The unit test that compares the copy with the real `architecture-viz/out` now runs instead of being skipped, and passes.

**Summaries checked against the real pages:**
- **F3.** The page title is "F3: Scoped HR requests a salary change and Admin HR approves it". Its last steps are `service.approve → INSERT INTO compensation_records (version = maxVersion + 1, source_request_id …)`. So the existing summary, "A Scoped HR salary request and the Admin HR approval that applies it.", is accurate. Unchanged.
- **Database.** The page says "20 tables and 31 foreign keys, generated from the 8 migration files … not from a live database."
  - I changed the summary to "Every MySQL table and foreign key, generated from the migration files."
  - I changed the page subtitle to the same, plus ", not from a live database".
  - I left out the counts so the text stays true if a migration is added.

**Tests updated for the synced pages:**
- **e2e journey:** it now opens all four embedded pages (F1, F2, F3, Database). For each it checks:
  - the raw response is 200;
  - there is no "Coming soon";
  - the iframe has `sandbox=""` and its title;
  - the frame's h1 matches the generated page;
  - the Open full page link and the raw page itself.
- **Raw-route e2e:** F2, F3 and schema return 200. The 404 cases are now `F4.html`, `..%2Fpackage.json`, `files.json` and `F1.png`.
- **Unit tests:** the committed copy must hold all four pages. The Admin 404 cases are `F4.html` and `schema.png` instead of F3 and schema.
- The component test still covers the Coming soon rendering, with an explicit list of available pages.

**2. Axe.**
- `generatedPageAxe` is removed, and F1, F2 and F3 on their raw URLs now use `noSeriousAxe`. No serious or critical findings at 1440 px or 390 px.
- **schema.html has one serious finding: `color-contrast`, 61 nodes.**
  - The `null` and `generated` column notes (`span.null`) are `#8a8f99`: 3.24:1 on white and 2.98:1 on the ground.
  - Source: `architecture-viz/schema.ts:309`.
  - Reported as CROSS_LANE_DEFECT in `builder_docs/frontend-builder/issues/07-schema-page-contrast.md`. The suggested fix is `var(--muted)`.
  - In the spec, "schema.html on its own has no serious or critical axe findings" is a separate test marked `test.fail` with the issue name. The journey test skips the raw-page scan only for schema.
  - Once the page is regenerated, Playwright will report that test as unexpectedly passing. That is the signal to remove the marker.
  - The Database page around the frame passes axe.
- Other findings on the generated pages are moderate only, and the app does not fail on moderate:
  - F1 to F3: `landmark-one-main`, `landmark-unique` and `region`;
  - schema: `landmark-one-main` and `region`.

**3. Evaluator report link.** `NOT_ON_MASTER` is now empty. The worked example's step 1 links `tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md` (section 8), and the path test confirms the file exists. The component test now expects that path as a GitHub link.

**4. Issue status.** `issues/07-generated-flow-pages-contrast.md` is marked RESOLVED, with the date and how it was verified.

**5. Results:**

| Command | Result |
|---|---|
| `npm ci` (both packages) and backend `npm run build` | Passed. |
| `npm run check` | API contract current; lint and typecheck clean; 20 files, 340 passed, 0 skipped. |
| `npm run build` | Passed, no warnings. |
| `npx playwright test tests/e2e/artifacts.spec.ts` (lane 3325/4225, fresh seed) | 10 passed (desktop and mobile). This includes the schema axe test, which fails as expected under `test.fail`. |

**Backend timeouts.** The backend log showed `getDirectoryOptions` and `listEmployees` timeouts on `/employees` right after sign-in. That is the cold lane straight after seeding. No Artifacts test depends on those calls, and all tests passed.

**Update, same evening.**
- **schema.html was regenerated.** While I was on Task 07a, someone outside this lane regenerated `architecture-viz/out/schema.html` and the synced copy at 23:14, with `.null { color: var(--muted) }`.
  - `npm run artifacts:check` reports the copy is current.
  - Axe now finds no serious or critical issue on any of F1, F2, F3 or schema.html, at 1440 px and 390 px.
  - The `test.fail` schema test reported "Expected to fail, but passed". I removed it, and schema.html is now scanned with `noSeriousAxe` like the others.
- **Schema issue status.** `issues/07-schema-page-contrast.md` is marked resolved for the page, with one caveat: `architecture-viz/schema.ts:309` in this worktree still has `#8a8f99`, so regenerating would bring the defect back.
- **Final results.** `npm run check`: 21 files, 354 passed. `npm run build`: passed, no warnings. Artifacts spec in the lane: 10 passed. These include the Task 07a additions; see `responses/07a-more-artifacts.md`.
