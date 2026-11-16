# Frontend Task 03b: Salary workflow review fixes

**Status:** READY

## Goal

Close the independent planner findings for Frontend Task 03 without changing salary behavior or starting another product area.

## Read first

- `docs_human/11-salary-adjustments.md`
- `builder_docs/frontend-builder/tasks/03-salary-adjustments-ui.md`
- `builder_docs/frontend-builder/responses/03-salary-adjustments-ui.md`
- `semantic-review/2026-11-16-200222-pr-frontend-03.md`
- Relevant installed Next.js 16 documentation under `next-frontend/node_modules/next/dist/docs/` if the completion-state mechanism depends on routing, cookies, or cache behavior.

## Required fixes

### 1. Show full current compensation before Admin approval

The request detail already fetches employee detail to determine the latest compensation version. Render the backend-provided current compensation before the Admin decision controls:

- Annual base salary.
- Annual bonus.
- Annual cash compensation.
- Native currency.
- Current compensation version and state.

Keep the request's exact changed-target before/after values, reason, note, and effective date visible. Keep the existing stale warning when the current version differs from the request version. Do not calculate a proposed salary or cash impact in the browser.

Add component or page-level coverage and a real browser assertion that the Admin sees this context before selecting Approve request.

### 2. Do not use query parameters as proof of a completed action

The current pages show action-specific success copy from `applied`, `submitted`, and `decided` query parameters. A copied or manually edited URL can reproduce those notices without that navigation performing the action.

Use one of these bounded approaches:

- truthful persisted-state copy that does not claim this navigation performed the action; or
- a one-time server-controlled completion marker.

Do not add a client-visible credential or backend secret. Do not put salary data, notes, preview tokens, JWTs, or idempotency keys in URLs or browser storage.

Add direct-navigation tests for crafted `applied`, `submitted`, and `decided` values. The page may show the persisted record state, but it must not claim the current browser just applied, submitted, approved, or cancelled the operation unless it has trusted completion context.

## Regression checks

- Admin direct apply still refreshes compensation history and identifies the resulting version.
- Scoped HR submission still lands on the request and clearly shows Pending approval without implying compensation changed.
- Approval and cancellation still refresh request status and history links.
- Stale preview still requires a second manual confirmation.
- Existing role, mobile, keyboard, no-overflow, accessibility, idempotency, and privacy tests remain green.

Run:

```text
cd next-frontend
npm run check
npm run build
npm run test:e2e
```

The browser suite requires the existing isolated seeded test setup. Do not read `.env`; use injected environment variables only.

## Scope limits

- Modify only `next-frontend/`, `builder_docs/frontend-builder/responses/`, and the existing frontend product/design docs only if the correction changes documented UI behavior.
- Do not modify `express-backend/`.
- Do not start dashboard or HR-access UI work.
- Do not redesign unrelated pages.
- Do not run Git commands, commit, or push.

## Response

Write:

```text
builder_docs/frontend-builder/responses/03b-salary-review-fixes.md
```

Report exact files changed, tests run and results, browser journeys, and confirmation that no backend file, `.env` file, or Git state was touched.
