# Tester Task 02: full HR workflow computer-use review

**Status:** READY

## Role

Act as a senior manual QA engineer temporarily performing the work of two ACME HR users:

- Meera Iyer, Admin HR.
- Rohan Mehta, Scoped HR.

Use the product through the visible browser UI with computer use. Behave like a real HR user who is trying to complete work, not like an automated script checking selectors.

Your aim is to find reproducible workflow, correctness, permission, privacy, accessibility, responsive-design, and recovery defects.

## Environment

```text
Frontend: http://localhost:3200
Backend health: http://localhost:4200/health
```

The sign-in page displays the approved synthetic demo password. Use that displayed value. Do not ask for, inspect, copy into reports, or expose any API key, JWT, cookie, signing key, database URL, or other credential.

All employee and salary data is synthetic. Salary operations intentionally change the local demo database. Record every employee code and request you mutate so the planner can understand the resulting state.

## Black-box rule

Test through the browser as an HR user would.

Do not:

- Read application source code.
- Read implementation reports before testing.
- Call Express APIs directly.
- Query MySQL.
- Use Git.
- Modify application files.
- Fix defects.
- Treat an unimplemented navigation item as a defect unless the UI falsely claims it is available.

You may read this task and the visible product copy. Infer expected behavior from the job, labels, confirmations, and safe HR practice. After exploratory testing, you may use the approved human specifications only to classify a suspected defect:

```text
docs_human/08-employee-directory-apis.md
docs_human/11-salary-adjustments.md
docs_human/13-ai-observability.md
```

Do not read builder response files until the report is complete.

## Evidence rules

For every confirmed defect, capture:

- Screenshot showing the visible problem.
- URL with sensitive query values removed.
- Persona and viewport.
- Exact reproduction steps.
- Expected result.
- Observed result.
- Severity and user impact.
- Whether it reproduces after one clean retry.

Save evidence under:

```text
tester_docs/evidence/02-full-hr-workflow/
```

Use filenames such as:

```text
01-admin-approval-missing-context-desktop.png
02-scoped-out-of-scope-mobile.png
```

Do not include passwords, tokens, cookies, raw request bodies, API keys, or browser-storage contents in screenshots or reports.

A visual preference is not a defect. A defect must violate visible product behavior, an approved rule, access isolation, data correctness, accessibility, or a credible HR task.

## Test method

1. Start with a clean signed-out browser state.
2. Record browser name, viewport, date, frontend URL, and whether backend health is available.
3. Complete the happy path before probing boundaries.
4. Recheck important salary values before and after each mutation.
5. Use two browser contexts, profiles, or incognito windows for concurrent Admin and Scoped HR work. Do not share one session between personas.
6. Test desktop at approximately 1440×900 and mobile at approximately 390×844.
7. Complete at least one critical journey using keyboard only.
8. Test browser Back, Forward, Reload, copied URLs, double-clicks, and retries where safe.
9. Check visible focus, labels, error placement, status announcements, and horizontal overflow.
10. Stop rather than guess if an action could affect anything outside the local synthetic demo.

## Journey A: sign-in and session behavior

Test:

- Sign-in page clearly identifies synthetic data and each role.
- Empty password.
- Wrong password once. Do not repeatedly trigger the rate limiter early in the run.
- Successful Meera sign-in.
- Sign out, then browser Back and Reload.
- Successful Rohan sign-in in a separate browser context.
- Protected direct URLs while signed out.
- Session-expired or invalid-session UI only if the browser tool can test it without exposing or editing raw cookies.

Confirm errors do not reveal whether an account exists, internal stack traces, backend addresses, or credentials.

## Journey B: employee directory and detail

As Meera, test:

- Exact employee code.
- Partial name.
- Exact email.
- A search with no result.
- Department, country, currency, level, and employment-status filters separately and together.
- Add and remove filter chips.
- Base-salary and cash-compensation sorting in both directions.
- Name and employee-code sorting where available.
- Page sizes, Next, Previous, and page-boundary behavior.
- Reload and Back from employee detail preserve meaningful list state.
- Current, upcoming, and historical compensation labels.
- INR and USD values remain distinct.
- Exchange-rate source, direction, and effective date are understandable and keyboard accessible.
- Narrow desktop and mobile layouts have no page-level horizontal overflow.

