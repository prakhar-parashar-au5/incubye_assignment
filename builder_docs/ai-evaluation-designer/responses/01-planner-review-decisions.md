# Planner review decisions for AI evaluation design Task 01

Status: APPROVED WITH CHECKPOINT-C DEPENDENCIES

## 1. Blocker protocol

Resolved. The protocol is now available inside this worktree at:

```text
docs/27-agent-blocker-reporting-protocol.md
```

The designer does not need cross-workspace access for it.

## 2. Stale handoff path

Resolved. The handoff now names the current file:

```text
express-backend/scripts/assistant-eval-cases.ts
```

## 3. Oracle fixture ownership

Decision: Backend AI Task 04 owns the evaluator-only oracle setup mechanism because it already owns deterministic observability test setup and the final Checkpoint B contract.

It must provide a guarded, evaluator-only setup command and generated run manifest without changing the normal workbook seed. The setup must create or identify:

- A permitted currently-working employee with multiple compensation versions.
- A recent non-import compensation change.
- A recent change whose `effectiveFrom` is in the future.

The generated manifest must record employee code, native exact values, versions, `recordedAt`, `effectiveFrom`, evaluation clock, and expected scope. It is created in the isolated evaluator database before Checkpoint C testing and supplied as provenance evidence. The evaluator does not query MySQL directly.

Until that mechanism is accepted, E08, E09, E10, and E18 correctly remain `BLOCKED_ORACLE`.

## 4. E05 control turn

Approved.

The same-persona unknown-code control is required to test existence privacy without comparing Admin and Scoped wording. Batch D has 6 planned requests and 14 reserve requests, which stays within the 20-request window.

## 5. JSON review

Approved.

Validated:

- JSON parses successfully.
- Canonical two-space indentation with one final newline.
- Declared 32 cases equals 32 actual cases.
- Case IDs are unique.
- No case contains duplicate hard gates, including E29–E32.
- Deterministic-only cases are exactly E29–E32.
- Every batch totals 20 planned plus reserve requests.
- Batch D records its E05 unknown-code control.
- E05 includes the same-persona control precondition and oracle.
- `honest_limitations` appears in the E04/E05 quality dimensions and the Markdown rubric.

No formatting-only rewrite needs correction.

## 6. Live evaluation gate

Unchanged. Agent 4 must not start until Checkpoint C is frozen with accepted Backend AI Tasks 03 and 04, saved conversations, complete traces, Admin observability UI, recording notice, current OpenAPI, and production builds.
