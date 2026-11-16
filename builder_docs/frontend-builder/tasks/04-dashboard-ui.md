# Frontend Task 04: compensation dashboard UI

**Status:** READY

## Goal

Implement the permission-aware compensation dashboard from the approved human specification, completed shape brief, and generated backend contract.

The dashboard must let Admin and Scoped HR understand current headcount, native-currency compensation commitments, concentration, recent activity, and work needing attention within ten seconds.

## Read first

```text
docs_human/10-compensation-dashboard.md
builder_docs/frontend-builder/responses/04a-dashboard-shape.md
builder_docs/responses/10-dashboard-analytics-api.md
docs/20-frontend-architecture.md
DESIGN.md
PRODUCT.md
express-backend/openapi/openapi.json
```

This repository uses Next.js 16.4.6 with Cache Components and Partial Prefetching. Before writing code, read the relevant installed guides under:

```text
next-frontend/node_modules/next/dist/docs/
```

At minimum, read the current guidance for Server and Client boundaries, data fetching, caching, navigation, forms where used, and authentication. Do not rely on remembered Next.js behavior.

Use the installed Impeccable guidance for implementation, critique, responsive adaptation, hardening, accessibility audit, and polish. Keep the existing product world; do not redesign unrelated pages.

## Backend dependency

Backend Task 11b is correcting one dashboard value: a later approved future adjustment for a `SOON_TO_JOIN` employee must contribute its signed impact to upcoming commitment.

This correction does not change the dashboard response schema. You may implement against the current OpenAPI, but final browser evidence and acceptance must use the corrected backend build.

## API contract

Add these operation IDs to the frontend contract allowlist and regenerate, rather than hand-writing response types:

```text
getDashboardSummary
getDashboardBreakdown
getDashboardRecentChanges
getDashboardWithoutRecentAdjustment
```

Reuse the existing permission-filtered directory-options operation.

Add runtime response validators generated from the selected OpenAPI schemas. No `unknown as` casts, duplicated handwritten API interfaces, or permissive unchecked JSON.

## Route and navigation

Add:

```text
/dashboard
```

Protect it with the existing proxy/session design.

Replace the Dashboard “Coming later” item with a real navigation link. Keep sign-in landing on Employees.

Extend safe return paths so employee detail can return to the exact filtered dashboard URL without accepting an open redirect.

## URL state and filters

Support:

- Department.
- Country.
- Currency.
- Level.
- Employment status.
- Recent-change period: 7, 30, or 90 days.
- Without-adjustment period: 3, 6, 12, or 24 months.
- Selected breakdown: department, country, currency, level, or employment status.
- Without-adjustment page.
- Optional USD-comparison display.

Keep state in the URL. Validate every value before making analytics requests. Invalid links show the approved invalid-filter state and make no dashboard API call.

Use frontend URL names that remain consistent with existing UI terminology, and map explicitly to backend names where they differ:

```text
status      -> employmentStatus
recentDays  -> periodDays
```

Changing a global filter resets list pagination.

Use only filter options returned for the authenticated user's current scope.

## First viewport

Follow the approved 04a shape. Do not build a wall of cards or a single oversized hero metric.

Show:

1. Scope and UTC as-of date.
2. Headcount line: currently working, soon to join, and left.
3. Commitment ledger with one row per native currency:
   - Current annual base salary.
   - Current annual cash compensation.
   - Upcoming approved commitment.
4. Needs-attention list:
   - Pending requests.
   - Out-of-date requests.
   - Recent recorded changes.
   - Upcoming approved changes.
   - Employees without a recorded adjustment.

Every actionable count links to the existing employee, request, or activity workflow. The dashboard itself performs no mutation.

## Currency and USD rules

- Never add INR and USD as native values.
- Every money value displays its currency code.
- Use backend exact decimal strings; do not recalculate authoritative compensation.
- Native values remain primary.
- USD comparison is optional and informational.
- The USD disclosure must show rate, direction, source name, source link, effective date, and disclaimer.
- The disclosure must work with mouse, keyboard, touch, and screen readers; it cannot be hover-only.
- If the rate is unavailable, keep native data and show the approved explanation. Remove or disable only USD comparison.

## Breakdowns

Implement one selected breakdown at a time:

```text
DEPARTMENT
COUNTRY
CURRENCY
LEVEL
EMPLOYMENT_STATUS
```

For each backend group, show meaningful values:

- Employee count.
- Annual base salary.
- Annual cash compensation.
- Average, median, minimum, and maximum annual cash compensation.
- Basis and any filter-not-applied explanation.

Use the 04a accessible CSS-bar approach only for:

- Annual cash by department, separated by native currency.
- Employee count by employment status.

Exact values remain visible as text. Do not add a chart library, canvas-only chart, pie, or donut.

## Activity and attention sections

### Recent recorded changes

