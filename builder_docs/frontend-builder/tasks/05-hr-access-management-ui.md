# Frontend Task 05: HR access-management UI

**Status:** READY

## Goal

Implement the accepted Admin HR access-management experience and the approved `Another HR account` sign-in mode.

## Read first

```text
docs_human/09-frontend-directory.md
docs_human/12-hr-access-management.md
builder_docs/frontend-builder/responses/05a-hr-access-management-shape.md
builder_docs/frontend-builder/issues/05a-created-hr-users-cannot-sign-in.md
builder_docs/responses/11-hr-access-management-api.md
builder_docs/responses/11a-temporary-password-recovery.md
builder_docs/responses/11b-backend-final-review-fixes.md
express-backend/openapi/openapi.json
PRODUCT.md
DESIGN.md
docs/27-agent-blocker-reporting-protocol.md
```

Read relevant installed Next.js 16.4.6 guides before coding, especially Server Actions, forms, authentication, data security, caching, and navigation. Use the generated OpenAPI contract and runtime validators. Do not handwrite backend response interfaces.

Use Impeccable and the accepted shape brief. Keep the existing product world.

## Required implementation

### Sign-in correction

Keep the two quick demo-account choices and add `Another HR account` with email and password fields.

- Use the existing backend login operation.
- Use the same generic invalid-credential response and rate limit.
- Do not reveal whether an email exists.
- Do not store email/password in browser storage or URLs.
- Do not log credentials.
- Do not claim email delivery.
- A created user's temporary password and a regenerated password must both work through this path.

### HR access routes

Implement the accepted route map from the shape response, including:

- Admin-only HR access list.
- Search, filters, sorting, pagination, active default, and Include inactive.
- HR-user detail and access-audit history.
- Create Admin or Scoped HR user.
- Combined country/department scope preview and replacement.
- Display-name edit.
- Scoped-to-Admin promotion.
- Deactivate and reactivate with required reason.
- Temporary-password regeneration.

Add Admin navigation. Scoped HR direct navigation must show the backend-authorized forbidden state and no HR-user metadata.

### Preview, concurrency, and outcomes

- Every consequential operation uses backend preview and exact confirmation.
- Display old/proposed role, status, scopes, cross-product, accessible employee count, version, and sessions to revoke where relevant.
- Editing input invalidates its preview.
- Stale version keeps the draft, shows current versus proposed state, and requires a new preview and confirmation.
- Idempotent uncertain retries reuse the same key.
- Trusted persisted state, not caller-controlled URL parameters, drives success copy.
- No-change results write no fake success history.

### Temporary passwords

- Show a returned temporary password once in a focused success state.
- Add explicit Copy password with an accessible copied/failed status.
- Warn that no email was sent and approved external sharing is required.
- Leaving the state removes the password from the rendered UI.
- Refresh, Back, later detail, audit, URLs, HTML, browser storage, analytics, logs, and error telemetry must not recover it.
- A create replay with `credentialRecoveryRequired` offers Regenerate temporary password.
- Regeneration preview shows the target and session-revocation warning.
- Self-regeneration rejection shows the approved message.

## Tests

Add unit/component coverage for parsing, role/status labels, preview invalidation, cross-product display, stale state, temporary-password one-time state, recovery-required state, and sign-in mode validation.

Add real-backend browser journeys for:

1. Admin list/filter/detail/audit.
2. Create Scoped user and sign in through `Another HR account`.
3. Create replay/lost response followed by regeneration and successful sign-in.
4. Scope replacement and next-request access change.
5. Promotion and session revocation.
6. Deactivation/reactivation and old-session rejection.
7. Last-active-Admin block.
8. Self-regeneration block.
9. Stale concurrent Admin edits.
10. Duplicate email.
11. Scoped HR direct URL forbidden.
12. Password absence after leaving the one-time state.
13. Desktop, mobile, keyboard, 200% zoom, no overflow, and axe.

Use an isolated synthetic database. Record any journey that cannot run and why.

## Scope limits

Do not modify backend code or OpenAPI, implement Admin demotion, general self-service reset, email delivery, MFA, SSO, custom roles, AI traces, or unrelated dashboard/salary behavior.

Do not edit `docs_human/**` further. Never read `.env`, run Git commands, commit, or push.

If blocked, write `builder_docs/frontend-builder/issues/05-<short-problem>.md` and continue only independent work.

## Validation

```text
npm run api:check
npm run check
npm run build
npm run test:e2e
```

## Response

Write:

```text
builder_docs/frontend-builder/responses/05-hr-access-management-ui.md
```

Include files, contract operations, Next.js decisions, security handling, exact checks/results, browser evidence, omitted scenarios, and confirmations. Stop after Task 05.