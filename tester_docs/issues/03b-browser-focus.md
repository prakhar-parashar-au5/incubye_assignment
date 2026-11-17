# Blocker: QA browser focus moved to unrelated user tab

Status: BLOCKED
Task: Tester Task 03b — approved master regression continuation
Agent lane: General HR tester
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_qa_run`
Candidate commit: `9236ac4` (as supplied in task 03)
Time observed: 2026-11-17 10:37–10:39 UTC

## What I was trying to do

Resume the approved browser-only regression checks in the existing QA Chrome window at `http://localhost:3228`, while leaving the user's other Chrome windows untouched.

## What blocked me

While loading the requested `/hr-access/new` path from the QA app, Chrome focus changed to an unrelated Oppenheimer movie tab. The visible CUA state then identified that user tab as the active Chrome window. The browser access host inventory also returned `Browsers: Error: The browser access host is unavailable`, so I could not bind the test tab without using the active window UI.

## Evidence

- CUA reported the active page as `Watching Oppenheimer — Atlantic` at `atlantic.bz/watch/872585`.
- The window list showed the QA app window separately as `Change HR access | ACME Compensation Manager`.
- No test action was performed on the movie tab and no app-state mutation occurred in Run 03b.

## Expected

The tester should be able to select and operate the isolated QA window at port 3228 without changing or clicking in the user's movie window.

## Observed

Focus moved to the unrelated user tab and the browser automation host was unavailable. Further UI actions risked interacting with the user's window, so testing stopped.

## What I verified

- The approved scope/promotion/deactivation/reactivation/regeneration and remaining regression checks are not yet performed.
- The prior screenshot-persistence issue was marked RESOLVED as directed; written observations are accepted evidence.
- No Meera, Rohan, or QA Scoped Reviewer account data was changed in Run 03b.

## What I tried

Read-only CUA state inspection and browser inventory. I did not continue clicking or typing once the user's movie tab was active.

## Decision or owner needed

Restore the QA Chrome window as an isolated frontmost context, or provide a dedicated browser profile/window for the tester.

## Files changed before stopping

- `tester_docs/responses/03-master-regression-computer-use.md`
- `tester_docs/issues/03-screenshot-persistence.md` (marked RESOLVED per planner direction)
- `tester_docs/issues/03b-browser-focus.md`

## Tests run and current results

No Run 03b application checks completed. Run 03 from the existing report remains accepted as partial.

## Safe next step

Resume only when the QA test window can be operated independently of the user's movie tab. At the action point, request confirmation before each security-sensitive access expansion and hand off all new credential entry.