- Default 30 days; support 7 and 90.
- Use the backend's `recordedAt` semantics.
- Say “recorded”, not “effective”, for the period.
- Show previous and new compensation, native currency, reason, recorded time, effective date, actor, employee link, and request link when available.
- Show future-effective status accurately.
- Use the approved empty message.

### Pending and stale requests

- Show counts in the first viewport.
- Link Admin to the existing approval queue.
- Link Scoped HR only to requests the backend permits.
- Do not add approve or cancel controls to the dashboard.
- Never carry unsupported global filters silently into the request list; explain when only department/status can be preserved.

### Upcoming changes

Show the backend's bounded soonest list with employee, native before/scheduled compensation, effective date, reason, approver, and links.

Display the backend commitment definition. Do not derive or repair commitment totals in the browser.

### Without recent adjustment

- Default 12 months; support 3, 6, and 24.
- Show total and paginated list.
- Use the exact approved statement: `No recorded salary adjustment since import or during the selected period.`
- Never claim the employee has never received an adjustment.

## Scope and partial failure

Admin sees all permitted data. Scoped HR sees only current country-and-department scope.

An empty-scope user sees only the approved no-access state. Do not display hidden counts as zeros or render hidden filter options.

Render independently requested dashboard sections so one failed endpoint does not erase correct sections. A failed section shows no stale or fabricated value and gives a bounded retry path.

Do not add caching without measurement. Follow the installed Next.js cache guidance explicitly so authenticated data is never shared across users or scopes.

## Responsive and accessibility requirements

Test desktop around 1440×900 and mobile around 390×844.

Required:

- No page-level horizontal overflow.
- Native money remains readable and does not wrap ambiguously.
- Keyboard-operable filters, breakdown tabs, disclosures, links, and pagination.
- Correct tab semantics and arrow-key behavior if tabs are used.
- Visible focus.
- Text labels in addition to color.
- Accessible loading status.
- Focus or announcement after filter and pagination updates.
- 200% zoom remains usable.
- Axe has no serious or critical findings on each major dashboard state.

## Tests

### Unit and component tests

Cover at least:

- URL parsing, defaults, invalid values, mapping, and pagination reset.
- Separate native-currency rows and absence of a combined native total.
- USD disclosure with rate present and absent.
- Breakdown selection and keyboard behavior.
- Exact backend values rendered without frontend salary calculation.
- Filter-not-applied explanations.
- Empty scope, no matches, empty activity, partial failure, invalid link, and unavailable states.
- Safe dashboard return paths.
- Accessible CSS-bar scaling as presentation only.

### Browser tests against corrected backend

Create required activity through the existing browser workflows in the isolated E2E environment. Do not modify backend production code or the normal seed merely to make dashboard screenshots interesting.

Cover Admin and Scoped HR:

1. First-viewport figures, scope, and separate INR/USD rows.
2. Scoped options and aggregates reveal no out-of-scope identity, count, or salary.
3. Empty scope shows no figures.
4. Global filters update compatible sections and URL state.
5. A not-applicable employment-status filter is explained.
6. Keyboard breakdown switching and exact-value bars.
7. USD disclosure and missing-rate state where the test environment supports it.
8. Recent change created through salary UI appears as recorded activity.
9. Pending request created through Scoped salary UI increments Admin attention and links to the queue.
10. Approved future change appears in upcoming commitment and list.
11. Without-adjustment count agrees with the list total and pagination.
12. Invalid URL performs no analytics call.
13. Partial endpoint failure does not hide healthy sections.
14. Mobile, keyboard-only, zoom, overflow, and axe checks.

Record any browser scenario that cannot run and why. Do not fabricate missing-rate or partial-failure evidence.

## Existing behavior protection

Keep sign-in, directory, employee detail, assistant, salary preview, direct apply, requests, approval, cancellation, and stale-conflict behavior unchanged.

Run:

```text
cd next-frontend
npm run check
npm run build
npm run test:e2e
```

Final E2E runs must use the corrected Backend Task 11b build and an isolated synthetic database.

## Scope limits

Do not implement:

- HR-access frontend.
- AI trace frontend.
- Dashboard mutations.
- New backend endpoints.
- Stored converted salary.
- Native mixed-currency totals.
- New chart dependency.
- Cache layer.
- Unrelated redesign.

Do not modify `express-backend/**` or `docs_human/**`.

Never read or create `.env`. Never run Git commands. Do not commit or push.

## Response

Write:

```text
builder_docs/frontend-builder/responses/04-dashboard-ui.md
```

Include:

- Files changed.
- Contract operations added.
- Server/client and cache decisions tied to installed Next.js 16 documentation.
- Desktop and mobile implementation decisions.
- Exact tests and results.
- Browser journeys and evidence paths.
- Any scenario not run and why.
- Known limitations.
- Confirmation that no backend, HR-access UI, `.env`, Git, commit, or push action occurred.

Stop after dashboard implementation.