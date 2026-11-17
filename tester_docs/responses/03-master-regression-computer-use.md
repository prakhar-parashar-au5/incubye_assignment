# Master regression computer-use report

## Environment and test window

- Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_qa_run`
- Candidate: Checkpoint A, `9236ac4` (as supplied in the task instructions; no Git commands used)
- Application: `http://localhost:3228`, visible production-mode Chrome application
- Personas: Meera Iyer (Admin HR) in a regular Chrome window; Rohan Mehta (Scoped HR) in Incognito. The Incognito session was signed out after its Rohan checks and reused to verify the newly created synthetic account.
- Test window: **2026-11-17 09:21:13–09:39:38 UTC**
- Test data: synthetic only. No APIs, database, source, Git, or `.env` were accessed.
- Screenshots: the browser screenshot action displayed the current UI inline, but I could not persist image files to the requested evidence folder without switching to an unrelated Chrome window. Evidence is recorded as page/URL/accessibility observations in `tester_docs/evidence/03-master-regression/observations.md`. See the test-run blocker at `tester_docs/issues/03-screenshot-persistence.md`.

## Journeys completed

- Meera signed in and used HR Access list, user detail, audit history, self-regeneration denial, and last-active-Admin deactivation preview guard.
- Meera searched and filtered HR Access, sorted by name, and tested pagination.
- Meera created one Scoped HR user. The one-time password appeared masked by default, was viewed only to sign in, and was not captured or saved. The account signed in through “Another HR account.”
- Rohan signed in in Incognito. HR Access and AI monitoring were absent from navigation; direct `/hr-access`, `/admin/ai-monitoring`, and `/admin/ai-traces` routes showed Admin-only denial. His dashboard was permission filtered to India, Support, and Tech.
- Meera’s dashboard showed the all-employee view, with currency amounts kept in separate native-currency sections.
- As Meera and Rohan, I sent one safe, non-sensitive assistant question each. Both displayed the configured-provider-unavailable state, saved the turn, and retained it after Reload. Meera found the failed trace in AI monitoring, reviewed its formatted and raw views after the warning, and marked it reviewed. The trace remains in the system as requested by the user.
- The newly created Scoped HR account opened an in-scope employee detail and submitted one low-impact salary-change request. Meera saw it in the pending queue. An empty cancellation reason was rejected; after entering a test reason, Meera cancelled it. The detail stated compensation did not change; a Reload in the Scoped HR context showed Cancelled and the same compensation version.
- After the Scoped HR account signed out, browser Back and Forward remained on the sign-in screen and did not reveal protected data.

## Confirmed defects

### D1 — HR Access sort cannot switch from ascending to descending

- **Severity:** Medium
- **Persona:** Meera Iyer, Admin HR
- **Reproduction:** Open `/hr-access`; click the Name header once, then click it again.
- **Expected:** The second click changes the sort direction to descending and reverses the displayed order.
- **Observed:** After the first click, the URL was `?sort=name&direction=asc`. The second click changed it to `?sort=name`, while the header remained ascending and the visible row order did not reverse. The list parser appears to default the omitted direction back to ascending.
- **Evidence:** `observations.md`, entry E1.

### D2 — HR Access pagination advertises a non-existent next page

- **Severity:** Low
- **Persona:** Meera Iyer, Admin HR
- **Reproduction:** Open `/hr-access` with the seeded two users; note “Page 1 of 1 · 2 users”; activate Next (`/hr-access?page=2`).
- **Expected:** Next is absent or disabled when the page count is one.
- **Observed:** Next was an active link and opened an empty state (“No HR users match these filters.”). After creating a third user, the list still reported one page while rendering an active Next link.
- **Evidence:** `observations.md`, entry E2.

### D3 — HR Access search and role filter show a compensation-service error

- **Severity:** Medium
- **Persona:** Meera Iyer, Admin HR
- **Reproduction:** On `/hr-access`, search for the exact existing name `Rohan Mehta`; repeat once after the error. Separately apply the Admin HR role filter.
- **Expected:** The list should return matching HR records or a normal empty result.
- **Observed:** Both queries displayed “The compensation service is not responding. Your session has not been ended. Try again in a moment.” Repeating the exact search reproduced it. The retry link returned to the unfiltered directory.
- **Evidence:** `observations.md`, entry E3.

### D4 — Opening Add HR user after a successful create retains the completion page

- **Severity:** Medium
- **Persona:** Meera Iyer, Admin HR
- **Reproduction:** Complete one HR user creation, return to the HR Access list, then select Add HR user.
- **Expected:** `/hr-access/new` opens a fresh blank create form.
- **Observed:** The page showed “Create HR user complete” and the prior account summary instead of a new form. Returning to the list and selecting Add HR user again showed the same completion state. This prevented completion of the duplicate-email-create check in this run.
- **Evidence:** `observations.md`, entry E4. The behavior was observed through the rendered page and accessibility tree; I did not retry by clearing site state or changing data.

## Permission, privacy, and workflow findings

- Rohan’s UI had no HR Access or AI monitoring link. The tested direct routes displayed Admin-only denials.
- Meera’s self-regeneration route explicitly asked her to use another active Admin HR account. Previewing Meera’s own deactivation displayed “You cannot deactivate the last active Admin HR user. Activate or create another Admin first.” I did not confirm a destructive action.
- The assistant displayed an unavailable notice and persisted the user turn without producing an answer. This matches the no-model test lane expectation. The saved trace was reviewed and left undeleted per user direction.
- Salary requests clearly stated that compensation does not change until approval. The cancellation reason was required and displayed in the final record. Rechecking the requester’s view after Reload showed the cancelled state and unchanged compensation version.
- Dashboard totals were shown by currency, with visible copy that currencies are never added together. The Scoped HR dashboard showed only its permission-filtered scope.
- No passwords, cookies, JWTs, or salary response bodies were written to evidence. Salary values are omitted from this report.

