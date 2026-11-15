# Response: Backend Task 08 review fixes (08a)

**Status:** Complete. Ready for planner review.

I applied both corrections from `builder_docs/parent_instructions/08a-ai-assistant-review-fix.md`, and nothing else.

`index.md` does not list 08a yet, but the fix file is marked `READY` and the user named it explicitly.

## 1. Assistant request limit

**Policy:** 20 requests per authenticated HR user per 15 minutes, on `POST /api/v1/assistant/messages` only.

- **Order:** the route runs `noStore`, then `requireAuth`, then the limiter, then the route's JSON parser, then the handler. Unauthenticated requests are rejected with 401 before the limiter runs, so they never consume or create a bucket.
- **Key:** `hr-user:<hrUserId>`. The ID comes from the principal that `requireAuth` loaded from the database. The key never uses IP, email, JWT text, or anything in the request. If no verified principal is present, the key generator throws, so the limiter fails closed.
- **What counts:** every authenticated request counts, including ones that end in 400 or 503, because each one can reach the model.
- **Over the limit:** the existing 429 shape with code `RATE_LIMITED`. The message is "Too many assistant requests. Try again later." instead of the login limiter's "Too many failed login attempts", which would be wrong here. The code and shape are unchanged.
- **Store:** the existing `ClockedMemoryStore` with an injected clock, in memory and per process. The code comment notes that several replicas need a shared store, such as Redis.
- **Scope:** the directory, auth, and MCP routes are not limited by it. MCP does not call OpenAI.
- **Logs:** no new log fields. The limiter writes no log of its own, and the request log still records only method, route pattern, status, and duration.

## 2. Recent changes by record creation time

`get_recent_compensation_changes` now selects on `compensation_records.created_at`:

```sql
c.change_reason <> 'INITIAL_IMPORT'
AND c.created_at > :now - :days  AND c.created_at <= :now
ORDER BY c.created_at DESC, c.id DESC
```

- **Window:** the injected current time, through the new `ToolContext.now`. The assistant service and MCP both pass `clock()`.
- **Kept the same:** scope (`scopeCondition`), the `INITIAL_IMPORT` exclusion, `effectiveFrom` on every change, and the previous-record and exact-difference logic. The previous record is still found on the effective-date timeline.
- **Included and excluded:** a future-effective change recorded inside the window is included. An old record with a recent effective date is excluded. A record created after `now` is excluded.
- **Ties:** equal `created_at` values are broken by record ID, descending (stable order of insertion). The ID is used only in `ORDER BY` and is never returned.
- **Descriptions:** the tool description now says "recent" means recently recorded, not recently effective, and gives both inclusion rules. The `days` field description, the card title ("Compensation changes recorded in the last N days"), and the empty-result message ("No compensation changes were recorded in the last N days …") follow the same wording. The evaluation question for this tool now reads "What new compensation changes were recorded in the last 30 days?".
- **New response field:** the old card could not represent `created_at`, so each `RecentChangesCard.changes[]` item now has a required `recordedAt` (ISO date-time, UTC). The tool name and card type are unchanged. `openapi/openapi.json` was regenerated.

**Frontend builder: regenerate the API types from `openapi/openapi.json`.** `RecentChangesCard.changes[].recordedAt` is new and required.

## Files changed

- `src/http/rate-limit.ts`: `ASSISTANT_REQUEST_LIMIT`, `ASSISTANT_REQUEST_WINDOW_MS`, `assistantRequestLimiter()`.
- `src/http/assistant-routes.ts`: limiter mounted after `requireAuth`.
- `src/http/app.ts`: creates the limiter with the app clock; optional `assistantRateLimitStore` dependency for tests.
- `src/assistant/compensation-insights.ts`: `recentChanges(…, now: Date)` selects and orders by `created_at` and returns it.
- `src/assistant/tools.ts`: `ToolContext.now`; tool description; `recordedAt`; messages and card title.
- `src/assistant/tool-schemas.ts`: `days` description.
- `src/assistant/assistant-service.ts`, `src/http/mcp-routes.ts`: pass `now`.
- `src/http/contract.ts`: `recordedAt` on recent-change items.
- `openapi/openapi.json`: regenerated.
- `scripts/assistant-eval-cases.ts`: recent-changes question wording.
- New test file `test/http-assistant-rate-limit.test.ts` (6 tests).
- Changed tests:
  - `test/db/assistant-tools.test.ts`: the recent-changes section was rewritten (4 tests, 6 markers with explicit `created_at`), and the pristine-seed message was updated.
  - `test/assistant-tools.test.ts`: added a description test and `now` in the context.
  - `test/assistant-service.test.ts`: asserts `context.now`.
  - `test/http-openapi.test.ts`: asserts `recordedAt` is published and required.

