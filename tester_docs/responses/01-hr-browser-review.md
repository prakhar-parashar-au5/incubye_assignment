# HR browser review

## Environment

- Local frontend at `http://localhost:3200`, tested in desktop Google Chrome through computer use on 15 Nov 2026.
- Synthetic demo accounts: Meera Iyer (Admin HR) and Rohan Mehta (Scoped HR).
- Browser screenshot saving and viewport resizing were unavailable in the computer-use interface used for this pass. No screenshots were saved.

## Journeys completed

- Meera: signed-out page, one wrong-password error, sign-in, role/scope, exact ID, partial-name and exact-email search, department filter and removal, base and cash sorting, direction reversal, USD source/date, page size and next page, employee detail/history, return-state retention, sign-out.
- Rohan: sign-in, displayed scope and count (4,599), department and country options, out-of-scope search and direct URL, comparison with an unknown URL, assistant queries, invalid query parameter.
- Three live assistant prompts: highest annual base salary, out-of-scope employee lookup, and a request for a 10% raise. This remained within the eight-prompt limit.

## Confirmed defects

### Sort arrows are misaligned in employee table headers

- Severity: Low
- Persona: Rohan Mehta, Scoped HR; the same shared directory table is used by Meera Iyer, Admin HR
- Steps: Sign in as Rohan; open Employees at desktop width; inspect the table header row, especially Employee ID, Department and job title, Employment status, and Annual base salary.
- Expected: Each sort arrow sits beside its own column label, with a consistent gap and alignment. A column without sorting should not appear to own a nearby arrow.
- Observed: Several arrows float at the far edge of their header cells instead of staying beside their labels. The arrow before Annual base salary appears closer to Employment status, which is not sortable, than to its own label. Other arrows sit at differing heights relative to wrapped labels.
- Evidence: Visual browser screenshot observed on `http://localhost:3200/employees` during the follow-up review (Rohan, desktop Chrome). The screenshot showed the header row with a sort arrow between Employment status and Annual base salary. The computer-use interface did not provide a screenshot-save action.

### Assistant conversation persists after leaving and returning

- Severity: Low
- Persona: Rohan Mehta, Scoped HR
- Steps: Sign in as Rohan; open Assistant; ask `Who has the highest annual base salary?`; after the answer, choose Employees in the app navigation; choose Assistant again.
- Expected: The conversation is cleared after leaving and returning, as specified in the tester task.
- Observed: The earlier question and answer remain in the Conversation list. The later out-of-scope and raise prompts also remained after the same navigation.
- Evidence: Browser accessibility state on `http://localhost:3200/assistant` after returning still listed `Conversation` and `You Who has the highest annual base salary?` plus `You Give employee ACME01644 a 10% raise.` No screenshot was available to save.

## Usability friction

- The directory has nine columns and 25 rows by default; no mobile assessment was possible, so readability at narrow widths remains unknown.
- Navigation includes Dashboard, Salary Reviews, and HR Access as “Coming later,” which can make the available scope of the demo less immediately clear.

## Accessibility findings

- The sign-in page exposes a skip link; directory and assistant controls had accessible labels in the browser accessibility tree. The directory exposed table headers and sort direction.
- A complete keyboard-only journey, focus visibility check, and automated accessibility scan were not completed. No accessibility defect is claimed.

## Security and privacy findings

- Rohan's department options were only Support and Tech; the country option was only India. His directory stated the scope and showed 4,599 employees.
- Searching for synthetic code `ACME03627` (outside Rohan's scope) returned no match. Its direct detail URL showed the same “Employee not found” heading as unknown code `ACME99999`.
- The assistant answered the out-of-scope lookup with “No permitted employee was found” and did not expose compensation. It refused the requested raise as read-only.
- Browser cookie inspection was not completed. No credentials, tokens, or salary response bodies were captured as evidence.

## Product suggestions

- Consider a visible “New conversation” or “Clear conversation” control if retaining chat on in-app navigation is intentional; otherwise clear it on return.

## What worked well

- The sign-in page clearly identified synthetic data and both account scopes. The wrong-password message gave a useful recovery instruction.
- Exact ID, partial name, and exact email search returned the expected record(s). The department filter could be removed, and search state survived opening a detail and returning.
- Base and cash sort controls showed direction. USD comparison disclosed the rate, effective date, and Federal Reserve source. Compensation detail distinguished current state from initial-import history.
- Changing page size to 50 and moving to page 2 updated the displayed range to 51–100. Invalid `page=-7&sort=bogus` showed a clear invalid-filter state with a recovery link.
- The tested assistant answer kept INR visible, gave exchange-rate provenance, and its structured card agreed with the text.

## Tests not completed

- Mobile viewport and screenshots; full keyboard-only journey; automated accessibility scan.
- Country, currency, level, and status filter application/removal; permitted-employee search as Rohan; every assistant prompt in the task (cash in INR, department totals, recent changes, permitted lookup, unclear question); timeout/retry behavior; browser cookie check; backend health and unavailable-state simulation.
- Counts were displayed but not independently reconciled against the underlying synthetic dataset.

## Overall verdict

The tested desktop HR workflows and scoped-access checks behaved as expected, except for misaligned sort arrows and the assistant conversation persisting after leaving and returning. The incomplete mobile, accessibility, and assistant scenarios limit this verdict.