Try awkward but normal input: leading/trailing spaces, mixed case, punctuation, a long search, and invalid URL query values. Do not perform injection or load testing.

## Journey C: Scoped HR access isolation

As Rohan, establish the visible scope first.

Test:

- Country and department options contain only permitted values.
- Search finds a permitted employee.
- Search for an out-of-scope employee returns no existence signal.
- Direct URL for an out-of-scope employee looks the same as an unknown employee URL.
- Counts, filters, request lists, employee details, and assistant results do not expose another country or department.
- Crafted directory and salary-request URLs cannot widen scope.
- Browser Back, copied URLs, and changing filters do not retain data from Meera's session.

Do not claim a permission defect without a concrete hidden identity, count, salary, option, or existence signal.

## Journey D: Admin direct salary adjustment

Choose one eligible employee and record their code, current compensation version, base salary, bonus, cash compensation, currency, and any future change.

Test previews without confirming first:

- Percentage increase boundaries: 1 and 200.
- Percentage decrease boundaries: 1 and 50.
- Decimal percentage rejection.
- Fixed increase and decrease with two decimals.
- Three-decimal rejection.
- Replacement.
- No-change replacement.
- Negative or zero resulting base salary.
- Bonus behavior when the current bonus is zero.
- Correction reason without a note.
- Note length and multiline text.
- Past date and future date.
- Editing an input after preview makes confirmation unavailable until another preview.
- Cancel from preview writes nothing.

Then perform one small valid direct change that stays inside the salary band. Before confirming, verify the preview shows:

- Employee and ID.
- Before and after values.
- Absolute and percentage change.
- Base salary, bonus, and annual cash compensation.
- Native currency.
- Budget impact.
- Effective date.
- Reason and note.
- Salary band.
- Compensation version.
- Any pending-request or future-change warning.

After confirmation, verify one new history version exists and the unchanged target stayed unchanged. Reload the destination and use a copied URL to check that completion copy remains truthful.

## Journey E: Scoped request and Admin decision

As Rohan:

1. Select one eligible in-scope employee with no pending request.
2. Record compensation before the request.
3. Preview a small valid change.
4. Confirm the button says `Submit for approval`, not `Apply salary change`.
5. Submit once, including one safe double-click attempt.
6. Verify compensation did not change and status is Pending approval.
7. Reload and find the request from the request list.
8. Confirm no Approve or Cancel control exists.

As Meera in the separate context:

1. Find the pending request in the Admin queue.
2. Verify the page shows requester, employee, complete current compensation, requested result, native currency, effective date, reason, note, version, and warning state before decision.
3. Complete one approval using keyboard only.
4. Verify exactly one compensation version is created.
5. Return to Rohan and confirm the request and employee history show the approved result.

Create another request and test cancellation:

- Empty cancellation reason is rejected.
- Multiline safe text displays as text.
- Cancellation changes no compensation.
- Reload and copied URLs show truthful persisted status.

## Journey F: stale and concurrent salary behavior

Use two Admin tabs or contexts on the same eligible employee:

1. Preview two different changes from the same starting version.
2. Apply one.
3. Attempt the other.
4. Verify a fresh preview appears, the earlier result is clearly invalid, and no automatic confirmation occurs.
5. Confirm that another manual click is required.

Also test, if the UI permits it without corrupting another journey:

- Admin direct change while a request is pending makes the old request Out of date.
- An out-of-date request cannot be approved.
- A second pending request for one employee is blocked.
- Double-click or network retry does not create duplicate compensation records or requests.

Record every mutation.

## Journey G: live AI assistant

Use no more than 10 prompts per persona so the 20-per-15-minute rate limit remains available for retests.

As Meera, ask natural HR questions rather than tool names:

