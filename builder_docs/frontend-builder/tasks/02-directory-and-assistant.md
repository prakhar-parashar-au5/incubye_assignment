# Frontend Task 02: Employee directory and assistant UI

**Status:** READY

## Goal

Extend the accepted authentication shell with the real employee directory, employee detail, and a read-only compensation-assistant page.

## Read first

- `builder_docs/frontend-builder/index.md`
- `docs_human/09-frontend-directory.md`
- `docs/20-frontend-architecture.md`
- `docs/21-frontend-test-plan.md`
- `builder_docs/shared/ai-assistant-contract.md`
- `builder_docs/responses/07-employee-directory-api.md`
- `builder_docs/responses/08-ai-assistant-mcp.md` when it exists
- `.kiro/skills/impeccable/SKILL.md`

## Part A: Directory

After backend Task 07 is committed:

- Regenerate the frontend API contract from backend OpenAPI.
- Implement employee search, filters, sorting, pagination, responsive list, detail, and compensation history.
- Show native and USD-equivalent money with exchange-rate source and date.
- Preserve URL state and permission messages.
- Use only real backend data.

## Part B: Assistant

After the assistant endpoint appears in backend OpenAPI:

- Regenerate the frontend contract again.
- Add `/assistant` to the protected shell.
- Add a clear `Synthetic data assistant` notice.
- Add suggested prompts for top compensation, recent changes, employee lookup, and summaries.
- Keep conversation state in memory only. Do not use local storage or persistent browser storage.
- Send chat through Next.js server code with the HTTP-only session cookie token.
- Render assistant text, tool activity, structured cards, limitations, and rate context.
- Keep native currencies clear.
- Handle loading, model unavailable, timeout, rate limit, unauthenticated, and malformed response states.
- Do not render model output as raw HTML.
- Do not expose JWT or `OPENAI_API_KEY` to the browser.

## Impeccable

Use the installed Impeccable skill again for directory and assistant surfaces. Run context once for this session. Use relevant shape, critique, adapt, harden, audit, and polish guidance. Review desktop and mobile. Record concrete findings and changes.

Do not enable hooks or live mode without approval.

## Tests

- Existing authentication tests remain green.
- Directory tests from `docs/21-frontend-test-plan.md`.
- Assistant suggested prompts and submit behavior.
- Structured card rendering.
- Model text is escaped.
- No JWT or API key reaches rendered HTML or Client Component props.
- Conversation is not stored in local or session storage.
- Provider unavailable and timeout states.
- Scoped HR cannot display out-of-scope tool results.
- Desktop, mobile, keyboard, and accessibility browser journeys.

## Ownership and sequencing

Modify only `next-frontend/`, `PRODUCT.md`, `DESIGN.md`, and this frontend response folder.

Do not modify backend files.

Do not invent assistant API types. Wait for or regenerate from backend OpenAPI before final integration.

Do not run Git commands.

## Response

Write:

```text
builder_docs/frontend-builder/responses/02-directory-and-assistant.md
```

Include API generation, Impeccable effects, tests, browser evidence, exact checks, known limitations, and confirmation that no backend or Git work ran.
