# Frontend Task 03: Salary adjustment and approval UI

**Status:** READY. Backend Task 09 response and OpenAPI are available. Regenerate the contract before implementation and again after any backend review fix.

## Goal

Implement the Admin direct-change, Scoped HR request, and Admin approval journeys from `docs_human/11-salary-adjustments.md`.

## Read first

- `docs_human/11-salary-adjustments.md`
- `docs/20-frontend-architecture.md`
- `DESIGN.md`
- `PRODUCT.md`
- `builder_docs/responses/09-salary-adjustments-backend.md`
- Updated backend OpenAPI.
- `.kiro/skills/impeccable/SKILL.md`

## Required work

- Regenerate frontend API types and validators.
- Add role-correct action on employee detail.
- Add adjustment target and method form.
- Add exact preview panel.
- Show salary band and future-change warning.
- Admin direct confirmation.
- Scoped HR request submission.
- Request list for Scoped HR.
- Approval queue and request detail for Admin HR.
- Admin approval and cancellation with required note.
- Stale conflict and fresh-preview behavior.
- Request status display.
- Compensation history refresh after approval.
- Desktop, mobile, keyboard, and accessibility tests.

The UI must use backend-calculated values. It must not calculate authoritative salary or decide authorization.

## Impeccable

Use the installed Impeccable skill for shape, critique, adapt, harden, audit, and polish. Keep the existing product design system. Do not redesign unrelated pages.

## Scope limits

Do not add bulk review cycles, retroactive changes, salary currency changes, agent-executed salary mutation, dashboard work, HR access UI, or AI trace UI.

Do not modify backend files. Do not run Git commands.

## Response

Write:

```text
builder_docs/frontend-builder/responses/03-salary-adjustments-ui.md
```
