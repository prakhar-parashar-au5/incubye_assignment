# Frontend Task 04 response: compensation dashboard UI

**Status:** implemented. `npm run check` (192 tests), `npm run build`, and the full Playwright suite (93 passed, 5 skipped) pass. The final browser runs used the Backend Task 11b build in an isolated, synthetic database.

No backend file, `docs_human/` file or `.env` file was read for secrets or modified. No HR-access UI was built, and no Git, commit or push action happened.

Read first:
- `docs_human/10-compensation-dashboard.md`
- `builder_docs/frontend-builder/responses/04a-dashboard-shape.md`
- `builder_docs/responses/10-dashboard-analytics-api.md`
- `builder_docs/parent_instructions/11b-backend-final-review-fixes.md` and its response, once it appeared
- `docs/20-frontend-architecture.md`, `DESIGN.md`, `PRODUCT.md`
- `express-backend/openapi/openapi.json`

Installed Next.js 16.4.6 guides read (under `next-frontend/node_modules/next/dist/docs/01-app/`):
- `02-guides/authentication-with-cache-components.md`
- `01-getting-started/08-caching.md`
- `01-getting-started/06-fetching-data.md` (Streaming, Reusing data with `React.cache`)
- `02-guides/data-security.md` (Data Access Layer)
- `03-api-reference/04-functions/use-router.md` (from Task 03b)

## 1. Contract operations added

The allowlist in `scripts/generate-api-contract.mjs` gained four operations:
- `getDashboardSummary`
- `getDashboardBreakdown`
- `getDashboardRecentChanges`
- `getDashboardWithoutRecentAdjustment`

The filter options reuse the existing `getDirectoryOptions`, which is already permission filtered.

Generation and validation:
- `npm run api:generate` regenerated `src/generated/api-openapi.json` and `src/generated/api.ts`.
- New runtime validators in `src/server/api/contract.ts` are compiled from the generated schemas: `isDashboardSummaryResponse`, `isDashboardBreakdownResponse`, `isDashboardRecentChangesResponse` and `isDashboardWithoutAdjustmentResponse`.
- `src/server/api/client.ts` has four methods. Their query types come from `operations[...]["parameters"]["query"]`.
- There are no handwritten API interfaces. New code uses no `unknown as` casts, apart from the existing test pattern that reads the contract JSON.

Backend 11b changed the spec during the task. I regenerated and diffed the output. The changes were the `approvedFutureChangeAnnualCashImpact` description text and one new HR-access error code, `SELF_PASSWORD_REGENERATION_FORBIDDEN`. No dashboard field changed, which matches the 11b response ("no response schema changed"). The final `npm run api:check` reports the contract as current.

## 2. Files changed

All under `next-frontend/` unless noted.

**New**
- `src/lib/dashboard-url.ts`: URL state. It holds the contract-typed value lists, `dashboardSearch` and `dashboardHref`, and `withDashboardChanges`, which resets the list page when a filter or the period changes. It also holds the explicit backend mapping in `dashboardApiQueries`, the `directoryLinkFor`, `employeeLinkFor` and `requestListLinkFor` helpers, and `barPercent`, which only sizes the decorative bars.
- `src/app/dashboard/page.tsx`: the route, with streaming sections and all page states.
- Client components in `src/app/dashboard/`:
  - `dashboard-navigation.tsx`: transition navigation, the busy region and the "Dashboard updated." live announcement.
  - `dashboard-link.tsx`: a link that navigates through that transition.
  - `dashboard-controls.tsx`: desktop filters, the mobile filter sheet, the recent-period radios and the months select.
  - `breakdown-tabs.tsx`: tabs with manual activation.
  - `usd-disclosure.tsx`
  - `focus-heading.tsx`
