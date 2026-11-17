# Cross-lane input: observability frontend contract questions

Status: CROSS_LANE_INPUT — not a blocker
Task: AI Backend Tasks 03 and 04
Agent lane: AI backend builder
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`
Candidate commit: `3853f4b09ff914b004164d5edb498073fa5f6a97`

## What happened

The AI-traces frontend shape task completed and identified exact OpenAPI information required for implementation.

Read its response at:

```text
/Users/admin/Desktop/Projects/incubyte_take_home_ai_traces_ui/builder_docs/ai-traces-frontend-builder/responses/01-shape-saved-conversations-and-observability.md
```

Section 15 contains the contract questions.

## Ownership split

Task 03 must answer and publish the conversation questions `Q-C1` through `Q-C11` where they belong to the persistent-assistant contract.

Task 04 must answer and publish:

- Trace list questions `Q-T1` through `Q-T4` and `Q-T11`.
- Trace detail questions `Q-T5` through `Q-T10`, `Q-T12`, and `Q-T13`.
- Review questions `Q-R1` through `Q-R5`.
- Deletion questions `Q-D1` and `Q-D2`.
- MCP questions `Q-M1` through `Q-M3`.
- Deterministic frontend test setup questions `Q-E1` and `Q-E2` where backend support is required.

## Required behavior

Do not treat the frontend's suggested field names as authoritative. Choose the smallest coherent backend contract that satisfies the approved human specification, then expose it through strict runtime schemas and OpenAPI.

If any question requires a product decision outside `docs_human/13-ai-observability.md`, write a separate `NEEDS_DECISION` report and stop only the affected part.

Mention this issue path and the resolved question IDs in each builder response.
