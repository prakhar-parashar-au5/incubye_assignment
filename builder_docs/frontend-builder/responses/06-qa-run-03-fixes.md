# Frontend Task 06: QA run 03 fixes

Status: Implemented. D1 to D5 are fixed. `npm run api:check`, `npm run check` (298 unit and component tests) and `npm run build` pass. The full real-backend Playwright suite passes in the isolated lane: 129 passed, 9 skipped, 0 failed.
Workspace: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_fixes`
Source report: `/Users/admin/Desktop/Projects/incubyte_take_home_qa_run/tester_docs/responses/03-master-regression-computer-use.md` and `tester_docs/evidence/03-master-regression/observations.md` (read only).

## Root causes and fixes

### D1: sort could not switch to descending

**Cause.** The parser and the serializer used different default directions. A header link for Name wrote `sort=name&direction=asc`. On the next render, the toggle compared against a default that did not match, so the second click produced ascending again. I reproduced this in the browser before the fix: the first click gave `?sort=name&direction=asc`, and the second click still showed `aria-sort="ascending"`.

**Fix.** `defaultHrDirection(sort)` in `src/lib/hr-access.ts` returns `desc` for `updatedAt` and `asc` for `name` and `email`. The parser, `hrAccessSearch`, the desktop header links and the mobile sheet all use it. Default values are left out of the URL, so Name ascending is `?sort=name` and Name descending is `?sort=name&direction=desc`.

### D2: disabled Previous and Next were links

**Cause.** On the HR Access list, Previous and Next always rendered `<Link>`. Before the fix, the browser showed Next as `A /hr-access?page=2` on a one-page list.

**Fix.** A local `PageLink` renders `<span aria-disabled="true">` with no href when there is no page to go to.

Other paginated lists I checked:

| List | Result |
|---|---|
| Salary requests | Already a span with `aria-disabled`. Unchanged. |
| Employee directory | Already a span with `aria-disabled`. Unchanged. |
| Dashboard lists | Already a span with `aria-disabled`. Unchanged. |
| AI traces and MCP calls (shared `Pagination`) | Returns nothing for a single page and uses `<span />` placeholders for the missing step. Unchanged. |
| Assistant conversation list | Same pattern as `Pagination`. Unchanged. |
| HR user detail, access history | Already spans. Unchanged. |

Only the HR Access list changed.

### D3: search and filters showed "The compensation service is not responding"

**Cause, confirmed in the browser before the fix.**
- Searching for "Rohan Mehta" submitted `/hr-access?q=Rohan+Mehta&sort=updatedAt&direction=desc&pageSize=25&role=&status=ACTIVE&country=&department=`.
- Choosing role ADMIN submitted `q=&...role=ADMIN...&country=&department=`.
- The parser treated the blank values (`role=`, `country=`, `department=`, `q=`) as values outside the enums. Those failed validation and fell through to the generic `ServiceUnavailable`, whose default wording is about compensation.
- I did not see repeated keys in any submitted URL. They are handled anyway; see below.

**Fix.**
- **Blank values.** The parser now treats blank values as not set, as the employee directory does.
- **Search length.** `q` is limited to 100 characters, which is the contract's `maxLength`. The old check allowed 254.
- **Search form.** The form is a new client component, `hr-access-search-form.tsx`. On submit it builds the URL with `hrAccessFormQuery` and `hrAccessSearch`:
  - each key appears once;
  - blank fields are dropped;
  - the page resets to 1;
  - sort, direction and page size are kept, but only when they are not the defaults.
  - Without JavaScript, the plain GET form still works because the parser accepts blank values.
- **Stale hidden fields (found during the fix).** The form is keyed by the list state. Without the key, the hidden desktop selects on mobile kept their first `defaultValue`, because a select does not follow a changed `defaultValue`. A mobile search after a sheet filter would then have cleared that filter. The mobile Playwright test covers this case.
- **Invalid links.** An invalid link, such as `?role=CEO`, an unknown key or a repeated key, now shows an "These filters could not be applied" alert with Clear filters (to `/hr-access`), as the AI traces list does. It makes no backend request. A backend `VALIDATION_ERROR` shows the same alert.
- **Outage wording.** `ServiceUnavailable` takes a `service` prop. Every HR Access page passes `HR_ACCESS_SERVICE` ("HR Access"): the list, `new`, `[hrUserId]` and `[hrUserId]/[operation]`. Other pages keep the compensation wording. Try again on the list keeps the search and filters.
- **Scoped HR.** Scoped HR still sees the Forbidden state, now checked before the invalid-filter alert. This is a `listHrUsers` call with `pageSize: 1`, and the backend still answers 403. Without this check, a Scoped HR user opening an invalid link would have seen the HR Access header and the invalid-filter alert instead of the Forbidden state.

### D4: create and change forms kept their old state on a later visit

**Cause.** With `cacheComponents`, React Activity hides a visited route instead of unmounting it, so `useState` survives client navigation. After create, then Done, then the list, then Add HR user, the form showed the old draft or the "Create HR user complete" view. A negative check confirmed this: with the fix disabled, the new Playwright test fails with `Expected: ""`, `Received: "QA Reset HR"` on desktop and mobile.

**Fix.** I used the same approach as Task 02a in `assistant-chat.tsx`. In `HrAccessWorkspace`:
- A `useLayoutEffect` cleanup runs whenever the route is hidden. It resets every piece of state: draft, preview, preview state, idempotency key, busy, error, current, saved, credential, copied and password reveal. The draft resets to the latest `user` prop.
- A generation ref drops preview or confirm results that arrive after the route was hidden.
- `leaveCredential` also clears `saved` and the reveal flag, so the "complete" view never shows after Done.

The one workspace serves create, profile name, scope, promote, deactivate, reactivate and regenerate, so the reset covers all of them. The one-time password is still removed when you leave, and it is now also removed when the route is hidden by any navigation.

One trade-off: if a confirm succeeds after the person has already navigated away, its result is dropped, which includes a new temporary password. The existing recovery path handles this. The detail page shows the change, and Regenerate temporary password issues a new password. I chose this over showing a one-time password on a page the person has already left.

### D5: the AI trace detail heading repeated its prefix

**Cause.** The `<h2>` was `Trace {shortId}` with the full trace ID inside it. `shortId` is the first 8 characters of the ID, so the prefix was read twice.

**Fix.** The heading is now just `Trace {shortId}`. The full ID moved to a separate line below it: "Trace ID …", marked `translate="no"`. The existing check in `ai-monitoring.spec.ts` for a level-2 heading matching `/^Trace /` still passes.

## Files changed

All under `next-frontend/`:
- `src/lib/hr-access.ts`: `defaultHrDirection`, blank-value parsing, the `q` limit, default-free `hrAccessSearch`, `hrAccessFormQuery` and `HR_ACCESS_SERVICE`.
- `src/app/hr-access/hr-access-search-form.tsx` (new): the client search and filter form.
- `src/app/hr-access/page.tsx`: the search form, `InvalidFilters`, `PageLink`, the shared direction rule, the Scoped HR pre-check, a retry link that keeps the query, and named regions for the table and the mobile list.
- `src/app/hr-access/hr-access-mobile-filters.tsx`: uses `defaultHrDirection`.
- `src/app/hr-access/hr-access-workspace.tsx`: the D4 reset and generation guard.
- `src/app/hr-access/new/page.tsx`, `src/app/hr-access/[hrUserId]/page.tsx`, `src/app/hr-access/[hrUserId]/[operation]/page.tsx`: `service={HR_ACCESS_SERVICE}`.
- `src/components/shell/page-states.tsx`: the `ServiceUnavailable` `service` prop. The default wording is unchanged.
- `src/app/admin/ai-traces/[traceId]/page.tsx`: the D5 heading.
- Tests: `tests/unit/hr-access.test.ts`, `tests/component/hr-access-workspace.test.tsx`, `tests/component/page-states.test.tsx` (new) and `tests/e2e/hr-access.spec.ts`.

## Tests added

**Unit tests, `tests/unit/hr-access.test.ts`:**
- **D1 round trip.** For every sort (`updatedAt`, `name`, `email`) in both directions, serialize then parse, and parse then serialize, give the same result.
- **Default rule.** The default direction for each sort, and the exact URL strings for default and non-default directions.
- **D3 URL handling:**
  - The exact URL QA submitted parses with no invalid keys and serializes to `?q=Rohan+Mehta`.
  - A `q` of 100 characters is accepted and 101 is rejected.
  - `hrAccessFormQuery` clears blanks, resets the page, keeps sort and direction, and writes each key once.
  - Fields the form does not carry are kept.
- Existing assertions are unchanged and still pass. The repeated-key test still reports `['role','unexpected','country','page']`.

**Component tests:**
- **Workspace, Activity hidden then visible (create).** After a create that shows the temporary password, hiding and showing the route gives a blank form: no password, no "complete" text, nothing checked.
- **Workspace, late preview.** A preview that resolves while the route is hidden is dropped.
- **Workspace, regenerate.** The reason field is blank on the next visit.
- I disabled the cleanup to check that the workspace tests depend on it. Both fail without it.
- **`page-states.test.tsx`.** The HR Access outage text is "HR Access is not responding" and does not mention compensation. Other pages keep the default wording.

**Playwright, `tests/e2e/hr-access.spec.ts`, desktop and mobile:**
- **D1.**
  - Desktop: clicking Name gives ascending, a second click gives descending with `direction=desc` in the URL, and a third click gives ascending again.
  - Mobile: choose Name and Descending in the sheet, apply, and reopen the sheet. Order still shows `desc`.
  - Both check that the rendered names are in descending order.
- **D2.**
  - With `?status=ALL&pageSize=100` (page 1 of 1), the page navigation has no `<a>`, and both steps have `aria-disabled="true"`.
  - With `pageSize=1`, Previous is not a link and Next links to page 2.
- **D3:**
  - The "Rohan Mehta" search returns the Rohan row with a clean URL and no "not responding" message.
  - Role ADMIN (desktop form, mobile sheet) returns Meera and not Rohan.
  - Mobile: a search after a sheet filter keeps `role=ADMIN`.
  - `?role=CEO` shows "These filters could not be applied" and no outage text, and Clear filters returns the list. Axe finds no serious or critical issues.
- **D4.**
  - Create, Done, "← HR Access" and Add HR user leaves a blank name and email, with no "complete" heading and no password panel.
  - Regenerate, Done, then Regenerate again leaves a blank reason, with no password panel or password value anywhere in the DOM.
  - This test uses only client navigation, because a reload would discard the hidden route. With the fix disabled, it fails on both projects.

## Commands and results

Run from `next-frontend/`:

| Command | Result |
|---|---|
| `npm run api:check` | Generated API contract is current. |
| `npm run check` (api:check, eslint, typecheck, vitest) | Passed. 18 files, 298 tests. |
| `npm run build` | Passed. |
| `npx playwright test tests/e2e/hr-access.spec.ts` (lane env) | 10 passed. |
| `npm run test:e2e` (full, lane env, freshly reseeded database) | 129 passed, 9 skipped, 0 failed (5.7 minutes). |

Lane environment for the e2e runs:
- `E2E_API_BASE_URL=http://127.0.0.1:4225`
- `E2E_DEMO_PASSWORD=<elided>`
- `E2E_MYSQL_CONTAINER=acme-hr-access-e2e-mysql`
- `E2E_DATABASE_URL=<lane MySQL on 127.0.0.1:3325, elided>`

