# Parallel worktree and AI evaluation plan

## Purpose

Run builders and testers in parallel without hot reloads, shared databases, partial code, or changing test evidence underneath a browser session.

A worktree is only a source checkout. Stable testing also requires a fixed commit, production builds, dedicated ports, and an isolated database.

## Checkpoints

### Checkpoint A: HR product baseline

Create this checkpoint after:

- Frontend Dashboard Task 04 is complete and reviewed.
- Backend Task 11b is accepted.
- Salary, dashboard, and HR-access backend work is committed.
- Salary and dashboard frontend work is committed.
- Generated OpenAPI artifacts are current.
- Required backend, frontend, MySQL, build, and browser checks pass.

The general HR computer-use tester freezes from Checkpoint A.

Checkpoint A does not claim that AI traces or saved conversations are complete.

### Checkpoint B: AI observability backend contract

Create this checkpoint after:

- Persistent server-owned conversations work.
- Complete assistant model and tool instrumentation works fail-closed.
- MCP instrumentation works.
- Admin trace, MCP, review, and deletion APIs work.
- Runtime schemas and OpenAPI are reviewed and current.
- Deterministic failure-injection tests pass.

The AI-traces frontend builder creates its implementation worktree from Checkpoint B.

### Checkpoint C: complete AI candidate

Create this checkpoint after:

- Saved assistant conversations and recording notice are implemented.
- Admin trace list/detail, raw view, review, deletion, and MCP views are implemented.
- Backend and frontend integration is reviewed.
- Production builds and isolated browser tests pass.

The AI-assistant evaluator freezes from Checkpoint C.

Do not create the AI evaluator from Checkpoint A. It would test the old client-owned conversation flow and would have no complete trace UI to reconcile.

## Worktree lanes

Suggested paths:

```text
/Users/admin/Desktop/Projects/incubyte_take_home                 integration workspace
/Users/admin/Desktop/Projects/incubyte_take_home_hr_tester       frozen Checkpoint A
/Users/admin/Desktop/Projects/incubyte_take_home_ai_backend       AI backend builder branch
/Users/admin/Desktop/Projects/incubyte_take_home_ai_traces_ui     AI-traces frontend builder branch
/Users/admin/Desktop/Projects/incubyte_take_home_ai_evaluator     frozen Checkpoint C
```

Suggested runtime isolation:

| Lane | Frontend | Backend | MySQL host port | Database |
|---|---:|---:|---:|---|
| Integration | 3200 | 4200 | 3317 | `acme_dev` |
| General HR tester | 3221 | 4221 | 3321 | `acme_hr_test` |
| AI backend builder | none | 4222 | 3322 | `acme_ai_backend_test` |
| AI-traces frontend builder | 3223 | 4223 | 3323 | `acme_ai_ui_test` |
| AI evaluator | 3224 | 4224 | 3324 | `acme_ai_eval_test` |

Each MySQL database used by destructive automated tests must satisfy the repository's test-database name guard.

The existing Compose file hardcodes its project name, container name, and port. Do not run it unchanged in several worktrees. Use an approved external orchestration command or a reviewed Compose override with unique project name, container name, and port per lane.

## Freeze procedure

For a tester candidate:

1. Finish and review all work included in that checkpoint.
2. Commit the accepted files in coherent feature commits.
3. Confirm generated contracts are current.
4. Record the checkpoint commit ID.
5. Add a detached tester worktree at that exact commit.
6. Install dependencies inside the worktree with the lockfiles.
7. Create a dedicated MySQL instance or database.
8. Apply migrations and seed deterministic synthetic data.
9. Build backend and frontend.
10. Run production servers, not development servers.
11. Record ports, migration list, seed date, OpenAPI hash, build time, and model configuration in the tester report.
12. Do not sync or patch the frozen worktree during a test run.

If a tester finds a defect, fix it in a builder worktree. Review and commit the correction, then create a new frozen candidate. Never repair the tester's checkout in place.

## Production-mode rule

Frozen testers run:

```text
backend: npm run build, then npm start
frontend: npm run build, then npm start
```

Do not use `next dev`, TypeScript watch mode, or any HMR process in tester lanes.

## Database isolation

Every lane owns its database state.

- Builders must not run destructive tests against tester databases.
- General HR tester salary mutations must not affect the AI evaluator.
- AI evaluator conversations and traces must not affect general HR evidence.
- A database reset starts a new named test run. Do not reset halfway through one report.
- Record every UI mutation made by a tester.

## Secret handling

- Never read or create `.env` files.
- Never copy process environments between worktrees.
- Never put API keys, JWT signing keys, cookies, database URLs, or passwords in Git, reports, screenshots, prompts, URLs, frontend variables, or trace data.
- The user injects the OpenAI key directly into the AI evaluator backend process through hidden terminal input.
- General HR testing should run without an OpenAI key unless its task explicitly includes AI behavior.
- Tester reports identify the configured model but never the credential.

## Lane ownership

### General HR tester

May use the visible browser to test sign-in, directory, salary, dashboard, responsive behavior, permissions, and accessibility.

Must not inspect code before the black-box report, call APIs directly, query MySQL, edit files, or follow builder changes during the run.

### AI backend builder

Owns model telemetry contract, persistent conversations, fail-closed assistant instrumentation, MCP instrumentation, Admin trace APIs, OpenAPI, and deterministic backend tests.

Must not modify frontend, add AI mutations, weaken authorization, or use a live-provider run as the main correctness proof.

### AI-traces frontend builder

Owns generated frontend contracts, saved conversation UI, recording notice, Admin trace/MCP pages, review and deletion UI, responsive behavior, and browser evidence.

Must not patch backend contracts, handwrite duplicate response interfaces, or weaken raw-data access and redaction rules.

### AI evaluator

Owns a fixed prompt corpus, browser conversations, trace reconciliation, repeat runs, scoring, and evidence reports against Checkpoint C.

Must not edit code, reset shared data, hide failed first attempts, or present one stochastic response as universal proof.

## Evidence provenance

Every tester report records:

- Candidate commit ID.
- Backend and frontend build timestamps.
- OpenAPI artifact hash.
- Applied migration names.
- Seed and generation date.
- Frontend, backend, and database ports.
- Model ID.
- System-prompt version/hash when visible through Admin traces.
- Exact test window.
- Retries, timeouts, rate limits, and omitted tests.

Stop the run if process provenance does not match the frozen handoff.

## Sequence

1. Complete and review Frontend Dashboard Task 04.
2. Commit all accepted current work in coherent slices.
3. Create Checkpoint A and freeze the general HR tester.
4. Run general HR testing while the AI backend builder works from its own worktree.
5. Complete AI Backend Tasks 03 and 04, then create Checkpoint B.
6. Start AI-traces frontend implementation from Checkpoint B. Its shape task may run earlier because it writes no production code.
7. Review and integrate the AI frontend, then create Checkpoint C.
8. Freeze and run the AI evaluator.
9. Route verified defects back to the owning builder lane.