## Test evidence

### Failed tests actually observed before the implementation

1. `test/http-assistant-rate-limit.test.ts`, with only the constants and the store dependency added: **6 failed, 0 passed**.
2. `test/assistant-tools.test.ts`, after adding the description test: **1 failed, 2 passed**.
3. `test/db/assistant-tools.test.ts`, after rewriting the recent-changes tests and before changing the query: **5 failed, 20 passed**. The failures were the pristine-seed message, the Admin window, the time window, Rohan's scope, and the empty-window message.

### Defects the new tests detect

| Test | Defect |
| --- | --- |
| 20 allowed, then 429 | No limit, an off-by-one limit, or a non-standard 429 body |
| Separate HR users | A shared or IP-based key letting one user exhaust others |
| Window reset (injected time) | A window that never resets or resets early (still 429 at 14:59, allowed at 15:00) |
| Auth before limiting | Unauthenticated or forged-token requests creating buckets; keys from client input (a body `hrUserId: 2` still counts against `hr-user:1`) |
| Normal routes remain available | The cost limit applied to directory, auth, options, or MCP |
| Logs and keys | Chat, email, or token in logs or limiter keys |
| Recent changes by `created_at` | Selection by effective date; future-effective changes dropped; old records with recent effective dates included; records after `now` included; unstable order |
| Window from current time | A day-boundary window instead of now minus N days |
| Rohan scope | Scope lost in the new query |
| Description mentions recorded, future, initial import | The model reading "recent" as "recently effective" |
| OpenAPI `recordedAt` | Contract missing the new field |

## Exact checks and results

From `express-backend/`:

```text
npm run check                 lint: no problems; typecheck: no errors
                              # tests 332  # pass 332  # fail 0      (was 325)
npm run build                 exit 0
npm run openapi:generate      Wrote .../openapi/openapi.json; drift test passes
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
                              # tests 199  # pass 199  # fail 0      (was 198)
```

The fake-model evaluations (8 cases × Admin and Rohan, through the HTTP endpoint with real login and MySQL) are part of `test/db/assistant-tools.test.ts` and pass.

## Live evaluation

**Not run.** The process list shows no backend for this workspace. The only running `src/server.ts` belongs to a different project, `/Users/admin/Desktop/Projects/incubyte_assignment`, which I did not touch. As instructed, I did not inspect any process environment variables. `npm run eval:assistant` remains available for a run with a key.

## Known limits

- **Per-process limit:** the limit lives in one process's memory. Several replicas would each allow 20, and a restart resets the counts. A shared store is needed for multiple replicas.
- **Applies to every request:** the limit counts all authenticated assistant requests, including validation failures and 503s.
- **Message differs from login:** the 429 message is assistant-specific. A client that matches on the login message text would need to match on the code instead.
- **Accuracy of `created_at`:** "Recent" depends on `created_at` being accurate. It is set by the database default on insert, and the seed tests set it explicitly. A future import or backfill tool must set it honestly.
- **`recordedAt` is new:** the frontend must regenerate its API types to display it.

## Confirmations

- No Git command ran.
- No mutation, persistent chat, web search, embeddings, or frontend code was added. No frontend files were modified.
- No `.env` file was read.
- `docs_human/` and `docs/` were not edited.
- Nothing was committed, and no later task started.
