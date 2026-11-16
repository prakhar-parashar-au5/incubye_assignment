# AI assistant observability specification

## User and problem

Only Admin HR can inspect AI assistant traces.

The current application logs record request metadata, tool names, status, duration, and model failure categories. They do not preserve prompts, model responses, tool arguments, or tool results. Chat history exists only in browser memory.

Admin HR needs enough evidence to reconstruct one assistant turn: what the user asked, what the model received, which tools it selected, what arguments and results passed through those tools, what answer it returned, how long each step took, and where a failure occurred.

This version uses synthetic employee and compensation data. Complete AI inputs and outputs can therefore be retained for evaluation. The same policy is not approved for real employee data.

## Outcome

After this feature exists:

- HR users can return to their saved assistant conversations.
- Admin HR can search traces and inspect a complete ordered timeline.
- Admin HR can review a trace as correct, partially correct, or incorrect.
- Developers can diagnose model, validation, tool, persistence, and provider failures without storing secrets or hidden model reasoning.
- The assistant never makes an unrecorded provider or tool call.
- MCP calls have an independent audit trail.
- Records older than 30 days can be removed with a guarded manual cleanup command.

## Recording notice

The assistant page must show a visible notice:

```text
Assistant conversations and tool results are recorded for 30 days for quality review. This demo uses synthetic employee data. Do not enter passwords, tokens, or real personal information.
```

The notice appears before the first message and remains available from the conversation view. It must not be hidden only in terms or a tooltip.

This notice does not make unrestricted production-data recording acceptable. Before real employee data is used, storage and display redaction must be designed, implemented, tested, and approved.

## Permissions

Admin HR can:

- List and filter all AI traces.
- Open trace details.
- Use the formatted and raw JSON views.
- Add or replace a trace review.
- Delete a trace through the controlled delete action.
- View MCP call records.

Scoped HR can:

- Use the assistant with their current employee scope.
- View only their own saved conversations and messages.
- Continue a conversation that belongs to them.

Scoped HR cannot open trace, review, deletion, or MCP-observability APIs. An authenticated Scoped HR request to an Admin observability endpoint returns HTTP 403 `FORBIDDEN`.

The backend checks the actor's current role in MySQL for every Admin observability request. Hiding navigation in the frontend is not the authority.

Assistant tools continue to apply the current actor's employee scope. Observability must not become a path around employee access control.

## Conversation and turn model

A conversation groups assistant messages for one HR user.

A trace represents one submitted user message and the complete assistant turn that follows it. One trace can contain several model calls and several tool calls.

Rules:

- Each submitted user message creates a new trace.
- Retrying a message creates a new trace. It does not overwrite the failed or unwanted trace.
- Every trace has a `conversation_id`.
- A trace can reference the previous trace in that conversation.
- Sequence numbers provide the authoritative order inside a conversation and inside a trace.
- A conversation belongs to one HR user and cannot be transferred.
- The server loads saved conversation history. It does not trust a browser-supplied array of earlier messages as authoritative history.
- A user cannot continue or read another user's conversation.
- The model receives only the bounded history required by the assistant's context policy. Saving a conversation does not require sending its entire history to every provider call.

Persist both user and assistant messages. A successful turn has one user message and one final assistant message. A failed turn keeps the user message and a safe failure state; it does not store a fabricated assistant answer.

## Trace lifecycle

Trace statuses:

```text
STARTED
COMPLETED
FAILED
```

Failure stages:

```text
TRACE_CREATE
MODEL_CALL
MODEL_TRACE_WRITE
TOOL_VALIDATION
TOOL_EXECUTION
TOOL_TRACE_WRITE
FINAL_TRACE_WRITE
```

A trace is created synchronously before any OpenAI call.

For each later step:

1. Persist the input record required to reconstruct the attempted step.
2. Perform the provider call, validation, or tool execution.
3. Persist the outcome before continuing or returning an answer.

If required trace persistence fails, the assistant fails closed:

