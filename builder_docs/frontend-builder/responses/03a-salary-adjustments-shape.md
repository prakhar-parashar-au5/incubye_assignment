# Frontend response 03a: Salary adjustment workflows (shape brief)

**Task:** `builder_docs/frontend-builder/tasks/03a-salary-adjustments-shape.md`
**Status:** Shape brief complete. Planning only.
- No production UI code was written.
- No frontend or backend production file was changed.
- No API types were created.

## Before the brief

- **Task status.** The task says "READY AFTER CURRENT FRONTEND COMMIT", and `index.md` does not list 03a. I cannot check commit state without Git, which this task forbids. I proceeded because you asked me to execute it. This brief changes no code, so it does not depend on that commit.
- **No backend contract yet.** The backend OpenAPI has no salary-adjustment paths, and `builder_docs/responses/09-salary-adjustments-backend.md` does not exist. Every field this brief names comes from `docs_human/11-salary-adjustments.md`, not from a response schema. The questions in section 15 must be answered by OpenAPI before Task 03 starts.
- **How Impeccable shape was applied.**
  - **No interview.** `shape.md` Phase 1 asks for a discovery interview. This harness has no structured question tool and no decision page, so I applied its rule for that case: "mark assumptions plainly, return the brief, and stop."
  - **Assumptions are marked.** Each one is labelled **(assumption)**.
  - **Product questions** are in section 16, separate from the API questions in section 15.
  - **No context rerun.** I did not rerun the Impeccable context command, because it already ran in this session. PRODUCT.md and DESIGN.md are unchanged since then.
- **Visual direction.** These surfaces sit inside the established world in DESIGN.md. The specification fixes composition and interaction closely, so `new-work.md` says to shape directly: no `concept-seed` roll and no new world. Mode: **Operate**.

## 1. Job, audience, and outcome

**Users**

| User | Job | Situation |
|---|---|---|
| Meera, Admin HR | Change one employee's compensation correctly, or decide on a colleague's request | Office desktop; checks figures against a case or approval note **(assumption)** |
| Rohan, Scoped HR | Propose a change for an employee in his scope and know what happened to it | Desktop, sometimes phone **(assumption)**; cannot apply changes |

**Success**
- No compensation changes without a reviewed, exact preview.
- Each person sees exactly which action their confirmation takes: "Apply salary change" or "Submit for approval".
- A stale preview is never confirmed silently.
- A request's state is always visible as text.

**Product-specific truth this surface must show**
- Native currency only, with an exact decimal result from the backend.
- The employee's salary band.
- The compensation version the change is based on.
- Any approved future change, which will still take effect.

**Anti-goals**
- A one-click "Give raise" button.
- A modal-only flow that hides context.
- Frontend salary arithmetic presented as authoritative.
- Colour-only status.
- Any edit control on a submitted request.

## 2. Page and route map

All routes are protected by the existing proxy matcher and session handling. The UI chooses role-specific actions only for presentation; the backend authorizes every operation.

| Route | Who | Purpose |
|---|---|---|
| `/employees/[employeeCode]` (existing) | Both | Adds a **Compensation actions** row: Admin sees "Adjust compensation", Scoped sees "Request compensation change", and either sees a pending-request notice or the ineligible message instead |
| `/employees/[employeeCode]/adjust` | Both | One page: adjustment form, then exact preview, then role-specific confirmation. Not a modal (`operate.md`: "Modals are usually laziness"); a full page keeps current compensation, history link, and back link visible. Keeps the `from` return path |
| `/salary-requests` | Both | Admin: the approval queue. Scoped: the requests in current scope. URL state: `q` (name, ID, or email), `status`, `department` (Admin only, per spec), `direction` (created date), and `page` |
| `/salary-requests/[requestId]` | Both | Request detail. Admin: Approve or Cancel request. Scoped: read-only with status and outcome |

**Navigation** **(assumption)**: the existing rail item "Salary Reviews – Coming later" becomes a live link to `/salary-requests`, relabelled **"Salary requests"**. "Salary Reviews" suggests annual review cycles, which the spec excludes (open question P1). For Admin, the item shows a pending count only if the API returns one (question A14).

