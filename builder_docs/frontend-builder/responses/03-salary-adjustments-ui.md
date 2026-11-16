# Frontend Task 03 response: salary adjustment and approval UI

**Status:** implemented. Unit, component and browser tests pass on the final build. No backend files were modified, no Git commands were run, and no `.env` file was read.

Read before implementation: `docs_human/11-salary-adjustments.md`, `builder_docs/frontend-builder/responses/03a-salary-adjustments-shape.md`, `builder_docs/responses/09-salary-adjustments-backend.md`, this task file, `docs/20-frontend-architecture.md`, `DESIGN.md`, `PRODUCT.md`, and `express-backend/openapi/openapi.json`.

## 1. API contract generation

- `scripts/generate-api-contract.mjs` now allowlists 14 operations. The 7 new ones are `previewSalaryAdjustment`, `applySalaryAdjustment`, `submitSalaryAdjustmentRequest`, `listSalaryAdjustmentRequests`, `getSalaryAdjustmentRequest`, `approveSalaryAdjustmentRequest` and `cancelSalaryAdjustmentRequest`. MCP, health, openapi and the HR-access operations stay excluded.
- `npm run api:generate` wrote `src/generated/api-openapi.json` and `src/generated/api.ts`. Runtime validators in `src/server/api/contract.ts` are compiled from the generated schemas: `isSalaryAdjustmentPreview`, `isSalaryAdjustmentResult`, `isSalaryRequestResponse`, `isSalaryRequestApproval` and `isSalaryRequestList`. No API type was written by hand.
- **Idempotency fingerprint fix.** The contract was generated at the start of the task and checked again at the end. The final `npm run api:check` reported it stale, so I regenerated and diffed the old and new output. The only change is in the shared `ErrorResponse.error.code` enum, which gained `LAST_ACTIVE_ADMIN`, `EMAIL_TAKEN` and `INVALID_SCOPE`. The backend spec documents these only on HR-access operations, which the frontend does not call. No salary schema, path, header or response changed, which matches the claim that the fix does not change the public API. `tests/unit/api-contract.test.ts` was updated for the wider enum. The error validator is compiled from the schema, so it accepts the new codes with no other change.
- I cannot confirm that the backend process I tested against included the fingerprint fix. I ran the existing `express-backend/dist` build (`dist/src/server.js` modified Nov 16 19:52) and did not rebuild it, because that would mean touching backend output.

## 2. What was built

Every salary value shown comes from the backend. The frontend checks only input format before preview (`validateDraft`). It never computes a salary, a band result, eligibility or a permission.

| Requirement | Where |
|---|---|
| Role-correct action on employee detail | `app/employees/[employeeCode]/page.tsx`, `CompensationActions` section: Admin sees "Adjust compensation"; Scoped HR sees "Request compensation change". An ineligible employee gets a sentence instead of a link. If a request is pending, Scoped HR sees a notice with no action, and Admin sees a warning. |
| Target and method form | `adjust/adjustment-workspace.tsx`: target radios, five method radios (percentage methods are disabled when the bonus is zero), value with a label that depends on the method, effective date (minimum is today, UTC), reason, and note (required for Correction, at most 2,000 characters). |
| Exact preview panel | Before, After and Change for the changed value, plus annual cash compensation. Annual budget impact is shown once (see Impeccable). Effective date, adjustment, reason, note, the version the preview is based on, and its expiry time are also shown. |
| Salary band and future-change warning | A band sentence with range and currency; a warning when a future change will replace this one; a warning that a pending request will become out of date. |
| Admin direct confirmation | "Apply salary change" sends `{previewToken, adjustment}` with an `Idempotency-Key`. On success the page goes to `/employees/<code>?applied=<version>`, which shows a success notice and highlights the new history row. |
| Scoped HR request submission | "Submit for approval" uses the same flow, then goes to `/salary-requests/<id>?submitted=1`: "Request submitted. Status: Pending approval. No compensation has changed." |
| Request list for Scoped HR | `/salary-requests`: all requests visible to the user, with a scope sentence. A `department` filter is rejected as an invalid link, because the backend rejects it for Scoped HR. |
| Approval queue and request detail for Admin | The nav link opens `/salary-requests?status=PENDING&direction=asc`. Filters: search, status, department and order. Desktop shows a table; mobile shows a list. Detail is at `/salary-requests/[requestId]`. |
| Approve and cancel with a required note | `request-decision.tsx`: an inline confirmation step, not a modal. Cancelling requires a reason of at most 2,000 characters. Back returns focus to the button that opened the step. Each action reuses one idempotency key per attempt. |
| Stale conflict and fresh preview | On a 409 `STALE_VERSION`, the server action immediately requests a new preview. The UI shows "Compensation changed while you were reviewing" with the earlier result struck through and moves focus to that alert. It never confirms on its own. |
| Request status display | Pending approval (amber dot), Approved (green), Cancelled (grey), Out of date (grey). Words always appear with the dot. |
| History refresh after approval | The approved request links to the employee history; the new version appears in it (checked in the browser test as Rohan). |
| Navigation | "Salary Reviews – Coming later" is replaced by the live "Salary requests" link. `proxy.ts` protects `/salary-requests/:path*`. |

