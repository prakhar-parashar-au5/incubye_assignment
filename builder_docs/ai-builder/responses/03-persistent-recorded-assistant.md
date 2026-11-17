# AI Task 03: persistent recorded assistant turns

**Task:** `builder_docs/ai-builder/tasks/03-persistent-recorded-assistant.md`

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend` (branch `feature/ai-observability-backend`, from Checkpoint A `3853f4b`). I took the branch name and checkpoint from the handoff and did not check them with Git.

**Status:** Complete and verified, except Q-C5 parts 2 and 3. Those wait on a product decision recorded in `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md` (NEEDS_DECISION). Not committed.

**Resume pass (2026-11-16):** I continued from the uncommitted Task 03 work and kept all of it. I resolved the conversation contract questions Q-C1 to Q-C11 from `builder_docs/ai-builder/issues/03-observability-frontend-contract-questions.md` (section 2a). That added a current-scope check on saved cards, a `reason` on failed turns, and a published `Retry-After`, and made the OpenAPI descriptions more precise.

**Result:**
- Conversations are now server-owned.
- Every model and tool step of the in-product assistant is recorded before and after it runs, and the turn fails closed when a required write fails.
- Message submission is idempotent and history is bounded on the server.
- Runtime schemas and OpenAPI are updated.
- Fault-injection tests cover every required boundary.
- Out of scope and not built: MCP observability, Admin trace routes, frontend changes, AI mutations, new frameworks, queues.

## 1. Architecture

| Layer | File | Role |
|---|---|---|
| Model port | `src/assistant/model.ts` | `ModelAdapter` now exposes `provider` and `model`. `ModelReply` carries an optional telemetry envelope `{ providerRequestId?, usage?: { inputTokens?, outputTokens?, totalTokens?, reasoningTokens? } }`. `ModelFailure` carries a safe category plus an optional `providerRequestId`. No other provider field crosses the interface. |
| OpenAI adapter | `src/assistant/openai-model.ts` | Fills the envelope from `response.usage` and the `x-request-id` request ID (`response._request_id`, or `APIError.requestID` on errors). Malformed IDs are dropped. Requests still use `store: false`. Encrypted reasoning items stay in the session's own input list for the live loop only; they never appear in `ModelReply`, so they cannot reach storage, logs, or responses. |
| Recorded loop | `src/assistant/assistant-service.ts` | `runTurn()` is the bounded tool loop with a `TurnRecorder` port. A failed required write throws `TurnFailure(stage, category)`. The old unrecorded `ask()` is gone. |
| Persistence port | `src/assistant/assistant-store.ts` | `AssistantStore` is a `Pick` of the existing observability repository: the same persistence model, not a new one. |
| Conversations | `src/assistant/conversation-service.ts` | Ownership, history policy, idempotency, Retry, trace lifecycle, and the error mapping. |
| Repository | `src/assistant/observability/repository.ts` | New reads: `listConversationSummaries`, `readConversation` (messages plus turn states), `findTraceByIdempotency`. Other changes in section 7. |
| HTTP | `src/http/assistant-routes.ts`, `app.ts`, `server.ts` | The four routes plus the deprecated route. Production passes `createObservabilityRepository(pool)` as `assistantStore`. |

**Source for provider behaviour:** the openai-node README, section "Request IDs" (`_request_id`, taken from the `x-request-id` header), read 2026-11-16 at https://github.com/openai/openai-node/blob/master/README.md. The usage fields (`input_tokens`, `output_tokens`, `total_tokens`, `output_tokens_details.reasoning_tokens`) come from the installed SDK type definitions, `openai` 7.57.0.

## 2. API

| Operation | Behaviour |
|---|---|
| `GET /api/v1/assistant/conversations` | The caller's conversations, most recently active first. `page`/`pageSize`, default 25, maximum 100. Returns summaries only: id, times, message count, and a title from the first 80 characters of the first user message. |
| `POST /api/v1/assistant/conversations` | Strict empty body. `201` with the new conversation, owned by the authenticated user. |
| `GET /api/v1/assistant/conversations/:conversationId` | Ordered `messages` (sequence, role, text, and for assistant messages the tool statuses, cards, limitations, and generation time) plus `turns` (trace ID, status, previous and retried trace, message sequences, and a safe error for failed turns). |
| `POST /api/v1/assistant/conversations/:conversationId/messages` | `Idempotency-Key` (16 to 100 URL-safe characters, matching the `VARCHAR(100)` column) and a strict body `{ content, retryOfTraceId? }`. Returns `AssistantTurnResponse`: the existing answer, tool statuses, cards, limitations, and generation time, plus `conversationId`, `traceId`, `previousTraceId`, and both message sequences. |

**Rules:**
- **Ownership.** Unknown, unowned, and malformed conversation IDs all return the same `404 NOT_FOUND` with "Conversation not found.".
- **One message per submission.** The body accepts exactly one user message; a `messages` array, roles, and identity fields are rejected with `400`.
- **Rate limit.** One limiter instance (20 per HR user per 15 minutes) is shared by the new message route and the deprecated route. Reads and conversation creation do not count.

**Errors:**

| Status | Code | Meaning |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Includes the reason `IDEMPOTENCY_KEY_REQUIRED`, and a Retry of a trace outside the conversation. |
| `401` | `UNAUTHENTICATED` | |
| `404` | `NOT_FOUND` | |
| `409` | `DUPLICATE_OPERATION` | Same key, different command. |
| `409` | `ASSISTANT_TURN_IN_PROGRESS` | **New.** The same command is still running. |
| `429` | `RATE_LIMITED` | |
| `502` | `MODEL_PROVIDER_FAILED` | **New.** Reasons `MODEL_TIMEOUT`, `MODEL_RATE_LIMITED`, `MODEL_ERROR`, `MODEL_INVALID_RESPONSE`. |
| `503` | `ASSISTANT_UNAVAILABLE` | Reasons `MODEL_NOT_CONFIGURED`, `TRACE_UNAVAILABLE` (required recording failed), `TURN_TIMEOUT`. |

`docs_human/13` names the idempotency conflict `409 CONFLICT`. I used the existing `DUPLICATE_OPERATION`, which salary and HR access already use for exactly this case (decision 1).

Error bodies and logs contain only the public code, reason, request ID, trace ID, stage, and category. They never contain SQL, provider text, prompts, or results.

## 2a. Conversation contract questions Q-C1 to Q-C11

Source: section 15 of the AI-traces frontend shape brief (`/Users/admin/Desktop/Projects/incubyte_take_home_ai_traces_ui/builder_docs/ai-traces-frontend-builder/responses/01-shape-saved-conversations-and-observability.md`), routed here by `builder_docs/ai-builder/issues/03-observability-frontend-contract-questions.md`. Each answer is published in the runtime schemas and OpenAPI.

| ID | Answer | Where published |
|---|---|---|
| **Q-C1** First message | Creating a conversation takes no `Idempotency-Key`, and the message endpoint never creates one. The frontend makes two calls. A conversation whose first message never arrived stays listed with `messageCount: 0` and `title: null`. Retention deletes empty conversations 30 days after creation (`deleteExpired`). Accepted as is: it holds no content. | `createAssistantConversation` description |
| **Q-C2** List summary | `conversationId`, `createdAt`, `lastMessageAt` (null when empty), `messageCount`, `title` (first 80 characters of the first user message, null when empty). Ordered by last activity, `COALESCE(MAX(message.created_at), conversation.created_at)` descending, then ID. `page`/`pageSize` (default 25, maximum 100); `page` returns `number`, `size`, `totalRows`, `totalPages`. | `AssistantConversationSummary`, `AssistantConversationListResponse` |
| **Q-C3** Thread messages | Each message: `sequence` (authoritative order; also its identity, so there is no separate message ID), `role`, `traceId`, `createdAt`, `text`, `response`. Turn state comes from `turns[]`: `traceId`, `sequence`, `status` (`STARTED`, `COMPLETED`, `FAILED`), `previousTraceId`, `retryOfTraceId`, both message sequences, and `error`. Messages are **not paginated**; the detail returns every saved message and turn. Gaps in `sequence` mean deleted or expired turns. | `AssistantConversationDetailResponse` field descriptions |
| **Q-C4** Saved assistant content | Same structure as today's assistant response, split as `text` (the answer) and `response` (`toolCalls`, `cards`, `limitations`, `generatedAt`). The existing turn and card components can render it. | `AssistantConversationMessage` |
| **Q-C5** Scope on read | **Changed in this pass.** On every read and on an idempotent replay, saved cards are re-checked against the caller's **current** scope, loaded from MySQL for each request. Employee and change rows are filtered by country AND department. Summary groups labelled with a department or country outside the scope are removed. If anything is removed, the limitation "Some saved results outside your current access were not shown." is added. Stored rows are not modified, and Admin HR responses are unchanged. **Open:** summary populations and the answer text cannot be re-checked; see the NEEDS_DECISION issue. | `AssistantConversationDetailResponse` description; `rescopeSavedResponse` |
| **Q-C6** History bound | At most the 4 most recent `COMPLETED` turns (user message plus final answer), at most 16,000 characters, newest first, stopping at the first turn that does not fit. Failed, in-progress, and retried turns, and earlier tool data, are never sent. Published so the UI can say the assistant considers recent messages only. | Message-operation description |
| **Q-C7** Retry link | Explicit: the body carries `retryOfTraceId` with a **new** key. The new turn's `previousTraceId` is that trace, and the detail shows `turns[].retryOfTraceId`. | `AssistantMessageRequest.retryOfTraceId` |
| **Q-C8** Idempotency key | The `Idempotency-Key` header, pattern `^[A-Za-z0-9_-]{16,100}$`, at most 100 to match the column. A UUID v4 (36 characters) is accepted. | Header parameter description |
| **Q-C9** Rate limit | **Published in this pass.** A 429 carries `Retry-After` (seconds until the window resets) plus the draft-8 `RateLimit` and `RateLimit-Policy` headers. express-rate-limit 8.7.4 already sent them; they are now documented and tested. | 429 response headers |
| **Q-C10** Message response | Success `200 AssistantTurnResponse`: answer, tool statuses, cards, limitations, `generatedAt`, `conversationId`, `traceId`, `previousTraceId`, both sequences. Failure bodies are `ErrorResponse` (`code`, `message`, `reason`): `502 MODEL_PROVIDER_FAILED` with a model reason, and `503 ASSISTANT_UNAVAILABLE` with `MODEL_NOT_CONFIGURED`, `TRACE_UNAVAILABLE`, or `TURN_TIMEOUT`. Error bodies carry no trace ID. When a trace was created, it appears in the conversation detail as a `FAILED` turn. **Changed in this pass:** `turns[].error` now carries the same `reason`, and the standard public message instead of an empty string. A replay while the original turn runs returns `409 ASSISTANT_TURN_IN_PROGRESS` with `Idempotency-Replayed: true`. | Message-operation description; `AssistantConversationTurn.error` |
| **Q-C11** Old endpoint | `POST /api/v1/assistant/messages` stays deprecated and fully recorded. It is removed at **Checkpoint C**, once the AI frontend uses the conversation API (section 4). | Operation `deprecated: true` and description |

## 3. Recorded state machine (one submitted message)

1. Authenticate, then load the owned conversation (`404` otherwise).
2. **Idempotency check.** The command hash is SHA-256 of a version label plus `[conversationId, content, retryOfTraceId]`. The same key and hash return the stored outcome with `Idempotency-Replayed: true`:
   - a `COMPLETED` trace returns the saved response;
   - a `FAILED` trace returns the same error;
   - a `STARTED` trace returns `409 ASSISTANT_TURN_IN_PROGRESS`.

   The same key with another hash returns `409 DUPLICATE_OPERATION`.
3. No model configured: `503`, and nothing is written.
4. Select bounded history (section 5).
5. **Create the trace before any provider call.** `createTrace` writes the `STARTED` trace and the user message in one transaction, together with the exact bounded model messages, user content, model name, prompt version `assistant-instructions-v1`, and the SHA-256 of the exact instructions text. Failure: `503` and no provider call.
6. **Each model round:**
   1. Persist the attempt: provider, model, exact provider-neutral input, tool schemas, prompt version and hash.
   2. Call the provider.
   3. Persist the outcome: text, tool decisions with provider call IDs, token counts, request ID, latency, and on failure a safe category.

   Only then are the text or the tool decisions used.
7. **Each requested tool call:**
   1. Persist the attempt: tool name, provider call ID, parent model call, requested arguments.
   2. Validate and execute with the server principal; the model never supplies identity, role, or scope.
   3. Persist the outcome:
      - `SUCCEEDED` with the complete data, cards, and limitations;
      - `REJECTED` with a validation reason: unknown tool, invalid arguments, too many calls, or past the round limit;
      - `FAILED` with `TOOL_FAILED`, `OUTPUT_TOO_LARGE`, or `turn_timeout`.

   Only then is the next model call made.
8. **Finish.** `finishTrace(COMPLETED)` writes the assistant message and the trace totals derived from the child rows. The answer is returned only after it succeeds.
9. **Any failure.** `finishTrace(FAILED, stage, category)` runs on a best-effort basis:
   - it closes any attempt left without an outcome as `FAILED / OUTCOME_NOT_RECORDED`;
   - it writes no assistant message;
   - a safe log event `assistant_trace_failure` records the request ID, trace ID, stage, and category.

**Unchanged bounds:** 4 tool rounds, 4 calls per round, 24,000-character tool output, 4,000-character answer, 8 cards, 45-second deadline.

**One deliberate change.** Calls the model requests in the final round, past the round limit, are now recorded as `REJECTED (TOOL_ROUND_LIMIT)` and reported as `rejected` in `toolCalls`. Before, they were silently dropped. The spec requires a row for every requested call.

## 4. Compatibility decision

`POST /api/v1/assistant/messages` stays as a **deprecated** compatibility route, because the current frontend (which I may not modify) uses it.
- **Recorded.** Each call creates a new server-owned conversation and runs the same recorded turn, using **only the final user message**. Earlier messages in the body are validated and then ignored, so they are never sent to the model. No unrecorded model call is possible on this route.
- **Marked.** Responses carry `Deprecation: true` and `Link: </api/v1/assistant/conversations>; rel="successor-version"`. OpenAPI marks the operation `deprecated: true`.
- **Response shape** is unchanged. As before, every assistant failure becomes `503 ASSISTANT_UNAVAILABLE`.
- **Effect on the current UI:** follow-up questions in the old assistant page lose their earlier context until the frontend moves to the conversation API.
- **Removal checkpoint: Checkpoint C**, when the AI frontend uses `/assistant/conversations`.

## 5. History policy

- **Selection.** The most recent **complete** turns: a user message and the final assistant answer of the same `COMPLETED` trace.
  - At most **4 turns** and at most **16,000 characters** of message text.
  - Turns are taken newest first, stopping at the first turn that does not fit, so the selection is always a contiguous recent suffix.
- **Exclusions.** Failed and in-progress turns, and the trace being retried.
- **Tool data.** Tool calls and results never cross turns, so no tool/result pair can be split.
- **Size.** With the 2,000-character message limit, the conversation text sent to the model is at most 18,000 characters. The old route allowed up to 20,000.
- **Storage.** The complete conversation stays stored. The exact selected input is recorded on the trace (`model_messages`) and on every model call (`input_messages.messages`), with this turn's tool exchanges.

## 6. Retry

A user-selected Retry sends a **new** `Idempotency-Key` with `retryOfTraceId`, which must be a trace in the same conversation (otherwise `400`).
- The new trace's `previous_trace_id` is the retried trace. Otherwise `previous_trace_id` is the latest trace in the conversation.
- The user content stores `{ text, retryOfTraceId }`, so the detail API can show the link (`turns[].retryOfTraceId`).
- The failed trace is never overwritten.

## 7. Defects found by the new tests, and storage changes

**Red observations.** The implementation was written before most of these tests, so most were never red. These failures did happen, and the defects were real:

1. **Secrets leaked through raw argument text** (`assistant-conversations.test.ts`, the "forbidden fields … redacted" test). The model call's `tool_decisions` and the next call's recorded input held the model's raw argument **strings**, so the key-based scrubber could not see `authorization` or `cookie`. The test failed on `Bearer abc.def`.
   - **Fix:** decisions are recorded as parsed JSON.
   - The test then failed on `tok-123`: tool outputs in the recorded exchanges were also strings.
   - **Fix:** they are recorded as parsed JSON too. The test passes.
   - **Remaining limit:** argument text that is not valid JSON is stored verbatim and cannot be scrubbed by key.
2. **Concurrent turns collided on message sequence** (`db/assistant-conversations.test.ts`, "concurrent messages … unique, ordered sequences"). 4 of 6 concurrent submissions returned `503`, logged at `FINAL_TRACE_WRITE`.
   - **Cause:** under REPEATABLE READ, `finishTrace`'s first read fixed a snapshot before it waited for the conversation lock, so its `MAX(sequence)` missed rows committed meanwhile.
   - **Fix:** repository transactions now run at READ COMMITTED.
   - **Result:** 15 of 15 in three consecutive runs.

**Other failures, from deliberate contract changes:**
- `openai-model.test.ts`: 2 tests (replies now include `telemetry`).
- `http-openapi.test.ts`: 2 tests (new error codes, generated-contract drift).
- `db/observability-storage.test.ts`: 1 test (`createTrace` now also returns `userMessageSequence`).
- One mistake in my own test: comparing a `COUNT(*)` string with a number.

**Mutation checks** (code broken temporarily and restored; a marker search returned 0 afterwards):
- Making the model-outcome write fire-and-forget made "model-outcome persistence failure prevents tool execution…" fail.
- Returning the answer after a failed final write made "final trace/message persistence failure…" fail.

**Storage changes, all within the accepted repository and the `005` schema; no migration:**
- `finishTrace(FAILED)` closes open child attempts as `FAILED / OUTCOME_NOT_RECORDED` in the same transaction, so a failed turn reaches one terminal state. Recorded inputs are untouched. `COMPLETED` still refuses unfinished children.
- `finishTrace` returns the final message sequence. `createTrace` returns the user-message sequence (null for a replay).
- `finishModelCall` stores a provider-reported `totalTokens`; otherwise it sums the input and output counts as before.
- New payload limit `assistantResponse: 256 KiB` for the final response and assistant message. The previous 16 KiB message limit is too small for up to 8 cards. User content keeps the 16 KiB limit. An over-limit payload fails the turn as `payload_rejected`; it is never truncated.

## 8. Fail-closed evidence

**Fast tests** (`test/assistant-conversations.test.ts`) use the fake model and the in-memory fake store (`test/support/fake-assistant-store.ts`). The fake store applies the same `boundedJson` scrubbing and limits as the repository, plus the same ordering guards, and `failOn` injects an unavailable-database error:

| Boundary | Proven |
|---|---|
| Trace creation fails | Zero provider calls; `503 TRACE_UNAVAILABLE`; log event at `TRACE_CREATE` |
| Model-attempt write fails | Zero provider calls; trace `FAILED / MODEL_TRACE_WRITE` |
| Model-outcome write fails | No tool runs; provider text is not returned and is absent from the error; attempt closed `FAILED`; no assistant message (tested for both an answer and a tool-call reply) |
| Tool-attempt write fails | Tool never executes; trace `FAILED / TOOL_TRACE_WRITE` |
| Tool-outcome write fails | Second model call never starts |
| Final write fails | No answer; trace `FAILED / FINAL_TRACE_WRITE`; no assistant message. If the failure write also fails, the trace stays `STARTED`, `assistant_trace_finalize_failed` is logged, and still nothing is returned |
| Over-limit tool result | `payload_rejected` at `TOOL_TRACE_WRITE`; no next model call |
| Failed trace | Never has an assistant message or a `final_response` |

**Real MySQL** (`test/db/assistant-conversations.test.ts`): the real repository wrapped so one operation fails.
- A failed model-outcome write gives a `FAILED / MODEL_TRACE_WRITE` trace, a model call closed as `OUTCOME_NOT_RECORDED`, and no answer text in any row or response.
- A failed `createTrace` causes no model call and writes no trace.
- With AI storage fully unavailable:
  - conversation routes return `503`;
  - sign-in, `/auth/me`, the directory list and detail, directory options, and the dashboard summary return `200`.

Fast HTTP tests check the same independence for `/auth/me`, the directory, options, and the dashboard. Salary and HR-access routes are separate routers with their own services. Their full regression suites pass, but I did not run them with a broken AI store.

## 9. Other test coverage

| Area | Tests |
|---|---|
| Conversation persistence (MySQL) | Messages come back in order after building a fresh app; turn states; owner-only paginated list; cross-user `404` identical to an unknown ID, and a rejected continuation writes nothing |
| Bounded history | The 7th message sends turns 3 to 6 plus the current message; exact equality with the model request, `ai_traces.model_messages`, and `ai_model_calls.input_messages`; a unit test of the character bound, failed-turn exclusion, and retry exclusion |
| Turn shapes | No-tool, one-tool, and multi-tool timelines (sequences and parent model calls); rejected (unknown tool, invalid JSON, schema-invalid; not executed; arguments kept); failed tool; model timeout; provider failure; turn deadline during a tool (`503 TURN_TIMEOUT`) |
| Telemetry (MySQL) | Request IDs, input/output/total/reasoning tokens, and latency on each model-call row; trace totals equal the child sums (250 input, 30 output, 5 reasoning tokens, 2 model calls, 1 tool call) |
| Scope | Rohan's recorded tool result in MySQL contains ACME00601 and ACME00602 and none of ACME00603 (Grace Miller, US Finance) |
| Idempotency | Replay with no second model call; conflicting reuse returns `409` with no new rows; replayed failed turn; in-progress `409`; concurrent same-key submissions create one trace |
| Retry | New linked trace with `previous_trace_id` set and the turn list showing the link |
| Concurrency | 6 concurrent messages: trace sequences 1 to 6 and message sequences 1 to 12, each USER before its ASSISTANT |
| Secrets | `authorization`, `cookie`, `password`, and token fields are `[REDACTED]` in stored arguments, decisions, and results; free text is stored as typed (the synthetic-data policy) |
| HTTP | 401 on every operation; strict bodies; key validation; replay header; 502/503 mapping; the shared 20-request limit across both routes, with reads not counted; deprecated-route headers and final-message-only behaviour; logs free of message text, answers, arguments, keys, and tokens |
| Existing behaviour | The ported loop tests (bounds, rejections, logging); the legacy route over the real MySQL store with all evaluation fixtures for Admin and Rohan; MCP tests unchanged and passing |
| OpenAPI | 42 operations; a new test for the conversation operations (auth, key pattern, one-message body, error statuses, `deprecated` flag, reasons); the error-code list; drift against the regenerated `openapi/openapi.json` |

## 10. Files changed (all under `express-backend/`)

- **New:**
  - `src/assistant/conversation-service.ts`, `src/assistant/assistant-store.ts`;
  - `test/assistant-conversations.test.ts` (29 tests after the resume pass), `test/http-assistant-conversations.test.ts` (9), `test/db/assistant-conversations.test.ts` (16 after the resume pass);
  - `test/support/fake-assistant-store.ts`.
- **Changed:**
  - `src/assistant/model.ts`, `src/assistant/openai-model.ts`, `src/assistant/assistant-service.ts` (rewritten as the recorded loop);
  - `src/assistant/observability/repository.ts`, `src/assistant/observability/validation.ts`;
  - `src/http/assistant-routes.ts`, `src/http/app.ts`, `src/http/contract.ts`, `src/http/openapi.ts`, `src/server.ts`;
  - `openapi/openapi.json` (regenerated);
  - `scripts/eval-assistant.ts`: the manual live evaluation now runs through `runTurn` with an in-memory recorder. It has no HR user or conversation, so nothing is persisted.
- **Tests changed:**
  - `test/assistant-service.test.ts` (ported to `runTurn`), `test/openai-model.test.ts` (+1), `test/http-openapi.test.ts` (+1);
  - `test/db/assistant-tools.test.ts` (uses the real MySQL store), `test/db/observability-storage.test.ts` (return shape);
  - `test/support/fake-model.ts`, `test/support/http.ts`.

No migration, frontend, `docs_human`, salary-calculator, or MCP-handler file was changed.

**Changed in the resume pass:**
- `src/assistant/conversation-service.ts`: `rescopeSavedResponse` and `RESCOPED_LIMITATION`, applied on read and replay; `turns[].error.reason`.
- `src/http/contract.ts`: turn error `reason`; detail field descriptions.
- `src/http/openapi.ts`: 429 rate-limit headers; Q-C1, Q-C3, Q-C6, Q-C8, and Q-C10 descriptions.
- `openapi/openapi.json`: regenerated.
- Tests: `test/assistant-conversations.test.ts`, `test/db/assistant-conversations.test.ts`, `test/http-assistant-conversations.test.ts`, `test/http-openapi.test.ts`.
- `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md`: new, NEEDS_DECISION.

## 11. Checks and results

**Resume pass, 2026-11-16**, run from `express-backend/` after the Q-C changes:

| Command | Result |
|---|---|
| Baseline before the resume changes: `npm run check`; `DATABASE_URL='mysql://acme:…@127.0.0.1:3322/acme_ai_backend_test' npm run test:db` | 424 pass, 0 fail; 364 pass, 0 fail |
| `npm run openapi:generate` | wrote `openapi/openapi.json` |
| `npm run check` | exit 0. Lint and typecheck pass; **428 pass, 0 fail** (4 new tests; the HTTP rate-limit and OpenAPI tests gained assertions) |
| `npm run test:db` (same isolated database) | exit 0. **365 pass, 0 fail, 0 cancelled** (1 new MySQL test) |
| `npm run build` | exit 0 |
| `node --import tsx --test test/http-openapi.test.ts` after regeneration | 16 pass, 0 fail (no drift) |

**New tests in this pass:**
- `assistant-conversations.test.ts`: suite "saved results and the current scope (Q-C5)" (3 tests), plus "a failed turn in the detail carries the same code, message, and reason".
- `db/assistant-conversations.test.ts`: "reading a saved conversation applies the current scope from MySQL to stored cards". It removes and then restores Rohan's Support scope row.
- `http-assistant-conversations.test.ts`: the shared-limit test now asserts `Retry-After` between 1 and 900 seconds.
- `http-openapi.test.ts`: asserts the 429 `Retry-After` header and `turns[].error.reason`.

**Red observation:** I wrote the re-check before its tests. Disabling it with a temporary early return made all 3 Q-C5 tests fail. I restored it, and a search for the marker returned 0.

**Original Task 03 pass:**

| Command | Result |
|---|---|
| Baseline before changes: `npm run check`; `npm run test:db` | 388 pass; 349 pass |
| `npm run openapi:generate` | wrote `openapi/openapi.json` |
| `npm run check` | exit 0. Lint and typecheck pass; **424 fast tests pass, 0 fail** |
| `DATABASE_URL='mysql://acme:…@127.0.0.1:3322/acme_ai_backend_test' npm run test:db` | exit 0. **364 pass, 0 fail, 0 cancelled**: salary, dashboard, HR access, auth, directory, assistant tools, MCP, and observability storage |
| `npm run build` | exit 0 |

**Isolated test database.** No lane database existed on port 3322. I started a dedicated local container matching the planned lane in `docs/24`: `acme-ai-backend-mysql`, image `mysql:8.4`, bound to `127.0.0.1:3322`, database `acme_ai_backend_test` (passes the `_test` name guard). It uses tmpfs storage and the repository's fixed local-only credentials. It is still running; `docker rm -f acme-ai-backend-mysql` removes it. No other database was touched.

**Checks not run:** none of the required checks were skipped. No live provider call was made.

## 12. Known limits

- **A trace can stay `STARTED`.** This happens only if both the step write and the failure write fail. The user still gets no answer, and a log event records it.
- **Argument text that is not valid JSON** is stored verbatim and cannot be key-scrubbed.
- **Free-text prompts are stored as typed,** under the synthetic-data policy and the recording notice.
- **Conversation titles** come from the first user message (80 characters).
- **The deprecated route** creates one conversation per call and ignores earlier browser messages (section 4).
- **The rate-limit store** is per process, as before.

## 13. Open decisions

1. **Idempotency conflict code:** `DUPLICATE_OPERATION` (consistent with the other APIs) or a new `CONFLICT` code as written in `docs_human/13`?
2. **History bound:** confirm 4 complete turns and 16,000 characters.
3. **Removal of the deprecated route** at Checkpoint C.
4. **Saved content after scope narrows (Q-C5 parts 2 and 3):** options A, B, or C in `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md`.
5. **Conversation detail size (Q-C3):** the detail is not paginated. The rate limit (20 per 15 minutes) and 30-day retention bound it, but a heavily used conversation could return a large body (assistant messages up to 256 KiB each). Options: accept for the demo, cap turns per conversation, or add message pagination later.

## 14. Confirmations

- No `.env` file was read or created.
- No live API key was used or requested; automated tests use fake adapters only.
- No Git command was run, and nothing was committed or pushed.
- No frontend (`next-frontend/**`) or `docs_human/**` file was changed.
- No MCP observability or Admin trace API was started (Task 04). The evaluator-oracle fixture (`builder_docs/ai-builder/issues/04-evaluator-oracle-fixtures.md`) is left to Task 04.
- No AI mutation, arbitrary SQL, LangChain, LangGraph, LangSmith, queue, or other persistence model was added.
- Work stopped after this report.

## Task 03a correction (2026-11-16 to 2026-11-17)

The full report, with root causes, migration, red-to-green evidence, and exact results, is in `builder_docs/ai-builder/responses/03a-persistent-assistant-review-fixes.md`. In summary:

1. **Model not configured.** The turn is now recorded: the user message and a `FAILED / MODEL_CALL / not_configured` trace with model `not-configured`, with no model or tool call and no assistant message. This replaces "No model configured: `503`, and nothing is written" in section 3, step 3. The deprecated route records the same failure.
2. **Option C.** Migration `007_ai_trace_actor_scope.sql` records the actor's role and sorted countries and departments on each trace. A saved answer that the caller's current scope no longer covers is withheld whole on read and replay (`withheld: true`) and left out of model history. Traces without a snapshot are withheld for Scoped HR. This **supersedes** the Q-C5 row-filtering answer in section 2a: `rescopeSavedResponse` and `RESCOPED_LIMITATION` are removed.
3. **Malformed tool arguments.** Argument text that is not valid JSON is stored as `{ invalidJson: true }`, with reason `INVALID_ARGUMENTS` and detail `INVALID_JSON`; the raw text is never stored. This replaces the limit "Argument text that is not valid JSON is stored verbatim" in section 12.
4. **Open decisions 1, 2, and 4 in section 13 are settled:** the conflict code is `DUPLICATE_OPERATION`, the history bound is 4 complete turns and 16,000 characters, and the scope policy is Option C.

Results after Task 03a: `npm test` 438 of 438 pass; `npm run test:db` 368 of 368 pass. Lint, typecheck, OpenAPI drift, and build all pass.
