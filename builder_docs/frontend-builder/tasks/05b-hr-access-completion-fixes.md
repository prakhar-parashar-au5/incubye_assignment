# Frontend Task 05b: complete and verify HR access UI

**Status:** READY

## Ownership decision

The original frontend builder owns the existing Task 05 implementation in this worktree. Keep the current files and fix them. The shape-only agent stands down and must not write here.

## Why this task exists

Task 05 has production code but no required implementation response. Independent checks currently show:

- `npm run build`: passes.
- `npm run check`: fails on `react-hooks/set-state-in-effect` in `sign-in-form.tsx`.
- `npm test`: 195 pass, 8 fail across 5 files.

The feature is not complete until all checks and required browser journeys pass and the response is written.

## Required work

1. Fix the sign-in state synchronization without disabling the React hook rule.
2. Fix all eight current test failures by correcting product code or stale test expectations based on approved behavior. Do not weaken meaningful assertions.
3. Review the one-time temporary-password component tests. Queries must identify the intended password output unambiguously and prove masked/revealed/copied/cleared behavior.
4. Ensure generated-contract tests include the approved HR-access operations.
5. Run the real-backend browser journeys required by Task 05.
6. Write the missing Task 05 response.

## Manual and browser acceptance

Prove at minimum:

- Demo sign-in still works.
- `Another HR account` sign-in works for a newly created user.
- Invalid email/password remains generic.
- Admin can list, filter, page, and inspect HR users and audit history.
- Scoped HR cannot access HR management.
- Create Scoped and Admin users.
- One-time password is initially masked, can be revealed/copied, and disappears after leaving.
- Lost create response/replay leads to password regeneration.
- Regenerated password works and old sessions/password fail as designed.
- Scope replacement changes access on the next request.
- Promotion clears scopes and revokes sessions.
- Deactivate/reactivate behavior and last-Admin protection.
- Stale concurrent edits require fresh preview.
- Desktop, mobile, keyboard, 200% zoom, no overflow, and axe.

Use only an isolated synthetic database and production backend build.

## Scope limits

Do not modify backend code, OpenAPI source, AI worktrees, dashboard behavior, salary behavior, or human specifications. Do not add email delivery or self-service password reset.

Do not read `.env`, run Git, commit, or push.

If blocked, report under `builder_docs/frontend-builder/issues/05b-<short-problem>.md`.

## Validation

```text
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Response

Write:

```text
builder_docs/frontend-builder/responses/05-hr-access-management-ui.md
```

Include files changed, root causes of the current failures, exact checks/results, browser evidence, omitted scenarios, and confirmations. Stop after Task 05 is genuinely green.