**After an action**

| Action | Lands on | Shows |
|---|---|---|
| Admin direct apply | Employee detail | Success alert; the new compensation version highlighted at the top of history |
| Scoped HR submit | The new request's detail | "Pending approval" status |
| Admin approve | The request detail | "Approved", the decision time, and a link to the employee's updated history |
| Admin cancel | The request detail | "Cancelled" and the note |

## 3. Admin direct-change journey

1. **Directory → employee detail.** Compensation actions shows **Adjust compensation**. If the employee has `LEFT`, it shows "This employee is not eligible for a compensation adjustment." with no button. If a pending request exists, it shows "A salary change request is waiting for approval" with a link to it.
2. **`/adjust` page, top.** Shows the employee name and ID, then the current compensation as an access-record-style ruled line: current base, bonus, cash, currency, compensation version.
3. **Form** (section 6), then **Preview**.
4. **Preview panel** (section 7) appears below the form. Focus moves to its heading.
5. **Confirm.** **Apply salary change** (`DIRECT_APPLY`). Beside it: **Edit adjustment** (back to the form, with the preview discarded) and **Cancel** (back to employee detail, nothing written).
6. **Applying.** The button shows "Applying…" and is disabled. The idempotency key is created when the confirmation starts and reused on retry.
7. **Success.** Redirect to employee detail with "Salary change applied. Compensation version N is now in the history." For a future-dated change: "…takes effect on 1 Jan 2027."
8. **Failure.** Stays on `/adjust` with the error in place (sections 10 and 12). A stale conflict shows a fresh preview (section 10).

## 4. Scoped HR request journey

1. **Employee detail** (in scope only; out of scope is already the shared not-found page). Compensation actions shows **Request compensation change**. It shows the ineligible message instead for `LEFT`, and a pending-request notice instead when one exists.
2. **`/adjust` page.** Same as the Admin page, plus the note "Your request will go to an Admin HR user for approval. Compensation does not change until it is approved."
3. **Preview.** Identical hierarchy. The primary action is **Submit for approval** (`SUBMIT_REQUEST`).
4. **Submitting.** "Submitting…", then redirect to the new request detail: "Request submitted. Status: Pending approval. No compensation has changed."
5. **Tracking.** `/salary-requests` lists the request. The status changes to Approved, Cancelled (with the note), or Out of date (with the stale reason).
6. **No approve or cancel controls** are rendered for Scoped HR anywhere. If a hand-crafted request reaches the server, the backend answers `403 FORBIDDEN`, and the UI shows "Your HR role cannot do this."

## 5. Admin approval and cancellation journey

**Queue**

1. **Default filter** **(assumption)**: `status=PENDING`, oldest first, so first-in, first-out.
2. **Rows.**
   - Employee and ID.
   - Requester.
   - Target and method ("Base salary, +10%").
   - Current and proposed target value, native currency.
   - Effective date.
   - Created time.
   - Status.
3. **Desktop:** a table. **Mobile:** a ruled list, the same pattern as the directory.

**Request detail**

1. **Review block**, in this order:
   - requester (name and role);
   - employee (link to detail);
   - current compensation now (version);
   - requested result (old → new, change, cash impact);
   - effective date;
   - reason and note;
   - the compensation version the request was made against;
   - salary-band result;
   - future-change warning.
2. **If the employee's version has moved since the request,** a warning says so. The request stays pending until approval is attempted, because the backend decides staleness (question A9).
3. **Approve.**
   - **Approve request** opens an inline confirmation in the same section: "Approve this exact change? Compensation version N+1 will be created." with **Confirm approval** and **Back**. Approving creates compensation, so it gets one explicit confirmation step, the same as direct apply after preview.
   - There is no modal, and focus moves to the confirmation text.
4. **Cancel.**
   - **Cancel request** expands an inline form with **Reason for cancelling** (required, up to 2,000 characters), plus **Confirm cancellation** and **Back**.
   - Focus moves to the textarea.
   - The copy says "Compensation will not change."
