# Frontend response 04a: Compensation dashboard (shape brief)

**Task:** `builder_docs/frontend-builder/tasks/04a-dashboard-shape.md` (`READY` in `index.md`)
**Status:** Shape brief complete. Planning only.
- No production frontend code was written.
- No production file was modified.
- No analytics API types were created.

## Before the brief

- **No analytics contract yet.** The backend OpenAPI has no analytics or dashboard endpoints. It now includes the Task 09 salary-request endpoints. Every analytics field named below is quoted from `docs_human/10-compensation-dashboard.md` or listed as a question in section 15. Nothing is a guessed response shape.
- **Existing contracts I read but did not invent from.** I read the published request-list query parameters (`q`, `department`, `status` with `PENDING | APPROVED | CANCELLED | STALE`, `sort=createdAt`, `direction`, `page`, `pageSize`) and the directory query parameters. I only use them to plan **links** into those pages.
- **Impeccable:**
  - **Context not rerun.** The context command already ran in this session (Task 02), and PRODUCT.md and DESIGN.md have not changed since. The task asks for one run per session, so I did not run it again.
  - **Interview substitution.** There is no structured question tool or decision page in this harness. Following `shape.md`, I marked assumptions **(assumption)**, return the brief, and stop. Product questions are in section 16.
  - **No new world.** This surface sits inside the established world (DESIGN.md), and the spec fixes its content closely. Following `new-work.md`, there is no `concept-seed` roll and no new world. Mode: **Operate** (`mode-operate.md`, `operate.md`).
- **Effects of Impeccable on the plan:**
  - **Hero-metric ban.** `craft-floor.md` refuses "the hero-metric template: big number, small label, supporting stats", and "same-size cards … as the page structure". The task says "avoid a wall of cards". So the top figures are a ruled **summary ledger** (section 3), not tiles.
  - **Signature move extended.** `mode-operate.md` asks for one named signature move. DESIGN.md's ruled "access record" becomes the dashboard's **scope line** and **commitment ledger**, using the same fixed-column, hairline-ruled form.
  - **Restrained palette.** `operate.md` says "Restrained is the floor". Chart bars use the single accent blue. State colours are reserved for request and compensation states, always with text.

## 1. Job, audience, and outcome

- **Users:** Admin HR (Meera) and Scoped HR (Rohan), at an office desk; Scoped HR sometimes on a phone **(assumption)**.
- **The ten-second test.** On opening the dashboard, HR can say:
  1. whose employees this covers (scope) and for which period;
  2. how many people are currently working;
  3. annual base and cash compensation **per currency**;
  4. what needs attention: pending and out-of-date requests, recent changes, and people without an adjustment.
- **Success:**
  - Every figure is native-currency and scope-correct.
  - USD is visibly secondary and sourced.
  - Every number that suggests action is a link to the page where the action happens.
- **Anti-goals:**
  - a card wall;
  - a hero metric;
  - a pie or donut chart;
  - INR + USD in one total;
  - hover-only rate information;
  - a filter that silently does nothing;
  - any mutation from the dashboard.

## 2. Route and navigation

- **New route `/dashboard`.**
  - It is protected by adding `/dashboard/:path*` to the proxy matcher.
  - It uses the same session handling as other protected pages: `requireUser`, the `/session/expired` path, and the retryable outage state.
- **Rail and mobile Menu:** the current "Dashboard – Coming later" text becomes a live link. Order **(assumption)**: Dashboard, Employees, Salary requests (Task 03), Assistant.
- **Landing after sign-in stays `/employees`.** `docs_human/09` says so, and the dashboard spec does not change it (product question P1).

## 3. First-viewport information hierarchy

**Desktop, 1440×900. Everything below fits above the fold.**

```text
Dashboard                                           [Filters: Department ▾ Country ▾ Currency ▾ Level ▾ Status ▾]
Compensation overview for your access

Scope    India, Support and Tech · permission filtered        As of  15 Nov 2026 (UTC)
──────────────────────────────────────────────────────────────────────────────────────
People   Currently working 4,412   Soon to join 96   Left 91                    → Open in Employees

Commitment by currency (currently working only)
          Annual base salary      Annual cash compensation   Upcoming approved commitment
  INR     INR 1,10,30,00,000.00   INR 1,21,33,00,000.00      INR 2,10,00,000.00
  USD     —                       —                          —
          [About USD comparison]  USD-equivalent total: hidden by default (secondary)

Needs attention
  Pending salary requests                     3   → Review queue
  Requests out of date                        1   → View
  Salary changes recorded in the last 30 days 12  → View below
  Upcoming approved changes                   4   → View below
  No recorded adjustment in 12 months       3,970 → View below
```

