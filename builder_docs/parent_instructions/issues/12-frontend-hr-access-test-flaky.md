# Blocker: HR access component test fails intermittently under the full Vitest run

Status: CROSS_LANE_DEFECT
Task: Backend task 12, Railway deployment readiness
Agent lane: Backend builder
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_deploy
Candidate commit: branch `chore/railway-deploy` from master `9236ac4`, plus uncommitted Task 12 files (I ran no Git command)
Time observed: 2026-11-17, about 17:38–17:50 IST

## What I was trying to do

Run `npm run check` in `next-frontend/` after pinning the Node version (`engines.node` and `.nvmrc`). Task 12 changes no frontend source or test file.

## What blocked me

Nothing in Task 12. One frontend component test fails in some full-suite runs and passes in others.

## Evidence

- Test: `next-frontend/tests/component/hr-access-workspace.test.tsx` › "offers password regeneration after a create replay without rendering a missing password".
- Error: `TestingLibraryElementError: Unable to find role="button" and name "Create HR user"` at the `await screen.findByRole('button',{name:'Create HR u…` line (line 83).
- Full `npm test` (17 files, 283 tests): 4 failures in 15 runs, always this one test. The other 282 tests passed every time.
- The file alone (`npx vitest run tests/component/hr-access-workspace.test.tsx`): 4 of 4 runs passed.

## Expected

The test passes on every run.

## Observed

It fails intermittently when the whole suite runs in parallel. That points to the default `findByRole` timeout (1000 ms) being too short under load, not to a product defect. I did not confirm the cause.

## What I verified

- Task 12 touched only `next-frontend/package.json` (`engines.node`), `next-frontend/package-lock.json` (root `engines` only), and the new `next-frontend/.nvmrc`. None of these is loaded by Vitest.
- `npm run api:check`, `npm run lint`, and `npm run typecheck` pass.

## What I tried

Re-ran the suite and the single file. I did not edit the test.

## Decision or owner needed

Frontend builder: make the test deterministic (for example wait for the preview step to settle, or raise the timeout for that query), or confirm it is a known flake.

## Files changed before stopping

None in `next-frontend/src` or `next-frontend/tests`.

## Tests run and current results

See Evidence.

## Safe next step

Frontend lane reproduces with repeated `npm test` runs and fixes the wait.