- It does not start an unrecorded model call.
- It does not execute an unrecorded tool call.
- It does not return a model answer whose required trace outcome could not be saved.
- It returns a generic assistant error without exposing database or provider details.
- It writes a safe application-log event with request ID, trace ID when available, failure stage, and error category.

A logging failure in the AI path must never affect authentication, employee directory, dashboard, salary adjustment, HR access, or other non-AI features.

## Data recorded for one trace

Store:

- Trace ID.
- Conversation ID.
- Previous trace ID when present.
- Request ID.
- HR user ID.
- User-message ID.
- Final assistant-message ID when completed.
- Start and completion time.
- Status and failure stage.
- Model failure category.
- Primary model name.
- System-prompt version and hash.
- Exact user content sent for this turn.
- Exact bounded conversation messages sent to the provider.
- Final assistant response.
- Total duration.
- Input tokens.
- Output tokens.
- Reasoning-token count when the provider reports only a count.
- Number of model calls.
- Number of tool calls.

Trace totals are derived from recorded child calls and stored when the parent trace reaches a terminal state for list performance. They must agree with those child records. Terminal status, completion time, failure fields, final response, final message ID, duration, token totals, and call counts are the only trace-finalization fields that can change after creation.

Do not store hidden chain-of-thought, encrypted reasoning content, or provider-internal reasoning payloads. A provider-reported reasoning-token count is allowed.

## Model-call records

The assistant loop can call OpenAI more than once for one user message. Store one `ai_model_calls` row for every attempted provider call.

Store:

- Trace ID.
- Call sequence number.
- Provider request ID when available.
- Provider and model.
- Input messages as JSON.
- System-prompt version and hash.
- Available tool names and schemas as JSON.
- Output text as JSON-compatible structured content.
- Tool-call decisions as JSON.
- Input, output, total, and reasoning-token counts when supplied.
- Start time, completion time, and latency.
- Status and failure category.
- Safe provider error metadata.

Never store an API key, authorization header, raw provider credential, or hidden reasoning content.

## Tool-call records

Store one `ai_tool_calls` row for every tool call requested by the model, including rejected and failed calls.

Store:

- Trace ID.
- Model-call ID.
- Provider tool-call ID.
- Tool sequence number.
- Tool name.
- Requested arguments as JSON.
- Argument-validation status and validation errors.
- Execution status.
- Start time, completion time, and duration.
- Complete structured result as JSON.
- Error category and safe error details.

This version stores complete tool results, including synthetic salary values, employee names, and employee codes.

Rejected calls retain the invalid arguments so Admin HR can diagnose the model decision. Arguments still pass through the forbidden-field scrubber before storage.

Tool-call status distinguishes at least:

```text
REJECTED
SUCCEEDED
FAILED
```

An unknown tool or invalid argument set is `REJECTED`; the tool is not executed.

## MCP call records

MCP calls do not create AI model-call traces because the MCP endpoint does not call OpenAI.

Store them in `mcp_tool_calls`, separate from `ai_tool_calls`.

Store:

- MCP call ID.
- Request ID.
- Authenticated HR user ID or approved client principal.
- Tool name.
- Requested arguments as JSON.
- Validation status.
- Execution status.
- Complete structured result as JSON.
- Error category and safe error details.
- Start time, completion time, and duration.

The authenticated principal comes from the server. It is never accepted from model or MCP tool arguments.

MCP tools apply the same current database-backed access policy as assistant tools.

## Sensitive data policy

### Version 1 synthetic-data decision

Version 1 stores complete prompts, responses, model inputs, tool arguments, and tool results because the dataset is synthetic.

The earlier preference to redact stored data applies to a future real-data version. It does not describe version 1 storage. This resolves the apparent conflict between “redact stored data” and “store it all”.

Even in the synthetic demo, always remove or reject these fields before persistence:

- OpenAI API keys.
- JWTs.
- Cookies.
- Passwords and password hashes.
- Database URLs and credentials.
- Authorization headers.
- Session tokens.
- Hidden model reasoning.