The backend was this worktree's built `express-backend/dist`, with a random lane-only JWT key and no OpenAI key. The database was MySQL 8 on tmpfs, migrated through 008 and seeded with 10,000 employees.

The 9 skips are existing conditional skips in other specs. They are project-specific or need the optional no-rate backend (`E2E_NO_RATE_API_BASE_URL`), which was not set. Examples: the dashboard missing-rate test and mobile-only or desktop-only layout checks in the directory, auth, AI monitoring and dashboard specs. No HR Access test was skipped.

**Teardown.** I stopped the lane backend, all `next start -p 39xx` servers, the failing proxy and the fake assistant backend. I removed the MySQL container, `next-frontend/test-results` and `/tmp/hrfix-*`. Ports 3325, 4225 and 3900 to 3909 are free. I did not touch ports 3224, 4224, 3324, 3228, 4228, 3328 or 3317.

## Not fixed or not verified

- The D4 Playwright regression covers create and regenerate, as the task asked. Scope, promote, deactivate, reactivate and name use the same component and the same reset, but they have no browser regression of their own.
- The D5 heading was checked by the existing AI monitoring e2e and by reading the code. No new test asserts the "Trace ID" line.

## Follow-up: filter arrow position (user report, 2026-11-17)

Prakhar reported from a screenshot that, on the desktop HR Access list, the dropdown arrow in the Role, Status, Country scope and Department scope filters touched the right border of its box.

