# AI traces frontend task 02: implement saved conversations and observability

## Status

BLOCKED UNTIL TASK 01 IS ACCEPTED AND CHECKPOINT B EXISTS

## Goal

Implement the accepted saved-conversation and Admin observability brief against the frozen backend OpenAPI from Checkpoint B.

## Entry conditions

Do not start unless:

- Shape Task 01 is accepted.
- Backend AI Tasks 03 and 04 are accepted and committed.
- Frontend worktree starts from Checkpoint B.
- Generated backend OpenAPI includes every required conversation, trace, MCP, review, and delete operation.
- Dedicated builder database and ports are ready.

Report a blocker rather than hand-writing a missing contract.

## Required work

- Add backend operation IDs to the frontend contract allowlist and regenerate types/validators.
- Migrate `/assistant` from browser-owned history to server-owned conversations.
- Show the approved 30-day synthetic-data recording notice.
- Add conversation list, start, reload, continue, failure, and Retry behavior.
- Preserve structured cards, native currency rules, limitations, rate-limit handling, and safe mutation refusals.
- Add Admin-only trace and MCP navigation/pages.
- Add trace filters, pagination, formatted timeline, warned raw JSON view, review, and deletion.
- Keep formatted employee identity redaction and raw-data restrictions exact.
- Handle stale review, unknown/deleted trace, partial failure, unavailable backend, session expiry, and large JSON.
- Implement desktop, mobile, keyboard, focus, zoom, and accessibility behavior from the accepted brief.

## Framework and security

Read relevant installed Next.js 16.4.6 docs before coding. Use the current server cookie/BFF boundary. Every Server Action validates untrusted inputs and sends the server-held Bearer token to Express.

Never send JWT or OpenAI key to browser JavaScript. Never put raw trace content, prompts, results, notes, preview data, or credentials in URLs, storage, analytics, console logs, or client telemetry.

Admin navigation hiding is not authorization. Render backend 403 correctly.

## Tests

Implement all unit, component, and browser journeys from the accepted shape brief.

Use fake or deterministic backend behavior for provider timeout and persistence failure states. Use a real isolated backend/database for complete conversation, trace, review, delete, MCP, role, mobile, and accessibility journeys.

Run:

```text
npm run api:check
npm run check
npm run build
npm run test:e2e
```

Final browser tests use production builds in the dedicated lane.

## Scope limits

Do not modify backend code, invent schemas, add AI mutations, add arbitrary SQL, add an observability vendor, redesign unrelated pages, or alter human specifications.

Never read `.env`, handle secrets, run Git, commit, or push.

## Response

Write:

```text
builder_docs/ai-traces-frontend-builder/responses/02-implement-saved-conversations-and-observability.md
```

Include contract changes, files, framework decisions, security boundaries, exact tests/results, screenshots, omitted checks, and confirmations. Stop after implementation.