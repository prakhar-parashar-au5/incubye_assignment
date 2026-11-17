# Blocker: GET /api/v1/employee-directory/options takes about 10 s in the lane, past the frontend's 5 s timeout

Status: CROSS_LANE_DEFECT (observed, not investigated)
Task: Frontend Task 07a
Agent lane: Frontend builder
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_artifacts (master merged in by the operator; I ran no Git command)
Time observed: 2026-11-17, about 23:30 IST

## What I was trying to do

Run `tests/e2e/artifacts.spec.ts` in the E2E lane: MySQL 8.4 on `127.0.0.1:3325` (tmpfs, freshly migrated through 008, 10,000 employees seeded) and this worktree's built backend on 4225.

## What blocked me

Nothing in Task 07a. On every sign-in, the Next server logged `{"operation":"getDirectoryOptions","kind":"TIMEOUT"}` when it rendered `/employees`.

## Evidence

- I signed in as Meera through the API and called `GET /api/v1/employee-directory/options` three times:
  - 200 in 10.28 s;
  - 200 in 10.24 s;
  - 200 in 10.52 s.
- The backend request log agrees, with `"durationMs"` of 10276.4, 10235.1 and 10520.7.
- The frontend's default API timeout is 5,000 ms (`next-frontend/src/server/config.ts`, `DEFAULT_API_TIMEOUT_MS`). So `/employees` renders without its filter options for Admin HR in this lane.
- The handler is `options()` in `express-backend/src/directory/directory-repository.ts:376`.

## Expected

Directory options well under the 5 s frontend timeout.

## Observed

About 10 s on every call, not only on a cold start.

## What I verified

- The Artifacts tests do not depend on this call, and all of them pass.
- I did not check whether this is new since the master merge or specific to the tmpfs lane. I made no backend change.

## Decision or owner needed

Backend lane: measure `options()` on a seeded database. `npm run measure:directory` exists. Then confirm whether it is a regression.

## Severity

Medium if it reproduces outside the lane: the employee directory's filters would be missing for every user. Low if it is only the lane.