The `·` in the sketch is diagram notation only. The rendered scope line uses labelled columns, not middle dots; that is the Task 02 correction.

**Order of meaning**
1. **Scope and period.** Scope uses `scopeSummary` and "permission filtered" for Scoped HR. "As of" is the backend's business date (question D2). The period selector appears beside the time-based sections, not in the header, because only some figures use time.
2. **People line.** "Currently working" is primary: first, bold, larger figure. Soon to join and Left are smaller in the same ruled line. This is a definition-list ledger with fixed columns, not three cards.
3. **Commitment ledger.** A small table: one row per **native currency** present in scope, columns for annual base, annual cash, and upcoming approved commitment. A currency with no employees in scope is omitted. Rohan sees only INR. The table makes the currency separation structural: values sit in separate rows, and there is no total row.
4. **Needs attention.** A ruled list of counts with links. Each count is a link to the place where the work happens (section 12). Zero counts stay visible ("0"), muted, so "nothing pending" is information.

**Below the fold:** Breakdown (section 6), then Activity (sections 7–10).

## 4. Native currency separation

- **Every money value** carries its currency code and uses the existing `Money` component (exact decimal string, Indian grouping for INR, tabular figures, no wrap).
- **No mixed figures:**
  - INR and USD are never summed, averaged, or charted on one axis.
  - Breakdown tables group rows by currency. A department with INR and USD employees shows two rows, "Tech (INR)" and "Tech (USD)", like the assistant summary card.
  - Charts are per currency (section 13).
- **Currency filter.** When a currency is chosen, every section shows that currency only, and the commitment ledger shows one row.

## 5. USD-comparison disclosure

- **Secondary only.** USD equivalents never replace native figures. Where shown, a USD column is muted and labelled "USD equivalent (comparison only)":
  - the commitment ledger (optional, collapsed by default);
  - breakdown tables (an optional "Show USD comparison" toggle).
- **The rate control.**
  - Beside each USD-comparison section there is an **"About USD comparison"** button (`aria-expanded`, `aria-controls`). It toggles an inline panel; it is not a tooltip.
  - The panel shows the comparison currency, rate ("1 USD = 93.9100 INR"), quote direction in words ("INR per one US dollar"), source name, source link, effective date, and "Informational only; native amounts are authoritative."
  - It works with mouse, keyboard (Enter/Space), touch, and screen readers. The panel content is real text, not `title` attributes.
- **Missing rate.** USD columns and toggles are removed, and the "About" control is replaced by: "USD comparison is unavailable: no saved exchange rate. Native totals are unaffected." Native figures stay.

## 6. Global filters and URL state

**Filters**
- Native selects with visible labels, filled only from options the backend permits (question D4): Department, Country, Currency, Level, Employment status.
- **Desktop:** applied on change, as in the directory.
- **Mobile:** the existing "Filters" sheet with Apply.
- Active filters show as removable chips, plus "Clear filters".

**URL parameters** **(assumption; names follow the directory where meanings match)**

| Parameter | Values | Default (omitted from URL) |
|---|---|---|
| `department`, `country`, `currency`, `level`, `status` | As in the directory | none |
| `recentDays` | `7`, `30`, `90` | 30 |
| `noAdjustmentMonths` | Values set by the API (question D9) | 12 |
| `breakdown` | `department`, `country`, `currency`, `level`, `status` | `department` |
| `usd` | `1` (show USD comparison columns) | off |
| `noAdjustmentPage` | Page of the without-adjustment list | 1 |

- **Validation.** The page validates parameters against the generated analytics contract, as `parseDirectoryQuery` does today. If any value is invalid, the page **does not call the analytics API**. It shows "Some filters in this link are not valid" with **Reset filters**.
- **Page reset.** Changing any filter resets `noAdjustmentPage` to 1.
- **Filters that do not apply to a metric.** The section says so in text and does not drop the filter silently. Two examples:
  - `status=LEFT` with spending: "Spending includes currently working employees only. The Employment status filter does not apply to this section."
  - `status=SOON_TO_JOIN` with the without-adjustment list (currently working only): "This list includes currently working employees only."
