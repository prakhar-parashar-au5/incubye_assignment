# AI builder task 01: observability storage foundation

## Status

Approved for implementation.

This is the first bounded observability task. Build the persistence foundation only. Do not wire it into live assistant or MCP requests yet. The planner will review this foundation before integration changes begin.

## Read first

```text
builder_docs/ai-builder/handoff.md
docs_human/13-ai-observability.md
express-backend/src/db/migrate.ts
express-backend/src/db/connection.ts
express-backend/src/assistant/assistant-service.ts
express-backend/src/http/assistant-routes.ts
express-backend/src/http/mcp-routes.ts
express-backend/test/db/migrations.test.ts
```

If a listed path has moved, find the current equivalent and record that in the response.

Read the current migration and database-test conventions before editing.

## Goal

Create a tested MySQL persistence foundation for saved assistant conversations, AI traces, model calls, assistant tool calls, MCP tool calls, and Admin reviews.

At the end of this task, application code must be able to create and read these records through typed repository interfaces. Existing assistant and MCP behavior must remain unchanged because live instrumentation is a later task.

## Required schema

Add forward-only migration or migrations for:

```text
ai_conversations
ai_messages
ai_traces
ai_model_calls
ai_tool_calls
mcp_tool_calls
ai_trace_reviews
```

Implement the relationships and integrity rules from `docs_human/13-ai-observability.md`.

Required details:

- Use the project's existing ID and timestamp conventions.
- Use MySQL `JSON` for structured message, model, tool, validation, result, and safe-error payloads.
- Use typed columns for searchable status, model, tool name, error category, sequence, duration, token count, actor, and timestamps.
- Add foreign keys with explicit delete behavior.
- `previous_trace_id` must use `ON DELETE SET NULL`.
- Deleting one trace must cascade only to its model calls, tool calls, review, and turn-owned messages. It must not delete the conversation or another turn.
- Add uniqueness constraints for conversation message sequence, conversation trace sequence, model-call sequence per trace, tool-call sequence per trace, and one review per trace.
- Add indexes required for Admin filters and the 30-day retention cutoff.
- Store non-negative durations and token counts.
- Support `STARTED`, `COMPLETED`, and `FAILED` trace lifecycle states without allowing arbitrary event-content edits.
- Keep MCP calls independent from AI model-call traces.

Do not add a second general audit framework, queue, ORM, tracing vendor, LangChain, LangGraph, or LangSmith.

## Persistence modules

Create a focused module boundary under the existing assistant area, such as:

```text
express-backend/src/assistant/observability/
```

Use the repository's established database wrapper. Do not create a new connection pool.

Expose typed operations for:

- Create and list a user's conversations.
- Read one owned conversation with ordered messages.
- Append a user or assistant message with a safe sequence allocation strategy.
- Create a `STARTED` trace before external execution.
- Append an attempted model call and finalize it as success or failure.
- Append an attempted assistant tool call and finalize it as rejected, success, or failure.
- Finalize a parent trace exactly once as `COMPLETED` or `FAILED` with totals.
- Create an MCP call and finalize it as rejected, success, or failure.
- List and read traces using Admin filter inputs without embedding authorization inside the repository.
- Create or replace one Admin review using an expected review version or equivalent compare-and-set rule.
- Hard-delete one trace with the exact aggregate behavior in the specification.
- Find records older than a supplied retention cutoff and delete complete expired aggregates.

Do not add HTTP routes in this task. Do not change the existing assistant request contract. Do not call these repositories from the live model loop or MCP handlers yet.

## Secret-field scrubber

Create and test one recursive scrubber used at every future JSON persistence boundary.

It must remove or replace values whose field names represent:

- Authorization headers.
- Cookies.
- Passwords and password hashes.
- JWTs and session tokens.
- API keys and generic token fields.
- Database URLs or credentials.

Requirements:

- Handle nested objects and arrays.
- Do not mutate the caller's object.
- Use a fixed redaction marker.
- Do not serialize request objects, environment variables, thrown objects, or database connections.
- Do not attempt to infer or store hidden model reasoning.
- Preserve ordinary synthetic employee identity and salary fields in storage.

