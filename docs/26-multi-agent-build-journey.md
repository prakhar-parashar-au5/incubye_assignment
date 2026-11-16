# How we built this product with multiple agents

## The working model

Prakhar is the product and technical owner.

The orchestrator turns Prakhar's decisions into bounded tasks, assigns those tasks to specialist agents, checks their evidence, and prevents concurrent work from drifting into one another.

Builders implement. Testers challenge the result. Neither group decides product policy or commits code.

```text
Prakhar decides
      ↓
Orchestrator specifies and assigns
      ↓
Specialist builder implements and reports
      ↓
Orchestrator independently reviews
      ↓
Tester exercises the accepted product
      ↓
Prakhar reviews and commits
```

## Where Prakhar comes in

Prakhar owns the decisions that change product behavior or operational risk.

Examples from this project:

- Annual salary is authoritative; monthly salary is derived.
- INR and USD remain separate native currencies.
- Scoped HR access uses country and department together.
- Admin applies a salary change; Scoped HR submits a request.
- Every salary mutation requires preview and confirmation.
- AI tools are read-only.
- Complete AI traces are allowed only while the dataset is synthetic.
- Real employee data requires a separate redaction policy.

The agents do not silently choose these rules. The orchestrator asks for a decision, records it in `docs_human/`, and then converts it into implementation and test requirements.

Prakhar also controls Git history. Builders do not run Git commands, commit, push, or decide when work is ready. Prakhar reviews the accepted slice and decides when to commit it.

## What the orchestrator does

The orchestrator is the planner, coordinator, and reviewer.

Its responsibilities are:

1. Turn product decisions into a coherent specification.
2. Split work into small tasks with explicit ownership.
3. State what each task must not change.
4. Define tests and evidence before implementation.
5. Route work to the right specialist.
6. Verify reported defects against actual code.
7. Run independent checks before accepting a task.
8. Send confirmed findings back as focused correction tasks.
9. Keep backend, frontend, AI, and tester work synchronized.
10. Stop agents from starting speculative follow-up work.

The orchestrator does not accept a builder report as proof. It reads the implementation, reproduces important behavior, runs checks, and uses an independent semantic reviewer where useful.

This review loop caught real issues, including:

- A frontend success message that could be manufactured with a URL parameter.
- An Admin approval screen that omitted current compensation context.
- A lost create-user response that could strand an account without a usable password.
- A sign-in race that could create a session from an old password after regeneration.
- A dashboard commitment total that omitted a future adjustment for a soon-to-join employee.
- AI observability records with incomplete list fields and contradictory rejected-tool results.

## Specialist agents

### Backend builder

The backend builder owns Express, MySQL, authorization, transactions, exact money, migrations, and OpenAPI.

It works from a bounded task and writes a response containing:

- Files changed.
- Design decisions.
- Tests written.
- Failures observed before the fix.
- Commands and results.
- Known limitations.

It does not modify frontend code or invent product behavior.

### Frontend builder

The frontend builder owns Next.js pages, Server Actions, generated API contracts, responsive behavior, accessibility, and browser tests.

It uses the backend OpenAPI as the contract. If the contract is missing something, it reports a blocker instead of inventing a frontend-only field or calculation.

The browser never becomes the authority for salary, scope, or permissions.

### AI backend builder

The AI builder owns the read-only assistant, model adapter, tool loop, MCP adapter, persistent conversations, trace recording, and Admin observability APIs.

It uses fake models and fault injection for deterministic correctness. A live OpenAI response proves provider compatibility and sampled behavior; it does not replace deterministic tests.

### General HR tester

The general tester uses only the visible application through computer use.

It behaves like Admin HR and Scoped HR, completes real workflows, records every mutation, captures screenshots, and reports reproducible defects. It does not read source before the black-box pass or fix the problems it finds.

### AI assistant evaluator

The AI evaluator first judges each answer as an HR user. It then opens the corresponding Admin trace and checks model calls, tool calls, arguments, results, cards, tokens, and the final response.

It checks facts against an independent source such as employee detail or dashboard data. It does not validate an answer only against its own trace because the answer and trace can share the same wrong tool result.

### AI traces frontend builder

This builder owns saved conversation UI and the Admin trace dashboard. It consumes the accepted observability OpenAPI and cannot change backend trace semantics or authorization.

## Why tasks are bounded

Every task names:

- Goal.
- Required behavior.
- Files or areas it may own.
- Areas it must not touch.
- Tests that must fail before implementation.
- Validation commands.
- Required response path.
- Stop conditions.

This prevents one agent from “helpfully” refactoring another feature or building the next idea before the current one has been reviewed.

A builder stops after its response. The orchestrator either accepts the result or creates a small correction task.

## How parallel work stays safe

Parallel agents create two risks:

1. They can edit the same files.
2. Their tests can reset the same database.

The next phase uses separate Git worktrees, databases, and ports.

```text
Integration workspace       accepted work and coordination
Backend builder worktree    backend branch and database
AI builder worktree         assistant branch and database
Frontend builder worktree   frontend branch and database
General tester worktree     frozen production build
AI evaluator worktree       frozen complete AI candidate
```

A tester receives a fixed commit and production build. Builder edits cannot trigger hot reloads or change the application during the test.

Each lane has its own MySQL instance or database. A destructive backend test cannot erase a tester's conversations or salary mutations.

## Checkpoints

The project advances through explicit checkpoints.

### Product baseline

Salary, dashboard, HR access, contracts, and browser workflows are accepted and committed. The general HR tester freezes here.

### AI backend contract

Persistent conversations, model/tool traces, MCP traces, Admin APIs, and OpenAPI are accepted. The AI traces frontend builder starts from here.

### Complete AI candidate

Saved conversations and Admin observability UI are accepted. The AI evaluator freezes here.

A defect is fixed in a builder worktree. The frozen tester copy is never patched in place. After the fix is reviewed, a new test candidate is created.

## Evidence and trust

Each agent produces evidence appropriate to its role:

- Unit tests prove small deterministic rules.
- Real-MySQL tests prove constraints, transactions, locks, and SQL scope.
- API tests prove authorization and contracts.
- Browser tests prove integrated journeys.
- Computer-use testing finds workflow and usability problems automation did not anticipate.
- AI evaluation repeats stochastic prompts and records failures as well as successes.
- Semantic review checks whether the code tells the same story as the specification.

Passing tests do not automatically mean acceptance. A test suite can miss a requirement or encode the wrong behavior. The orchestrator checks both implementation and test quality.

## The practical loop

For each feature:

```text
1. Prakhar answers product questions.
2. The decision is recorded in docs_human/.
3. The orchestrator writes a bounded task.
4. A builder implements it test-first.
5. The builder writes an evidence report.
6. The orchestrator verifies code and behavior.
7. Confirmed findings become a correction task.
8. Prakhar tests or reviews the accepted result.
9. Prakhar commits the coherent slice.
10. A frozen tester validates the integrated product.
```

The result is not “agents building autonomously.” It is a controlled engineering process where agents provide parallel execution, Prakhar owns judgment, and the orchestrator maintains boundaries, evidence, and sequence.
