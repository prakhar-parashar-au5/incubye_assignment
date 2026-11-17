# AI Task 05: fixes from live evaluation 01

**Task:** `builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md`

**Worktree:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_fixes`. Branch `fix/assistant-eval-01` from master `9236ac4`, as stated in the task; I did not check this with Git.

**Date:** 2026-11-17

**Status:** D1, D2, and the optional money rule are fixed and every check is green. Not committed; no Git command was run.

**Source:** section 8 of `…/incubyte_take_home_ai_eval_run/tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md`, read only. There was no live-model rerun; the evaluator re-checks D1 and D2 after the merge.

## D1: Scoped answers claimed company-wide coverage

**Cause.** For Scoped HR, the tool results were correctly limited to the user's scope, but their `limitations` said nothing about that. The model then described an in-scope top five or total as "company-wide".

**Layer 1, tool results** (`src/assistant/tools.ts`).
- The new `scopeLimitation(principal)` builds a fixed sentence from the principal's current scope, for example: `Covers only employees in your access: India; Support, Tech.`
- Country codes become names from `APPROVED_COUNTRIES`. Countries and departments are sorted. An empty scope gives `…: none.`
- The sentence is added as the first limitation of every aggregate result:
  - `get_top_compensated_employees` (ranking);
  - `get_compensation_summary` (summary);
  - `get_recent_compensation_changes` (the change list and its total count).
- It is added on the empty-result path as well.
- Admin HR gets no scope limitation. Single-employee tools (`search_employees`, `get_employee_compensation`) are unchanged.
- The UI already shows limitations, so users see the statement whatever the model writes.

**Layer 2, instructions.** One new rule: *"When tool results are limited to the employees you can access (a limitation says so), say that, and never describe them as company-wide or organization-wide."*

## D2: mutation refusals gave no safe next action

The instruction "say you are read-only" is replaced. The new rule refuses, never claims a change was made, never calls a tool to attempt one, and names the place in the app where the action is done.

Instructions now depend on the role (`assistantInstructions(asOf, role)`, `AssistantService.prompt(asOf, role)`):

| Role | Next action named |
|---|---|
| Admin HR | Salary changes: "Adjust compensation" on the employee's page. Approving or cancelling salary requests: "Salary requests". HR users and permissions: "HR Access". |
| Scoped HR | Salary changes: submit a salary request from "Adjust compensation" on the employee's page; Admin HR approves it. Tracking requests: "Salary requests". Approving or cancelling requests, and HR users or permissions: done by Admin HR, so ask an Admin HR user. **HR Access is never mentioned.** |

The labels are the app's own page names: `employees/[employeeCode]/adjust` is titled "Adjust compensation", the salary requests page and nav item are "Salary requests", and the HR access pages are "HR Access".

The backend restricts approve and cancel to Admin HR, and allows Scoped HR to list salary requests in its scope. The table follows those rules.

## Optional money rule

The money rule now says: quote amounts exactly as the tools return them, *"with their currency code, and do not regroup the digits"*.

## Rules followed

- **Prompt version:** `assistant-instructions-v1` became **`assistant-instructions-v2`**. The stored prompt hash also differs between Admin and Scoped instructions, because it covers the exact text.
- **Smallest change in the shared path:**
  - One new function, applied in three tool results.
  - One instruction table plus three rewritten lines.
  - The prompt now receives the actor's role at its call sites (conversation service, eval script, one test).
- **Not changed:** tools, schemas, and OpenAPI. `openapi/openapi.json` has the same SHA-256 before and after regeneration (`fe42c8c5…b838374`).
- **Gates that already passed in evaluation 01** were not touched: grounding, exact money, currency, time, existence privacy, no mutation, tool validity, trace completeness, and secret exclusion.

## Tests

**Fast tests:** `test/assistant-eval01-fixes.test.ts`, 6 tests, fake data, no model.
- Rohan's ranking, summary, and recent-change results start with exactly `Covers only employees in your access: India; Support, Tech.`
- The text follows the principal's scope, with sorting, country names, and a `none` case.
- Admin results never carry it, and Scoped HR searches don't either.
- The prompt version is v2, and the hash differs by role.
- Both roles' instructions contain:
  - the refusal rule (never claim, never attempt);
  - "Adjust compensation" and "Salary requests";
  - the scope rule;
  - the currency-code money rule.
- Admin instructions name "HR Access" and "Adjust compensation" on the employee's page. Scoped instructions contain no "HR Access" and refer to a salary request and Admin HR.

**MySQL test:** `test/db/assistant-conversations.test.ts`, "Scoped HR ranking and summary results carry the scope limitation…"
- Rohan's turn calls the top-compensated and summary tools.
- The turn response's first limitation is the exact text.
- Both stored `ai_tool_calls.result.limitations[0]` values equal the text.
- The trace's `prompt_version` is v2.
- Meera's summary turn has no scope limitation.

**Expectations changed on purpose:** the prompt version moved from v1 to v2 in `test/assistant-conversations.test.ts` and `test/db/assistant-conversations.test.ts`.

**Red-to-green evidence:**
1. Run before any change, the new fast test file failed to load (`does not provide an export named 'scopeLimitation'`).
2. After D1 only: 3 pass (D1), 3 fail (D2: prompt version, refusal rule, role-aware next action).
3. After D2: 6 pass.

**Mutation check:** removing the scope limitation from the summary tool made both summary-dependent D1 tests fail. I then restored the code; no backup file remained.

## Checks

Run from `express-backend/` against `acme_ai_backend_test` in container `acme-ai-backend-mysql` on 127.0.0.1:3322. The container still existed, so I did not recreate it.

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0; file byte-identical |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: **455 tests, 455 pass, 0 fail, 0 cancelled** |
| `npm run test:db` | exit 0: **390 tests, 390 pass, 0 fail, 0 cancelled** |
| `npm run build` | exit 0 |
| `node --import tsx --test test/http-openapi.test.ts` | 16 pass, 0 fail (no drift) |

I did not run a baseline in this new worktree before the changes. The counts match Task 04a (449 fast, 389 MySQL) plus the 6 new fast tests and 1 new MySQL test.

## Files changed (all under `express-backend/`)

- `src/assistant/tools.ts`: `scopeLimitation` and `withScope`, applied in the three aggregate tools.
- `src/assistant/assistant-service.ts`: prompt v2, role-aware `assistantInstructions` and `prompt`, the scope rule, the refusal rule, and the money wording.
- `src/assistant/conversation-service.ts`: passes `principal.role` to `prompt`.
- `scripts/eval-assistant.ts`: passes the Admin role to `prompt`.
- Tests:
  - `test/assistant-eval01-fixes.test.ts` (new);
  - `test/db/assistant-conversations.test.ts` (+1 test, plus the v2 expectation);
  - `test/assistant-conversations.test.ts` (v2 expectation);
  - `test/assistant-service.test.ts` (prompt call takes a role).

## Found but not fixed (outside Task 05)

**The evaluator's manifest note is a real defect from my Task 04 step 3.**
- In `src/evaluation/oracle-fixtures.ts`, `evaluationClock` is read once, but the salary service calls the live clock again when it writes `created_at`.
- `recordedAt` therefore ends up a few milliseconds after `evaluationClock`, and `recordedWithinRecentWindow` comes out `false`.
- The test missed it because it injects a fixed clock.
- Proposed one-line fix: pass the service a frozen clock (`() => now`).
- I did not change it here. It is outside this task's scope and the oracle command's shared code path. I can do it as a follow-up if the planner wants.

**The evaluator's other minor findings are not addressed:**
- prose missing dates;
- clarification wording;
- no source pointer;
- an extra summary call;
- the search card showing non-matching departments.

## Confirmations

- No Git command was run, and nothing was committed.
- No `.env` file was read or created, and no live API key was used; tests use fake models.
- Only database 3322 / `acme_ai_backend_test` was used.
- No `next-frontend/**` or `docs_human/**` file was changed. The frontend page names were only read.
- Task 06 was not started; it waits for the planner's acceptance of this task.