- **Where applicability comes from.** It must come from the API (question D6), so the UI does not hard-code rules that may drift.

## 7. Breakdown interaction (department, country, currency, level, status)

- **One breakdown at a time.** A tab list (`role="tablist"`, arrow keys move between tabs, `aria-selected`) with Department, Country, Currency, Level, and Employment status. The selected tab is in the URL (`breakdown=`). One panel is shown, as the spec requires.
- **The panel:**
  - **Chart, where specified:**
    - Department tab: horizontal bars of annual cash compensation, one chart per currency or only the filtered currency.
    - Employment status tab: bars of employee count.
    - Other tabs have no chart (section 13).
  - **Exact table.** For each group and currency: employees, annual base salary, annual cash compensation, average, median, minimum, and maximum annual cash compensation. Columns the API marks "not meaningful" are omitted (question D7).
  - **Optional USD comparison columns** (section 5).
- **Row links.** Each group row links to the directory filtered to that group plus the current global filters, for example `/employees?department=Tech&country=IN&currency=INR&status=CURRENTLY_WORKING`. Spending groups count currently working employees only, so the link adds `status=CURRENTLY_WORKING`.
- **Breakdown by employment status.** This is headcount for all three statuses. Money columns appear only for `CURRENTLY_WORKING` and for the `SOON_TO_JOIN` future commitment, labelled as such. `LEFT` shows a count only (spec: left employees contribute no spending).

## 8. Recent recorded salary changes

- **Period control.** A segmented radio group, "Recorded in the last: 7 days | 30 days | 90 days", in the section header. URL `recentDays`, default 30. The heading says "recorded", and helper text explains: "Changes HR recorded in this period, including ones that take effect later. The initial import is not counted."
- **Table (desktop), ruled list (mobile).**
  - Employee name (link to detail) and ID.
  - Department and country.
  - Previous and new compensation (native, before → after).
  - Change reason.
  - Recorded time (UTC).
  - Effective date ("Upcoming" label when it is in the future).
  - HR actor.
  - Request link (Admin HR only, when present) **(assumption)**. The spec says Admin can open the related request. Scoped HR can view requests in scope (11), so whether Scoped HR also gets the link is product question P3.
- **Empty:** "No compensation changes were recorded in this period."
- **Long lists:** the latest N with "Show all" (question D10) **(assumption)**. The dashboard is for orientation, not a full report.

## 9. Pending and stale requests

- **Counts** appear in Needs attention (section 3). The section shows the **five oldest pending** requests **(assumption)**: employee, requester, target change, effective date, created time, and the "Pending approval" label.
- **Links:**
  - Admin: "Review queue" opens `/salary-requests?status=PENDING&direction=asc`, using the published parameters.
  - Scoped HR: the same list path, read-only, scoped by the backend.
- **Out of date.** The `STALE` count and the five most recent stale requests (label "Out of date" plus the stale reason) link to `/salary-requests?status=STALE`.
- **Filters on request links.** The request list supports `department` only for Admin and has no country, currency, or level parameter. When those global filters are active, the link carries only what the list supports, and says so: "The request list is filtered by department only."
- **No actions here.** The dashboard has no approve or cancel controls (spec).

## 10. Upcoming compensation changes

- **What it lists:** approved changes with a future effective date, soonest first, showing employee, target, before → after (native), effective date, and approved by. Each row links to employee detail.
- **Commitment figure.** The "Upcoming approved commitment" figure in the ledger (section 3) is the API's own figure (question D3). It includes eligible `SOON_TO_JOIN` compensation and approved future changes, per the spec. The UI shows it as one value per currency, with a footnote defining it.

## 11. Employees without a recorded adjustment

- **Period control.** A select labelled "No recorded adjustment in the last". Default 12 months; options from the API (question D9). URL `noAdjustmentMonths`.
- **Required wording**, as the section description: "No recorded salary adjustment since import or during the selected period." Never "has never received a raise".
- **Total count** in the section header and in Needs attention. The two must agree; this is a browser assertion.
- **Paginated list:**
  - Columns: name (link to detail), ID, department, country, level, current annual cash compensation (native), and last recorded change (the date of the last non-import record, or "Since import").
  - Pagination: Previous/Next with page `x of y` and `noAdjustmentPage` in the URL, the same pattern as the directory.
