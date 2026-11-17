# AI Task 03a: persistent assistant review fixes

**Task:** `builder_docs/ai-builder/tasks/03a-persistent-assistant-review-fixes.md`
**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`
**Date:** 2026-11-16 to 2026-11-17. The work was resumed after an interruption; the migration, `actor-scope.ts`, the repository, fake-store, and test edits from the first session were re-read and kept.
**Status:** Complete and verified. Not committed.

All five required items are done. Nothing required by Task 03a was left out.

## 1. Model-not-configured turns are recorded

**Root cause.** `submit()` threw `503 MODEL_NOT_CONFIGURED` before `createTrace`, so the user's message and the failed turn were never saved. The deprecated route checked `assistant.available` first and did the same.

**Fix.** `src/assistant/conversation-service.ts`:
1. Ownership and idempotency checks run as before.
2. `createTrace` writes the user message and the `STARTED` trace in one transaction, with model `not-configured` (`UNCONFIGURED_MODEL`, provider `none`). The NOT NULL columns get explicit safe values; no schema constraint was weakened.
3. `runTurn` throws `TurnFailure('MODEL_CALL', 'not_configured')` before any model-call row or provider call.
4. The trace is finalized `FAILED / MODEL_CALL / not_configured`, with no assistant message and no `final_response`.

The API returns `503 ASSISTANT_UNAVAILABLE`, reason `MODEL_NOT_CONFIGURED`. The conversation detail shows the user message and a `FAILED` turn with that reason. Replaying the same key and command returns the same failure with `Idempotency-Replayed: true`, and writes nothing. The same key with different content returns `409 DUPLICATE_OPERATION`.

The deprecated `POST /assistant/messages` now records the same failed turn in a new conversation. It keeps its generic `503` body and its `Deprecation` and `Link` headers.

## 2. Option C: trace-time actor scope

**Root cause.** Traces stored no record of the actor's scope, so a saved answer could not be checked once HR Access narrowed a Scoped HR user's scope. The Task 03 resume pass only re-filtered card rows. It left answer text and aggregate populations visible, and it kept them in model history.

**Migration** `db/migrations/007_ai_trace_actor_scope.sql` (forward-only):
- Adds `actor_role ENUM('ADMIN','SCOPED')`, `actor_countries JSON`, and `actor_departments JSON` to `ai_traces`.
- Check `chk_ai_traces_actor_scope`: either all three are NULL (a legacy trace), or all are set and both lists are JSON arrays.
- No session ID and no new authorization tables.

**Rule** (`src/assistant/actor-scope.ts`):
- `actorScopeOf(principal)` records a sorted, de-duplicated snapshot. Admin HR stores empty lists, because Admin HR has no scope rows.
- `coversRecordedScope(current, recorded)`:
  - Active Admin HR is always covered. This includes a Scoped HR user promoted to Admin, and legacy traces.
  - Active Scoped HR is covered only when the recorded actor was Scoped HR and the current countries and departments are each a superset of the recorded ones.
  - An Admin-recorded answer viewed after demotion, a missing snapshot, or a narrower, sideways, or empty scope is not covered.

**Applied in** `conversation-service.ts`:
- **Read:** an uncovered assistant message comes back as `text: WITHHELD_ANSWER`, `response: null`, `withheld: true`. Prose, cards, aggregates, and limitations are all hidden. The user message is never withheld.
- **Replay:** an uncovered completed turn returns `answer: WITHHELD_ANSWER`, empty `toolCalls`, `cards`, and `limitations`, and `withheld: true`. It makes no new trace and no model call.
- **History:** `selectHistory(…, { principal })` drops uncovered turns, both the question and the answer.
- **Storage:** never modified. Tests check that the stored message and `final_response` still hold the original content.

The current principal is the one `requireAuth` loads from MySQL on every request.

The interim `rescopeSavedResponse` row filter and its `RESCOPED_LIMITATION` are **removed**, together with their 3 fast tests and 1 MySQL test. Under Option C, a covered answer cannot hold rows outside the current scope, and an uncovered one is withheld whole. `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md` is marked RESOLVED with these semantics.

**Contract.** `AssistantConversationMessage.withheld` and `AssistantTurnResponse.withheld` are new required booleans. The detail and operation descriptions now explain the rule.

## 3. Malformed tool arguments

**Root cause.** `recordedArguments` stored argument text that was not valid JSON verbatim. The key-based scrubber cannot see secrets inside unstructured text. The raw text reached `ai_tool_calls.requested_arguments`, `ai_model_calls.tool_decisions`, and the recorded exchanges in the next model call's input.

**Fix** (`src/assistant/assistant-service.ts`):
- Unparseable text is replaced by the fixed marker `INVALID_JSON_ARGUMENTS = { invalidJson: true }` at the single point where arguments are recorded.
- The tool call stays `REJECTED`, with validation `{ reason: 'INVALID_ARGUMENTS', detail: 'INVALID_JSON' }`.
- The tool never runs.

Responses report only the tool name and status. Logs report only tool, status, and duration.

## 4. Idempotency conflict code and history bound

No code change; both are confirmed by existing tests that still pass:
- **Conflict code.** Reusing a key with a different command returns `409 DUPLICATE_OPERATION`. Fast test: "the same key and command replays without a second model call; other content conflicts". MySQL test: "same key and command replays the stored result; other content is 409 and writes nothing". The new not-configured tests cover it too.
- **History bound.** At most 4 complete turns and 16,000 characters (`HISTORY_POLICY`). Fast tests: "sends the most recent complete turns within the bound and records that exact input" and "the character bound drops whole older turns; failed turns and the retried turn are excluded". MySQL test: "bounded server history is sent, and the exact model input is stored on the trace and model call".

## 5. OpenAPI

The project script is `npm run openapi:generate`; there is no `openapi:write` script. It regenerated `openapi/openapi.json`, and the drift test in `test/http-openapi.test.ts` passes (16 of 16).

## Red-to-green evidence

**Red, before any behavior change.** The new and updated tests in `test/assistant-conversations.test.ts` were run against the old code: **15 failed, 24 passed**.
- Option C suite: 11 failed.
- Not configured: 2 failed.
- Malformed arguments: 1 failed.
- The updated invalid-argument expectation: 1 failed.

Each failed for the expected reason. For example, a narrowed scope still returned "Found ACME00602 Vikram Iyer.", and the next turn's history still contained the withheld answer.

**Green.** The same file: 39 pass, 0 fail.

**Mutation checks.** Each fix was broken temporarily and then restored; a search for the marker returned 0 and no backup files remained:

| Broken | Fast tests that failed |
|---|---|
| `coversRecordedScope` always returns true | 7: narrower, sideways, empty, demotion, legacy, history exclusion, replay |
| Raw text stored again for malformed arguments | 2: the malformed-argument test and the invalid-argument test |
| The early not-configured `503` restored | 2: both not-configured tests |

**Expectations changed on purpose** (old behavior):
- `http-assistant-conversations.test.ts`: the response body now includes `withheld: false`.
- `db/assistant-conversations.test.ts`: the malformed call row is now the marker.
- `db/observability-storage.test.ts`: the new check constraint.
- `db/access-schema.test.ts` and `db/salary-adjustment-schema.test.ts`: the migration list includes `007`.

**A defect the new tests found.** My first version of the `007` check constraint used only `JSON_TYPE(...) = 'ARRAY'`. That evaluates to NULL, which MySQL treats as passing, when a list is NULL. The storage test's `UPDATE … SET actor_countries = NULL` was accepted, so the test failed. I added explicit `IS NOT NULL` terms, and the test passes. The migration had been applied only to the isolated test database, which the suite resets.

## Files changed

All under `express-backend/` unless noted.

- **New:**
  - `db/migrations/007_ai_trace_actor_scope.sql`
  - `src/assistant/actor-scope.ts`
  - `builder_docs/ai-builder/responses/03a-persistent-assistant-review-fixes.md` (this file)
- **Changed source:**
  - `src/assistant/conversation-service.ts`
  - `src/assistant/assistant-service.ts`
  - `src/assistant/observability/repository.ts`: optional `actorScope` on `createTrace` with validation, the snapshot columns written and read, and `actorScope` on turn rows.
  - `src/http/contract.ts`
  - `src/http/openapi.ts`
  - `openapi/openapi.json` (regenerated)
- **Changed tests:**
  - `test/support/fake-assistant-store.ts`
  - `test/assistant-conversations.test.ts`
  - `test/http-assistant-conversations.test.ts`
  - `test/db/assistant-conversations.test.ts`
  - `test/db/observability-storage.test.ts`
  - `test/db/access-schema.test.ts`
  - `test/db/salary-adjustment-schema.test.ts`
- **Docs:**
  - `builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md` (marked resolved)
  - `builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md` (a Task 03a section that points here)

## Checks and exact results

Run from `express-backend/`. The database is the isolated `acme_ai_backend_test` in container `acme-ai-backend-mysql` on `127.0.0.1:3322`.

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0, wrote `openapi/openapi.json` |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (fast unit and HTTP) | exit 0, **438 tests, 438 pass, 0 fail, 0 cancelled** (was 428; +14 new, −4 replaced) |
| `node --import tsx --test test/http-*.test.ts` | exit 0, **101 tests, 101 pass, 0 fail** (a subset of the line above) |
| `node --import tsx --test test/http-openapi.test.ts` | 16 pass, 0 fail (no drift) |
| `npm run test:db` | exit 0, **368 tests, 368 pass, 0 fail, 0 cancelled** (was 365; +4 new, −1 replaced) |
| `npm run build` | exit 0 |

## Not done, and limits

- Task 04 (MCP observability, Admin trace APIs, evaluator fixtures) was not started.
- No frontend change. The frontend must handle the new `withheld` field: show the fixed text, and render no cards or Retry for that answer.
- Existing traces without a snapshot stay withheld for Scoped HR until retention removes them after 30 days. This is the approved fail-closed behavior.
- The withheld text is fixed English, like the other public messages.
- The HR tester worktree was left idle, as instructed.

## Confirmations

- No Git command was run, and nothing was committed or pushed.
- No `.env` file was read or created, and no API key was used; tests use the fake model.
- Only the isolated AI backend test database was used.
- No `docs_human/**` or `next-frontend/**` file was changed.
- Work stopped after Task 03a.