5. **Outcomes.**
   - **Approved:** the status changes in place, with an alert linking to updated history.
   - **Cancelled:** the status changes in place and shows the note.
   - **Approval found the request stale** (409, or the request marked `STALE`): "This request is out of date: Compensation changed after this request was created. It can no longer be approved. The requester must submit a new request." No fresh-preview option is offered here, because Admin cannot edit requests (spec).
6. **Two Admins at once.** The second approver gets `409 REQUEST_NOT_PENDING`. The UI says "Another Admin HR user already decided this request." and reloads the current status.
7. **No edit controls** exist on a request in any state.

## 6. Form field groups

One `<form>` with visible labels and these groups, in order:

1. **What to change** (radio group, required): Annual base salary | Annual bonus. The helper text says the other value stays unchanged, and pay frequency and currency do not change.
2. **How to change it** (radio group, required):
   - Percentage increase
   - Percentage decrease
   - Fixed amount increase
   - Fixed amount decrease
   - Replacement amount
   - When the target is bonus and the current bonus is 0, both percentage methods are disabled with "Bonus is zero. Use a fixed increase or a replacement amount." The value comes from the backend's current compensation.
3. **Value** (one input whose label follows the method):

   | Method | Label | Input rule |
   |---|---|---|
   | Percentage | "Increase (%)" or "Decrease (%)" | `inputmode="numeric"`; integer 1–200 (increase) or 1–50 (decrease), or the band's published percentage limits when stricter (question A4) |
   | Amount | "Amount (INR)" | `inputmode="decimal"`, currency code shown as a prefix; at most two decimals; positive |
   | Replacement | "New annual base salary (INR)" | Same as amount |

4. **When** (date, required):
   - **Effective date**, default today (UTC business date).
   - The minimum is today, using the server's UTC date passed to the page rather than the browser clock.
   - The helper text is "Today or a future date. Dates use UTC."
5. **Why** (required):
   - **Reason**: native select with Performance, Market adjustment, Promotion, Role change, Correction.
   - **Note**: textarea, up to 2,000 characters, with a counter after 1,800. Required when the reason is Correction, with the label changing to "Note (required for corrections)".
   - The helper text says "Do not include passwords, bank, health, or other sensitive details."

**Validation**
- Early checks run on Preview, not per keystroke: required fields, integer, range, two decimals, date not in the past, note length.
- These checks only catch typos. The backend validates authoritatively.
- The frontend never computes the new salary.
- Errors appear inline next to each field, with an error summary at the top that links to the fields. Focus moves to the summary.

**After a preview is shown**
- Editing any field marks the preview **"Out of date: your inputs changed. Preview again."**
- The confirm button is disabled until a new preview arrives.
- This keeps "the exact previewed adjustment" literal.

## 7. Preview information hierarchy

The preview is a panel (hairline border, white surface) titled **"Preview: nothing has changed yet"**. In reading order:

1. **The result line**, the signature move. It extends DESIGN.md's ruled access-record pattern to a **change record**: one ruled line with fixed columns, **Before | After | Change**, for the adjusted target.
   - Example: "Annual base salary: INR 25,00,000.00 | INR 27,50,000.00 | +INR 2,50,000.00 (+10.00%)".
   - Figures are large and tabular, in native currency, exactly as returned.
   - The unchanged target is shown below in muted text ("Annual bonus: INR 2,50,000.00, unchanged").
2. **Cash impact:**
   - annual cash compensation before and after;
   - **Annual budget impact** (the backend value; its definition is open question P2);
   - currency code on every value.
3. **When:** effective date with a plain phrase, "Takes effect today" or "Scheduled: takes effect on 1 Jan 2027".
4. **Checks:**
   - Salary-band status, with the band range (section 8).
   - Future-change warning, if any (section 8).
5. **Your input:**
   - method and value as entered ("Percentage increase, 10%");
   - reason, and note (shown as plain text, never HTML);
   - employee and ID.