- **Filtered link:** "Open in Employees" goes to the directory with the global filters. A directory filter for "no adjustment" does not exist, so the link says "Employees matching these filters" rather than implying the same list (product question P4).

## 12. Links into directory, detail, and approval queue

| From | To |
|---|---|
| People line (each status) | `/employees?status=<status>&<global filters>` |
| Commitment row (currency) | `/employees?currency=<c>&status=CURRENTLY_WORKING&<filters>` |
| Breakdown row | `/employees?<group key>=<value>&currency=<c>&status=CURRENTLY_WORKING&<filters>` |
| Recent change, upcoming change, no-adjustment rows | `/employees/<code>?from=<this dashboard URL>` |
| Pending and stale counts and rows | `/salary-requests?status=PENDING` (or `STALE`), or `/salary-requests/<id>` |

- **Filter mapping** is only by shared meaning: department, country, currency, level, and status mean the same in both APIs.
- **Return path.** Detail pages accept `from` only for `/employees…` today (`safeReturnPath`). Returning to `/dashboard` needs that allowlist extended to `/dashboard`, which is a Task 04 change.
- **No-access users** see none of these links.

## 13. Proposed chart types

| Chart | Where | Why | Accessible form |
|---|---|---|---|
| **Horizontal bar**, annual cash compensation by department, **one chart per currency** (or one when filtered) | Department breakdown | Ranking five departments by size reads faster as bars than as numbers; horizontal bars fit the long department names; per-currency charts avoid mixing INR and USD scales | Built as an HTML list, not canvas: each row is the department name, the exact `Money` value as text, and a decorative bar (`aria-hidden`) whose width is the value relative to that chart's maximum. Values are always visible, so there is no tooltip dependency, and it works with keyboard and touch by default |
| **Vertical or horizontal bar**, employee count by employment status | Employment status breakdown | Three categories with very different sizes; one glance shows the proportion | Same list structure with counts as text |
| **No chart** for country, currency, or level | — | Two countries, two currencies, and five levels compare faster in the exact table; a chart would add nothing (spec: "Use charts only where visual comparison is faster") | Table only |
| **No pie, donut, or sparkline** | — | Excluded by spec; sparklines are also a craft-floor default | — |

- **No chart library** **(assumption)**: CSS bars inside semantic lists meet every requirement without client JavaScript.
- **Bar widths come from backend values.** The frontend works out each bar's length relative to that chart's largest value, for display only. This is a ratio, not authoritative compensation, so it can use JavaScript numbers.
- **Mobile.** The same lists stack: the label and value sit above a full-width bar, so nothing overflows.

## 14. Desktop and mobile layout

**Desktop (≥1024px):**
- The rail stays. The main column has a max width of about 80rem.
- The first viewport is section 3.
- **Breakdown** is a full-width tab panel, with the chart left (about 40%) and the table right; or the table only.
- **Activity** sits in two columns at ≥1280px **(assumption)**:
  - left: Recent changes and Upcoming changes;
  - right: Pending and out-of-date requests, then Employees without a recorded adjustment.
- Below 1280px, Activity is one column.

**Mobile (390px):**
- Compact header, then the scope line, the people line (wrapping into a two-column definition list), the commitment ledger as one block per currency, and Needs attention.
- Below that: a "Filters" sheet button; the breakdown tabs as a horizontally scrollable tablist **inside its own region** (no page overflow); tables as ruled lists; charts stacked.
- Money never wraps.
- Section order is the same as desktop.

**Both:** the page never scrolls sideways. Wide tables scroll inside focusable regions only at narrow desktop widths, as the directory does.

## 15. Keyboard and focus behavior

- **Order:** filters → scope and figures → Needs attention links → breakdown tabs → panel → activity sections, all in DOM order. A skip link already exists.
- **Tabs:** standard tab pattern (roving `tabindex`, Left/Right/Home/End). The panel is focusable.
- **Disclosures:** "About USD comparison" is a `<button>` with `aria-expanded`, and its panel follows the button in the DOM. There is no hover dependency.
- **After filter changes:** focus stays on the changed control. Navigation runs in a transition with the content marked `aria-busy`, and a polite live region announces "Dashboard updated" (as in the directory).
- **Period and pagination controls** announce their results the same way. After a no-adjustment page change, focus moves to that section's heading.
- **Visible focus** is DESIGN.md's 2px outline. Nothing sticky covers it.
- **Sign-out** stays reachable (keyboard sign-out journey).

