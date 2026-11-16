# Frontend response 02: Employee directory and assistant UI

**Task:** `builder_docs/frontend-builder/tasks/02-directory-and-assistant.md`
**Status:** Parts A and B complete and verified locally. Not committed. Waiting for review.

**Order of work:**
1. I built the directory (Part A) against the committed Task 07 contract.
2. During that work the backend OpenAPI gained `sendAssistantMessages`, and `builder_docs/responses/08-ai-assistant-mcp.md` appeared.
3. I then regenerated the contract and built the assistant (Part B).

**One rule breach to report first:** while adding shadcn components I ran `git --version` inside a chained shell command. It is read-only and touched no repository, but it is a Git command and the task forbids them. No other Git command ran.

## API generation

The script is unchanged in approach: `scripts/generate-api-contract.mjs`. It now uses an explicit operation allowlist and writes `src/generated/api-openapi.json` and `src/generated/api.ts`; the old `auth-*` files were removed.

| Step | Operations added | Observed diff |
|---|---|---|
| Part A | `listEmployees`, `getEmployee`, `getDirectoryOptions` | Directory schemas: `DirectoryResponse`, `DirectoryRow`, `SelectedCompensation`, `ExchangeRateContext`, `EmployeeDetailResponse`, `CompensationHistoryEntry`, `DirectoryOptionsResponse` |
| Backend changed mid-task | none | `npm run api:check` failed ("Generated API contract is stale"). The only change in my subset was the new `ASSISTANT_UNAVAILABLE` error code. |
| Part B | `sendAssistantMessages` | `AssistantMessagesRequest`, `AssistantMessagesResponse`, `AssistantCard`, `EmployeeListCard`, `CompensationSummaryCard`, `RecentChangesCard`, `NoticeCard`, `AssistantMoney` |

Excluded from the subset: `getHealth`, `getOpenApiDocument`, and `mcp`. The MCP endpoint is for non-browser clients and rejects requests carrying an `Origin` header.

**No handwritten API types:**
- Types come from `src/generated/api.ts`.
- Runtime response validation uses Ajv over the generated JSON. The components are registered as one document so `$ref`s resolve.
- Directory URL parameters are validated with the contract's own parameter schemas (`src/server/directory-query.ts`).
- Defaults (`sort=name`, `direction=asc`, `pageSize=25`) and assistant limits (10 messages, 2,000 characters) are constants, and a test asserts each one against the generated contract.
- Assistant test fixtures are asserted against the generated response validator.

**Backend contract checked read-only.** I ran no backend command this time.

## Part A: Directory

**`/employees`**
- **Header:** "Employees / Search and review compensation records" and the total count. Scoped HR also sees "Results are permission filtered to your access: India, Support and Tech."
- **Data loading:** session, options, and the page of employees load in parallel.
- **URL state:** search, the five filters, sort, direction, page, and page size are all in the URL. Defaults are omitted. `comparisonCurrency=USD` is added automatically for salary sorts. Any change except paging returns to page 1.
- **Search:** one field ("Search by name, employee ID, or exact email"). Enter or the Search button submits. There is no per-keystroke request.
- **Filters:** native selects filled only from the permission-filtered options endpoint.
  - Desktop applies on change.
  - Mobile uses a "Filters and sort" sheet (Base UI Dialog) with Apply, Clear all filters, and Cancel.
  - Active filters show as removable chips, plus "Clear all".
  - Without JavaScript, GET forms with hidden state fields still work.
- **Sorting:** desktop headers are links with `aria-sort` and an arrow; mobile sorts in the sheet. Salary headers appear only if the options endpoint lists them.
  - A salary sort shows "Sorted by USD equivalent of …" above the rows, with the rate value, effective date, and a link to the Federal Reserve H.10 source.
  - The USD column follows the active metric (base or cash).
