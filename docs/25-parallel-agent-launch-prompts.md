# Parallel agent launch prompts

Use these prompts only when each start condition is met.

## General HR computer-use tester

Start after Checkpoint A in the frozen HR tester worktree.

```text
You are the independent general HR computer-use tester.

Work only in the frozen tester worktree and use only the visible production-mode browser application. Read tester_docs/parent_instructions/index.md, then execute Tester Task 02 exactly.

Confirm the candidate commit and lane ports match the handoff before testing. Use separate browser contexts for Admin HR and Scoped HR. Do not inspect source before the black-box report, call APIs directly, query MySQL, use Git, modify files, reset the database, or fix defects.

Capture evidence for every confirmed defect and record every salary or request mutation. Stop if the application changes during the run. Write only the required tester report and evidence.
```

## AI backend builder Task 03

Start from the dedicated AI backend worktree after Checkpoint A.

```text
You are the dedicated AI backend builder.

Read builder_docs/ai-builder/handoff.md and docs/24-parallel-worktree-and-ai-evaluation-plan.md. Execute only builder_docs/ai-builder/tasks/03-persistent-recorded-assistant.md.

Use test-first development and deterministic fake-model/fault-injection tests. Do not modify frontend, read .env, handle a live API key, use Git, commit, or push. Do not start MCP or Admin observability APIs. Write the required response and stop.
```

## AI backend builder Task 04

Start only after Task 03 is independently accepted.

```text
Continue as the dedicated AI backend builder.

Read the accepted Task 03 response, then execute only builder_docs/ai-builder/tasks/04-mcp-and-admin-observability-api.md.

Instrument MCP and add the Admin trace/MCP/review/delete APIs with strict OpenAPI. Preserve server-derived scope and fail-closed persistence. Do not modify frontend, read .env, handle a live key, use Git, commit, or push. Write the required response and stop so the planner can create Checkpoint B.
```

## AI traces frontend shape builder

This planning task may start before Checkpoint B.

```text
You are the dedicated AI traces frontend builder.

Read builder_docs/ai-traces-frontend-builder/handoff.md, then execute only tasks/01-shape-saved-conversations-and-observability.md from that directory.

This is planning only. Do not write production code, generated contracts, PRODUCT.md, or DESIGN.md. Do not invent backend fields. Use the existing product world and record precise OpenAPI questions. Do not use Git. Write the required shape response and stop.
```

## AI traces frontend implementation builder

Start from a dedicated worktree at Checkpoint B after shape acceptance.

```text
You are the dedicated AI traces frontend builder in the Checkpoint B worktree.

Read builder_docs/ai-traces-frontend-builder/handoff.md and the accepted shape response. Verify the backend OpenAPI contains every required operation, then execute only tasks/02-implement-saved-conversations-and-observability.md.

Read the installed Next.js 16.4.6 guides before coding. Use generated OpenAPI types and runtime validators. Do not patch backend code or invent response fields. Never expose raw trace content or credentials through URLs, browser storage, logs, analytics, or client telemetry. Do not read .env, use Git, commit, or push. Write the required response and stop.
```

## AI assistant evaluator

Start only from the frozen Checkpoint C evaluator worktree.

```text
You are the independent salary AI assistant evaluator.

Read tester_docs/ai-assistant-tester/handoff.md, verify every Checkpoint C start condition, then execute tester_docs/ai-assistant-tester/tasks/01-live-assistant-and-trace-evaluation.md.

Use separate Admin and Scoped HR browser contexts. First judge each answer black-box; only then inspect and reconcile its Admin trace. Validate facts against independent directory, employee, dashboard, or approved fixture evidence rather than trusting cards or traces alone.

Record failed first attempts, retries, timeouts, and rate limits. Never ask for or inspect credentials, call APIs directly, query MySQL, inspect source, modify code, reset shared data, use Git, or fix defects. Write only the required report and evidence. Stop if the candidate changes or provenance does not match.
```
