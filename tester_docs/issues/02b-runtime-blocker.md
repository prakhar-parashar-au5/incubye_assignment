# Blocker: demo sign-in credential unavailable

Status: BLOCKED
Task: Tester Task 02b
Agent lane: General HR tester
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_tester`
Candidate commit: `3853f4b09ff914b004164d5edb498073fa5f6a97` (handoff value; not independently verified)
Time observed: 16 Nov 2026, approximately 17:15 UTC

## What I was trying to do

Start the black-box HR review at the isolated frontend, using the synthetic password displayed on the sign-in page.

## What blocked me

The product renders, but the Synthetic demo credentials section says: “The demo password is not configured on this deployment.” The task requires using the displayed password, so neither HR persona can be signed in from the visible UI.

## Evidence

- Page: `http://localhost:3221/sign-in`
- Screenshot: [sign-in blocker](../evidence/02b-full-hr-workflow/01-sign-in-demo-password-unconfigured.png)
- Browser accessibility state identified the same message after a clean reload.

## Expected

The sign-in page displays the approved synthetic demo password so Meera and Rohan can be tested.

## Observed

The page states that the demo password is not configured. No password value is displayed.

## What I verified

The isolated frontend rendered in Chrome at port 3221. The missing-credential message persisted after reload.

## What I tried

Opened the sign-in page in a new Chrome window, checked the empty-password state, and performed one clean reload. I did not guess or retrieve a credential.

## Decision or owner needed

Runtime owner: make the approved synthetic demo credential available through the frozen tester sign-in UI, then confirm the candidate remains unchanged before resuming.

## Files changed before stopping

Only this blocker report, the resumed tester report, and the evidence screenshot in `tester_docs/`.

## Tests run and current results

Sign-in page rendering: passed. Demo credential availability: blocked. No account sign-in or salary workflow ran.

## Safe next step

Restore the frozen runtime's demo sign-in configuration and restart Task 02b from a clean signed-out state.
