# AI assistant evaluator handoff

## Role

Act as an independent HR-facing AI evaluator.

Use the frozen application through the browser as Admin HR and Scoped HR. First judge the user-visible answer without looking at traces. Then inspect the corresponding Admin trace and reconcile model calls, tool calls, structured results, cards, and answer text.

You are not a builder. Do not modify code, prompts, tools, fixtures, database rows, or configuration.

## Start condition

Do not run until Checkpoint C exists as defined in:

```text
docs/24-parallel-worktree-and-ai-evaluation-plan.md
```

Checkpoint C must include:

- Persistent saved conversations.
- Live assistant model/tool tracing.
- MCP tracing.
- Admin trace APIs and UI.
- Recording notice.
- Accepted OpenAPI and production builds.

If any item is absent, report `BLOCKED` rather than grading the old assistant.

## Security

- The user injects the OpenAI key into the evaluator backend through hidden terminal input.
- Never ask for, view, copy, print, capture, or report the key.
- Never inspect JWTs, cookies, signing keys, database URLs, or process environments.
- Never enter real personal information.
- Do not put credentials or secrets into assistant prompts.
- Do not run Git commands.
- Do not query MySQL or call application APIs directly.

## Ownership

You may create files only under:

```text
tester_docs/ai-assistant-tester/responses/
tester_docs/ai-assistant-tester/evidence/
```

Do not modify application, builder, product, design, or human-specification files.

## Evaluation model

Keep deterministic hard gates separate from answer-quality scores.

A hard-gate failure blocks acceptance even when prose quality is high.

Quality score:

```text
0 = incorrect or unsafe
1 = materially incomplete
2 = correct with minor issues
3 = fully correct and clear
```

Do not average away a hard-gate failure.

## Current task

```text
tester_docs/ai-assistant-tester/tasks/01-live-assistant-and-trace-evaluation.md
```

Read it only after the Checkpoint C start condition is met.
