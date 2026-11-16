# AI builder task 03: persistent recorded assistant turns

## Status

READY AFTER CHECKPOINT A

## Goal

Replace browser-owned assistant history with server-owned conversations and instrument every in-product model and tool step through the accepted observability repository.

This task covers the in-product assistant and owned conversation APIs. It does not cover MCP instrumentation, Admin trace APIs, or frontend implementation.

## Read first

```text
docs_human/13-ai-observability.md
docs/24-parallel-worktree-and-ai-evaluation-plan.md
builder_docs/ai-builder/handoff.md
builder_docs/ai-builder/responses/02-observability-storage-review-fixes.md
express-backend/src/assistant/model.ts
express-backend/src/assistant/openai-model.ts
express-backend/src/assistant/assistant-service.ts
express-backend/src/assistant/tools.ts
express-backend/src/http/assistant-routes.ts
express-backend/src/http/contract.ts
express-backend/src/assistant/observability/
```

Use current official OpenAI Responses API documentation if provider behavior is material. Record source and date. Do not add LangChain, LangGraph, LangSmith, a queue, or another persistence model.

## Required contract

Implement authenticated owned-conversation operations:

```text
GET  /api/v1/assistant/conversations
POST /api/v1/assistant/conversations
GET  /api/v1/assistant/conversations/:conversationId
POST /api/v1/assistant/conversations/:conversationId/messages
```

Rules:

- A conversation belongs to one HR user.
- Unknown and unowned conversations return the same 404.
- List is server-paginated, default 25 and maximum 100.
- Message submission accepts one user message, not browser-supplied historical messages.
- The server loads bounded ordered history.
- Message submission requires an idempotency key.
- Same key and same canonical command returns the existing trace state/result.
- Same key with different content returns 409.
- A user-selected Retry uses a new key and creates a new linked trace.
- Existing assistant rate limiting remains 20 requests per authenticated user per 15 minutes.

Publish strict runtime schemas and OpenAPI. Remove the browser-history request shape from the new authoritative path. If temporary compatibility with the old endpoint is required, it must not permit an unrecorded model call and must be explicitly deprecated; report the exact removal checkpoint.

## Model telemetry envelope

Extend the provider-neutral model interface with only the fields required for observability:

- Provider request ID when supplied.
- Provider and model.
- Output text.
- Tool-call decisions and provider tool-call IDs.
- Input, output, total, and reasoning-token counts when supplied.
- Safe failure category.
- Latency measured by the service boundary.

Do not expose or persist hidden chain-of-thought or encrypted reasoning content. Provider-internal encrypted reasoning may be passed back only when the Responses API requires it within the live loop; it never enters repository JSON, application logs, API responses, fixtures, or reports.

OpenAI remains `store: false`.

## Recorded assistant state machine

For one submitted user message:

1. Authenticate and load the owned conversation.
2. Select bounded server-side history.
3. Create the user message and `STARTED` trace before OpenAI.
4. Persist each model-call attempt before calling the provider.
5. Persist the model outcome before processing text or tool decisions.
6. Persist each requested tool call before validation or execution.
7. Persist `REJECTED`, `SUCCEEDED`, or `FAILED` outcome before continuing.
8. Persist the final assistant message and response.
9. Finalize the parent trace from persisted children.
10. Return the answer only after required persistence succeeds.

Use the existing server-derived principal for every tool. The model cannot provide user ID, role, or scope.

Keep the existing bounds for rounds, calls, cards, output size, and deadline.

## Fail-closed behavior

Fault-injection tests must prove:

- Trace creation failure prevents OpenAI.
- Model-attempt persistence failure prevents OpenAI.
- Model-outcome persistence failure prevents tool execution and prevents returning provider text.
- Tool-attempt persistence failure prevents tool execution.
- Tool-outcome persistence failure prevents the next model call.
- Final trace/message persistence failure prevents returning the answer.
- A failed trace contains no fabricated assistant answer.
- AI persistence failure does not affect auth, directory, salary, dashboard, or HR-access routes.

Use fake model and fake persistence adapters. Do not use a live API key for automated correctness tests.

## History policy

Choose and document a deterministic bounded policy using complete user/assistant turns. It must fit the existing model input limit and never silently split a tool/result relationship.

Store complete conversation history under the approved payload limits, but send only the selected bounded history to the model. Record the exact model input in each model-call row.

## Errors

Distinguish safely:

- Validation failure.
- Unauthenticated.
- Forbidden/unowned conversation as approved.
- Idempotency conflict.
- Rate limit.
- Provider timeout/failure.
- Tool rejection/failure.
- Required persistence unavailable.

Responses and logs must not contain SQL, headers, cookies, tokens, API keys, connection URLs, prompts, salary results, or provider bodies.

## Tests

Add fast and real-MySQL/API tests for:

- Create/list/read owned conversations.
- Ordered persisted messages after reload.
- Cross-user conversation 404.
- Bounded server history and exact recorded model input.
- No-tool, one-tool, multi-tool, rejected-tool, failed-tool, timeout, and provider-failure turns.
- Token and provider-request metadata.
- Scope remains enforced in tool SQL.
- Same-command replay and conflicting idempotency reuse.
- New Retry trace linked to previous trace.
- Concurrent message sequence allocation.
- Every fail-closed boundary above.
- Secret scrubbing at live persistence boundaries.
- Existing assistant response/card behavior where still applicable.
- OpenAPI drift.

Run all backend regressions and production build.

## Scope limits

Do not implement:

- MCP observability.
- Admin trace/MCP/review/delete routes.
- Frontend conversation or trace UI.
- AI mutations.
- Arbitrary SQL.
- New framework or service.
- Retention changes.

Do not modify `next-frontend/**` or `docs_human/**`.

Never read or create `.env`, handle a live API key, run Git commands, commit, or push. Use only an isolated test database.

## Response

Write:

```text
builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md
```

Include architecture, state transitions, compatibility decision, history bound, failure-injection evidence, files changed, exact checks/results, and confirmations. Stop after this task.