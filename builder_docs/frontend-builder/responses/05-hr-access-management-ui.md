# Frontend Task 05: HR access-management UI

Status: Implemented. All local checks and the full real-backend Playwright suite pass in an isolated lane: 93 passed, 7 skipped, 0 failed. Of the required browser journeys, only journeys 2, 11, 12 and 13 (in part) are automated so far; the rest are unverified (see "Browser evidence and unverified scenarios").
Workspace: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_access_ui`

## Implemented

- Added generated OpenAPI support for the approved HR-user API surface (17 operations) and runtime response/request validation in the server API layer. The UI uses the generated types for list/detail/audit, previews, create/change results, and request payloads.
- Added Admin-only HR Access navigation and routes for the searchable/filterable/sortable/paginated list, detail and paginated audit, create, name, scope, promotion, deactivate, reactivate, and temporary-password regeneration.
- Added the `Another HR account` sign-in mode, using the existing sign-in endpoint and session cookie boundary. It accepts an email plus password and retains the generic invalid-credentials response.
- Added backend-authorized direct-route handling for Scoped HR. The route makes the normal server-side request and renders the forbidden state without exposing HR-user metadata.
- Added preview and confirmation workflows, input invalidation, cross-product/count/version presentation, stale-version comparison with draft retention, idempotent retry key retention, no-change handling, and persisted-state navigation after changes.
- Added a one-time temporary-password state with masked display, show/copy status, explicit no-email warning, cleanup on leaving, and the credential-recovery action after replay.
- Added responsive list filters, mobile overflow checks in the browser journey, and unit/component coverage for URL parsing, labels, cross-products, sign-in mode, preview invalidation, stale state, recovery, and temporary-password behavior.

## Files changed

- Contract generation and generated source: `next-frontend/scripts/generate-api-contract.mjs`, `next-frontend/src/generated/api-openapi.json`, `next-frontend/src/generated/api.ts`.
- Server boundary and sign-in: `next-frontend/src/server/api/contract.ts`, `next-frontend/src/server/api/client.ts`, `next-frontend/src/server/session.ts`, `next-frontend/src/server/actions/auth.ts`, `next-frontend/src/server/actions/hr-access.ts`, `next-frontend/src/lib/sign-in-state.ts`, `next-frontend/src/app/sign-in/sign-in-form.tsx`.
- HR access routes and navigation: `next-frontend/src/lib/hr-access.ts`, `next-frontend/src/app/hr-access/page.tsx`, `next-frontend/src/app/hr-access/[hrUserId]/page.tsx`, `next-frontend/src/app/hr-access/new/page.tsx`, `next-frontend/src/app/hr-access/[hrUserId]/[operation]/page.tsx`, `next-frontend/src/app/hr-access/hr-access-workspace.tsx`, `next-frontend/src/app/hr-access/hr-access-mobile-filters.tsx`, `next-frontend/src/components/shell/app-shell.tsx`, `next-frontend/src/proxy.ts`.
- Tests: `next-frontend/tests/unit/auth-actions.test.ts`, `next-frontend/tests/unit/hr-access.test.ts`, `next-frontend/tests/component/sign-in-form.test.tsx`, `next-frontend/tests/component/hr-access-workspace.test.tsx`, `next-frontend/tests/e2e/auth.spec.ts`, `next-frontend/tests/e2e/hr-access.spec.ts` (the two e2e specs were corrected again during the E2E-lane session; see Validation).
- Evidence: `builder_docs/frontend-builder/responses/05-hr-access-evidence/`.
- Issues: `builder_docs/frontend-builder/issues/05-real-backend-e2e-environment.md` (resolved), `builder_docs/frontend-builder/issues/05-concurrent-writer-in-worktree.md` (superseded).

## Contract and framework decisions

- The frontend contract generator includes the 17 approved HR-user operation IDs from the existing OpenAPI. No backend source, OpenAPI, or human product document was changed, and no response fields were invented.
- Browser code does not call the backend directly. Server Components and Server Actions use the existing server-only client and `readSessionToken`; the existing HttpOnly session cookie remains the authentication boundary.
- The API client and actions keep credentials and response bodies out of logs. Email/password are not written to browser storage or URLs. The one-time password is held only in component state and is not put in a route or server-provided page prop.
- HR scope choices are limited to the country and department values present in the approved generated contract enums. No scope catalog endpoint or response field was added.
- Success for ordinary changes follows the persisted result back to detail, where the audit data is authoritative. No URL flag is used as success evidence.

## Validation

All results below are from the E2E-lane session on 2026-11-17, against the code as it stands now.

| Command (from `next-frontend/`) | Result |
|---|---|
| `npm run api:check` | "Generated API contract is current." |
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. 15 files, **206 tests passed** |
| `npm run build` | Exit 0. Routes `/hr-access`, `/hr-access/new`, `/hr-access/[hrUserId]` and `/hr-access/[hrUserId]/[operation]` built (partial prerender) |
| `npm run test:e2e` (as `npx playwright test`, with the lane environment below) | **93 passed, 7 skipped, 0 failed** (3.6 min). Both `hr-access.spec.ts` runs passed (desktop 5.9 s, mobile 6.5 s) |

**Skipped (7):**
- Five pre-existing project-specific skips:
  - `directory.spec.ts:170` on desktop;
  - `auth.spec.ts:121`, `directory.spec.ts:121` and `directory.spec.ts:217` on mobile;
  - `dashboard.spec.ts:512` on mobile.
- Two runs of `dashboard.spec.ts:288`, "missing exchange rate", on both projects. That journey needs `E2E_NO_RATE_API_BASE_URL`, a second backend started without its saved rate file. The planner's lane allocates one backend port, so I did not start a second backend, and it skipped with its own message.

### Failures found in the lane and fixed (frontend tests only)

The first full run gave **91 passed, 2 failed, 7 skipped**. Both failures were assumptions in tests; the product code was unchanged by the fixes:

1. **Mobile `auth.spec.ts:165` and `hr-access.spec.ts`.** `getByRole('link', { name: 'HR Access' })` cannot find the mobile link, because it sits inside the closed Menu `<details>`.
   - `auth.spec.ts` now checks `nav[aria-label="Main"] a[href="/hr-access"]` has the text "HR Access", the same pattern it already uses for Dashboard.
   - `hr-access.spec.ts` opens the Menu after the streamed shell renders (the pattern from `salary.spec.ts` and `assistant.spec.ts`) and clicks the link in the visible navigation.
   - The Scoped-user check now counts `a[href="/hr-access"]` in the DOM, so a hidden link would also fail it.
2. **`hr-access.spec.ts`, second run, two causes:**
   - **Desktop:** `getByText('India + Tech').last()` matched a hidden `<p>` in the list page's mobile rows (`lg:hidden`). Next.js keeps the previous route mounted but hidden. The assertion is now scoped to the preview region: a list item exactly "India + Tech", plus "Estimated employees in access:".
   - **Mobile:** there is no table on mobile, so no "Last updated" column header. Mobile sorting is in the filter sheet. The test now checks the desktop header's `aria-sort="descending"`, and on mobile checks that the sheet's Sort by is `updatedAt` and Order is `desc`.
3. After the fixes, `hr-access.spec.ts` and `auth.spec.ts` gave 19 passed and 1 skipped. Then the clean full run above passed.

**Backend defects found:** none, so no backend issue file was written.

### Isolated E2E lane (planner resolution in `issues/05-real-backend-e2e-environment.md`)

All values were synthetic and passed on the command line; the password is shown as `…`. No `.env` file was read.

1. **MySQL 8.4,** tmpfs storage, `127.0.0.1:3325`:
   ```
   docker create --name acme-hr-access-e2e-mysql --tmpfs /var/lib/mysql:rw -p 127.0.0.1:3325:3306 -e MYSQL_DATABASE=acme_hr_access_e2e_test -e MYSQL_USER=acme_lane -e MYSQL_PASSWORD=… -e MYSQL_ROOT_PASSWORD=… mysql:8.4
   docker start acme-hr-access-e2e-mysql
   ```
   The harness refuses `docker run`, so the container was created, then started.
2. **This worktree's backend** (source identical to the main checkout's, verified with `diff -rq` before Task 05). In `express-backend/`:
   ```
   npm ci
   npm run build
   DATABASE_URL=mysql://acme_lane:…@127.0.0.1:3325/acme_hr_access_e2e_test APP_ENV=test npm run db:migrate          # 001–006
   … npm run db:seed -- --replace                                                                                  # 10,000 employees
   … DEMO_MEERA_PASSWORD=… DEMO_ROHAN_PASSWORD=… npm run db:seed-demo-users
   env -u OPENAI_API_KEY DATABASE_URL=… JWT_SIGNING_KEY=$(openssl rand -hex 32) PORT=4225 CLIENT_IP_SOURCE=socket node dist/src/server.js
   ```
   `/health` returned 200. Before each full run, the database was reseeded and the backend restarted with a new signing key. HR users created by earlier runs stay in the database (7 before the final run); the journeys use unique emails.
3. **Playwright:**
   ```
   E2E_API_BASE_URL=http://127.0.0.1:4225 E2E_DEMO_PASSWORD=… E2E_MYSQL_CONTAINER=acme-hr-access-e2e-mysql E2E_DATABASE_URL=mysql://acme_lane:…@127.0.0.1:3325/acme_hr_access_e2e_test npx playwright test
   ```
   The MySQL variables are there only because `dashboard.spec.ts`'s empty-scope journey requires them. The Next.js servers ran on the config's ports (3900, 3902, 3905–3908); none of the reserved ports were used.
4. **Teardown:**
   - Backend and Next.js servers stopped, `acme-hr-access-e2e-mysql` removed (`docker ps -a` no longer lists it), and ports 3325, 4225 and 3900–3908 confirmed free.
   - `next-frontend/test-results` and the temporary `/tmp` lane scripts deleted.
   - `express-backend/node_modules` and `express-backend/dist` from `npm ci` and `build` were left in place. Both are in `express-backend/.gitignore`, and no backend source was changed.

## Browser evidence and unverified scenarios

**Verified in the lane.** `hr-access.spec.ts`, on desktop (1440×900) and mobile (390×844), against the real backend:
1. Meera opens HR Access from the navigation (the mobile Menu on mobile) and sees the list.
   - Default sort: Last updated, newest first (the desktop header's `aria-sort`, or the mobile sheet values).
   - Axe reports no serious or critical findings.
2. **Create a Scoped user** (India × Tech): the preview shows the "India + Tech" combination and the estimated employee count, with clean axe. Confirm.
3. **One-time password:**
   - It is shown once, masked, with Show/Hide.
   - It is not in the URL, and `localStorage` and `sessionStorage` are empty.
   - After "Done, I have shared it" and a reload, it is not in the page HTML.
4. **Sign in as the new user** in a new browser context through **Another HR account** (email plus temporary password). The shell shows "QA Scoped HR", Scoped HR, "India and Tech"; there is no HR Access link in the DOM; no page overflow; clean axe.
5. **That Scoped user opens `/hr-access` directly** and sees "HR Access is available to Admin HR only." Their own email does not appear on the page.

This covers required journeys **2** (create Scoped user and sign in through Another HR account), **11** (Scoped HR direct URL forbidden), **12** (password absent after leaving the one-time state: URL, HTML after reload, browser storage), and part of **13** (desktop and mobile, no overflow, axe). The rest of the suite (auth, dashboard, directory, assistant, salary) also passed, so the sign-in change and navigation change broke nothing.

Evidence in `builder_docs/frontend-builder/responses/05-hr-access-evidence/`:
- `hr-access-password-masked-{desktop,mobile}.png`: the one-time panel with the password masked. No unmasked screenshot is taken.
- `hr-access-created-scoped-{desktop,mobile}.png`: the created user signed in.

**Still unverified: no automated browser journey exists yet** for these required journeys:
- **1:** Admin list, filters and detail with audit pagination.
- **3:** create replay or lost response, then regeneration, then sign-in.
- **4:** scope replacement and the next-request access change.
- **5:** promotion and session revocation.
- **6:** deactivate and reactivate, and old-session rejection.
- **7:** last-active-Admin block.
- **8:** self-regeneration block.
- **9:** stale concurrent edits.
- **10:** duplicate email.
- **13** (rest): keyboard-only and 200% zoom for HR Access.

These are the earlier implementation's gaps. Running the lane did not add them; this session's scope was running the suite and fixing its failures. Unit and component tests cover the related logic (preview invalidation, stale state, recovery-required state, one-time password state), but these flows have not been driven end to end in a browser.

## Confirmation

- The Task 05 implementation passes all local checks and the full real-backend suite in the isolated lane.
- The required journeys listed as unverified above are still open.
- `issues/05-real-backend-e2e-environment.md` is resolved by the planner's lane.
- `issues/05-concurrent-writer-in-worktree.md` is superseded: the planner assigned this lane, and the worktree's existing Task 05 code was treated as the implementation under test.
- Files changed in this session:
  - `next-frontend/tests/e2e/auth.spec.ts`
  - `next-frontend/tests/e2e/hr-access.spec.ts`
  - this response
  - the evidence folder
- No backend source, OpenAPI or `docs_human` file was modified. No `.env` file was read. No Git command was run, and nothing was committed or pushed.
