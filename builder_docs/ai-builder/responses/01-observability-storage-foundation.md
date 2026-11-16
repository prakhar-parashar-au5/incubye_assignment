# Task 01: observability storage foundation

## Scope delivered

Added the seven approved MySQL tables, a typed repository under the existing assistant area, a recursive JSON scrubber and size validator, and a guarded manual retention command. The current assistant loop, MCP handler, HTTP contracts, and frontend were not changed or connected to this repository.

`express-backend/test/db/migrations.test.ts` from the task has moved: the migration runner test is `express-backend/test/db/migration-runner.test.ts`.

## Files changed

- `express-backend/db/migrations/005_ai_observability.sql` — seven tables, foreign keys, cascades, uniqueness, checks, and search/retention indexes.
- `express-backend/src/assistant/observability/validation.ts` — JSON-only recursive scrubber, payload limits, and typed validation error.
- `express-backend/src/assistant/observability/repository.ts` — conversation, message, trace, model call, tool call, MCP call, review, deletion, and retention operations using the supplied MySQL pool.
- `express-backend/src/assistant/observability/retention.ts` — guarded CLI argument parsing, deterministic cutoff, and dry-run/execute service.
- `express-backend/scripts/ai-retention.ts` — manual command entry point.
- `express-backend/test/observability-storage.test.ts` and `express-backend/test/db/observability-storage.test.ts` — fast and real-MySQL tests.
- `express-backend/test/db/access-schema.test.ts` and `express-backend/test/db/salary-adjustment-schema.test.ts` — updated exact migration/table inventory expectations for additive migration 005. No access or salary behavior assertions were weakened.

## Storage design

Conversation IDs, trace IDs, and MCP call IDs are UUIDs; call/message IDs are MySQL `BIGINT UNSIGNED`. All timestamps are UTC `DATETIME(3)` supplied by the caller. Native `JSON` holds content and structured events. Indexed scalar columns hold actor, status, model, tool name, error category, sequence, timing, and tokens. Sequence allocation locks the conversation row in a transaction; trace finalization locks conversation then trace. Trace creation atomically inserts its user message before any external execution can occur. Idempotency keys are unique per conversation, with a stored command hash for retry conflict detection.

Deleting a trace cascades to its messages, model calls, tool calls, and review. It leaves its conversation and later turns intact. A later trace's `previous_trace_id` becomes null. MCP records have no AI-trace foreign key. Reviews use an expected version under a trace row lock. Call outcomes update only `STARTED` rows; trace outcomes update only `STARTED` traces. Parent totals derive from persisted child rows at terminal transition. The repository contains no authorization decision; future routes must check current authority before calling Admin operations.

Retention selects records by creation/start time, deletes traces and MCP calls in batches of 100 transactions, removes old unowned messages, and removes empty old conversations. Dry-run only counts. The CLI requires `--retention-days N`, defaults to dry-run, requires `--execute` to delete, requires `--allow-short-retention` below 30 days, and requires `--acknowledge-production` for execution when `NODE_ENV` or `APP_ENV` is `production`. It prints only cutoff and counts. It exits nonzero with a generic message on failure.

## Payload limits and redaction

Limits are UTF-8 bytes of the fully serialized JSON after scrubbing: message **16 KiB**, model input **128 KiB**, model output **128 KiB**, tool arguments **32 KiB**, tool result **256 KiB**, validation details **16 KiB**, safe error **8 KiB**. These cover the existing bounded assistant message size and normal synthetic structured results while preventing one event from making trace detail unbounded. The repository validates before writes and raises `PersistenceValidationError`; it does not truncate or substitute partial results. The scrubber copies nested JSON and replaces forbidden keys with `[REDACTED]`, including authorization/cookies, passwords, tokens, database credentials, and hidden reasoning fields. It rejects class instances, unsupported values, and cycles. Synthetic employee names, codes, and salaries remain intact.

## Red-to-green evidence

- Fast test first run: `node --import tsx --test test/observability-storage.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the new validation module. After implementation: **6 passed, 0 failed**. A later expanded secret-key test failed because `databaseCredentials` and `encryptedReasoning` were still present; after the scrubber change: **6 passed, 0 failed**.
- MySQL test first run: `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' node --import tsx --test test/db/observability-storage.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the repository. After migration/repository work, the initial schema inspection test failed because its `information_schema` query did not alias MySQL's uppercase metadata column names. Corrected inspection query: **7 passed, 0 failed**. A later test for failed traces storing fabricated answers failed with “Missing expected rejection”; after validation: **9 passed, 0 failed**. A later complete-timeline test failed with `undefined !== 5` for model latency; after expanding detail mapping: **9 passed, 0 failed**.
- Retention cutoff/service tests were run red first: missing `retentionCutoff` and `runRetention` exports respectively; both passed after implementation.
- The first complete `npm run test:db` had **323 passed, 3 failed**. Two failures were in `access-schema.test.ts` and one in `salary-adjustment-schema.test.ts`; each asserted the old exact table/migration inventory. After adding migration 005 to those inventories, their focused run had **32 passed, 0 failed** and the full suite was green.

## Final validation

- `npm run check` — exit 0: lint and typecheck passed; **381 fast tests passed, 0 failed**.
- `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` — exit 0: **326 real-MySQL tests passed, 0 failed** (final rerun after lock-order change).
- `npm run build` — exit 0.
- `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' node --import tsx scripts/ai-retention.ts --retention-days 30` — exit 0, `mode: dry-run`, `deleted: null`; printed cutoff and zero aggregate counts, no content.

No tests were skipped. No live OpenAI test was run; automated tests use no provider or network call.

## Planner review points

- The repository enforces append-only event content and one terminal transition through its public methods. The migration does not add database triggers to stop privileged manual SQL updates.
- The retention CLI reports aggregate trace, unowned-message, and MCP counts; child rows disappear through cascades. Its counts are a pre-delete snapshot, while the execute result reports actual aggregate rows deleted.
- Live integration must supply a bounded, allowlisted event shape and current actor from server authentication. It must require idempotency keys at the message endpoint and keep Admin authorization in the HTTP layer. No live call path has been changed here.

No Git command, `.env` read, development-database write, OpenAI call, commit, or push occurred. Database writes were confined to the guarded `acme_test` integration database.