6. **Fine print:** "Based on compensation version 3. This preview is valid until 14:32 UTC." The expiry comes from the API (question A3).
7. **Actions:**
   - The primary button follows `confirmationMode`: **Apply salary change** or **Submit for approval**. An unknown value shows no confirm button and an "unexpected response" error.
   - **Edit adjustment** and **Cancel** are secondary.

**Interaction rules**
- **Native currency only.** USD is not shown in the preview, because the spec's preview list has no USD and conversion is not authoritative **(assumption)**.
- **The browser holds only an opaque preview token.** The Server Action keeps it server-side **(assumption)**, as with the JWT pattern; the browser keeps a reference, or the token if the API requires it (question A2). The browser never sends edited values with a confirmation; it sends the token.

## 8. Salary-band and future-change warnings

**Salary band** (data from the preview response; early feedback from published limits if the API exposes them, question A4):

| Result | Treatment | Copy |
|---|---|---|
| Within band | Neutral line with a green dot and text | "Within the salary band for Senior Software Engineer, India: INR 18,00,000.00 – INR 40,00,000.00." |
| Outside band | Error alert, red, in the Checks block; confirm disabled | "This result is outside the salary band (INR 18,00,000.00 – INR 40,00,000.00). Change the adjustment." |
| Bonus over cap | Same as outside band | "The new annual bonus exceeds the maximum of INR 5,00,000.00 for this role." |
| Percentage outside band limits | Field error before preview, if published; otherwise backend error | "This role allows increases of 1% to 25%." |

**Existing approved future change** (amber, the "upcoming" colour, with an icon and text):

> An approved change takes effect on 1 Jan 2027 and sets annual base salary to INR 30,00,000.00. It is a fixed amount: it will still apply on that date and will replace the result of this change.

- This shows on every preview where one exists, for both roles.
- If the new effective date is also in the future, the backend rejects it (one approved future change only). The UI shows "This employee already has an approved future change on 1 Jan 2027. Choose an effective date of today, or wait until that change takes effect."
- Which error code covers this is question A8.

**Pending request exists** (shown on employee detail and on `/adjust`, which blocks the form):

> A salary change request for this employee is already waiting for approval (submitted 14 Nov by Rohan Mehta). [View request]

- Shown for both roles.
- Admin can still apply directly, which makes that request stale. The preview then also warns: "Applying this change will make the pending request out of date." Whether the preview response flags this is question A10.

## 9. Request statuses and copy

Text labels are always visible; colour only repeats them. The mapping follows DESIGN.md: amber for upcoming, green for current or active, grey for historical, and red only for errors.

| API status | Label | Dot colour | Detail line |
|---|---|---|---|
| `PENDING` | **Pending approval** | Amber | "Submitted 14 Nov 2026, 10:20 UTC by Rohan Mehta." |
| `APPROVED` | **Approved** | Green | "Approved 14 Nov 2026, 11:05 UTC by Meera Iyer. Compensation version 4 created." |
| `CANCELLED` | **Cancelled** | Grey | "Cancelled 14 Nov 2026 by Meera Iyer: <note>." |
| `STALE` | **Out of date** | Grey | The stale reason from the API, for example "Compensation changed after this request was created." |

- The `STALE` label is user language. The spec term is kept in code and tests (open question P3).
- Empty list, Admin: "No requests are waiting for approval." with a link "Show all requests".
- Empty list, Scoped: "No salary change requests for employees in your access."
- A filtered list with no matches: "No requests match these filters." with Clear all.

## 10. Stale conflict and fresh preview

**Direct apply or submit gets `409 STALE_VERSION`**
1. No compensation was written (backend contract).
2. The frontend calls Preview again with the same inputs (the decision depends on question A6).
3. The panel shows:
   - an alert "Compensation changed while you were reviewing. Here is a fresh preview based on version 4. Nothing was applied."
   - the **old preview's result line struck through** next to the fresh one, so the difference is visible;
   - a fresh token and the confirm button, which needs a **new manual click**.
