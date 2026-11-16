# Frontend Task 03b response: salary workflow review fixes

**Status:** both review findings fixed. `npm run check`, `npm run build` and `npm run test:e2e` pass. No backend file was modified, no `.env` file was read, and no Git command was run.

Read: `docs_human/11-salary-adjustments.md`, Task 03 and its response, `semantic-review/2026-11-16-200222-pr-frontend-03.md`, and the installed Next.js 16 `useRouter` documentation (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`) for `router.refresh()`.

I checked both findings against the code before changing anything. Both were accurate:
- `salary-requests/[requestId]/page.tsx` fetched `getEmployee` but used it only for the latest version.
- The `applied`, `submitted` and `decided` query values switched on first-person success copy.

## 1. Full current compensation before Admin approval

- New `CompensationSnapshot` in `src/components/salary/salary-ui.tsx` renders the backend's `SelectedCompensation` from the employee detail response the page already fetches. It shows:
  - annual base salary, annual bonus and annual cash compensation;
  - the native currency, as a code on every amount plus the line "Amounts are in INR, the employee's native currency";
  - the compensation version and effective date;
  - the state as text with a dot. The heading follows the state: Current, Upcoming or Last recorded compensation, using the existing `CompensationStateLabel`.
- The request detail order is now: status, outcome notice, stale or behind warnings (unchanged), **current compensation**, requested change (the exact before and after for the changed target, plus adjustment, effective date, reason, note and requested-against version, unchanged), record, then the Decision panel.
- The browser calculates nothing. Every value is a backend string formatted for display.
- If the employee record cannot be loaded, the page says so with a Reload link. **Admin then gets no decision controls**, so a decision is never made without this context. This is the only behaviour change on that error path; the backend still checks everything on approval.

## 2. Query parameters are no longer proof of a completed action

I chose the first approach the task allowed: truthful copy based on persisted state. There is no cookie, no marker, nothing new in the URL, and no browser storage.

| Before | After |
|---|---|
| `/salary-requests/<id>?submitted=1` showed "Request submitted…" | Submission goes to `/salary-requests/<id>`. A `RequestOutcomeNotice` built only from the persisted request says "Pending approval since 16 Nov 2026, 15:11 UTC. Compensation has not changed. An Admin HR user will approve or cancel this request." The duplicate Scoped HR sentence under the request was removed. |
| Approve/cancel did `router.replace(...?decided=approved\|cancelled)` and showed "Request approved…" / "Request cancelled…" | `RequestDecision` calls `router.refresh()`, so the page is re-read from the backend in place. The notice comes from the record: "Approved by Meera Iyer on … Compensation version 2 was created. View compensation history" or "Cancelled by Meera Iyer on … Compensation did not change." |
| `/employees/<code>?applied=N` showed a green "Salary change applied…" | `applied` is now only a highlight hint for an existing history row. A neutral info notice says "Compensation version N is highlighted in the history: Performance, effective 16 Nov 2026." Nothing appears if version N is not in the history. |

The request page no longer reads `submitted` or `decided` at all. `RequestOutcomeNotice` takes no URL input, so a crafted link can only show what the backend records, in the same words for every visitor.

The regression checks still hold:
- **Admin direct apply** still names the resulting version and highlights its row.
- **Scoped HR submission** lands on the request showing Pending approval and "Compensation has not changed."
- **Approval and cancellation** refresh the status, the outcome notice, the snapshot (it moves to version 2 after approval) and the history link.
- **Stale preview** still needs a second manual click.

## Files changed

All under `next-frontend/` unless noted:
- `src/components/salary/salary-ui.tsx`: added `CompensationSnapshot` and `RequestOutcomeNotice`.
- `src/app/salary-requests/[requestId]/page.tsx`: renders the snapshot; removed the query-based `Notices`; reads only `from`; hides decisions when compensation is unavailable.
- `src/app/salary-requests/[requestId]/request-decision.tsx`: `router.refresh()` instead of `router.replace(?decided=…)`.
- `src/app/employees/[employeeCode]/adjust/adjustment-workspace.tsx`: submission goes to the request without `?submitted=1`; added a comment that `applied` is a highlight hint only.
- `src/app/employees/[employeeCode]/page.tsx`: neutral highlight notice in place of "Salary change applied".
- `tests/support/salary-fixtures.ts`: added `selectedCompensation()`, typed against the generated contract.
- `tests/component/salary.test.tsx`: decision tests now expect `refresh()` and no `replace`/`push`. Added `CompensationSnapshot` tests (all values, currency, version, state; upcoming heading) and `RequestOutcomeNotice` tests (pending, approved, cancelled and stale wording; no first-person claim).
- `tests/e2e/salary.spec.ts`: updated journeys and added the crafted-URL test (below).
- `DESIGN.md` (repository root): request-detail order, outcome-notice rule, success-wash wording.
- `builder_docs/frontend-builder/responses/03b-salary-evidence/`: screenshots.

## Tests run

| Command | Result |
|---|---|
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. "Generated API contract is current." 11 files, **157 tests passed** (152 before; 5 new component tests). |
| `npm run build` | Exit 0. |
| `E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD=… npm run test:e2e` (freshly reseeded) | Exit 0. **66 passed, 4 skipped.** The 4 skips are the existing project-specific tests. All 18 salary journeys pass (9 per project). |
| `npm audit --omit=dev` | 0 vulnerabilities. |

Failures along the way, both in the new tests:
- My request-URL pattern did not allow the existing `?from=` return path on list links.
- A money pattern expected a plain space, but `formatMoney` uses a non-breaking space.

I fixed both patterns. No product code changed because of them.

## Browser journeys

Desktop 1440×900 and mobile 390×844. Each step that already had overflow and axe checks keeps them.
1. **Admin direct apply:** the URL is `?applied=2`, the highlight notice names version 2 and Performance, and the top history row shows the change.
2. **Scoped HR keyboard submission:** the URL ends at the request ID with no flag. The notice says Pending approval and "Compensation has not changed." There are no decision buttons, and history is unchanged.
3. **Admin approval from the queue (new assertions):**
   - The "Current compensation" region shows base, bonus and cash as INR amounts, version 1 with its effective date, the Current state and the currency line.
   - Its base salary equals the request's Before value.
   - In document order it comes before the Approve request button, and it stays visible during the confirmation step.
   - After confirming, the URL is unchanged (only `from`), the notice says "Approved by Meera Iyer on … Compensation version 2 was created.", the decision buttons are gone and the snapshot shows version 2. Rohan then sees Approved and the new history row.
4. **Admin cancellation:** the snapshot is visible; an empty reason is rejected; after a reason, the notice says "Cancelled by Meera Iyer on … Compensation did not change." with no URL change; history is unchanged.
5. **Stale preview:** the second Apply is still manual, and the highlight notice names version 3.
6. **Direct change makes a request out of date:** the request can no longer be approved, and the snapshot shows version 2 beside it.
7. **Ineligible and out-of-scope** checks, and **JWT not in HTML or storage**: unchanged and passing.
8. **New: crafted completion values** (signed in as Meera; the pending request is made in a separate Rohan session):
   - Pending request opened with `?submitted=1&decided=approved` shows "Pending approval since … Compensation has not changed." and still offers Approve request. No "Request submitted/approved/cancelled", "Salary change applied", "Approved by" or "Cancelled by" text appears.
   - Approved request opened with `?decided=cancelled&submitted=1` shows "Approved by …" and no cancelled or pending copy.
   - Cancelled request opened with `?decided=approved` shows "Cancelled by …" and no approved copy.
   - Employee opened with `?applied=2` and `?applied=1` shows only the neutral highlight ("Performance" and "Initial import").
   - Employee opened with `?applied=99`, `0`, `-1`, `abc` or `%3Cscript%3E` shows no highlight notice and no completion claim. The final page passes the overflow and axe checks.

Screenshots in `03b-salary-evidence/`: `approve-confirm-*` (snapshot above the inline confirmation), `approved-*`, `cancelled-*`, `request-submitted-*`, `adjust-preview-*`, each for desktop and mobile.

## Environment

- The Task 03 test database had been removed, so I recreated it: container `acme-frontend-e2e-mysql` (`mysql:8.4`, `127.0.0.1:3318`, database `acme_e2e`, synthetic local passwords).
- Setup in `express-backend`, with values passed on the command line: `npm run db:migrate` (applied 001–006), `npm run db:seed -- --replace`, and `npm run db:seed-demo-users` with synthetic demo passwords.
- Backend: the existing `express-backend/dist` build, run with `env -u OPENAI_API_KEY … PORT=3901 CLIENT_IP_SOURCE=socket node dist/src/server.js`. I did not rebuild it. Its `server.js` is dated Nov 16 20:30, and no backend source file is newer.
- I reseeded and restarted the backend before each full run.
- Cleanup: servers stopped, container removed (`docker ps -a` no longer lists it), `next-frontend/test-results` deleted. The other containers and the server on port 3000 were left alone.

## Limitations

- After a decision, focus is not moved. The Decision panel unmounts on refresh and the outcome notice is a `role="status"` element in the new render, so screen readers may not announce it. This matches the earlier `router.replace` behaviour.
- After a direct apply, the Admin sees a neutral highlight rather than a "you applied this" message. That is the trade-off of the persisted-state approach. A one-time server marker could bring the first-person message back, but it needs cookie consumption in `proxy.ts` and would interact with prefetching. I left it out because the task allowed either approach.
- The snapshot shows the backend's selected compensation. When a future-dated change exists, that can be an Upcoming record; the heading and label then say Upcoming.

## Confirmations

- No file under `express-backend/` was modified. I only ran its migrate and seed scripts and its existing build.
- No `.env` file was read; every value was passed on the command line.
- No Git command was run, and nothing was committed or pushed.
- No dashboard or HR-access UI work was started, and no unrelated page was redesigned.