**Cause.** Those four filters were plain `<select>` elements with `px-3` padding. The browser's own arrow sits at the right edge, with no padding before the border.

**Fix.** In `next-frontend/src/app/hr-access/hr-access-search-form.tsx`, the four filters now use the shared `NativeSelect` (`src/components/ui/native-select.tsx`), which the mobile filter sheet already uses.
- `NativeSelect` hides the browser arrow (`appearance-none`).
- It draws a `ChevronDown` 12px (`right-3`) in from the right edge.
- It reserves `pr-9` so the option text never runs under the chevron.
- Each filter is wrapped with `wrapperClassName="mt-1"`, which keeps the old gap under the label, and gets `className="font-normal"`, so the option text does not pick up the label's `font-medium`.
- The field names (`role`, `status`, `country`, `department`) and `defaultValue`s are unchanged, so form submission and the D3 URL handling behave as before.
- I renamed the local `selectClass` constant to `inputClass`, because only the search input uses it now.

**Checks.** `eslint` on the file, `tsc --noEmit`, and `vitest run` (298 passed) all pass.

**Not verified.** I have not seen the new arrow rendered. The lane was already torn down, so I did not rebuild or rerun the HR Access Playwright spec. The D3 desktop test selects the Role filter by its label, and the label text is unchanged, so I expect it to keep passing. To confirm, run `tests/e2e/hr-access.spec.ts` in the lane and look at `/hr-access` at 1440px.

## Confirmations

- No Git commands were run and nothing was committed.
- No `.env` file was read or written.
- No backend files or `docs_human` files were changed. The backend was only built and run inside the lane.
