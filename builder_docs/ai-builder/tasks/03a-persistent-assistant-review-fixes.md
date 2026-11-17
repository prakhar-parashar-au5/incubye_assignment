# AI builder task 03a: persistent assistant review fixes

## Status

READY

## Goal

Close three confirmed Task 03 gaps before MCP or Admin observability work starts.

## Read first

```text
builder_docs/ai-builder/tasks/03-persistent-recorded-assistant.md
builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md
builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md
docs_human/13-ai-observability.md
docs/27-agent-blocker-reporting-protocol.md
```

Reproduce each finding with a failing test before changing behavior.

## 1. Persist model-not-configured failures

A valid submission to an owned conversation must retain its user message and failed turn even when no model is configured.

Required behavior:

- Ownership and idempotency checks still run.
- User message and `STARTED` trace are created atomically.
- Zero provider and tool calls occur.
- Trace finalizes as `FAILED`, stage `MODEL_CALL`, safe category `not_configured` or one documented equivalent.
- No assistant message or final response is stored.
- API returns `503 ASSISTANT_UNAVAILABLE` with reason `MODEL_NOT_CONFIGURED`.
- Conversation detail exposes the saved user message and safe failed-turn state.
- Same key/same command replays the failure without another trace or message.
- Same key/different command returns 409.

Apply equivalent recording to the deprecated compatibility route while preserving its generic 503 body and deprecation headers.

Use explicit safe model/provider metadata for the unconfigured state; do not weaken non-null schema constraints.

## 2. Resolve narrowed-scope saved content with Option C

Decision: record the actor's trace-time scope and withhold the complete assistant message when current scope no longer covers it.

Add a forward migration with the minimum trace-time authorization snapshot:

- Role.
- Sorted country set.
- Sorted department set.

Do not store session IDs or create another authorization model.

For conversation read, idempotent replay, and bounded-history selection:

- Reload the current database-backed principal.
- Existing Admin authority remains as approved.
- For Scoped HR, current scope covers trace-time scope only when current countries are a superset of trace-time countries and current departments are a superset of trace-time departments.
- If scope is narrower or sideways/incomparable, withhold the entire assistant message: prose, cards, aggregate populations, and limitations derived from that answer.
- Return a fixed safe withheld state/notice.
- Exclude the withheld turn from future model history.
- Keep the user's own submitted message visible.
- Never modify stored historical evidence.
- Existing traces without a snapshot fail closed for Scoped HR.

Test unchanged, broader, narrower, and sideways scopes; Scoped-to-Admin promotion; and missing legacy snapshot.

Mark `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md` resolved with these semantics.

## 3. Never persist malformed raw tool arguments

Unparseable argument text cannot pass field-key scrubbing. Preserve diagnostic status without preserving raw unstructured content.

For invalid JSON arguments, persist one fixed safe representation such as an invalid-JSON marker. Keep the validation reason and `REJECTED` status. Never persist the raw malformed string in:

- Model-call tool decisions.
- Tool-call requested arguments.
- Recorded model exchanges.
- Responses or logs.

Test malformed input containing recognizable authorization, cookie, password, token, API-key, JWT, database URL, and hidden-reasoning values. None may appear anywhere, and the tool must not execute.

## Preserve

- Fail-closed attempt/outcome ordering.
- Provider telemetry.
- Bounded complete-turn history.
- Message idempotency and Retry links.
- Rate limits.
- Strict runtime schemas and OpenAPI.
- OpenAI `store: false`.
- No hidden/encrypted reasoning persistence.
- Deprecated-route removal at Checkpoint C.

## Scope limits

Do not implement Task 04, MCP instrumentation, Admin trace APIs, evaluator fixtures, or frontend code. Do not edit `docs_human/**`.

Never read `.env`, use a live API key, run Git, commit, or push. Use only the isolated AI backend test database.

## Validation

Run OpenAPI generation/drift, lint, typecheck, fast tests, full real-MySQL tests, and production build.

## Response

Update:

```text
builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md
```

Add a clearly dated Task 03a correction section with root causes, migration, tests, exact results, and confirmations. Stop after Task 03a.