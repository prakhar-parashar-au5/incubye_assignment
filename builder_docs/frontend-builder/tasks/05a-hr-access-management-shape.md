# Frontend Task 05a: shape HR access management

**Status:** READY

Planning only. Do not write production frontend code.

## Goal

Create an implementation-ready UX brief for the Admin-only HR access-management frontend.

## Read first

```text
docs_human/12-hr-access-management.md
builder_docs/responses/11-hr-access-management-api.md
builder_docs/responses/11a-temporary-password-recovery.md
builder_docs/responses/11b-backend-final-review-fixes.md
express-backend/openapi/openapi.json
docs/20-frontend-architecture.md
PRODUCT.md
DESIGN.md
docs/27-agent-blocker-reporting-protocol.md
```

Use the installed Impeccable shape guidance and the existing product world. Do not invent backend fields; list precise OpenAPI questions for anything missing.

## Required journeys

Shape:

- Admin-only `/hr-access` navigation and route map.
- HR-user list, search, role/status/country/department filters, sorting, pagination, active default, and Include inactive.
- HR-user detail and immutable access-audit history.
- Create Admin or Scoped HR user.
- Combined country and department scope selection with cross-product and accessible-employee preview.
- Display-name edit.
- Scoped-to-Admin promotion with scope removal and session-revocation warning.
- Deactivate and reactivate with required reasons.
- Temporary password shown once after successful creation or regeneration.
- Create replay with `credentialRecoveryRequired` and a clear Regenerate temporary password action.
- Password-regeneration preview, confirmation, session warning, and self-regeneration rejection.
- Expected-version conflicts with old/current/proposed state and mandatory re-preview.
- Idempotent retry, uncertain network result, and truthful persisted-state outcomes.
- Last-active-Admin protection.
- Empty-scope legacy user display.
- Admin-only authorization and Scoped HR 403.

## Security and privacy

The brief must ensure:

- Password appears only in the trusted successful Server Action result and is shown once.
- Password never enters URLs, browser storage, analytics, logs, audit views, screenshots, copied test fixtures, or later reads.
- UI never claims email delivery.
- Copy-password is explicit and warns the Admin to use an approved external channel.
- JWT stays in the HTTP-only cookie boundary.
- Backend remains authority for role, scope, status, version, and last-Admin rules.
- Audit data never shows credentials or session IDs.

## Interaction design

Define:

- Route and page hierarchy.
- First viewport and information priority.
- Preview and confirmation states.
- Desktop/mobile behavior.
- Keyboard order and focus after preview, conflict, success, and cancellation.
- Loading, empty, invalid, forbidden, stale, last-Admin, duplicate-email, uncertain-result, unavailable, and success states.
- Accessible multi-select behavior without inventing a complex custom widget unnecessarily.
- How cross-product and employee count remain understandable at 200% zoom and mobile width.

## Browser test plan

Include real-backend journeys for:

- Create Scoped user and use the one-time password to sign in.
- Lost create response/replay followed by password regeneration.
- Scope replacement and next-request access change.
- Promotion and session revocation.
- Deactivate/reactivate and old-session rejection.
- Last-active-Admin block.
- Stale concurrent Admin edits.
- Duplicate email.
- Scoped HR direct URL/API action receives forbidden UI.
- Audit history.
- Password absent from HTML after leaving the one-time state, URL, and browser storage.
- Desktop, mobile, keyboard, 200% zoom, overflow, and axe.

## Scope limits

Do not write production code, generated contracts, PRODUCT.md, DESIGN.md, backend files, human specifications, or tests in this task.

Do not run Git, commit, or push. Never read `.env` or handle real credentials.

If blocked, write:

```text
builder_docs/frontend-builder/issues/05a-<short-problem>.md
```

## Response

Write:

```text
builder_docs/frontend-builder/responses/05a-hr-access-management-shape.md
```

Include route map, journeys, information hierarchy, states, security handling, responsive/accessibility design, browser tests, exact OpenAPI questions, assumptions, and exclusions. Stop after the brief.