**Files** (all under `next-frontend/`):
- New: `src/lib/salary.ts`, `src/lib/salary-messages.ts`, `src/server/actions/salary.ts`, `src/components/salary/salary-ui.tsx`, `src/app/employees/[employeeCode]/adjust/{page.tsx,adjustment-workspace.tsx}`, `src/app/salary-requests/{page.tsx,request-controls.tsx}`, `src/app/salary-requests/[requestId]/{page.tsx,request-decision.tsx}`, `tests/support/salary-fixtures.ts`, `tests/unit/salary.test.ts`, `tests/component/salary.test.tsx`, `tests/e2e/salary.spec.ts`.
- Changed: `scripts/generate-api-contract.mjs`, `src/generated/*`, `src/server/api/{client.ts,contract.ts}`, `src/server/directory-query.ts`, `src/server/protected.ts` (`isAdmin` for presentation only), `src/proxy.ts`, `src/components/shell/app-shell.tsx`, `src/components/ui/native-select.tsx` (`wrapperClassName`), `src/app/employees/[employeeCode]/page.tsx`, `tests/unit/api-contract.test.ts`.
- Docs: `DESIGN.md` (warning and success washes, change record, adjust page, superseded result, request status, inline confirmation); `PRODUCT.md` (capabilities).

**Security and data handling**
- Salary calls go from the browser to a Next server action and then to Express. The JWT stays in the HttpOnly cookie, and the idempotency key is created by the server action's caller and sent only as a header. A browser test checks that neither the JWT nor storage entries appear in page HTML or in `localStorage`/`sessionStorage`.
- `fail()` logs only the operation, the error kind, the status and the optional `reason`. It never logs bodies, salary values, tokens or notes.
- Inputs are checked at the action boundary: employee code `^ACME[0-9]{5}$`, request ID UUID, and idempotency key `^[A-Za-z0-9_-]{16,128}$`. Return paths go through `safeReturnPath` with an allowlist.
- Notes render as text. The browser test types `<script>alert(1)</script>` into a note and checks it appears literally.

## 3. Design (Impeccable)

`impeccable context` ran with the adjust workspace as target and loaded PRODUCT.md and DESIGN.md. This is an Operate surface, so I kept the existing system: no new colours, fonts or components beyond what the salary journeys needed.

Concrete effects, each tied to a check:

| Pass | Finding | Change |
|---|---|---|
| shape (03a) | Modals hide context during a consequential review. | The adjust flow is a full page with form and preview side by side; approve and cancel confirm inline. |
| critique (rendered stale screenshot) | After a stale conflict, the "Current compensation" strip still said version 1 next to a preview based on version 2. | The STALE handler calls `router.refresh()`. The page has no `key`, so the draft and fresh preview survive. The browser test now asserts the strip says "version 2". |
| critique | "Earlier preview (version 1): Annual base salary INR …" did not say what was struck through or why. | Copy changed to "Earlier result (based on version 1), no longer valid: ~~new annual base salary INR …~~". |
| critique / detector `repeated-container-text` | `annualCashImpact` appeared twice in the cash row: in the Change column and in the "Annual budget impact" line. | The cash row now shows Before and After only; the budget impact is shown once under its spec name. |
| polish | The chevron on the Reason select sat outside the narrow select. | Added `NativeSelect` `wrapperClassName`; the wrapper now carries `max-w-xs`. |
| detector `tight-leading` (rendered `/salary-requests`) | The long search label inherits `leading-none` from `Label` and wraps on mobile. | Added `leading-snug` on that label; the finding is gone on rescan. |
| harden / audit | The queue screenshot and its axe scan ran on the loading skeleton. | The test waits for a visible row before axe and the screenshot. |
| adapt | Mobile check at 390px: the change record becomes label/value rows, actions go full width, and nothing scrolls sideways. | Covered by `expectNoOverflowOrSeriousA11y` on each mobile salary screen. |

**Detector results**
- Source (`detect --json` on `src/app/salary-requests`, `src/app/employees`, `src/components/salary`, `src/components/shell`): `[]`.
- Rendered HTML for adjust preview, request list and request detail, saved from a signed-in production build: after the fixes above, the remaining findings are:
  - `cream-palette`: kept. The brief pins the warm off-white ground, and DESIGN.md already records this.
  - `cramped-padding` on `<dl>` and `border-t` elements: kept. These are the ruled-record pattern (a hairline with text 8–12px below it). The screenshots show the inset, and the rule flags the parent element, which carries no padding while its children do.
  - `cramped-padding` on the preview `<section>` and the mobile request `<ul>`: kept. The children carry `px-4`, so the text is inset 16px (visible in `adjust-preview-*.png` and `queue-mobile.png`).
  - `repeated-container-text` for "plus": kept. It is screen-reader text for the sign on separate amounts.