1. Find one employee by exact code.
2. Summarize that employee's current compensation and history.
3. Find the top compensated employees, with a specific native currency.
4. Summarize compensation for one department.
5. Ask what changed recently after the salary operations from this test.
6. Ask a follow-up that depends on the preceding answer.
7. Ask an ambiguous question that should request clarification or state limits.
8. Ask it to change a salary. It must refuse mutation and explain the safe UI workflow.

As Rohan:

1. Ask for a known in-scope employee.
2. Ask for a known out-of-scope employee.
3. Ask for top compensation across a department outside the visible scope.
4. Ask for organization-wide totals.

Check:

- Text agrees with structured cards.
- Employee identity, compensation, status, currency, and history agree with the directory.
- INR and USD are not silently added or compared as native values.
- Exchange-rate context appears when conversion is used.
- Initial import is not described as a recent salary adjustment.
- Future-effective changes are described accurately.
- Out-of-scope results reveal no identity, amount, count, or existence signal.
- Mutation requests are refused.
- Loading, timeout, provider-error, and retry states are understandable if encountered naturally.
- Leaving and returning, reload, and a second conversation behave consistently with the visible recording/history notice.
- The page visibly states that conversations and tool results are recorded for 30 days only if persistence is actually available in the tested build. Report a false claim as a defect.

Do not paste real personal information or secrets into the assistant.

## Journey H: responsive and accessibility pass

At desktop and mobile widths, inspect:

- Sign-in.
- Directory and filters.
- Employee detail.
- Adjustment form and preview.
- Salary-request list and detail.
- Assistant conversation and structured cards.

Check:

- No page-level horizontal overflow.
- Money values remain readable.
- Controls have visible labels and focus.
- Keyboard focus follows preview, error, stale-conflict, approval, and cancellation state changes.
- Status is conveyed with text, not color alone.
- Dialogs, disclosures, menus, and filter sheets can be opened and closed with keyboard.
- 200% browser zoom remains usable.
- Touch targets are practical at mobile size.
- Loading skeletons do not expose false final values.
- Empty and failure states provide a recovery action.

If the computer-use environment exposes an accessibility tree, use it to confirm names and roles. Do not substitute source inspection for browser behavior.

## Exploratory abuse without destructive testing

Try realistic mistakes:

- Double-submit a consequential action.
- Reload during a preview.
- Open the same detail in two tabs.
- Navigate Back after success.
- Edit harmless URL filters and completion markers.
- Enter HTML-looking text in a safe note and confirm it renders literally.
- Use a very long but allowed note.
- Lose connectivity only if the computer-use tool has a reversible offline toggle.

Do not attempt SQL injection, denial of service, credential attacks, mass requests, or destructive database administration.

## Reporting

Write:

```text
tester_docs/responses/02-full-hr-workflow-computer-use.md
```

Structure:

1. Environment and exact test window.
2. Journeys completed.
3. Confirmed defects, highest severity first.
4. Permission and privacy findings.
5. Accessibility findings.
6. Usability friction.
7. What worked well.
8. Mutations performed, with employee codes and request IDs when visible.
9. Tests not completed and why.
10. Overall verdict: `PASS`, `PASS_WITH_FINDINGS`, or `BLOCKED`.

For every confirmed defect use:

```text
Title:
Severity: Critical | High | Medium | Low
Persona:
Viewport:
Precondition:
Steps:
Expected:
Observed:
User impact:
Reproduces after clean retry: Yes | No | Not tested
Evidence:
```

Keep product suggestions separate from defects. Do not infer internal causes. Report only what the browser proves.

## Stop conditions

Stop and report `BLOCKED` if:

- The frontend or backend is unavailable for more than one clean retry.
- Demo sign-in fails for both accounts.
- The visible app changes materially during the run because another builder is editing it.
- The browser tool cannot preserve separate Admin and Scoped sessions.
- A requested action may affect non-synthetic or remote data.

Do not modify or reset the database. Do not ask for secrets. Do not fix anything.