- **Desktop table:**
  - Columns: Employee (detail link), Employee ID, Department and job title, Level, Country, Employment status, Annual base salary, Annual cash compensation, USD equivalent.
  - Money uses tabular figures and never wraps.
  - Below 1440px the table scrolls inside its own focusable region; the page never scrolls sideways (measured: 1024, 1280, 1440, and 1920px all report zero page overflow).
- **Mobile list:** name, ID, department, status, native base salary, USD equivalent, and compensation state.
- **Money and state:**
  - Format: `INR 25,00,000.00` (Indian grouping) or `USD 120,000.00`. Strings are formatted as decimal strings and never converted to floats (tested with `90071992547409.99`).
  - Each salary carries a state label: "Current", "Upcoming from <date>", "Historical", or "Last recorded compensation" for leavers. A coloured dot repeats the text but never replaces it.
- **Pagination:** "Showing 1–25 of 10,000", "Page 1 of 400", a rows-per-page select (25, 50, 100), and Previous/Next. An unavailable action is a non-link with `aria-disabled`.
- **States:**

  | Case | What the page shows |
  |---|---|
  | No match | "No employees match these filters." with Clear all filters |
  | No access, no filters | "Your HR account has no employee access." |
  | Past the last page | A link to page 1 |
  | Invalid link (the URL values fail the contract) | "Some filters in this link are not valid". No API call is made. |
  | Missing exchange rate (salary sort not in options) | "Salary sorting is unavailable" with a link to sort by name |
  | Backend `VALIDATION_ERROR` | A notice |
  | Unexpected response | "No data is shown rather than something that may be wrong" |
  | Backend unavailable | Retryable error; the session is kept |
  | Session expired | Redirect through `/session/expired` |

- **Loading:** a page-specific skeleton with "Loading employees…" status text. The skeleton has no search field, so nothing typed can be lost. After the first render, navigation runs in a transition, so the field keeps its text and the results dim with `aria-busy`.

**`/employees/[employeeCode]`**
- **Fields:** name, employee ID, email, department, job title, level, country, employment status, hire date, end date (when present), and employee version.
- **Compensation:** heading by state (Current, Upcoming, or Last recorded compensation). Shows annual base salary, bonus, cash compensation, the native currency, the USD equivalent (bonus marked "Not converted"), pay frequency, effective date, compensation version, and the rate source and date.
- **History:** newest first (the backend returns oldest first), with "Initial import" for `INITIAL_IMPORT`. Desktop shows a table, phones a list.
- **Back link:** goes to a validated `from` path. Only a same-site `/employees?…` is accepted; external, protocol-relative, path-escaping, and array values become `/employees` (tested).
- **Not found:** unknown and out-of-scope employees get the same "Employee not found" page.

## Part B: Assistant

**`/assistant`** is added to the shell navigation and protected by the proxy matcher.

**Page**
- A "Synthetic data assistant" notice states that the data is synthetic, that the assistant is read-only, the user's scope, and that the text is model-written while card figures come from the directory.
- Four suggested prompts: Top compensation, Recent changes, Employee lookup, and Summary.
- The composer sends on Enter; Shift+Enter adds a line. Over 2,000 characters it blocks sending and says so.

**Server path** (`src/server/actions/assistant.ts`)
- The conversation is validated: only `role` and `content` are forwarded, the latest 10 messages are kept starting on a user turn, and the final message must be from the user.
- The Server Action adds the cookie token on the server and calls `POST /api/v1/assistant/messages` with a separate timeout: `API_ASSISTANT_TIMEOUT_MS`, default 50 s, against the backend's 45 s turn limit.
- The JWT never reaches the browser. `OPENAI_API_KEY` exists only in the backend.

**Memory only**
- The conversation lives in React state and is never written to local storage, session storage, cookies, or the URL (tested).
- Leaving the page clears it.

**Rendering**
- The answer is plain text, escaped by React, with no HTML or Markdown rendering.
- Tool activity shows a readable label and completed, rejected (not run), or failed.
- **Cards:**
  - `employee_list` and `recent_changes`: links to detail.
  - `compensation_summary`: one row per group and currency, with "currencies are never added together"; stacked layout on phones.
  - `notice`: info or warning.