## 4. Tests that ran

All results are from this session.

| Command | Result |
|---|---|
| `npm run api:check` | Stale at the end (shared error enum, see §1). Regenerated, then "Generated API contract is current." |
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. 11 files, **152 tests passed**. This includes `tests/unit/salary.test.ts` (32) and `tests/component/salary.test.tsx` (12). |
| `npm run build` | Exit 0. |
| `npm audit --omit=dev` | 0 vulnerabilities. |
| `E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD=… npx playwright test` (full suite, freshly reseeded database, final build) | **64 passed, 4 skipped**. All 16 salary journeys pass, 8 per project. The 4 skips are pre-existing project-specific tests (mobile-only on desktop or the reverse). |

**Browser journeys** in `tests/e2e/salary.spec.ts`, desktop 1440×900 and mobile 390×844. Each includes an overflow check and an axe check (serious or critical findings fail the test).
1. Admin previews +5% and applies it; history shows version 2.
2. Scoped HR uses the keyboard: preview, focus lands on the preview heading, submit. Status is Pending approval, there are no approve or cancel buttons, and compensation is unchanged.
3. Admin finds the request in the queue and approves it with the inline step. Rohan then sees Approved and the new history row.
4. Admin cancels; an empty reason is rejected with a described error; then the cancellation succeeds with a reason, and compensation is unchanged.
5. Stale conflict between two Admin sessions: the alert takes focus, the old result is struck through, the current strip shows version 2, and the page applies version 3 only after a second click.
6. A direct change makes a pending request Out of date, and it can no longer be approved.
7. A left employee is ineligible on detail and on adjust; an out-of-scope or unknown employee shows "Employee not found"; a Scoped HR `department` filter is reported as invalid.
8. The JWT is not in page HTML, and browser storage is empty.

**Failures during the session and their fixes**
- Keyboard journey: pressing ArrowDown on a closed native select on macOS Chromium opens the OS menu instead of changing the value, so validation failed. The test now uses `selectOption` for Reason and keeps keyboard focus and Enter for everything else.
- Mobile approve journey: the Menu was clicked before the streamed shell replaced the skeleton. The test now waits for the identity region and network idle, the same way `assistant.spec.ts` does.

**Evidence** in `builder_docs/frontend-builder/responses/03-salary-evidence/`, desktop and mobile for each: `adjust-preview-*`, `request-submitted-*`, `queue-*`, `approve-confirm-*`, `approved-*`, `cancelled-*`, `stale-*`, `request-out-of-date-*`. The `round1-*` files are earlier captures made before the critique fixes.

## 5. Environment and exact commands

- MySQL 8 container `acme-frontend-e2e-mysql` on port 3318, migrated through 003, seeded with `APP_ENV=test DATABASE_URL=… npm run db:seed -- --replace` in `express-backend`.
- Backend: `env -u OPENAI_API_KEY DATABASE_URL=… JWT_SIGNING_KEY=<synthetic test value> PORT=3901 CLIENT_IP_SOURCE=socket node dist/src/server.js`.
- The database was reseeded and the backend restarted before every full run, because the journeys change compensation and the backend rate limiter holds state.
- Rendered-page detector run: Playwright signed in on `next start -p 3900`, saved the HTML to `/tmp`, rewrote `/_next/` paths to relative ones, copied `.next/static`, then ran `impeccable detect --json`.
- Cleanup: servers stopped, `acme-frontend-e2e-mysql` removed (`docker ps -a` no longer lists it), `next-frontend/test-results` and the `/tmp` files deleted. The other containers (`acme-take-home-mysql`, `acme-mysql`) and the `next start -p 3000` process were not started by me and were left alone.

## 6. Limitations

- The mobile Menu (`<details>`) stays open after navigating within the same layout. This existed before this task.
- The pending-request check on detail and adjust uses `listSalaryAdjustmentRequests({q: code, status: PENDING, pageSize: 1})`, so it depends on search matching the exact employee code. The backend has no per-employee pending lookup.
- `todayUtc`, the effective-date minimum, comes from the Next server clock. The backend still makes the final date check.
- The "behind" warning on a pending request comes from comparing `requestedAgainstVersion` with the employee's latest history version. It is advisory; the backend decides staleness on approval.
- For an out-of-date request, the Record does not say when it became out of date. STALE has no decider (backend 09 response), and the page shows `decidedAt` only next to a decider. The stale reason in `decisionNote` is shown in the out-of-date notice.
- Directory search labels elsewhere still use `leading-none` from `Label`. They were left alone because they are outside this task.
- Not built (scope limits): bulk review cycles, retroactive changes, currency changes, agent-run salary mutation, dashboard, HR access UI, AI trace UI.

## 7. Confirmations

- No files under `express-backend/` were modified. I read them, ran the seed script and ran the built server.
- No Git commands were run.
- No `.env` file was read; all values were passed on the command line as synthetic test values.
- Impeccable hooks and live mode stayed off.
