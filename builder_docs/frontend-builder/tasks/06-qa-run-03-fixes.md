# Frontend Task 06: fixes from QA run 03

## Status

READY. Branch `fix/hr-access-qa-03`, worktree `/Users/admin/Desktop/Projects/incubyte_take_home_hr_fixes`, started from master `9236ac4`.

Source report: `/Users/admin/Desktop/Projects/incubyte_take_home_qa_run/tester_docs/responses/03-master-regression-computer-use.md` and `tester_docs/evidence/03-master-regression/observations.md` in the same worktree. Read them; don't edit them.

The planner verified D1 to D3 in the code and confirmed the backend is not involved (direct API calls for `q=Rohan Mehta`, `role=ADMIN`, and `sort=name&direction=desc` all return correct data). All fixes are frontend-only.

## Defects

### D1 (Medium): HR Access sort cannot switch to descending

Root cause: `hrAccessSearch` in `src/lib/hr-access.ts` omits `direction` when it equals `'desc'`, treating `desc` as the default for every sort. `parseHrAccessQuery` defaults a missing direction to `'asc'` when sort is not `updatedAt`. So `?sort=name&direction=desc` serializes to `?sort=name`, which parses back to ascending.

Fix: one rule for the default direction (`updatedAt` → `desc`, others → `asc`), used by both the parser and the serializer. Unit test the round trip for every sort and both directions.

### D2 (Low): disabled pagination links are still links

`src/app/hr-access/page.tsx` renders Previous/Next as `<Link aria-disabled ... pointer-events-none>`. The href stays live for keyboard and assistive tech, so Next on a one-page list opens an empty page 2.

Fix: when disabled, render non-interactive text (no `href`), not a styled link. Check the other list pages built in the same style (salary requests, AI traces, MCP calls) and fix them the same way if they share the pattern. Report which ones you changed.

### D3 (Medium): HR Access search and role filter show "The compensation service is not responding"

Root cause, from the code: the list's GET form also submits the filter controls' fields. Empty or repeated keys (for example `role=` or `role` appearing twice) make `parseHrAccessQuery` report invalid keys. The page then skips the API call and renders `ServiceUnavailable`, whose copy is about the compensation service, with a Retry that drops the user's search.

Fix:
1. The form must submit only fields with values, and each key once. Search plus any filter combination must work on desktop and on the mobile filter sheet.
2. An invalid HR Access URL must render an "invalid filters" alert with a "Clear filters" link, the same pattern the AI traces list uses. It must not render the service-unavailable state.
3. `ServiceUnavailable` on HR Access must not mention compensation.

Confirm the exact cause in the browser before fixing; if it differs from the above, fix the real cause and say so.

### D4 (Medium): "Add HR user" after a successful create shows the old completion page

With `cacheComponents: true`, Next.js 16 keeps a visited route mounted but hidden (React `<Activity>`), so the create workspace's client state survives navigation. You fixed the same class of bug for the assistant in Frontend Task 02a ("Conversation cleared after client-side navigation"); reuse that approach.

Fix: opening `/hr-access/new` from any link always shows a blank create form. This applies to every HR Access operation page with a completion or one-time-password state (create, regenerate, scope, promote, deactivate, reactivate): each must reset on a fresh visit. The one-time password must still disappear on leaving.

### D5 (Low, cosmetic): AI trace detail title repeats its trace prefix

Reported in the same run. Make the trace detail heading show the prefix once.

## Added by planner: HR access lifecycle journeys (moved from the QA tester)

The QA tester's computer-use tool cannot change account access or enter new passwords without a human confirming each step, so these journeys move here as automated Playwright tests against the real backend. They are the journeys your Task 05 response listed as unverified (3 to 10). Cover each one on desktop; mobile only where layout differs:

1. Create → lost response replay → regenerate → sign in with the new temporary password.
2. Replace a Scoped user's scope → that user's next page load shows the new scope.
3. Promote to Admin → that user's old session is rejected.
4. Deactivate → old session rejected → reactivate → can sign in again.
5. Last active Admin cannot be deactivated (preview and confirm both blocked).
6. An Admin cannot regenerate their own password.
7. Two contexts edit the same user → the second save shows the stale-version state and keeps its draft.
8. Duplicate email on create is refused with a clear message.
9. List filters plus detail with paginated audit history.

If a journey exposes a product defect, fix it if it's frontend; if it's backend, write an issue and don't change backend code.

## Tests

- Unit tests for D1 and the D3 query handling.
- A Playwright regression for each of D1 to D4 in `tests/e2e/hr-access.spec.ts`, on desktop and mobile. D4 means create → list → Add HR user → blank form, plus the same check for regenerate.
- Run `npm run api:check`, `npm run check`, `npm run build`, and the full `npm run test:e2e`.

E2E lane, same as Task 05:
- MySQL `acme-hr-access-e2e-mysql` on `127.0.0.1:3325`, database `acme_hr_access_e2e_test`.
- This worktree's backend on 4225.

Remove the container and stop the servers afterwards.

Ports in use by other lanes (do not touch): 3224, 4224, 3324, 3228, 4228, 3328, 3317.

## Rules

- No backend or `docs_human/**` changes.
- No Git, no commits, no `.env`.
- Report blockers per `docs/27-agent-blocker-reporting-protocol.md`.

Write `builder_docs/frontend-builder/responses/06-qa-run-03-fixes.md`, covering root cause per defect, files changed, exact test results, and anything not fixed. Stop after Task 06.
