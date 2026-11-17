# Blocker: real-backend E2E environment unavailable

Status: BLOCKED
Task: Frontend Task 05
Agent lane: Frontend builder
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_hr_access_ui`
Candidate commit: Not checked (Git prohibited by task)
Time observed: 2026-11-16

## What I was trying to do
Run the required Playwright real-backend browser journeys against an isolated synthetic database.

## What blocked me
The documented Playwright configuration requires `E2E_API_BASE_URL` and `E2E_DEMO_PASSWORD` to be supplied by the test runner. Neither value was supplied in this execution environment. I did not inspect `.env` or request credentials.

## Evidence
`cd next-frontend && npm run test:e2e` exits before starting Playwright with: `Set E2E_API_BASE_URL and E2E_DEMO_PASSWORD to run the browser tests.` No browser journey or screenshot was produced.

## Expected
The test runner supplies an isolated synthetic backend URL and the shared synthetic demo password, allowing Playwright to start its production frontend and execute the journeys.

## Observed
Playwright configuration exits during load, before any server or browser starts.

## What I verified
`npm run api:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass. The unit/component suite reports 206 tests passing. The generated contract is current.

## What I tried
Invoked the documented `npm run test:e2e` command without reading environment files. It failed with the configuration message above.

## Decision or owner needed
Provide the isolated synthetic backend URL and demo password through the documented process environment, then rerun the browser suite. No secret needs to be included in this issue.

## Files changed before stopping
Frontend implementation and test files listed in the Task 05 response; this issue report.

## Tests run and current results
- `npm run api:check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 206 tests.
- `npm run build`: passed.
- `npm run test:e2e`: blocked at Playwright configuration load by missing runtime variables.

## Safe next step
Rerun `npm run test:e2e` in the isolated E2E environment with the two required values provided as process environment variables. Do not read `.env` or use a production database.

## Planner resolution

Status: RESOLVED — builder provisions its own isolated E2E lane

These values are synthetic local test inputs, not secrets. Use the same approach as Frontend Tasks 03 and 04:

1. Start a dedicated MySQL 8.4 container for this lane only:
   - name `acme-hr-access-e2e-mysql`
   - host port `127.0.0.1:3325`
   - database `acme_hr_access_e2e_test`
   - tmpfs storage, fixed local-only synthetic credentials
2. From this worktree's `express-backend`, run `db:migrate`, `db:seed -- --replace` with `APP_ENV=test`, and `db:seed-demo-users` with a synthetic demo password passed on the command line.
3. Build and start this worktree's backend on port `4225` with a freshly generated local `JWT_SIGNING_KEY` and no `OPENAI_API_KEY`.
4. Run Playwright with `E2E_API_BASE_URL=http://127.0.0.1:4225` and `E2E_DEMO_PASSWORD=<the synthetic value you seeded>` on the command line. Add the MySQL container/database variables only where existing specs require them.

Do not use ports 3200, 3221, 3317, 3321, 3322, 4200, 4221, or 4222; they belong to other lanes. Do not read `.env`. Do not modify backend source. Remove the container and stop the servers after the run, and record the exact commands with the password value elided in the response.