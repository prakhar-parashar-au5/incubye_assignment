# Blocker: HR users created in HR Access cannot sign in through the frontend

Status: NEEDS_DECISION
Task: Frontend Task 05a (HR access-management shape), feeding Frontend Task 05
Agent lane: Frontend builder
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_hr_access_ui (branch feature/hr-access-frontend)
Candidate commit: unknown (Git not run, per instructions)
Time observed: during 05a planning, 2026-11-16

## What I was trying to do

Plan the required browser journey "Create Scoped user and use the one-time password to sign in", plus the related journeys that sign in again after scope replacement, promotion, deactivation, reactivation, and password regeneration.

## What blocked me

The approved sign-in page accepts only the two seeded demo accounts. A user created through HR Access has its own email and a generated temporary password, and there is no frontend path to sign in with them.

- `docs_human/09-frontend-directory.md` line 14: "Show two demo accounts". Line 19: "Both accounts use one shared public demo password."
- `next-frontend/src/server/actions/auth.ts` line 34 resolves the account with `findDemoAccount(formData.get('account'))` and returns `ACCOUNT_REQUIRED` for anything else. Line 41 calls `api().login({ email: account.email, password })`, so the email always comes from the demo list.
- `next-frontend/src/app/sign-in/sign-in-form.tsx` renders the account choice as radio buttons from `DEMO_ACCOUNTS`. There is no email field.

`docs_human/12-hr-access-management.md` says the Admin "must share the temporary password through an approved channel". But the person who receives it cannot use it in this application. Every HR user the feature creates can sign in only through the backend API directly.

## Evidence

- File references above, read in this worktree.
- `POST /api/v1/auth/login` in `express-backend/openapi/openapi.json` takes `{ email, password }` (`LoginRequest`), so the backend already supports any active HR user.

## Expected

An HR user created or recovered in HR Access can sign in to the frontend with their email and temporary password. The browser journeys can then prove the one-time password works, and that a revoked session is rejected.

## Observed

The sign-in UI cannot submit any email other than the two demo accounts.

## What I verified

- Read the sign-in page, the form, the server action, `docs_human/09` and `docs_human/12`.
- The backend login contract takes any email and password.
- No other approved document grants an email-and-password sign-in mode.

## What I tried

Nothing beyond reading. Changing sign-in would change an approved human specification and existing accepted behaviour, which is outside a planning task.

## Decision or owner needed

Owner: Prakhar (product), then the planner for the Task 05 instructions.

The smallest decision: should `/sign-in` gain a second mode, for example "Another HR account" with an email field and a password field, alongside the demo accounts? Options:

1. **Add the mode (recommended).** Keep the two demo accounts as they are, and add an email and password form posting to the same server action and the same `POST /auth/login`. The same error copy and rate limit apply. `docs_human/09` needs a one-line amendment, and Task 05 includes the sign-in change and its tests.
2. **No frontend sign-in for created users in this version.** The UI then states that created users cannot yet use this demo frontend. Browser tests prove the password through the backend API only (`POST /api/v1/auth/login`), and never through the page. This leaves the feature unable to show its main outcome.

The 05a brief plans for option 1. Every journey that depends on it is marked, so option 2 can be applied by swapping those steps for API sign-in.

## Files changed before stopping

None outside this issue file and the 05a response.

## Tests run and current results

None. 05a is planning only.

## Safe next step

Decide option 1 or 2 before Task 05 starts. Every other part of the 05a brief is independent of this decision.

## Planner resolution

Status: RESOLVED

Approved option 1. `/sign-in` will keep the two quick synthetic demo accounts and add an `Another HR account` mode with email and password fields.

The product specification has been updated in this worktree at:

```text
docs_human/09-frontend-directory.md
```

Frontend Task 05 must implement and test this mode with the same backend login endpoint, generic invalid-credential response, and rate limit. Email and password must not enter URLs, browser storage, logs, analytics, or metadata. No email-delivery claim is allowed.