4. Focus moves to the alert.
5. If the fresh preview fails validation (for example now outside the band), the error state shows instead, with no confirm.

**Preview expired** (time passed, or the backend rejects the token as expired, question A3)
- Confirm is disabled.
- The panel says "This preview has expired. Preview again to see the current result." with a **Preview again** button.
- No automatic re-preview happens, because time-based expiry is not a data conflict **(assumption)**.

**Never** does the UI confirm a changed result automatically or retry a 409 with a new token.

**Idempotency** (question A11)
- One key per confirmation attempt, created by the Server Action **(assumption)**.
- A network failure or timeout retries with the same key; a "Try again" press reuses it.
- A new preview gets a new key.
- `409 DUPLICATE_OPERATION` means the same key was used with different data. The UI shows "This action was already submitted with different details. Reload to see the current state." This should not happen in normal use.

## 11. Desktop and mobile interaction plan

**Desktop (≥1024px)**
- `/adjust` uses two columns:
  - left (about 28rem): the form, with the current-compensation line above it;
  - right: the preview panel, with an empty-state outline reading "Preview appears here" before the first preview.
- The rail stays.
- The request list is a table with sortable created-date headers, built with the fixed 02a header component.
- Request detail is one column (max-width about 48rem), with the action section at the end.

**Mobile (<1024px)**
- `/adjust` is one column: current compensation, form, then preview below.
- After Preview, the page scrolls to the preview heading and focuses it.
- The action buttons are full width at the end of the preview.
- There is no sticky footer, because it can cover the focused field (Vercel guideline).
- Request list: ruled list items with employee and ID, target change, proposed value, status label, and created date. Filters go in the existing filter sheet pattern.
- Approve and cancel confirmations expand inline, full width.
- **Money never wraps** inside one value (DESIGN.md). On a phone, the before/after/change line stacks into three labelled rows.

The Menu disclosure staying open after navigation (02a known limitation 1) also affects these pages. It should be fixed before or with Task 03.

## 12. Keyboard and focus plan

- **Order:** all controls follow DOM order. Radio groups use arrow keys (native). Enter inside a text field submits the form.
- **Focus moves:**

  | Moment | Focus goes to |
  |---|---|
  | After Preview | The preview heading (`tabindex="-1"`), announced through an `aria-live="polite"` status ("Preview ready. Annual base salary would change from … to …") |
  | Validation error | The error summary, which links to the fields |
  | 409 conflict | The conflict alert |
  | Expiry | The "Preview again" button |
  | Approve or cancel | Into the confirmation text or the note field; **Back** returns focus to the button that opened it |
  | Success after a redirect | The success alert on the destination page (`tabindex="-1"`, `role="status"`) |

- **Pending buttons** are disabled but keep their place in the tab order. Their text changes ("Applying…"), and the live region announces it.
- **Visible focus** uses DESIGN.md's 2px outline. Nothing sticky covers focused elements.
- **Error announcement:** errors are announced with `role="alert"` only for blocking failures (conflict, unavailable). Inline field errors use `aria-describedby`.

## 13. Loading, empty, error, conflict, and success states

| State (spec name) | Where | Treatment |
|---|---|---|
| Loading employee | `/adjust`, detail | Page skeleton without the form, so nothing typed can be lost; "Loading employee…" status |
| Invalid adjustment | Form | Inline field errors and summary; backend `400 VALIDATION_ERROR` maps to fields if the API gives field detail (question A12), otherwise a form-level alert |
| Preview ready | Panel | Section 7 |
| Preview expired | Panel | Section 10 |
| Confirming direct change | Panel | "Applying…", disabled, live region |
| Submitting request | Panel | "Submitting…" |
| Request pending | Request detail and employee detail | "Pending approval" status line |
| Approval success | Request detail | Green status, alert, link to history |
| Cancellation success | Request detail | Grey status, note, "Compensation did not change." |
| Stale conflict with fresh preview | Panel | Section 10 |
| Employee not found | `/adjust` | The existing shared "Employee not found" page; unknown and out-of-scope look the same |
| Employee ineligible | Detail, `/adjust`, and `422` | "This employee is not eligible for a compensation adjustment." with no form |
| Salary-band violation | Panel | Section 8; confirm disabled |
| Existing future change | Panel | Amber warning, section 8 |
| Existing pending request | Detail and `/adjust` | Blocking notice with a link, section 8 |
| Duplicate operation | Panel | Section 10 |
| Backend unavailable | Any | The existing `ServiceUnavailable` component; the session is kept; nothing is assumed applied. If the request might have reached the server, the copy is "We could not confirm whether this change was applied. Check the employee's history before trying again." Retrying with the same idempotency key is safe |
| Forbidden (`403`) | Any action | "Your HR role cannot do this." |
| Request not pending (`409`) | Request detail | "This request was already decided." Reloads the status |
| Unauthenticated | Any | The existing `/session/expired` path |
| Empty request list | `/salary-requests` | Section 9 |