- `src/components/dashboard/dashboard-sections.tsx`: presentational sections. They take contract data and render it as text: the scope line, headcount line, commitment ledger, needs-attention list, breakdown panel and CSS bars, the three activity lists, the not-applied notes, the rate context and the page states.
- Tests:
  - `tests/support/dashboard-fixtures.ts`
  - `tests/unit/dashboard.test.ts` (16 tests)
  - `tests/component/dashboard.test.tsx` (19 tests)
  - `tests/e2e/dashboard.spec.ts` (14 journeys per project)
  - `tests/e2e/support/failing-dashboard-proxy.ts`

**Changed**
- `scripts/generate-api-contract.mjs` and `src/generated/*`.
- `src/server/api/contract.ts` and `src/server/api/client.ts`.
- `src/server/directory-query.ts`: added `parseDashboardQuery`, which validates each value with the backend parameter's own schema from the contract.
- `src/components/shell/app-shell.tsx`: Dashboard is now a real link and comes first. "HR Access" stays "Coming later".
- `src/proxy.ts`: the matcher now covers `/dashboard/:path*`.
- `src/app/employees/[employeeCode]/page.tsx`: `/dashboard` is an allowed return path, with the label "Back to dashboard".
- `playwright.config.ts`: adds the failure proxy (3907), its Next server (3908), and an optional Next server (3904) for the no-rate backend.
- `tests/unit/api-contract.test.ts`: new operations, paths, schemas and the error code.
- `tests/e2e/auth.spec.ts`: Dashboard is now a link, not "Coming later".
- `DESIGN.md` (repository root): dashboard patterns. `PRODUCT.md`: capabilities.

## 3. Server, client and cache decisions (Next.js 16 docs)

- **Session and searchParams are request-time APIs**, so the page streams behind `<Suspense>`. Following `authentication-with-cache-components.md` and `08-caching.md` ("Working with runtime APIs"), only the heading and skeleton sit in the static shell. This matches every other protected page.
- **No cache.** There is no `use cache`, `use cache: private`, `cacheLife` or `cacheTag` anywhere. The task forbids a cache layer without measurement, and the backend measured about 45 ms for the Admin summary. `08-caching.md` says per-request data that must be fresh should not use `use cache`. The API client already sends `cache: "no-store"`. Authenticated figures are therefore never stored in a shared server cache, so they can't cross users or scopes. `authentication-with-cache-components.md` notes that cache keys are plain text; since nothing is cached, no token or scope enters a cache key.
- **Parallel requests, independent streaming.** This follows `06-fetching-data.md` (Streaming, parallel fetching):
  - The four dashboard requests and the options request start together.
  - The first viewport awaits only the summary and the options.
  - The breakdown, recorded changes and without-adjustment sections each await their own promise in their own `<Suspense>` boundary.
  - The upcoming list comes from the summary, as the backend designed.
  - A failed request affects only its own section.
- **Server/client split.** Data access stays in the server-only API client, the Data Access Layer from `data-security.md`. Client components get display props only, never the token. They are the filters, tabs, disclosure, period controls, pagination links and the focus heading.
- **Navigation.** Filter, tab, period, chip and page changes are `router.push(href, { scroll: false })` inside `useTransition`. The current figures stay visible and dimmed with `aria-busy`, and a polite live region says "Dashboard updated." when the new render lands. Every control is also a real link or a GET form, so the URL is always the state.

## 4. Implementation decisions

**URL state and mapping**
- Frontend names: `department`, `country`, `currency`, `level`, `status`, `recentDays` (7, 30 or 90), `noAdjustmentMonths` (3, 6, 12 or 24), `breakdown` (`department`, `country`, `currency`, `level` or `status`), `noAdjustmentPage`, and `usd=1`. Defaults are left out of the URL.
- Explicit mapping: `status` → `employmentStatus`, `recentDays` → `periodDays`, and `breakdown` → the uppercase enum. Each endpoint gets only its own parameters, because the backend rejects parameters that don't belong to an endpoint.
- Validation:
  - Every value is checked against the backend parameter schema in the generated contract and against the typed lists. A unit test asserts the lists equal the contract enums.
  - Repeated keys are invalid.
  - Any invalid value shows "Some filters in this link are not valid" with **Reset filters**, and the page makes **no dashboard call**. A browser test proves this with a request counter.