Use an allowlist for recorded HTTP and provider metadata. Do not serialize complete request headers, environment variables, thrown objects, database connection objects, or process state. OpenAI requests continue to use `store: false`; MySQL is the product's approved trace store for this version.

### Frontend display

The formatted trace timeline redacts employee names and employee codes in tool results by default. Salary values remain visible to Admin HR because compensation behavior is being evaluated.

The raw JSON view can show the complete synthetic prompt, response, arguments, and result. Before opening it, Admin HR sees:

```text
Raw trace data contains complete synthetic employee identities and compensation values.
```

The raw view is Admin-only, is not indexed by public search, and must not place trace content in URLs, browser local storage, analytics events, or client-side error reporting.

### Gate before real employee data

Real employee data must not use this recording policy. Before that deployment, the team must:

- Define field-level redaction or tokenization before database persistence.
- Redact identities and compensation according to an approved access and evaluation policy.
- Define who can reveal protected values and record that access.
- Reassess retention and deletion requirements.
- Test prompts, errors, rejected arguments, and tool results for indirect disclosure.
- Update the recording notice and privacy documentation.

Until these controls exist, real employee data is deliberately unsupported.

## Retention and deletion

The retention period is 30 days.

Retention uses record creation time, not conversation activity time. A newer message does not extend the lifetime of older turns.

Version 1 includes a manual cleanup command. Scheduling it is deferred.

The cleanup command must:

- Require an explicit execute flag; dry-run is the default.
- Refuse an invalid or missing retention value.
- Refuse a retention value below the approved 30 days unless the operator supplies a separate explicit override.
- Refuse production execution unless the production environment and destructive action are both explicitly acknowledged.
- Print counts and cutoff time, never prompt or result contents.
- Delete complete expired aggregates in a transaction or bounded transactions.
- Remove expired model calls, tool calls, reviews, messages, traces, empty conversations, and MCP records according to foreign-key rules.
- Return a non-zero exit code on failure.

Admin HR also has a controlled delete action for an individual trace. The UI must show the trace time, HR user, status, and irreversible consequence before confirmation.

Deleting a trace hard-deletes its model calls, tool calls, review, and the user/assistant messages that belong only to that turn. It does not delete other turns in the conversation. `previous_trace_id` uses `ON DELETE SET NULL` so a later trace remains readable.

Trace and child content cannot be edited in place. Immutability means no application update can rewrite recorded prompts, results, or call events. Controlled hard deletion for retention or an Admin request is the only exception. Lifecycle fields on the parent trace can move from `STARTED` to one terminal state.

## Admin trace list

Page:

```text
/admin/ai-traces
```

Show:

- Start time.
- HR user.
- Trace status.
- Model.
- Tool names.
- Duration.
- Input and output tokens.
- Model-call count.
- Tool-call count.
- Error category and failure stage.

Filters:

- Date range.
- HR user.
- Status.
- Model.
- Tool name.
- Error category.

Default sort is start time, newest first.

Use server-side filtering and pagination. Default page size is 25 and maximum is 100. Filters remain in the URL. List responses do not include raw prompts, responses, arguments, or results.

## Trace detail

The detail page shows an ordered timeline:

1. User prompt.
2. First model-call input and output.
3. Tool decision.
4. Requested and validated arguments.
5. Tool result or rejection.
6. Later model and tool calls in sequence.
7. Final assistant response.
8. Timing and token usage.
9. Errors and failure stage.
10. Admin review.

Provide two views:

- **Formatted:** readable messages, status chips, structured cards, default identity redaction, durations, and token totals.
- **Raw JSON:** the exact stored JSON available only after the synthetic-data warning.

JSON rendering must handle large nested values without freezing the page. Collapse large sections by default and copy only through an explicit user action.

User-facing states:

- Loading: stable timeline skeleton.
- Empty: explain that no traces match the filters.
- Permission denied: show the standard forbidden state.
- Deleted or unknown trace: HTTP 404 and a not-found page.
- Partial failure: show all persisted steps and mark the exact failure stage.
- Raw JSON parse/display failure: keep the formatted view available and show a safe display error.