## 14. Browser test journeys (planned for Task 03)

These run against the real backend with a seeded database, desktop and mobile, with axe on each page.

| # | Journey | Key assertions |
|---|---|---|
| 1 | Admin direct base change | Base +10% today. Preview shows exact before, after, and change, `Apply salary change`. Apply lands on detail with the success alert and version 2 at the top of history. Bonus unchanged |
| 2 | Admin future-dated bonus replacement | Then a second preview on the same employee shows the future-change warning; a second future date is rejected |
| 3 | Scoped HR request | Rohan previews an in-scope employee and sees `Submit for approval`. Submit, then "Pending approval"; employee compensation unchanged |
| 4 | Admin approves Rohan's request | Queue, detail, inline confirm, Approved; history has the new version. Rohan then sees Approved and the new compensation |
| 5 | Admin cancels a request | Required note blocks empty submit. Cancelled with the note; compensation unchanged |
| 6 | Stale conflict | Two sessions on one employee: B applies first; A's confirm gets 409 and shows the fresh preview with the struck-through old line; no auto-confirm; A must click again |
| 7 | Stale request | Admin direct change while a request is pending: the request shows "Out of date" with the reason; no Approve button |
| 8 | Ineligible and out of scope | `LEFT` employee shows the message and no action; Rohan's `/adjust` for an out-of-scope code shows the same not-found page as an unknown code |
| 9 | Inputs changed after preview | The preview is marked out of date and confirm is disabled until a new preview |
| 10 | Preview expiry | With a short test token lifetime, or a mocked clock if the backend supports it (question A3): confirm disabled, "Preview again" |
| 11 | Double-submit and retry | Double click or Enter twice creates one version; a network retry reuses the key |
| 12 | Scoped HR has no decision controls | No Approve or Cancel on any request; the 403 copy if the action is forced |
| 13 | Keyboard-only | Journeys 3 and 4 with keyboard only, including the focus moves in section 12 |
| 14 | Mobile | Journeys 3, 4, and 5 at 390×844; no horizontal overflow; money not wrapped |
| 15 | Privacy | JWT and preview token absent from HTML and client props (if the token stays server-side); no salary values or notes in Next.js logs |

Component tests (Vitest) will cover form validation and field switching, the zero-bonus percentage lock, `confirmationMode` labels, the status label mapping, the stale-conflict panel, and notes rendered as plain text.

**Not planned: frontend calculation tests.** The UI shows backend values only.

## 15. Questions the backend OpenAPI must answer

The UI cannot be built without these. I will not guess a shape.