- Changing a global filter or the months period resets `noAdjustmentPage`. Changing the tab, the recent period or USD keeps it.

**First viewport (approved 04a shape, no card wall)**
- The scope line shows "All employees", or the scope plus "(permission filtered)" for Scoped HR, and "As of … (UTC business date)".
- The people line shows Currently working as the primary figure, with Soon to join and Left smaller beside it. Each is a link to the filtered directory.
- The commitment ledger has one row per native currency and no total row. It shows employees, annual base, annual cash and upcoming approved commitment, with the soon-to-join and approved-change parts beneath. The backend's commitment definition is printed under the ledger. The browser never derives a commitment total.
- Needs attention lists pending requests, out-of-date requests, recorded changes, upcoming approved changes and no recorded adjustment. Each row is one link to the queue, the request list or the section below. A note explains when the request list cannot keep a filter: Admin keeps only department, and Scoped HR keeps none. The page says the dashboard performs no mutation.

**Currency and USD**
- Native values come first and every amount carries its currency code. Amounts are the backend's exact strings, formatted by the existing `Money` component.
- USD comparison is off by default; `usd=1` adds muted "USD equivalent, cash (comparison only)" columns.
- "About USD comparison" is a `<button aria-expanded>` with an inline panel showing currency, rate, direction, linked source, effective date and disclaimer. It works with mouse, keyboard, touch and screen readers, and is not hover-only.
- With no saved rate, both controls are replaced by the backend's `unavailableReason`, and the native figures stay.

**Breakdowns**
- One selected breakdown at a time, as WAI-ARIA tabs with manual activation (Left, Right, Home and End move focus; Enter or Space selects). Each tab is a real link.
- One exact table per currency on desktop, and ruled lists on phones. Columns: employees, base, cash, average, median, and cash range (minimum to maximum).
- The status breakdown shows the basis (current spending, future commitment, or count only). Left employees show "Not applicable" for money.
- The backend's `population` is shown in words, and `notApplied` reasons are shown above the tables.
- CSS bars appear only for annual cash by department and employee count by status, one chart per currency. Each bar is `aria-hidden` and sits next to its exact value in text. There is no chart library.

**Activity**
- **Recorded salary changes:** a 7, 30 or 90 day radio group. The copy says the period counts recording time, not effective time. Each row shows previous and new base and cash, reason, recorded time (UTC), effective date with an "Upcoming" tag for future changes, actor, employee link, and either "View request" or "Direct change". The empty state uses the approved message, which comes from the backend's `emptyMessage`.
- **Upcoming approved changes:** the backend's ten soonest, showing employee (with a "Soon to join" label where it applies), effective date, before and scheduled values, reason, approver and request.
- **Without a recorded adjustment:** the total, the exact statement "No recorded salary adjustment since import or during the selected period.", and a paginated list with Previous and Next. Focus moves to the section heading after a page change. The copy never claims an employee was never adjusted.

**Scope and states**
- An empty Scoped HR scope in the session shows only the no-access message and makes no dashboard request. A summary that reports `hasEmployeeAccess: false` gives the same result.
- "No compensation data matches these filters." appears when filters match no one, with Clear filters.
- A failed section shows "{Section} could not be loaded." with Try again, and no figures.
- Filters that fail to load show their own retry, and the sections still render.

**Desktop and mobile**
- **Desktop (≥1024px):** filter selects apply on change, and tables sit in focusable scroll regions.
- **Mobile:** the filter sheet is reused from the directory (focus trap, page behind made inert). The ledger, breakdown and lists become ruled blocks and the tabs wrap. There is no page-level horizontal overflow at 390px or 1440px, or at 720px (200% zoom of 1440).

