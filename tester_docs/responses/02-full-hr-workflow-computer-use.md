# Full HR workflow computer-use review

## Environment and test window

- Candidate supplied: Checkpoint A `3853f4b09ff914b004164d5edb498073fa5f6a97` (not independently verified; Git and source inspection were prohibited).
- Frozen workspace: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_tester`.
- Test window: 16 Nov 2026, approximately 16:58–17:00 UTC (22:28–22:30 IST).
- Browser: visible Google Chrome, regular profile; desktop window. Exact viewport dimensions were not available before the stop condition.
- Frontend: `http://localhost:3200/` returned Chrome `ERR_CONNECTION_REFUSED` on initial navigation and on two clean reloads.
- Backend health: not checked because the frontend stop condition was met.

## Journeys completed

- Read the Task 02 index and charter. Opened the frontend in a new Chrome tab and performed two clean reloads. No HR journey could begin in this frozen run.

## Confirmed defects

None claimed. The connection failure is an environment blocker; the browser alone does not establish a product defect in Checkpoint A.

## Permission and privacy findings

Not tested. No protected data was opened or captured.

## Accessibility findings

Not tested.

## Usability friction

Not assessed.

## Product suggestions

None from this run.

## What worked well

The task instructions and required paths were available in the frozen workspace.

## Mutations performed

None. No employee compensation or salary request was changed.

## Tests not completed and why

Sign-in, separate Admin and Scoped sessions, directory, detail, salary adjustment, requests, approval, cancellation, dashboard, isolation, AI unavailable state, mobile, keyboard, zoom, accessibility, Back, copied URLs, concurrency, retries, and duplicate submissions were not run. The frontend refused the connection repeatedly, triggering the Task 02 stop condition. No screenshots were saved because no product defect was confirmed.

## Overall verdict

**BLOCKED** — `http://localhost:3200/` was unavailable after the initial attempt and two clean retries. Resume the black-box review when the frozen candidate's frontend is running.