Keep this mechanism small and explicit. Do not introduce a data-loss-prevention package.

## Payload limits

Choose bounded maximum serialized sizes for:

- Conversation message content.
- Model input and output JSON.
- Tool arguments and results.
- Validation and safe-error JSON.

Document the chosen values and reasoning in the builder response.

Behavior must be explicit:

- Validate before inserting.
- Return a typed persistence validation error.
- Never silently truncate JSON.
- Never replace a complete result with a misleading partial result.

Do not add arbitrary limits to existing live assistant behavior in this task.

## Retention service and CLI

Implement the service and a manual CLI entry point for 30-day retention.

The CLI must:

- Default to dry-run.
- Require an explicit execute flag to delete.
- Require a valid retention-days value.
- Refuse fewer than 30 days unless a separate explicit override is present.
- Require an explicit production acknowledgement before production deletion.
- Print cutoff and row counts only, never trace content.
- Return non-zero on failure.

Automated scheduling is excluded.

Tests must use the isolated test database. Never read `.env`.

## Test-first requirements

Write failing tests before each behavior and report the red and green command/output honestly.

### Fast tests

Cover at least:

- Recursive secret-field scrubbing.
- Scrubber immutability.
- JSON payload-size validation.
- Status-transition validation.
- Review verdict and note validation.
- Retention CLI argument validation and dry-run default.

### Real-MySQL integration tests

Cover at least:

- Migration creates every table, foreign key, unique constraint, and required index.
- A conversation stores ordered messages.
- Concurrent message or trace sequence allocation does not duplicate a sequence.
- A trace stores multiple ordered model and tool calls without overwriting earlier calls.
- Rejected tool arguments remain stored after secret scrubbing.
- Complete synthetic salary and employee result fields remain stored.
- Parent trace finalization stores matching totals and cannot reach a second terminal state.
- Stale review replacement fails instead of overwriting another Admin's review.
- Deleting one trace removes only that trace aggregate and turn-owned messages.
- `previous_trace_id` becomes null when its referenced trace is deleted.
- Retention dry-run changes nothing.
- Retention execution removes only records older than the cutoff and leaves no orphan rows.
- MCP records remain independent from AI traces and follow their retention cutoff.
- Oversized JSON fails without partial persistence.

Use deterministic clocks and fixtures. Do not require OpenAI or any network call.

## Existing behavior protection

Run the established backend fast tests, real-MySQL tests, type check, and production build that are relevant to the touched code.

Existing assistant and MCP tests must still pass without behavior changes.

Do not update snapshots or expectations merely to hide a regression.

## Files you must not change

```text
docs_human/**
next-frontend/**
express-backend/src/compensation/adjustment.ts
express-backend/test/compensation-adjustment.test.ts
```

Do not modify unrelated dashboard, salary-adjustment, HR-access, directory, authentication, or seed behavior.

## Security rules

- Never read or create `.env` files.
- Never ask for or handle a real OpenAI key.
- Never put secrets in fixtures, logs, reports, or source.
- Never run a Git command.
- Do not commit or push.
- Do not run a database write outside the isolated automated test database.
- Do not reseed or alter the development database.

## Stop conditions

Stop and report instead of guessing if:

- The existing migration design cannot express the required cascade behavior safely.
- A schema choice would require changing existing assistant API behavior.
- The test database cannot be identified without reading `.env`.
- Existing uncommitted work overlaps a file this task must change.
- A requirement conflicts with the completed human specification.

## Response

Write the implementation report to:

```text
builder_docs/ai-builder/responses/01-observability-storage-foundation.md
```

Include:

- Files changed.
- Schema and repository design.
- Payload limits and reasoning.
- Exact red-to-green test evidence.
- Full validation commands and results.
- Any tests not run and why.
- Risks or decisions the planner must review.
- Confirmation that no Git command, `.env` read, development-database write, OpenAI call, commit, or push occurred.

Stop after writing the report. Do not start live assistant integration, Admin APIs, or frontend work.