| # | Question |
|---|---|
| A1 | **Preview response schema.** Field names and types for before, after, absolute change, percentage change (decimal string or number, and how rounded), cash before and after, **annual budget impact**, `expectedCompensationVersion`, `confirmationMode`, band result, and the future-change warning. Are all money values exact decimal strings with a currency, like `AssistantMoney`? |
| A2 | **Preview token.** Where is it returned, and how is it sent back (body field or header)? Does confirmation need only the token, or the token plus the original inputs? Is the token safe to send to the browser, or should the Next.js server keep it? |
| A3 | **Expiry.** Is `expiresAt` returned? Which error and status does an expired token produce? Can tests shorten the five-minute lifetime? |
| A4 | **Salary bands for early feedback.** The spec says the frontend uses "the same published limits". Which endpoint or preview field publishes the band (min and max base, max bonus, percentage limits) for an employee, before the first preview? |
| A5 | **Band violation detail.** Is an out-of-band result a `400 VALIDATION_ERROR` with machine-readable detail (which limit, band values), or a successful preview with a failing band result? The UI must disable confirm and show the band in either case. |
| A6 | **409 STALE_VERSION body.** Does it include a fresh preview and token, or must the frontend call Preview again? |
| A7 | **Current values before preview.** Does the employee detail response gain current bonus and band data, or is a separate read needed? (The zero-bonus percentage lock needs the current bonus; the existing detail response has it.) |
| A8 | **Future change.** How is an existing approved future change described in preview (effective date, target, absolute amount)? Which error code rejects a second future change? |
| A9 | **Pending and stale detection.** Does employee detail, or a request list filter, tell the UI that a pending request exists for an employee? Does request detail say whether its version is behind the current one before approval is attempted? |
| A10 | **Admin apply with a pending request.** Does the preview flag that applying will make a pending request stale? |
| A11 | **Idempotency.** Header name and format (for example `Idempotency-Key` with a UUID)? Retention period? What does a replay return: the original 2xx body, or a marker? |
| A12 | **`VALIDATION_ERROR` detail.** Is there field-level detail (path and code)? The current public error shape has only `code` and `message`. |
| A13 | **Request schemas.** List item and detail fields: requester and decider display names (not IDs), proposed values, status, stale reason, decision note, timestamps. Request ID format (it appears in a URL). Pagination shape. Filter and sort parameter names and allowlists for Admin and Scoped. |
| A14 | **Pending count.** Is there a count for the Admin navigation item, or should the item show no count? |
| A15 | **Errors.** Is `403 FORBIDDEN` added to the public error-code enum? Does a rate limit apply to these mutation endpoints (`429 RATE_LIMITED`)? Is `503 SERVICE_UNAVAILABLE` distinct from the existing behaviour, where a non-contract 5xx maps to unavailable? |
| A16 | **Business date.** Is today's UTC business date returned (for example in preview, or a lightweight endpoint), so the date field's minimum does not depend on the browser clock? |
| A17 | **Response after apply or approve.** Is the new compensation version, and the request status after approval, returned, so the UI can show "version N" without a second read? |

## 16. Product questions (not API)

| # | Question | Default I would build if unanswered |
|---|---|---|
| P1 | Navigation label: keep "Salary Reviews", or rename to "Salary requests"? | "Salary requests" (no review cycles in scope) |
| P2 | Is "Annual budget impact" the same as the change in annual cash compensation, or something else (for example prorated for the rest of the year)? | Show exactly the backend value, labelled as the API names it |
| P3 | `STALE` label: "Out of date", or "Stale"? | "Out of date" |
| P4 | Queue default: pending only, oldest first? | Yes |
| P5 | Should the preview show USD equivalents? | No, native only |
| P6 | May Admin apply directly while a pending request exists for the same employee (making it stale), or should the UI steer Admin to decide the request first? | Allow, with the warning in section 8 (the spec permits it) |

## Confirm and stop

Following `shape.md`, this brief is returned for one confirmation or correction round, and work stops here.

**Not done in this task:**
- no production code;
- no API types;
- no DESIGN.md or PRODUCT.md changes;
- no surface brief under `.impeccable/`, which is outside my file ownership.

Frontend Task 03 starts after backend Task 09 is accepted and the questions in section 15 are answered in the published OpenAPI.

## Confirmations

- Only `builder_docs/frontend-builder/responses/03a-salary-adjustments-shape.md` was written.
- No backend or frontend production files were modified.
- No Git command ran.
- No `.env` file was read.
- No backend response types were invented. Every field name above is quoted from `docs_human/11-salary-adjustments.md` or marked as a question.