- Native money everywhere. USD figures are labelled context with the rate line.
- Limitations are listed, plus the answer time.

**States**

| Case | Message |
|---|---|
| Loading | "The assistant is working…" (`aria-live`) |
| Model unavailable (503) | "The assistant is unavailable" |
| Timeout | "The assistant took too long to answer" |
| Rate limited | "Too many questions in a short time" |
| Malformed response | "…a response this page cannot read" |
| Service down | "The compensation service is not responding" |
| Unauthenticated | "Sign in again" link through `/session/expired`, with no retry |

Every retryable state has "Try again", which resends the same conversation.

**Scoped HR**
- The backend already filters in SQL and in code.
- In addition, the Server Action drops any `employee_list` or `recent_changes` row whose country and department fall outside the signed-in user's scope, and any department summary group outside it. This happens before the data reaches the browser.
- The page then says how many records were withheld.

## Impeccable

- **Context.** I ran `impeccable context --target next-frontend/src/app/employees/page.tsx` once, with output piped through `head`. I ran it a second time only to read the truncated directives at the end of its output, so it ran twice, not once.
- **Disclosure.** It reported `AUTONOMY_DIRECTIVE_CHECK`. I have no structured question tool or decision page in this harness, so I did not run an interview. Direction comes from DESIGN.md and the approved spec. The shipped finish-reviewer subagent is not available, so critique was done in-thread.
- **Routing.** The project already has a visual world (DESIGN.md). Both surfaces are precisely specified by `docs_human/09`, the task, and the shared contract, so `new-work.md` says to shape directly without a `concept-seed` roll. Mode: Operate.
- **References used:**
  - `shape.md`: the brief above.
  - `operate.md`: density; native affordances (native selects); "Modals are usually laziness"; overlays must escape containers, so the sheet uses a portal.
  - `craft-floor.md`: states; no eyebrow labels.
  - `adapt.md`: "Tables: transform to cards on mobile"; the 1024–1279px desktop range.
  - Critique and audit through the rendered rounds below.
- **Design decision caused by Impeccable.** Following `operate.md` and the craft-floor "Coverage" and "States" checks, compensation state is set in the money cell, under the salary it qualifies ("Current", "Upcoming from 1 Jan 2027", "Last recorded compensation"). It is not a separate badge column. The same `CompensationStateLabel` is reused in detail and in assistant cards.
- **Round 1 critique and adapt findings, and the fixes** (screenshots `round1-*` in `02-directory-evidence/`):
  1. **Adapt, 1440px.** The 9-column table overflowed (`min-w-[68rem]` cut off cash compensation and USD), and names wrapped to two lines. Fix: compact 13px table with 12px headers that wrap, nowrap names, and narrower main padding below `xl`. Measured: no overflow at 1440 or 1920; contained scroll at 1280.
  2. **Critique.** The rate note sat above every table, pushing rows down, while it matters most for salary sorts. Fix: shown above the rows only for salary sorts, otherwise as a footnote under pagination.
  3. **Critique.** The leaver label "Last recorded compensation" wrapped with its dot orphaned on a separate line. Fix: the dot is inline with the text.
  4. **Adapt, mobile detail.** The three-column compensation table squeezed `INR 10,52,700.00USD 11,209.67` together. Fix: stacked per-amount blocks on phones, and history as a list on phones.
  5. **Critique.** The detail header repeated "Last recorded compensation" as both heading and state label. Fix: the label is hidden when the heading already says it.
  6. **Anthropic-skill tell.** The detail header joined ID and email with a middle dot. Fix: a labelled `dl` ("Employee ID", "Email").
- **Audit findings fixed (axe, serious):**
  - `definition-list` on mobile cards: a stray `dd` sat outside `div` groups. Moved the state label out of the `dl`.
  - `scrollable-region-focusable` on the detail history table: replaced by a list on phones and made the desktop table container focusable.
