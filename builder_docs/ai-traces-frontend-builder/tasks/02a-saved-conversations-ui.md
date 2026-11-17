# AI traces frontend task 02a: saved conversations UI

## Status

READY once this worktree has merged `feature/ai-observability-backend` (AI Tasks 03 and 03a, accepted 2026-11-17). Check that `express-backend/openapi/openapi.json` contains the assistant conversation operations and the `withheld` field before starting. If it does not, stop and report per `docs/27-agent-blocker-reporting-protocol.md`.

## Why this is split

Task 02 needs two backend contracts. The conversation contract (Task 03/03a) exists now. The Admin trace, MCP, and monitoring-summary contract (Task 04) is being built in parallel. Do the conversation half now. Task 02b covers the Admin half after Task 04 lands.

## Read first

- Your accepted shape: `builder_docs/ai-traces-frontend-builder/responses/01-shape-saved-conversations-and-observability.md`
- `builder_docs/ai-traces-frontend-builder/tasks/02-implement-saved-conversations-and-observability.md` (security, framework, and test rules all still apply)
- `express-backend/openapi/openapi.json` (the frozen contract; never hand-write a schema)
- `builder_docs/ai-builder/responses/03a-persistent-assistant-review-fixes.md`, sections 1 and 2
- Installed Next.js docs in `next-frontend/node_modules/next/dist/docs/`

## Required work

From Task 02, only the conversation items:

- Add the conversation operation IDs to the frontend contract allowlist and regenerate types and validators.
- Migrate `/assistant` from browser-owned history to server-owned conversations.
- Show the approved 30-day synthetic-data recording notice.
- Conversation list, start, reload, continue, failure, and Retry, with idempotency keys kept on Retry.
- `MODEL_NOT_CONFIGURED` shows as a recorded failed turn, not a crash.
- `withheld: true` shows the fixed withheld text, with no cards, no limitations, and no Retry for that answer.
- Preserve structured cards, native currency rules, limitations, rate-limit handling, and safe mutation refusals.
- Stop calling the deprecated `POST /api/v1/assistant/messages`.

Not in this task: Admin trace pages, MCP pages, review, delete, monitoring dashboard.

## Tests and lane

Unit and component tests for every state above. Browser journeys against a real isolated backend:

- MySQL container `acme-ai-traces-e2e-mysql`, `127.0.0.1:3326`, database `acme_ai_traces_e2e_test`, tmpfs, synthetic credentials.
- This worktree's backend on port `4226`, fresh local `JWT_SIGNING_KEY`, no `OPENAI_API_KEY` (so you get the recorded not-configured path).
- Do not use ports 3200, 3221, 3317, 3321, 3322, 3325, 4200, 4221, 4225.

Run `npm run api:check`, `npm run check`, `npm run build`, `npm run test:e2e`. Remove the container and stop servers afterwards.

## Rules

Do not modify `express-backend/**` or `docs_human/**`. Never read `.env`, handle secrets, run Git, commit, or push. Report blockers per `docs/27`.

## Response

Write `builder_docs/ai-traces-frontend-builder/responses/02a-saved-conversations-ui.md` with contract changes, files, exact test results, screenshots, omitted checks, and confirmations. Stop after 02a.