## 5. Impeccable

- `impeccable context` ran with `--target next-frontend/src/app/dashboard/page.tsx`. It loaded PRODUCT.md and DESIGN.md; there is no surface brief.
- There was no interview: the approved 04a shape was the brief, and no structured question tool is available. The mode is Operate.
- I read `craft-floor.md` before UI edits. It steered the design away from a card wall and a hero metric, and toward ruled records, one accent and no new colours.

Concrete effects from reviewing the rendered screenshots:
- **Breakdown table too wide:** the first breakdown was one ten-column table mixing INR and USD rows, and it ran off the right edge at 1440px. I split it into one table per currency, with a caption, and merged minimum and maximum into a "Cash range" column.
- **Raw enum shown:** the population line printed `CURRENTLY_WORKING`. It now reads "currently working employees only", or describes all statuses for the status breakdown.
- **Overclaiming copy:** the without-adjustment description said "does not mean an employee was never adjusted". I rewrote it as "an employee may have had adjustments before it", which keeps the meaning without echoing a prohibited claim. A browser assertion caught this.
- **Screen-reader names:** spaces inside `sr-only` spans were dropped from accessible names ("8,500currently working…"). I moved the spaces outside the spans.

Detector results:
- On `src/app/dashboard`, `src/components/dashboard` and `src/components/shell`: `[]`.
- On rendered signed-in HTML (Admin at 1440px with `usd=1`, Scoped at 390px), only `cream-palette` (the pinned ground) and `cramped-padding` remain. The `cramped-padding` findings are on the ruled-record `dl` and hairline elements, the hidden responsive variants, and lists whose children carry the padding. The screenshots show the text inset. These are the same kinds already recorded as kept in Task 03.

## 6. Tests and results

| Command | Result |
|---|---|
| `npm run api:check` | "Generated API contract is current." (against the final 11b OpenAPI) |
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. 13 files, **192 tests passed** (157 before; 16 unit and 19 component tests are new) |
| `npm run build` | Exit 0; `/dashboard` is a partial-prerender route |
| `npm run test:e2e` (run as `npx playwright test` with the injected environment below, on a freshly reseeded database) | **93 passed, 5 skipped** |
| `npm audit --omit=dev` | 0 vulnerabilities |

The 5 skips are four existing project-specific tests (mobile-only on desktop or the reverse) plus the new "keyboard-only path and 200% zoom", which runs on desktop only because zoom is emulated from the 1440px window.

**Unit tests** (`tests/unit/dashboard.test.ts`):
- Value lists and defaults equal the contract enums and defaults.
- Fixtures pass the compiled validators. Extra keys, numeric money and a wrong empty message are rejected.
- Parsing: defaults; every valid value; invalid, repeated and lower- or upper-case-wrong values; backend names ignored.
- Mapping to each endpoint, with no foreign parameters.
- Defaults are left out of URLs; page reset rules.
- Directory, detail and request links, including the dropped-filter notes.
- Safe return paths: `/dashboard?…` is accepted; `/dashboardevil`, `//evil`, absolute URLs and `/dashboard/../admin` are rejected.
- `barPercent` bounds.
- The client sends the mapped query and the Bearer token. It returns `INVALID_RESPONSE` for an off-contract body and `SERVICE_UNAVAILABLE` for a 503.

**Component tests** (`tests/component/dashboard.test.tsx`):
- Separate INR and USD ledger rows with no total row.
- A deliberately inconsistent backend total is shown as given, which proves the browser does no salary arithmetic. A signed decrease renders correctly.
- USD columns are opt-in; the missing-rate state removes only the USD controls.
- Not-applied notes.
- Disclosure by click, Enter and Space, with full rate text.
- Tab semantics, roving tabindex, manual activation and arrow, Home and End keys.
- Exact breakdown values per currency and directory links.
- Bars are `aria-hidden` and scaled per currency.
- Count-only status groups.
- Recorded-change labels, the empty message, upcoming rows, without-adjustment pagination and its wording.
- Scope line, headcount links, attention links and notes.
- No-access, no-match, invalid-link and failed-section states contain no figures.