- **Harden finding fixed.** The mobile sheet trapped focus most of the time, but in 1 of about 5 runs a fast Tab sequence reached "Skip to main content" behind the scrim. Fix: while the sheet is open the app root gets `inert`. Six consecutive runs passed afterwards.
- **Polish, round 2:** the assistant summary card stacks per group on phones, not a hidden-column scroll; the retry link is no longer underlined.
- **Detector** (`impeccable detect --json`, run at the end):

  | Target | Findings |
  |---|---|
  | `next-frontend/src` | `[]` |
  | `http://localhost:3906/sign-in` (URL mode) | `cream-palette` only |
  | Signed-in directory, detail, and assistant HTML (file mode, built CSS beside it) | `cream-palette` plus `cramped-padding` |

  - **`cream-palette`:** kept. The brief pins a warm off-white, as recorded in DESIGN.md.
  - **`cramped-padding`:** matches the Task 01 file-mode artifact; Task 01 showed the same ScopeRecord markup clean in URL mode. These pages need a session the detector cannot create, so I could not confirm it in URL mode.
- **DESIGN.md** gained directory table, mobile list, money, compensation-state, and filter rules, plus the sheet overlay. **PRODUCT.md** "Capabilities" is updated.
- Hooks and live mode were not enabled.

## Tests

**Vitest: 105 tests, 9 files, all pass (52 before).**

| File | New coverage |
|---|---|
| `directory.test.ts` (20) | Contract defaults; full URL round-trip of every parameter; page reset on change; salary-sort comparison currency; Clear all; invalid and repeated values flagged (department, page, page size, sort injection, arrays, fractions, q > 100); 9 return-path cases; exact money formatting beyond float precision; UTC dates; query and Bearer sent; employee code encoded as one segment (`../auth/me?x=1` → `..%2Fauth%2Fme%3Fx%3D1`); contract-mismatched directory responses rejected (numeric money, extra `salaryUsd`, missing fields) |
| `assistant.test.ts` (22) | Limits equal the contract; fixtures valid, extra `html` and unknown card types rejected; 10-message window; scope filter (Rohan loses Marcus Thompson and the HR group, Admin unchanged); Bearer server-side; body contains only role and content (client `userId` and `scope` dropped); out-of-scope rows never reach the result; 503, 429, 401, 400, malformed, and 502 mapped; real 150 ms timeout → `TIMEOUT`; 6 invalid conversations rejected without a backend call; no cookie → `SESSION_EXPIRED` |
| `assistant-chat.test.tsx` (11, jsdom) | 4 suggested prompts send; Enter, Shift+Enter, and multi-turn history; `<img onerror>`, `<b>`, and `javascript:` text rendered as text with no elements created; tool activity including "rejected (not run)"; all four card types with native money and rate line; 4 error states with retry; session expiry sends to sign-in; over-2,000 block; no `Storage.setItem` call, empty storage, no cookie |
| Updated | `api-contract` (7 operations, 19 schemas, error codes, paths); `api-client` (own timeout now `TIMEOUT`, not `UNAVAILABLE`); `auth.spec` (placeholder assertion replaced by the real count) |

**Playwright: 45 passed, 3 skipped by design.**
- Final run against the real compiled backend (`dist/src/server.js`, Tasks 07 and 08, no `OPENAI_API_KEY`) and an isolated MySQL 8.4 container on port 3318 with the 10,000-employee seed.
- Projects: desktop 1440×900 and mobile 390×844.
- Skips: the wrong-password test on mobile (rate-limit budget), salary header sort on mobile (headers are a desktop control), and the filter sheet on desktop.

