# Resumed full HR workflow computer-use review

## Environment and exact test window

- Frozen tester workspace: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_tester`.
- Candidate supplied: Checkpoint A `3853f4b09ff914b004164d5edb498073fa5f6a97`; not independently verified.
- Test window: 16 Nov 2026, approximately 17:26–17:43 UTC (22:56–23:13 IST).
- Browser: Google Chrome. Meera used a regular Chrome window; Rohan used an Incognito window, keeping sessions separate. Desktop viewport was used; exact dimensions were not recorded.
- All application navigation used port 3221. No direct API calls, source inspection, database queries, or Git commands were used.
- The earlier attempt used integration port 3200 and was blocked by the port mismatch. In this run the demo password appeared at `localhost:3221/sign-in`, and sign-in succeeded.
- The backend health page was not visited.

## Journeys completed

- **Sign-in:** Reviewed synthetic demo and persona copy; sign-in succeeded for Meera and Rohan in separate contexts. Task 02's initial failed-password tests were not repeated.
- **Meera directory and detail:** Confirmed Admin HR and all-employee scope, opened an employee detail, reviewed INR and USD compensation, history, version, and effective date, and opened the direct adjustment form.
- **Direct salary adjustment:** Previewed a 1% base increase for `ACME03627`, changed the input after preview and verified the preview became out of date, canceled and verified version 1 remained unchanged, then submitted a fresh preview. The preview showed employee/code, before/after, absolute and percentage change, unchanged bonus, cash compensation, budget impact, native currency, effective date, reason, note, band, and version. Applied once and reloaded the result.
- **Rohan directory and scope:** Confirmed Scoped HR and scope India, Support, and Tech; visible directory count 4,599. The department menu exposed Support and Tech; country menu exposed India. Opened an in-scope employee and reviewed compensation before requesting a change.
- **Scoped salary request and Admin approval:** Previewed and submitted a 1% base increase for `ACME02345` using a double-click on Submit for approval. The request appeared once, remained Pending approval, and the detail stated compensation had not changed. The request detail had no Approve or Cancel buttons while signed in as Rohan. Meera's queue showed the requester's identity, employee, before/after values, currency, reason, note, and version context. Approved by keyboard through the confirmation; the request showed Approved and created version 2. Reloading Rohan's request detail changed its displayed status from the prior Pending state to Approved and showed the new compensation.
- **Scope direct URL:** While signed in as Rohan, opened `ACME03627` (HR department, outside the permitted departments). The result was “Employee not found.”

## Confirmed defects

None confirmed in the completed workflows. The scope isolation, 1% direct adjustment, single request after double-click, and keyboard approval behaved consistently with the visible product copy.

## Permission and privacy findings

- Rohan's directory stated the scope and permission-filtered count. Filter options were limited to Support/Tech and India.
- Rohan's direct URL for `ACME03627` returned “Employee not found.”
- Rohan's request detail exposed no approval/cancellation controls; Meera's Admin queue exposed those decision controls.
- No JWTs, cookies, credentials, or raw salary response bodies were inspected or included as evidence.

## Accessibility findings

- The adjustment and request forms exposed labeled controls in Chrome's accessibility tree. The Admin approval confirmation was completed with keyboard navigation and Enter; one new version resulted.
- No full keyboard-only journey, focus appearance review, automated accessibility scan, or 200% zoom review was completed.

## Usability friction

- Chrome sometimes moved focus back to the user's movie window during the run. The HR sessions remained available in separate windows and were resumed through Chrome's Window menu. This affected test pace, not observed product state.
- No mobile viewport assessment was completed.

## What worked well

- The initial Admin preview became explicitly out of date when an input changed, and confirmation was unavailable until a fresh preview.
- Canceling that preview left the employee on compensation version 1.
- The completed direct change showed version 2 in history and stayed after reload. The completion page stated the version and reason.
- The scoped request remained separate from employee compensation until Admin approval. The double-click produced one request in the Admin pending queue.
- Admin approval used a second confirmation step. Rohan's stale page refreshed to the persisted Approved status and new version.
- The preview and request detail used INR as the employee's native currency and kept USD comparisons distinct in the employee detail.

## Mutations performed

- **Direct change:** `ACME03627`, Aarav Banerjee, Admin HR. Percentage increase of 1% to annual base salary, reason Performance, effective 16 Nov 2026, note “QA synthetic direct adjustment, 1% increase.” Applied once. Result: compensation version 2. A prior preview was canceled and did not write.
- **Scoped request:** `ACME02345`, Aarav Banerjee, Rohan Mehta. Percentage increase of 1% to annual base salary, reason Performance, effective 16 Nov 2026, note “QA synthetic scoped request, 1% base increase.” Submitted once using a double-click. Request `e921ba45-d045-47a2-a224-319162ebeff1`; approved by Meera using keyboard. Result: compensation version 2.
- **Scoped request for cancellation scenario:** `ACME05142`, Aarav Banerjee, Rohan Mehta. A 1% annual base salary increase request was submitted with reason Performance and note “QA synthetic cancellation scenario.” Request `55de7692-e255-49a4-bb19-3b847228a6de`. It remains pending; the cancellation workflow could not be completed before browser focus was interrupted.

## Tests not completed and why

- Cancellation reason validation, cancellation, and verifying unchanged compensation for the pending `ACME05142` request.
- Directory search variants, exact email/no-result, full filter combinations, sorting directions, page boundaries, salary history states, dashboard, crafted salary-request URLs, and copied URLs.
- Concurrent stale previews, duplicate compensation submission, request-out-of-date behavior, and prevention of a second pending request.
- Detailed AI evaluation was explicitly excluded. Assistant unavailable state was not checked.
- Mobile width, narrow desktop, 200% zoom, overflow, full keyboard navigation, full accessibility review, and sign-out Back/Forward checks.
- Screenshot capture for workflow results was not completed. The initial sign-in blocker screenshot from the earlier attempt remains in the evidence folder but does not describe this resumed run.

## Overall verdict

**PASS_WITH_FINDINGS** — Core Admin direct adjustment, Scoped request, Admin keyboard approval, and one scope boundary check passed. The pending request `55de7692-e255-49a4-bb19-3b847228a6de` remains in the synthetic queue because cancellation was not completed. Significant directory, cancellation, concurrency, mobile, and accessibility coverage remains incomplete.