## Review and evaluation workflow

Admin HR can review a trace as:

```text
CORRECT
PARTIAL
INCORRECT
```

A review includes:

- Trace ID.
- Reviewer HR user ID.
- Verdict.
- Review note of at most 2,000 characters.
- Whether the trace is nominated as an evaluation-fixture candidate.
- Created and updated times.

One current review exists per trace. Re-review replaces the verdict and note while preserving reviewer and update metadata. Review changes do not alter the trace or call records.

A nominated trace does not automatically become a fixture. A developer must manually inspect and redact it before copying the minimum required input and expected output into the evaluation corpus. Never export credentials, session data, unnecessary employee identity, or hidden reasoning.

Deterministic evaluators are required for security and policy properties where possible:

- Tool name is allowed.
- Arguments match the schema.
- Result respects employee scope.
- Answer agrees with structured compensation cards.
- Currency rules are followed.
- Mutation requests are refused by read-only tools.
- Forbidden secret fields are absent.

An LLM judge may later score answer quality, clarity, and groundedness. It must not be the only evaluator for authorization, mutation safety, exact money, or currency correctness.

Track latency and token use as measurements, not correctness verdicts.

## Database tables

Required tables:

```text
ai_conversations
ai_messages
ai_traces
ai_model_calls
ai_tool_calls
mcp_tool_calls
ai_trace_reviews
```

Relationships:

```text
ai_conversations 1 -> many ai_messages
ai_conversations 1 -> many ai_traces
ai_traces 1 -> many ai_model_calls
ai_model_calls 1 -> many ai_tool_calls
ai_traces 0 -> 1 ai_trace_reviews
```

Use native MySQL `JSON` columns for message payloads, model inputs and outputs, tool schemas, tool arguments, tool results, validation details, and safe error details.

Use normal typed columns for IDs, sequence numbers, statuses, model names, timestamps, durations, token counts, and searchable error categories. Do not filter list pages by scanning JSON when a first-class indexed field exists.

Required integrity rules include:

- Unique message sequence within a conversation.
- Unique trace sequence within a conversation.
- Unique model-call sequence within a trace.
- Unique tool-call sequence within a trace.
- At most one review per trace.
- Non-negative duration and token counts.
- Foreign keys with deliberate retention and delete behavior.
- Indexes for start time, HR user, status, model, error category, tool name, conversation, and retention cutoff.

Trace event content is append-only. Parent trace lifecycle completion and review replacement are controlled updates, not arbitrary event edits.

## API

### Saved conversations

Authenticated assistant-user endpoints:

```text
GET    /api/v1/assistant/conversations
POST   /api/v1/assistant/conversations
GET    /api/v1/assistant/conversations/:conversationId
POST   /api/v1/assistant/conversations/:conversationId/messages
```

A user sees and continues only their own conversations. The message endpoint creates the user message and trace, runs the recorded assistant turn, and persists the final assistant message on success.

Conversation lists use server-side pagination. They return summaries, not trace internals.

### Admin traces

Required Admin-only endpoints:

```text
GET    /api/v1/admin/ai-traces
GET    /api/v1/admin/ai-traces/:traceId
POST   /api/v1/admin/ai-traces/:traceId/review
DELETE /api/v1/admin/ai-traces/:traceId
GET    /api/v1/admin/mcp-tool-calls
GET    /api/v1/admin/mcp-tool-calls/:mcpCallId
```

The trace list supports the approved filters, sort, and pagination. The detail endpoint supports formatted data and raw JSON through an explicit response-view parameter. Raw content is never included in list results.

Review validation accepts only the approved verdicts and note length. Delete requires explicit confirmation data. Repeating a delete is safe: an already deleted or unknown trace returns 404 and cannot affect another record.

Important results:

- `400 VALIDATION_ERROR`: malformed filters, review, or conversation input.
- `401 UNAUTHENTICATED`: no valid session.
- `403 FORBIDDEN`: authenticated user lacks Admin authority.
- `404 NOT_FOUND`: trace, MCP call, or owned conversation is unavailable.
- `409 CONFLICT`: an idempotency key is reused with different content, or a review version is stale.
- `429 RATE_LIMITED`: existing assistant limit exceeded.
- `502 MODEL_PROVIDER_FAILED`: provider call failed after trace creation.
- `503 ASSISTANT_UNAVAILABLE`: required AI trace persistence or execution dependency is unavailable.

Unknown and unowned conversations use the same 404 response to avoid disclosing their existence.

## Concurrency and retry

- A client retry of message submission requires an idempotency key.
- Repeating the same idempotency key and canonical message command returns the existing result or current trace state.
- Reusing an idempotency key with different content returns HTTP 409.
- Selecting Retry in the UI sends a new idempotency key and creates a new trace linked to the same conversation.
- Sequence numbers are allocated safely under concurrent messages to one conversation.
- A trace can reach only one terminal state.
- Concurrent review updates use an expected review version or equivalent compare-and-set rule so one Admin does not silently overwrite another Admin's review.
- Delete and review operations lock or conditionally update the target so a review cannot be written onto a deleted trace.

## Tests I expect

### Conversation persistence

```text
Given: An authenticated HR user starts a conversation and completes one assistant turn.
When: The user reloads the assistant page.
Then: The server returns the saved user and assistant messages in their original order.
Plausible bug caught: Chat history still depends on browser memory and disappears on reload.
```

```text
Given: Two HR users have separate saved conversations.
When: One user requests the other user's conversation ID.
Then: The API returns 404 without conversation content.
Plausible bug caught: Guessing an ID exposes another HR user's prompts and salary results.
```

### Model and tool timelines

```text
Given: One assistant turn completes without selecting a tool.
When: Admin opens its trace.
Then: The trace has one or more ordered model calls, zero tool calls, the final response, timing, and token usage.
Plausible bug caught: The timeline assumes every model call has a tool child.
```

```text
Given: A turn performs several model and tool calls.
When: Admin opens its trace.
Then: Every call appears once in execution order with matching parent IDs and aggregate counts.
Plausible bug caught: Repeated loop iterations overwrite the first call or produce misleading totals.
```

```text
Given: The model requests an unknown tool or invalid arguments.
When: Validation rejects the call.
Then: The invalid scrubbed arguments and validation errors are recorded, the tool is not executed, and status is REJECTED.
Plausible bug caught: Rejected model behavior disappears from observability or reaches the repository.
```

```text
Given: A valid tool throws a controlled execution error.
When: The trace is viewed.
Then: The attempted arguments, FAILED status, duration, and safe error category appear without stack secrets.
Plausible bug caught: A tool failure is misreported as a provider failure or leaks an internal exception.
```

### Failure policy

```text
Given: Creating the parent trace fails.
When: A user submits a message.
Then: OpenAI is not called and the user receives a safe assistant-unavailable error.
Plausible bug caught: The system makes an unrecorded provider call.
```

```text
Given: OpenAI returns an answer but saving the required model outcome fails.
When: The assistant handles the provider response.
Then: The answer is not returned, the turn fails safely, and application logs contain only safe identifiers and failure category.
Plausible bug caught: Users receive behavior that Admin cannot reconstruct.
```

```text
Given: AI trace storage is unavailable.
When: A user opens the directory, dashboard, or salary workflow.
Then: The non-AI feature continues normally.
Plausible bug caught: AI observability becomes a shared application dependency.
```

### Security and permissions

```text
Given: A Scoped HR user calls an Admin trace endpoint.
When: Current authority is checked in MySQL.
Then: The API returns 403 and no trace metadata or content.
Plausible bug caught: Frontend-only navigation hiding is mistaken for authorization.
```

