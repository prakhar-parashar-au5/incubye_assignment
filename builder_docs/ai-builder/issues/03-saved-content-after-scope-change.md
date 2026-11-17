# Blocker: saved assistant content after a Scoped HR user's scope narrows

Status: RESOLVED — Option C implemented in Task 03a (2026-11-17)
Task: AI Backend Task 03 (contract question Q-C5)
Agent lane: AI backend builder
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`
Candidate commit: Checkpoint A `3853f4b` plus uncommitted Task 03 work. Taken from the handoff, not checked with Git.
Time observed: 2026-11-16

## What I was trying to do

Answer Q-C5: when a Scoped HR user's scope narrows, does the conversation read return stored cards as stored, or re-scope them?

## What blocked me

`docs_human/13-ai-observability.md` says: "Assistant tools continue to apply the current actor's employee scope. Observability must not become a path around employee access control." A saved conversation stores three kinds of content produced under the scope the user had at the time:

1. **Structured employee and change rows** in `employee_list` and `recent_changes` cards. Each row carries a country and department, so it can be re-checked exactly.
2. **Aggregate summary groups** in `compensation_summary` cards. A group's label can be re-checked (department name or country code), but its population cannot. A `Tech` group saved when the user had `IN` and `US` still includes US employees in its count, total, minimum, and maximum after the scope narrows to `IN`. A `CURRENCY` group carries no scope dimension at all.
3. **Model-written answer text.** It can name employees or quote amounts. It cannot be re-checked by field. The bounded history also sends the earlier answers back to the model on the next turn.

The traces store no snapshot of the actor's scope at turn time (`005_ai_observability.sql`), so the backend cannot tell which saved turns were produced under a broader scope.

Part 1 follows directly from the spec, so I implemented it. Parts 2 and 3 need a product decision.

## Evidence

- `docs_human/13-ai-observability.md` lines 50–58 (Scoped HR uses the assistant "with their current employee scope"; observability must not bypass access control).
- `express-backend/db/migrations/005_ai_observability.sql`: no scope columns on `ai_traces`.
- `express-backend/src/assistant/compensation-insights.ts`: summary groups are `d.name`, `e.country_code`, or `sc.currency`.

## Expected

A Scoped HR user whose scope narrowed sees no saved employee data outside the current scope.

## Observed (after my change)

- Employee and change rows outside the current scope are removed on every read and on an idempotent replay. A limitation is added: "Some saved results outside your current access were not shown." The stored rows are unchanged.
- Summary groups whose department or country label is outside the current scope are removed. Groups that remain, and all `CURRENCY` groups, are returned as stored, with populations computed under the earlier scope.
- Answer text is returned as stored, and earlier answers still enter the bounded model history.

## What I verified

- Fast tests: `test/assistant-conversations.test.ts`, suite "saved results and the current scope (Q-C5)" (3 tests). Disabling the re-check made all 3 fail; restored.
- Real MySQL: `test/db/assistant-conversations.test.ts`, "reading a saved conversation applies the current scope from MySQL to stored cards". Removing Rohan's Support scope row hides ACME00602 on read; the stored message still contains it.

## What I tried

No other approach. Each option below changes what an HR user sees or needs a migration, so I did not pick one.

## Decision or owner needed

Product owner (Prakhar) via the planner. Options:

- **A. Accept the current partial behavior.** Rows are exact. Summary populations and prose stay as saved. Simplest; leaves a narrow disclosure path for users whose scope shrinks.
- **B. Withhold aggregates and prose that cannot be re-checked.** For Scoped HR, drop every saved `compensation_summary` card. Replace the answer text with a fixed notice whenever any row was removed. Exclude those turns from model history. No migration. Loses useful history even when nothing sensitive was in the prose.
- **C. Record the actor's scope on each trace** (new migration). On read, compare it with the current scope. If the scope narrowed, withhold the whole assistant message (text and cards) and exclude it from history. If not, return it unchanged. This is the most precise option, but it changes the accepted `005` schema.

My recommendation is C if scope narrowing is a real workflow; otherwise A, documented.

## Files changed before stopping

- `express-backend/src/assistant/conversation-service.ts` (`rescopeSavedResponse`, used by read and replay)
- `express-backend/src/http/contract.ts`, `express-backend/src/http/openapi.ts`, `express-backend/openapi/openapi.json` (published behavior)
- `express-backend/test/assistant-conversations.test.ts`, `express-backend/test/db/assistant-conversations.test.ts`

## Tests run and current results

See `builder_docs/ai-builder/responses/03-persistent-recorded-assistant.md`, section 11.

## Safe next step

Choose A, B, or C. Parts 2 and 3 remain as described until then. Everything else in Task 03 is independent of this decision.

## Planner resolution

Status: RESOLVED — OPTION C

Scope narrowing is a real supported workflow through HR Access. Record the trace-time role and sorted country/department sets in a forward migration.

For Scoped HR, current scope covers trace-time scope only when both current sets are supersets of their trace-time sets. If not, withhold the complete assistant message and exclude the turn from model history. Keep the user's own message visible and preserve stored evidence unchanged. Existing traces without a snapshot fail closed for Scoped HR.

Implement and test this in Task 03a before Task 04 starts.
## Implementation (Task 03a)

Implemented as resolved above. Details and evidence: `builder_docs/ai-builder/responses/03a-persistent-assistant-review-fixes.md`.

- Migration `007_ai_trace_actor_scope.sql` adds `actor_role`, `actor_countries`, `actor_departments` to `ai_traces` (all NULL, or all set with JSON arrays). No session ID is stored.
- `src/assistant/actor-scope.ts`: `actorScopeOf` (sorted, de-duplicated snapshot; Admin HR stores empty lists) and `coversRecordedScope`. Active Admin HR is always covered. Active Scoped HR is covered only for a Scoped HR snapshot whose countries and departments are each a subset of the current ones. An Admin snapshot, a missing snapshot, or a narrower or sideways scope is not covered.
- On read, on idempotent replay, and in history selection, an uncovered answer is withheld whole: fixed text, `response: null`, `withheld: true`, and the turn is left out of model history. The user's message stays visible. Stored rows are not modified.
- The interim row re-scoping from the Task 03 resume pass (`rescopeSavedResponse`) is removed: with Option C, a covered answer cannot contain rows outside the current scope, and an uncovered one is withheld completely.
