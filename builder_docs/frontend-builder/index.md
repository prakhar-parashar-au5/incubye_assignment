# Frontend builder index

This is the entry point for the separate `frontend-builder` session.

## Role

The frontend builder owns frontend implementation only.

Prakhar owns product decisions and commits. The planner reviews work and controls task status. The backend builder owns `express-backend/`.

## Ownership boundary

The frontend builder may modify:

```text
next-frontend/
builder_docs/frontend-builder/responses/
PRODUCT.md
DESIGN.md
```

The frontend builder must not modify:

```text
express-backend/
docs/
docs_human/
builder_docs/parent_instructions/
builder_docs/responses/
```

The frontend builder can read backend OpenAPI and all approved documents.

Do not run Git commands. Do not commit or push.

## Current task

### Frontend Task 01: Foundation and authentication shell

Status: `ACCEPTED AND COMMITTED`

Independent planner verification passed: generated contract check, lint, type check, 52 tests, production build, and rendered sign-in inspection. Builder evidence reports 17 passing Playwright journeys and one intentional skip.

Instructions:

```text
builder_docs/frontend-builder/tasks/01-foundation-auth.md
```

Expected response:

```text
builder_docs/frontend-builder/responses/01-foundation-auth.md
```

### Frontend Task 02: Directory and assistant

Status: `ACCEPTED AND COMMITTED`

Instructions and review fixes:

```text
builder_docs/frontend-builder/tasks/02-directory-and-assistant.md
builder_docs/frontend-builder/tasks/02a-tester-review-fixes.md
```

Responses:

```text
builder_docs/frontend-builder/responses/02-directory-and-assistant.md
builder_docs/frontend-builder/responses/02a-tester-review-fixes.md
```

Result: directory, employee detail, assistant UI, mobile layouts, and tester corrections are complete.

## Blocked implementation task

### Frontend Task 03: Salary adjustment UI

Status: `BLOCKED UNTIL BACKEND TASK 09`

Instructions:

```text
builder_docs/frontend-builder/tasks/03-salary-adjustments-ui.md
```

## Current task

### Frontend Task 04a: Dashboard shape

Status: `READY`

Instructions:

```text
builder_docs/frontend-builder/tasks/04a-dashboard-shape.md
```

Expected response:

```text
builder_docs/frontend-builder/responses/04a-dashboard-shape.md
```

## Communication rules

- Read this index at the start of each task.
- Read only the task marked `READY`.
- Write the response at the exact path named above.
- Do not edit this index.
- Report true requirement conflicts.
- Make routine implementation decisions without repeated questions.
- Record actual tests and browser checks only.
- Do not claim skill use without a concrete effect.
- Stop when the current task is complete.

## Safety rules

- Never read an `.env` file.
- Never create code that loads an `.env` file.
- Use injected process environment values.
- Never expose JWTs to browser JavaScript.
- Never put backend URLs or secrets in a `NEXT_PUBLIC_` variable.
- Never log passwords, JWTs, cookies, request bodies, salary data, or database URLs.
- Do not enable Impeccable hooks or live mode without explicit approval.