## 7. Browser journeys and evidence

Every journey ran on desktop (1440×900) and mobile (390×844, touch). Each major state has an overflow check plus axe with no serious or critical findings.

| # | Journey (task item) | Result |
|---|---|---|
| 1 | Admin first viewport: scope, UTC date, currently working + soon to join + left = 10,000, separate INR and USD rows, no total, linked attention counts; headcount equals the directory count | pass |
| 2 | Scoped HR: options are only Support, Tech, India and INR; INR row only; no USD amount, Finance, Operations, United States or out-of-scope employee code on the page; headcount equals the directory | pass |
| 3 | Empty scope: an HR user is created through the real HR-access API, its scope rows are removed in the isolated database, the backend summary returns `hasEmployeeAccess:false` and `figures:null`, and the page shows only the no-access message, with no digits, currencies or filter controls | pass |
| 4 | Global filter Department=Tech: URL, announcement, headcount, breakdown and chips update; reload keeps state; detail → "Back to dashboard" returns to the exact URL | pass |
| 5 | `status=LEFT` is explained in the ledger and Needs attention as not applied | pass |
| 6 | Keyboard tab switching (Arrow, End, Enter); the URL changes only on Enter; a bar's printed value equals the table value | pass |
| 7 | USD disclosure by click (desktop) or tap (mobile), then Enter and Space; rate, direction, source link, date and disclaimer; columns opt-in. **Missing rate** against a real backend without its rate file: native INR and USD totals stay, the unavailable message shows, and all USD controls are gone | pass |
| 8 | A change applied through the salary screen increments "recorded in the last 30 days" and appears with Performance, Meera Iyer and Direct change; the 7-day period keeps it; the return path works | pass |
| 9 | A Scoped HR request increments both Rohan's and Meera's pending counts; the count opens `/salary-requests?status=PENDING&direction=asc`, which lists it; the dashboard has no approve or cancel controls | pass |
| 10 | Approved future changes for a currently working employee and a **soon-to-join** employee: the upcoming count goes up by 2, both rows show (the joiner labelled "Soon to join"), the INR upcoming commitment rises by exactly the sum of the two previewed signed impacts, and the soon-to-join count is unchanged. This is the 11b correction, observed in the browser | pass |
| 11 | Without adjustment: the attention count equals the section total and the pagination total; Next moves to page 2 and focuses the heading; a period change returns to page 1 | pass |
| 12 | Invalid links (`level=CEO`, `recentDays=14`, `breakdown=DEPARTMENT`, `usd=yes`, repeated `status`): the invalid notice shows and the proxy counter is unchanged (no dashboard call); Reset makes calls | pass |
| 13 | Partial failure: the breakdown endpoint answers 503 through the test proxy; its alert and Try again show, and the ledger, headcount, recorded changes and list stay with real data | pass |
| 14 | Keyboard-only path (skip link, filter by keyboard with focus kept, disclosure, attention link) and 200% zoom (720px) with no overflow and passing axe | pass (desktop) |

The existing auth, directory, assistant and salary journeys all pass in the same run, so their behaviour is unchanged.

**Evidence** in `builder_docs/frontend-builder/responses/04-dashboard-evidence/`:
- `dashboard-admin-{desktop,mobile}.png`
- `dashboard-scoped-*`
- `dashboard-breakdown-status-*`
- `dashboard-recent-*`
- `dashboard-upcoming-*` (shows "2 approved changes: +INR 89,425.00" and the soon-to-join row)
- `dashboard-without-*`
- `dashboard-partial-failure-*`
- `dashboard-no-access-*`
- `dashboard-zoom-200.png`