| Spec | Journeys |
|---|---|
| `auth.spec.ts` (9) | Unchanged from Task 01, all green |
| `directory.spec.ts` (8) | Admin: department filter, then exact-ID search, URL `?q=ACME00001&department=HR`, chips, axe, keyboard Enter on the row link, detail fields, compensation, native INR, history "Initial import", rate line, axe, back with filters and search text preserved |
| | Scoped: notice, count 4,599, department options exactly `All, Support, Tech`, out-of-scope `ACME00010` search returns no match, `/employees/ACME00001` (India HR) and unknown `ACME99999` give the same "Employee not found" |
| | Salary sort header (ascending, descending, `aria-sort`, rate link, USD column), paging, chip removal, Clear all, invalid link notice and recovery, external return path rejected, mobile sheet (focus trap, Escape and focus return, apply, active count), JWT absent from directory and detail HTML |
| `assistant.spec.ts` (7) | Signed-out redirect; notice, scope, prompts, `aria-current`, axe, no overflow |
| | Keyboard question to the **real backend**, its real `503 ASSISTANT_UNAVAILABLE`, retry, JWT absent, storage empty, axe, directory still works, returning starts empty |
| | Through the test-only fake backend (Next.js on 3906 → fake on 3905): answer, tool activity, cards, limitations, axe; Rohan never sees the out-of-scope row and is told "2 records outside your access were not shown"; `<script>`/`<img onerror>` answer shown as text and `document.title` unchanged; real 1.5 s timeout state; malformed JSON state |

**The fake backend is test-only.** `tests/e2e/support/fake-assistant-backend.ts` serves only `/api/v1/auth/me` and `/api/v1/assistant/messages` from the contract-validated fixtures, for tokens `fake-meera` and `fake-rohan`. It exists because no language model runs in tests. It is not used by the application, and its employee rows exist only in test fixtures.

**Failures actually observed and fixed:**
- **Strict-mode locator collisions:** text present in both the desktop table and the mobile list, two summary regions, two Menu summaries. Fixed by scoping the locators.
- **Axe serious findings:** `definition-list` and `scrollable-region-focusable`. Fixed in the UI (above).
- **Focus trap escape**, found by repeated runs. Fixed with `inert` (above).
- **Mobile `aria-current` check:** the details menu stays open across client navigation, and I first checked the nav before the streamed page finished. Fixed the test to wait for the page.
- **Hidden-element locators:** `getByText("Annual cash compensation").first()` and the INR money locator resolved to the hidden phone or desktop variant first. Filtered to visible.
- **Rate-limit budget hit:** one earlier run reached Rohan's 5-failure budget (`429`). I restarted the backend to reset its in-memory limiter, as in Task 01.

**Server log scan.** The final backend log has 0 matches for `Bearer`, `eyJ`, the demo password, `Sneha`, and `ACME0`. The Next.js logs carry only `{event, operation, kind, status}`.

## Exact checks (from `next-frontend/`)

| Command | Result |
|---|---|
| `npm run api:generate` / `npm run api:check` | Wrote both files / "Generated API contract is current." |
| `npm run check` (api:check, lint, typecheck, test) | exit 0; 105 passed |
| `npm run build` | exit 0. Routes: `/assistant` ◐, `/employees` ◐, `/employees/[employeeCode]` ◐, `/session/expired` ƒ, `/sign-in` ◐, proxy |
| `E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD=<synthetic> npx playwright test` | 45 passed, 3 skipped |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `impeccable detect --json …` | As listed above |

**Test environment.** No backend files were modified.
- MySQL: `docker run … acme-frontend-e2e-mysql -p 127.0.0.1:3318:3306 --tmpfs …`.
- Seeding: the backend's `db:migrate`, `db:seed -- --replace` (`APP_ENV=test`), and `db:seed-demo-users` with synthetic passwords.
- Server: `env -u OPENAI_API_KEY … node dist/src/server.js` on port 3901, which logged `"assistant":"unavailable"`.
- The container, servers, and `test-results/` were removed afterwards.

## Files changed

All new unless noted.