## Usability suggestions

- Keep the HR Access sort indicator and URL direction synchronized on every click.
- Disable the HR Access Next control when the list has only one page.
- The HR Access search/filter failure and the stale create-success view interrupt routine directory work; clear the previous completion state when opening a new create flow and show a non-compensation-specific recovery message for query failures.
- The AI trace title appeared to repeat its trace prefix. Low-priority visual cleanup suggestion; not treated as a functional defect.

## Mutations recorded

1. **HR user create:** Meera created synthetic user `QA Scoped Reviewer` (`qa.scoped.reviewer@example.test`), record ID 3, as active Scoped HR for India + Support. The account was reported as covering 1,755 employees by the preview. Its temporary password was shown once; it was not recorded in this report or evidence. The account successfully signed in using “Another HR account.”
2. **Assistant turns:** Meera sent one safe exact-email directory question (conversation `85f5b423-2855-4dfa-969d-183967960270`); Rohan sent one safe in-scope directory question (conversation `43fd5b8b-9076-480a-bd34-7fea7dd3a3cc`). Both were persisted as unavailable turns.
3. **Trace review:** Meera marked the unavailable trace Correct with a note that the provider-unavailable state was expected. The user asked that the trace be left in place, so it was not deleted.
4. **Salary request:** `QA Scoped Reviewer` submitted one +1% annual-base-salary request for in-scope synthetic employee `ACME02345`, reason Performance, effective 17 Nov 2026. Request ID: `89486b80-e60d-4b00-92c3-1dd59921e284`. Meera cancelled it with reason “QA workflow cancellation; no compensation change requested.” The request page confirmed Cancelled and “Compensation did not change.” No salary change was applied.
5. **No other HR access mutation** was made. The proposed scope expansion/promotion of the created account remains unperformed pending action-time confirmation.

## Not completed

- Scope replacement and confirmation in the already signed-in test account, promotion, deactivation/old-session rejection, reactivation, and password regeneration/sign-in were not performed. Those steps materially change or expand account access; action-time approval for them was still pending when the run ended. Meera self-regeneration denial and the last-active-Admin safeguard were checked without changing access.
- Duplicate email, two-tab stale-version editing, keyboard-only workflows, 200% zoom, 390px mobile layout, and detailed accessibility/focus checks were not completed.
- Employee-directory exact-email/no-result variants, last-page pagination, both sort directions, second-pending-request guard, stale preview/concurrent changes, and direct Admin salary change were not completed in this pass.
- Meera’s sign-out Back/Forward was not repeated; the equivalent post-sign-out check was completed in the Scoped HR Incognito context.
- Evidence screenshots could not be saved to the specified directory with the available browser capture workflow. This is logged in `tester_docs/issues/03-screenshot-persistence.md`.

## Verdict

**BLOCKED — partial run with confirmed findings.** Core HR access, assistant availability, monitoring, scoped-denial, salary-request cancellation, dashboard, and sign-out navigation paths were exercised. The remaining high-priority access lifecycle tests require specific confirmation before changing the synthetic account’s scope or role. Four functional defects were reproduced. The evidence persistence limitation also prevented delivery of the requested screenshot files.

## Run 03b

### Test window and environment

- **Window:** 2026-11-17 10:36:57–10:39:08 UTC
- **Worktree/app:** `/Users/admin/Desktop/Projects/incubyte_take_home_qa_run`, `http://localhost:3228`
- **Personas:** Planned use remains Meera in regular Chrome and the approved synthetic account in Incognito. No account settings or credentials were changed in this continuation.
- **Issue status:** The accepted screenshot blocker is resolved. Per the planner, the text observations in `tester_docs/evidence/03-master-regression/observations.md` are sufficient; no screenshot artifact is claimed.

### Work completed

- Marked `tester_docs/issues/03-screenshot-persistence.md` RESOLVED with the planner’s evidence-acceptance note.
- Began the approved continuation. Before any application interaction for Run 03b, Chrome focus moved to an unrelated Oppenheimer tab in the user's window. The CUA browser inventory reported that the browser access host was unavailable. I stopped without clicking or typing in that tab.
- No Run 03b application behavior was verified and no mutation was made.

### Not completed

All planned Run 03b checks remain outstanding: synthetic account scope replacement and session refresh; promotion/deactivation/reactivation lifecycle; password regeneration and sign-in; duplicate email using a full `/hr-access/new` load; two-tab stale edit; keyboard-only workflows; 200% zoom; 390px mobile layout; directory search/sorting/last page; second-pending-request guard; stale salary preview; and direct Admin salary change. The confirmation policy also requires action-time confirmation immediately before scope expansion, promotion, and reactivation; it requires user handoff for credential change/new-password entry.

### Verdict

**BLOCKED — no Run 03b app checks completed.** The only Run 03b file change was resolving the accepted screenshot-evidence issue. Resume when the QA Chrome window can remain isolated and frontmost without touching the user's movie window. Confirm sensitive access-expansion steps at action time and hand off credential entry as required.