**How the environment ran.** Synthetic values were injected on the command line; no `.env` file was used.
- **Database:** MySQL 8.4 container `acme-frontend-e2e-mysql` (127.0.0.1:3318, `acme_e2e`). In `express-backend` I ran `npm run db:migrate` (001–006), `npm run db:seed -- --replace` and `npm run db:seed-demo-users`. I reseeded before each full run and restarted the backends to reset their rate limiters.
- **Backend:** the existing `express-backend/dist` build on port 3901 (`dashboard-service.js` dated 21:27). That was the build in place once the 11b response appeared, and no backend source file is newer than it. The final reset restarted it from that build. Journey 10 confirms in the browser that it includes the 11b commitment fix.
- **Missing-rate backend:** a byte-identical copy of the same `dist` (`diff -rq` empty) plus `package.json` in `/tmp/acme-norate`, with `node_modules` symlinked and no `data/` directory, on port 3903. It logged `exchange_rate_unavailable` at startup. No backend file was modified.
- **Test proxy:** `tests/e2e/support/failing-dashboard-proxy.ts` (3907) fails only `GET /api/v1/dashboard/breakdowns` with the public 503 shape and counts dashboard requests. Next on 3908 uses it.
- **Command:**
  ```
  E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_NO_RATE_API_BASE_URL=http://127.0.0.1:3903 E2E_MYSQL_CONTAINER=acme-frontend-e2e-mysql E2E_DATABASE_URL='mysql://acme:…@127.0.0.1:3318/acme_e2e' E2E_DEMO_PASSWORD=… npx playwright test
  ```

## 8. Scenarios not run, and simulated ones

- **Partial failure** is simulated: the backend was healthy, so a test proxy injected the 503 for one endpoint. The other three sections show real backend data. The 11b response separately covers the backend's own 503 mapping.
- **Empty scope** cannot be created through the API, which rejects it with `INVALID_SCOPE`. The test creates a real Scoped user through the API, then deletes its scope rows in the isolated database. That journey skips (and says why) when `E2E_MYSQL_CONTAINER` and `E2E_DATABASE_URL` are not set. They were set for the recorded runs.
- **Missing rate** skips without `E2E_NO_RATE_API_BASE_URL`. It ran in the recorded runs.
- **Not run:**
  - Real browser zoom; zoom was emulated as a 720px viewport.
  - A screen reader; only the semantics were checked, through roles, names, `aria-expanded` and live-region text.
  - The expired-session redirect from a dashboard section. It uses the existing `redirectIfUnauthenticated` helper, which the auth journeys cover for other pages.

## 9. Known limitations

- Recorded changes show the 10 most recent with a "Showing 10 of N" note; there is no dashboard pagination for that list. Upcoming changes show the backend's 10 soonest plus the total.
- The pending and stale counts apply every dashboard filter, but the request list they link to can keep only department (Admin) or nothing (Scoped HR). The page says so beside the links.
- The without-adjustment count above the fold and the list total come from two requests. If they differ, the section shows a "reload for one consistent view" note instead of hiding the difference. In the browser runs they agreed.
- The breakdown status chart is drawn per currency, so headcount by status is never summed across currencies, even for counts.
- After a filter change, focus stays on the control and the change is announced, as the directory does; focus does not move to the content.
- Requests whose data was already started are not cancelled when the page returns early, for example the no-match state.

## 10. Confirmations

- `express-backend/**` and `docs_human/**` were not modified.
- No HR-access frontend, AI trace frontend, dashboard mutation, new backend endpoint, stored converted salary, native mixed-currency total, chart dependency or cache layer was added.
- No `.env` file was read or created.
- No Git command was run, and nothing was committed or pushed.
- The isolated test container, the `/tmp` backend copy, the test servers and `next-frontend/test-results` were removed afterwards. The other containers and the server on port 3000 were left alone.
