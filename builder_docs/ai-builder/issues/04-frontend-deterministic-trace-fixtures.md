# Blocker: deterministic trace data for the AI-traces frontend (Q-E1, Q-E2)

Status: NEEDS_DECISION
Task: AI Backend Task 04
Agent lane: AI backend builder
Worktree: `/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend`
Candidate commit: the Task 04 checkpoint 1 commit plus uncommitted steps 2 and 3. Taken from the planner's message; I did not check it with Git.
Time observed: 2026-11-17

## What I was trying to do

Answer the frontend's test-setup questions:
- **Q-E1:** can the backend on port 4223 run a scripted, non-OpenAI model selected by process configuration?
- **Q-E2:** how can a trace that failed while being recorded exist so the frontend can display it?

## What blocked me

Neither option is in Task 04's assigned scope, and each one adds behavior the planner has not approved:

- A model adapter chosen by process configuration would be a new production-reachable code path. Without a guard, the server could answer with scripted text instead of the real model.
- A seed script that writes trace shapes is a second fixture command next to the approved evaluator-oracle command. It would need its own guards and its own shape list.

## What exists today

- The repository can produce every trace shape the frontend asked for: no-tool, one-tool, multi-tool, rejected (including a `password` argument, stored as `[REDACTED]`), tool-failed, provider-timeout, a persistence failure with `FAILED / OUTCOME_NOT_RECORDED` children, and `STARTED`. The `seedTrace` helper in `express-backend/test/db/admin-observability.test.ts` writes these shapes through the real repository.
- The frontend's own fake backend can serve them from the published OpenAPI schemas. The frontend task allows this.

## Decision or owner needed

The planner picks one of:

- **A.** No backend support. The frontend tests against its fake backend built from the OpenAPI schemas.
- **B.** A guarded `npm run eval:trace-fixtures` command, with the same guards as `eval:oracle-fixtures` (refuses production and unsafe database names, dry run by default). It would write the shapes above into `acme_ai_ui_test` through the repository.
- **C.** A scripted model adapter for the server. It would be allowed only when `APP_ENV=test` and the database name ends in `_test`, and would never be selectable by an API request.

My recommendation is B. It reuses the existing guards, touches no runtime path, and gives the frontend real rows.

## Files changed before stopping

None for this question.

## Tests run and current results

See section 7 of `builder_docs/ai-builder/responses/04-mcp-and-admin-observability-api.md`.

## Safe next step

Choose A, B, or C. Nothing else in Task 04 depends on this decision.
