# Cross-lane input: evaluator oracle fixtures

Status: CROSS_LANE_INPUT — not a Task 03 blocker
Task: AI Backend Task 04
Owner: AI backend builder

## Decision

Backend AI Task 04 owns the evaluator-only oracle setup mechanism required by evaluation cases E08, E09, E10, and E18.

Do not change the normal workbook seed.

## Required setup

Provide a guarded evaluator-only command that operates only on an explicitly supplied isolated test/demo database and requires an explicit apply flag. It must refuse production and an unsafe database name.

It creates or deterministically identifies:

- One permitted currently-working employee with at least two compensation versions.
- One recent non-`INITIAL_IMPORT` compensation change.
- One recent compensation change with an `effectiveFrom` later than the evaluation clock.

Use existing compensation invariants, exact decimal values, valid salary bands, and immutable version links. Do not bypass production constraints in a way that creates impossible data.

## Run manifest

The setup emits a JSON run manifest containing no credentials or internal database IDs. Include:

- Evaluation clock.
- Synthetic employee codes.
- Personas/scopes that may access them.
- Exact native base, bonus, cash, and currency.
- Compensation versions and reasons.
- `recordedAt` and `effectiveFrom` as separate fields.
- Which evaluation cases each fixture supports.
- Applied migration list or expected migration checkpoint identifier.

The orchestrator runs this command before freezing the Checkpoint C evaluator database and supplies the manifest to the evaluator. The evaluator itself does not query MySQL or call setup APIs.

## Tests

Prove:

- Production and unsafe database targets are refused.
- Dry-run or validation mode writes nothing.
- Repeated approved setup is deterministic or safely idempotent.
- `recordedAt` and `effectiveFrom` remain distinct.
- The recent marker falls inside the 30-day evaluation window.
- The future-effective marker is not selected as current early.
- Scope and exact money are correct.
- No normal seed behavior changes.

## Related design

Read:

```text
/Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_design/builder_docs/ai-evaluation-designer/responses/01-prompt-corpus-and-oracles.md
/Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_design/builder_docs/ai-evaluation-designer/responses/01-live-prompt-corpus.json
```

Mention this issue path and the final manifest location in the Task 04 response.