## 16. States

| State | Treatment |
|---|---|
| Loading | Page-specific skeleton: scope line, people line, ledger rows, attention list shapes; static bars; "Loading dashboard…" status. No final totals until the API confirms them. Filters are not editable during the first load |
| No employee access (empty scope) | "Your HR account has no employee access. Ask an Admin HR user to assign countries and departments." Nothing else renders: no counts, options, or zeros that might hint at hidden data |
| No data for filters | "No compensation data matches these filters." with **Clear filters**; the figures and sections are replaced, not shown as zeros (question D11) |
| No recent changes | "No compensation changes were recorded in this period." |
| No pending or upcoming work | "No requests are waiting for approval." / "No approved future changes." |
| Missing exchange rate | Native figures shown; USD columns and controls removed; message in each USD section (section 5) |
| Invalid URL filters | No analytics call. "Some filters in this link are not valid." with **Reset filters** |
| Partial failure **(assumption)** | If the API is split into several endpoints (question D1) and one fails, only that section shows "This section could not be loaded. Try again." Others stay. A failed section never shows stale numbers |
| Backend unavailable | The existing `ServiceUnavailable` with retry; the session is kept; no figures shown |
| Expired session | The existing `/session/expired` flow, which clears the cookie and goes to sign-in |
| Unexpected response | The existing `UnexpectedResponse` ("No data is shown rather than something that may be wrong") |

## 17. Browser test journeys (planned for Task 04)

These run against the real backend and seed (separate database), desktop 1440×900 and mobile 390×844, with axe on each.

| # | Journey | Key assertions |
|---|---|---|
| 1 | Admin ten-second view | Scope "All employees"; currently working, soon to join, and left counts; INR and USD ledger rows separate with no total row; Needs attention counts are links |
| 2 | Scoped HR view | "permission filtered" scope line; INR row only; department options only Support and Tech; no Finance or HR anywhere on the page |
| 3 | Empty scope | No-access message only; no numbers rendered |
| 4 | Global filter | Choose Department, then the URL, ledger, breakdown, and lists update together; chip removal restores; reload keeps state |
| 5 | Unsupported filter | `status=LEFT`, then the spending section shows the "does not apply" message, not zeros |
| 6 | Breakdown tabs | Keyboard arrow keys switch tabs; the URL updates; department bars show exact values as text; one chart per currency |
| 7 | USD disclosure | Keyboard Enter opens the panel with rate, direction, source link, and date; touch tap works (mobile project); screen-reader name and expanded state |
| 8 | Missing rate | Backend started without a rate fixture **(test-environment question)**: native totals shown; USD controls absent; message present |
| 9 | Recent changes | Default 30 days, then 7 and 90; empty message; future-effective item labelled; employee link opens detail with a return link to the dashboard |
| 10 | Pending and stale | After a Scoped HR request (Task 03 flow), the Admin dashboard pending count increments; the link opens `/salary-requests?status=PENDING` |
| 11 | Without adjustment | Count equals the list total; pagination; the required wording present; links to detail |
| 12 | Invalid URL | `?level=CEO`, then the invalid notice, no analytics request (verified by the absence of a backend log entry or a network stub), and Reset |
| 13 | Unavailable and expired | A second Next.js server pointed at a closed port shows the retry state; an invalid cookie leads to sign-in |
| 14 | Overflow and keyboard | No page overflow at 1024, 1280, 1440, 1920, and 390px; a full keyboard path through filter, tab, disclosure, detail, and sign-out |

Component tests (Vitest) will cover:
- the ledger's currency rows and the absence of a total row;
- the "does not apply" filter notes;
- the disclosure with the rate present and absent;
- tab keyboard behaviour;
- bar widths derived from values;
- each state component.

## 18. Exact backend API questions before implementation

