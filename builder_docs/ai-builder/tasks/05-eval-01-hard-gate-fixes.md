# AI builder task 05: fixes from live evaluation 01

## Status

READY. Branch `fix/assistant-eval-01`, worktree `/Users/admin/Desktop/Projects/incubyte_take_home_ai_fixes`, from master `9236ac4`.

Source: `/Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_run/tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md`, section 8. It was run on `gpt-6-luna`. Read it; don't edit it.

Everything else passed: grounding, exact money, currency, time, existence privacy, no mutation, tool validity, trace completeness, and secret exclusion. Keep those passing.

## D1 (hard gate, medium): Scoped answers claim company-wide coverage

**Example.** Rohan (Scoped HR: India, Support and Tech) asks for the "top five company-wide" or the "total for the whole organization". The answer says "company-wide … across 3,901 employees". The data shown is correct and in scope, but the claim about coverage is false.

**Fix, in two layers:**
1. **Tool results.** When the actor is Scoped HR, every ranking, summary, or aggregate result includes a limitation that states the scope, for example: "Covers only employees in your access: India; Support, Tech." The text is generated from the principal's current scope. It is never the model's own wording. Admin HR gets no such limitation. The UI already shows limitations, so this also fixes what the user sees without depending on the model.
2. **Instructions.** Add one rule: when results are limited to the user's access, say so, and never describe them as company-wide or organization-wide.

## D2 (hard gate, low): mutation refusals give no safe next action

Replace the read-only rule with one that refuses and then names where the action is done in the app:
- Salary changes: "Adjust compensation" on the employee's page (Admin HR), or a salary request (Scoped HR).
- Approving or cancelling requests: "Salary requests".
- HR users and permissions: "HR Access" (Admin HR only).

The refusal must never claim an action was taken, and must never call a tool to attempt one. Name only places the current role can use: Scoped HR must not be pointed to HR Access.

## Minor, do only if cheap

Add one instruction to quote money exactly as the tools return it, with its currency code, and not reformat the digit grouping. Optional.

## Rules for the change

- Bump the prompt version (`assistant-instructions-v1` to `v2`), so traces tell old answers from new ones.
- This is a shared assistant path, so make the smallest change. No new tools, no schema changes, and no OpenAPI changes beyond limitation text, if any.

## Tests

- **Fast tests with the fake model:**
  - Scoped ranking, summary, and aggregate results carry the scope limitation, with the exact text from the principal's scope.
  - Admin results do not carry it.
  - The instructions contain the scope rule and the safe-next-action rule.
  - The role-aware next action for Scoped HR does not mention HR Access.
- **MySQL tests:** the scope limitation appears in the stored tool result and in the API turn response for Rohan.
- **Checks:** lint, typecheck, `npm test`, `npm run test:db`, build, and OpenAPI drift.

Use test DB `acme-ai-backend-mysql` on `127.0.0.1:3322`, database `acme_ai_backend_test`. It still exists. If it is gone, start a new one on 3322 with the same name.

## Not in scope

There is no live-model rerun. The planner will have the evaluator re-check D1 and D2 after merge.

No frontend changes, no `docs_human/**`, no Git, no `.env`, no live key. Write `responses/05-eval-01-hard-gate-fixes.md` and stop.
