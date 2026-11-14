# Builder task 08: Next.js sign-in and employee directory

**Status:** NOT READY. Task 07 must pass review and be committed first.

## Goal

Build the first complete browser journey from sign-in through employee directory, employee detail, compensation history, and sign-out.

## Read first

- `builder_docs/parent_instructions/index.md`
- `docs_human/09-frontend-directory.md`
- `docs/20-frontend-architecture.md`
- `docs/21-frontend-test-plan.md`
- `docs/14-authentication-api-design.md`
- `docs/16-employee-directory-api-design.md`
- `builder_docs/responses/06-authentication-api.md`
- `builder_docs/responses/06-authentication-api-fix.md`
- `builder_docs/responses/07-employee-directory-api.md`
- `.kiro/skills/impeccable/SKILL.md`

## Required skill use

Impeccable is installed for Kiro at `.kiro/skills/impeccable/`.

Use it during this task. Run its context command once from the repository root. Follow its setup and new-surface guidance. Read its craft-floor guidance before editing UI files.

Use relevant shape, critique, adapt, harden, audit, and polish guidance. Do not use every command without purpose.

Do not enable hooks or use live mode without explicit candidate approval.

Also fetch and inspect original Anthropic frontend-design and Vercel React/web-design skill sources. Record exact revisions and concrete effects.

## Work order

1. Confirm Task 07 is accepted.
2. Check current official Next.js documentation and installed package guidance.
3. Load Impeccable and required frontend guidance.
4. Create product/design context and propose one visual direction tied to HR work.
5. Scaffold strict TypeScript Next.js with Tailwind.
6. Add selected shadcn/ui components.
7. Generate the typed API client from backend OpenAPI.
8. Implement server-only API and session-cookie boundaries.
9. Implement sign-in and protected shell.
10. Implement directory search, filters, sorting, pagination, states, and mobile behavior.
11. Implement employee detail and compensation history.
12. Add focused tests and browser journeys.
13. Inspect real desktop and mobile renders.
14. Apply concrete review corrections.
15. Run lint, type check, tests, production build, browser tests, and design audit.
16. Write the response and stop.

## Rules

- Use strict TypeScript.
- Browser code must not receive JWTs or backend secrets.
- Use server-only `API_BASE_URL`.
- Do not call Express directly from browser code.
- Generate frontend API types from OpenAPI.
- Keep directory state in validated URL parameters.
- Preserve native compensation as primary.
- Show exchange-rate source and date with USD equivalents.
- Do not calculate authoritative salary values in the frontend.
- Test desktop, mobile, keyboard use, and main failure states.
- Never read `.env` files.
- Do not run Git commands.

## Scope limits

Do not build dashboard analytics, employee mutations, salary changes, HR management pages, upload, AI, or MCP.

## Response

Write:

```text
builder_docs/responses/08-frontend-directory.md
```

Include versions and official docs checked, skill sources and concrete effects, files changed, API/cookie boundaries, tests, browser journeys, visual review findings, screenshots or paths, commands and results, known limitations, and confirmation that no Git or later feature work ran.
