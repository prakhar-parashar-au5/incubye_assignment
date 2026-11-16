# Task 02: observability storage review fixes

## Reproduced findings and corrections

1. **Incomplete Admin trace summary.** A real-MySQL test expected the complete summary and failed because `failureStage`, three token counts, and `toolNames` were absent. `listTraces` now returns an exported `TraceSummary` with every required field. It fetches tool names for the selected page in one additional query, preserving first-seen tool sequence and removing duplicates. The test compares the complete object and verifies that no raw content appears.
2. **Rejected calls retained results.** The new assistant/MCP test failed with “Missing expected rejection (PersistenceValidationError)” when a `REJECTED` call carried a result. Both finalizers now use one runtime validator: rejected and failed calls cannot carry results, successful calls require a result, and failed execution requires an error category. Invalid finalization leaves the attempted row `STARTED`. The previous salary assertion moved to a successful assistant tool call. Additional tests verify failed assistant/MCP safe errors and successful MCP synthetic employee and salary results.
3. **Incomplete idempotency pair and false replay sequence.** The pair test failed because a key without a hash was accepted. The replay test failed with `sequence: 0` instead of `1`. `createTrace` now validates a nonempty key and a 64-character lowercase hexadecimal command hash together before entering a transaction. Same-command replay returns the stored trace ID and sequence. Conflicting reuse raises `ConflictError`; tests verify that neither replay nor conflict creates another trace or message.
4. **Tool started before model outcome.** The ordering test failed with “Missing expected rejection (ConflictError)” for a `STARTED` model call. `startToolCall` now requires its parent model call, within the active trace, to have status `SUCCEEDED`. The test rejects both `STARTED` and `FAILED` parents, then permits a successful parent.
5. **Migration contract sampled instead of fully verified.** The prior test checked two foreign keys and selected index names. Its replacement compares all 12 foreign keys with referenced tables/columns and delete rules, all 29 ordered indexes including unique keys, and all six named checks across the seven observability tables. A separate test verifies that invalid status/timestamp combinations, negative durations/tokens, and review version zero are rejected by MySQL. To prove the contract assertion detects a real regression, I temporarily changed `fk_ai_reviews_user` from `ON DELETE RESTRICT` to `CASCADE` in migration 005. The focused test failed on that exact difference (`CASCADE` actual versus `RESTRICT` expected). A `finally` block restored the migration; the normal focused test passed afterward. Migration 005 has no lasting change.

## Files changed

- `express-backend/src/assistant/observability/repository.ts`
- `express-backend/test/db/observability-storage.test.ts`
- `builder_docs/ai-builder/responses/02-observability-storage-review-fixes.md`

No live assistant or MCP handler, HTTP route, OpenAPI contract, frontend, human specification, salary calculator, or migration was changed.

## Validation

- `cd express-backend && npm run check` — exit 0; lint and typecheck passed; **381 fast tests passed, 0 failed**.
- `cd express-backend && DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` — exit 0; **344 real-MySQL tests passed, 0 failed**.
- `cd express-backend && npm run build` — exit 0.
- Focused `test/db/observability-storage.test.ts` — **16 passed, 0 failed** after the correction and fixture update.

No required check was omitted. Database writes occurred only in the established guarded `acme_test` database. No live integration, Git command, `.env` read, development-database write, OpenAI call, commit, or push occurred.
