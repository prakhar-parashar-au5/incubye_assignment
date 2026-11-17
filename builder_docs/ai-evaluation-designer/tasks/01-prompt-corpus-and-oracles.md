# AI evaluation design task 01: prompt corpus and independent oracles

## Status

READY

## Goal

Produce a compact, high-signal evaluation corpus for the later live AI evaluator. Every case must state what it tests, which persona runs it, which tool behavior is expected, how correctness is checked independently, and which failures block acceptance.

Do not execute live evaluations in this task.

## Corpus requirements

Design approximately 24–32 cases across:

- Exact employee ID, unique partial name, ambiguous name, unknown employee, and out-of-scope employee.
- Current, upcoming, historical, and multi-version compensation.
- Recently recorded versus future-effective changes.
- Native INR and USD rankings.
- Cross-currency comparison with rate provenance.
- Department, country, currency, and organization summaries.
- Multi-turn follow-up and conversation separation.
- Underspecified questions requiring clarification.
- Tool-free capability response.
- Salary, approval, HR-access, and arbitrary-SQL mutation refusals.
- One-tool and multi-tool turns.
- Provider timeout, tool validation rejection, tool execution failure, and trace persistence failures handled by deterministic test doubles.
- Admin and Scoped HR permission differences.

Respect the 20-requests-per-user-per-15-minute live limit. Divide the live subset into batches with room for retries. Mark deterministic-only cases separately from live-provider cases.

## Case format

For every case specify:

```text
ID:
Category:
Persona:
Conversation precondition:
Natural-language prompt:
Expected clarification or tool class:
Expected argument constraints:
Independent oracle:
Required answer facts:
Forbidden claims/disclosures:
Expected card behavior:
Expected trace shape:
Hard gates:
Quality dimensions:
Repeat count:
Live | deterministic-only:
```

Do not require an exact prose sentence from a stochastic model unless the wording itself is a safety requirement.

## Independent oracles

Prefer:

1. Deterministic seed facts and approved fixtures.
2. Employee detail/directory/dashboard UI values from the frozen candidate.
3. Exact backend tool fixture expectations for deterministic tests.

Do not use the model answer, structured card, and trace tool result as three independent proofs; they may share one wrong source.

Where current seed values may change after salary workflows, define a setup step and relative assertion instead of hardcoding a stale salary.

## Expected trace shapes

For each applicable case describe:

- Expected model-call count range.
- Expected tool names or allowed alternatives.
- Whether a tool-free answer is acceptable.
- Required model/tool ordering.
- Rejected versus failed versus successful tool outcome.
- Required parent status.
- Required previous-trace link.
- Token fields when provider supplies them.
- Absence of hidden reasoning and secrets.

Do not overconstrain legitimate provider variation. Hard-code only safety, authorization, exact-money, and contract requirements.

## Scoring

Define:

- Deterministic hard gates that cannot be averaged away.
- Quality rubric 0–3 for tool choice, entity resolution, context, clarification, temporal correctness, completeness, concision, refusal guidance, and evidence agreement.
- Repeat-run aggregation that reports pass count and all failures.
- Rule for classifying flaky provider behavior separately from deterministic product defects.

## Outputs

Write:

```text
builder_docs/ai-evaluation-designer/responses/01-prompt-corpus-and-oracles.md
builder_docs/ai-evaluation-designer/responses/01-live-prompt-corpus.json
```

The JSON must contain no credentials, internal database IDs, live JWTs, API keys, or real employee data. Use stable synthetic employee codes only when verified from committed fixtures; otherwise use named placeholders with setup instructions.

Also include:

- Batch schedule under rate limits.
- Preflight checklist.
- Oracle preparation checklist.
- Trace reconciliation checklist.
- Defect-report template.
- Known gaps that depend on Backend AI Tasks 03 or 04.

## Scope limits

Do not modify application code, existing test fixtures, prompts, tool schemas, human specifications, or evaluator tasks. Do not call OpenAI or execute browser testing.

If blocked, write `builder_docs/ai-evaluation-designer/issues/01-<short-problem>.md` and stop the affected section.

Do not use Git, commit, or push.