```text
Given: A prompt or rejected argument contains fields named authorization, cookie, password, token, or database URL.
When: The trace is persisted.
Then: Forbidden values are absent or replaced with a fixed redaction marker.
Plausible bug caught: Complete JSON serialization stores credentials with an otherwise useful trace.
```

```text
Given: A Scoped HR user asks about employees outside their current country and department scope.
When: The assistant or MCP tool executes.
Then: Tool results reveal no hidden identities, compensation, counts, or existence signals.
Plausible bug caught: Trace work bypasses the established database-backed access policy.
```

```text
Given: Admin opens the formatted trace detail.
When: A tool result contains synthetic employee names and codes.
Then: Identities are redacted by default, while the warned raw view contains the complete stored synthetic JSON.
Plausible bug caught: The UI either ignores the display decision or destroys evidence in storage.
```

### Retention, deletion, and reviews

```text
Given: Traces and MCP calls exist on both sides of the 30-day cutoff.
When: Cleanup runs first in dry-run and then with explicit execution approval.
Then: Dry-run changes nothing; execution removes only expired aggregates and leaves no orphan child rows.
Plausible bug caught: Cleanup uses conversation activity time, deletes fresh records, or leaves sensitive children behind.
```

```text
Given: Admin confirms deletion of one trace in a multi-turn conversation.
When: Deletion completes.
Then: Only that turn, its child calls, and its review are removed; later turns remain readable.
Plausible bug caught: Cascade rules delete the complete conversation or leave dangling trace content.
```

```text
Given: Two Admin users edit the same review version.
When: Both submit different verdicts.
Then: One succeeds and the stale update returns 409.
Plausible bug caught: The later request silently overwrites another reviewer's evaluation.
```

### List, API, and browser behavior

```text
Given: More than 100 traces match several possible filters.
When: Admin requests a filtered page.
Then: The backend applies filters before pagination, enforces the maximum page size, and returns no raw payload fields.
Plausible bug caught: Client-side filtering misses records or list responses expose full prompts.
```

```text
Given: A trace contains a model timeout after a successful tool call.
When: Admin opens the detail page.
Then: The persisted timeline remains visible and the timeout stage is marked clearly.
Plausible bug caught: A terminal failure hides useful earlier evidence.
```

```text
Given: A trace has deeply nested or large JSON results.
When: Admin opens and expands the raw view.
Then: The page remains usable, content is collapsed by default, and no trace content enters the URL or analytics.
Plausible bug caught: Raw observability data freezes the browser or leaks through client telemetry.
```

## Performance

Expected first-version scale is the existing demo workload under a 20 assistant requests per authenticated HR user per 15 minutes limit.

Measure:

- Trace-create latency added before the first provider call.
- Persistence latency for each model and tool outcome.
- Trace list query latency with 30 days of data.
- Trace detail payload size and render time for multi-call turns.
- Cleanup duration and affected-row counts.

Do not add caching before measurement. Trace list indexes and bounded pagination are required. Detail responses may load the complete trace because the page is Admin-only and explicitly selected, but the backend must enforce a maximum stored payload size per JSON field and return a controlled error if a provider or tool result exceeds it.

## Deliberately excluded

- Hidden chain-of-thought or encrypted-reasoning storage.
- Real employee data under the version 1 complete-recording policy.
- Direct AI mutation of compensation or HR access.
- Arbitrary SQL tools.
- Production observability vendor.
- Distributed tracing platform.
- Kafka or queue-based trace ingestion.
- Scheduled retention job in version 1.
- Automated prompt optimization.
- Automatic creation of evaluation fixtures from raw traces.
- LLM judges for authorization, exact money, mutation safety, or other deterministic policies.
- LangChain, LangGraph, or LangSmith unless a later requirement demonstrates a specific benefit that the current direct implementation cannot provide simply.

## Open questions

No product questions block version 1.

Before implementation, the builder must choose and document bounded maximum sizes for stored prompt, response, argument, result, and error JSON. Those limits are an engineering safety decision and must be covered by tests; they must not silently truncate evidence.