| # | Question |
|---|---|
| D1 | **Endpoint shape.** One dashboard endpoint, or several (summary, breakdown, recent changes, requests summary, upcoming, without-adjustment)? Several allow per-section failure and lazy loading. Paths and `operationId`s are needed for the contract allowlist. |
| D2 | **As-of date.** Is the UTC business date returned with the figures? |
| D3 | **Top figures schema.** Counts by status; annual base and cash by native currency for `CURRENTLY_WORKING`; the upcoming approved commitment (exact definition: does it combine `SOON_TO_JOIN` compensation and approved future deltas or new amounts, per currency?); recent-change count; pending and stale request counts; without-adjustment count. Exact money strings with currency (like `AssistantMoney`)? |
| D4 | **Filter options.** Does the dashboard reuse `GET /api/v1/employee-directory/options`, or does it get its own permission-filtered options? Is the date-period option list published? |
| D5 | **Filter parameter names and validation.** Same names and enums as the directory (`department`, `country`, `currency`, `level`, `status`)? Names for `recentDays` and the no-adjustment period? Is repetition rejected with `400 VALIDATION_ERROR`? |
| D6 | **Filter applicability.** Does each section report which filters were applied and which were not, for example `appliedFilters` and `ignoredFilters` with reasons? The spec forbids silently ignoring a filter, and the UI must not hard-code the rules. |
| D7 | **Breakdown schema.** Per group and per currency: count, base, cash, average, median, minimum, maximum. Median rounding? Which metrics are "not meaningful" for which breakdowns (for example money for the `LEFT` status)? How is `group` labelled for country (code or name) and status (enum)? |
| D8 | **USD comparison.** Is the USD equivalent returned per figure and group as secondary data, with the `ExchangeRateContext` (rate, quote direction, source name and URL, effective date)? What does the response look like when the rate is missing: `null` fields plus a flag? |
| D9 | **Periods.** Allowed values for recent changes (7, 30, 90 days, confirmed) and for "without adjustment" (12 months default; which other values?). Are windows measured from the current time (as 08a recent changes) or from the business date? |
| D10 | **Lists.** Recent changes: the fields from spec (previous and new compensation, reason, `recordedAt`, effective date, HR actor display name, request ID when applicable); pagination or limit and total. Upcoming changes: fields, ordering, total. Without adjustment: fields including the last recorded change date, pagination shape, total. Request summary: oldest pending and recent stale with display names, or should the UI call `GET /api/v1/salary-adjustment-requests` itself (two calls)? |
| D11 | **Empty results.** For filters matching nothing, are counts zero with empty groups, or is there an explicit "no data" indicator? For an empty scope, does the backend return a distinct result (the UI must render no numbers at all)? |
| D12 | **Request links for Scoped HR.** Is the related request ID returned to Scoped HR in recent changes, given they can view in-scope requests? |
| D13 | **Errors and limits.** Public error codes for the analytics routes (expected `400`, `401`, `500`, `503`); any rate limit; expected latency for the median and without-adjustment queries, for the loading design. |
| D14 | **Test environment.** Can the backend run with a missing rate fixture (or a flag) so the missing-rate journey runs against the real API? Seed data with recorded changes, pending and stale requests, and future changes, so the activity sections are not empty in browser tests? |

## 19. Product questions (not API)

| # | Question | Default if unanswered |
|---|---|---|
| P1 | Should sign-in land on Dashboard instead of Employees? | Keep Employees (`docs_human/09`) |
| P2 | Navigation order | Dashboard, Employees, Salary requests, Assistant |
| P3 | Should Scoped HR get the related-request link on recent changes? | Yes, if the API returns it (they can view in-scope requests) |
| P4 | Should the directory gain a "no recorded adjustment" filter so the dashboard can link to the exact list? | No; the dashboard keeps its own paginated list |
| P5 | Should USD comparison be on by default anywhere? | Off by default; opt-in toggle |

## Confirm and stop

Following `shape.md`, this brief is returned for one confirmation or correction round, and work stops here.

**Not done:**
- no production code;
- no API types;
- no DESIGN.md or PRODUCT.md changes;
- no `.impeccable/` surface brief (outside my file ownership).

Task 04 implementation needs the analytics OpenAPI that answers section 18.

## Confirmations

- Only `builder_docs/frontend-builder/responses/04a-dashboard-shape.md` was written.
- No frontend or backend production files were modified.
- No Git command ran.
- No `.env` file was read.
- No analytics API types were invented. Field names are quoted from `docs_human/10-compensation-dashboard.md`, taken from the already published directory and request-list parameters, or asked as questions.