| Area | Files |
|---|---|
| Contract | `scripts/generate-api-contract.mjs` (changed); `src/generated/api-openapi.json`, `src/generated/api.ts` (replace the `auth-*` files) |
| Server | `src/server/api/client.ts` (changed: directory and assistant calls, `TIMEOUT`); `api/contract.ts` (changed: validators); `config.ts` (changed: `API_ASSISTANT_TIMEOUT_MS`); `actions/auth.ts` (changed: maps `TIMEOUT`); `directory-query.ts`; `protected.ts`; `actions/assistant.ts`; `src/proxy.ts` (changed: `/assistant` matcher) |
| Lib | `src/lib/directory-url.ts`, `directory-choices.ts`, `format.ts`, `assistant.ts` |
| UI | `src/app/employees/page.tsx` (rewritten), `directory-controls.tsx`, `directory-navigation.tsx`, `directory-results.tsx`, `page-size-select.tsx`, `[employeeCode]/page.tsx`, `[employeeCode]/not-found.tsx`; `src/app/assistant/page.tsx`, `assistant-chat.tsx`; `src/components/directory/money.tsx`, `assistant/assistant-cards.tsx`, `shell/page-states.tsx`, `shell/app-shell.tsx` (changed: Assistant nav, `data-app-root`); `ui/native-select.tsx`; `ui/sheet.tsx` (shadcn, adapted: no backdrop blur, navy scrim, explicit transitions) |
| Tests | `tests/unit/directory.test.ts`, `assistant.test.ts`; `tests/component/assistant-chat.test.tsx`; `tests/e2e/directory.spec.ts`, `assistant.spec.ts`, `support/fake-assistant-backend.ts`; `tests/support/assistant-fixtures.ts`; changed: `tests/support/setup-dom.ts`, `unit/api-contract.test.ts`, `unit/api-client.test.ts`, `e2e/auth.spec.ts` |
| Config and docs | `playwright.config.ts`, `tsconfig.json` (`allowImportingTsExtensions` for the Node-run fake backend), `README.md`; root `DESIGN.md`, `PRODUCT.md` |
| Evidence | `builder_docs/frontend-builder/responses/02-directory-evidence/` (27 screenshots: round 1, round 2, and browser-suite captures) |

The shadcn `table` component was added and then deleted (unused).

## Known limitations

1. **No live model check.** No real model answer was ever rendered from the real backend. The backend has no key, and no test calls OpenAI. Real-backend coverage is the 503 path; answer and card rendering is covered by contract-validated fixtures.
2. **The scope filter in the browser path is defence in depth with a gap.** Country and currency summary groups are not filtered, because the contract does not say what `group` contains for those (code or name). Backend scoping still applies.
3. **No assistant rate limit at the Next.js boundary.** The backend has none either (08 limitation). The `RATE_LIMITED` state is ready if one is added.
4. **Conversation history comes from the client** (backend 08 limitation): a user can fabricate earlier assistant turns. It can only steer reads inside their own scope.
5. **Gaps I could not exercise.** The seed has only initial-import history, so multi-version history and non-empty "recent changes" were never shown against real data; only the component tests with fixtures render them. "Missing exchange rate" was likewise not exercised against a real backend without a rate.
6. **Wide-table scrolling.** At 1024–1279px the desktop table scrolls sideways inside its own focusable region.
7. **The mobile Menu `<details>` stays open after client navigation** (seen in testing). It is harmless, but it should close on navigation in a later polish.
8. **Scope wording.** Task 01 open decision 1 still stands: "India, Support and Tech" is sorted, while the spec text says "India, Tech and Support".

## Open decisions for review

1. Should the assistant drop country and currency summary groups for Scoped HR, once the contract defines what `group` holds for those?
2. Should the frontend add its own per-user assistant request limit?

## Confirmations

- **Backend:** no files under `express-backend/` were modified; it was only read and its scripts run against my own isolated database.
- **Git:** one read-only `git --version` ran by mistake (reported above). No other Git command ran, and nothing was staged, committed, or pushed.
- **`.env`:** no `.env` file was read or created.
- **Ownership:** only `next-frontend/`, `PRODUCT.md`, `DESIGN.md`, and `builder_docs/frontend-builder/responses/` were changed.
- **Fixtures:** no mock employee data in production code. The fake backend and fixtures live under `tests/`.
- **Impeccable:** hooks and live mode were not enabled.
