# Builder instruction index

This file is the entry point for every builder session.

The builder must read this file before it reads a task file.

## Roles

- Prakhar is the product owner and technical owner. He approves product decisions and commits.
- The planner creates requirements, design documents, tests, and bounded builder tasks. The planner reviews builder results.
- The builder implements only the current task.
- A tester will check selected completed workflows independently.

The builder must not expand the product scope without approval.

## Directory contract

```text
builder_docs/
  parent_instructions/
    index.md                         # Current state and next task
    01-workbook-generator.md         # Completed task instructions
    02-initial-migration.md          # Completed task instructions
    02a-migration-review-fix.md      # Completed review correction
    03-workbook-database-seed.md     # Current task instructions
  responses/
    01-workbook-generator.md         # Completed builder report
    02-initial-migration.md          # Completed builder report
    02-initial-migration-fix.md      # Completed review response
    03-workbook-database-seed.md     # Builder creates this after task 03
```

Product decisions and technical designs remain under `docs/`.

Prakhar's raw notes remain under `docs_human/`. The builder must not edit them.

The planner updates this index after review. The builder does not change task status in this file.

## Project method

For each milestone:

1. Prakhar and the planner make the important decisions.
2. The planner writes or reviews the design and expected tests.
3. Prakhar commits the approved plan.
4. The builder reads this index and the current task.
5. The builder implements only that task.
6. The builder writes a response under `builder_docs/responses/`.
7. The planner checks the code, tests, and response.
8. Prakhar performs the requested manual check.
9. Prakhar commits the accepted implementation.
10. The planner updates this index to point to the next task.

Do not combine milestones because the next design document already exists.

## Global builder rules

- Work only in `/Users/admin/Desktop/Projects/incubyte_take_home`.
- Use JavaScript until a later approved TypeScript migration.
- Do not run Git commands.
- Do not commit or push.
- Never read an `.env` file.
- Never create code that loads an `.env` file.
- Use injected process environment values.
- Do not modify files under `docs_human/`.
- Do not modify approved product decisions under `docs/` unless the task requests a documentation correction.
- Record actual work only.
- Do not invent failed tests, test runs, measurements, or agent work.
- Stop when the current task is complete.
- Report a true requirement conflict instead of making a hidden product decision.
- Make normal implementation decisions without repeated approval requests.

## Skill use

Use relevant skills only.

For each skill used, record:

- Original repository URL.
- Exact revision.
- Files read.
- Loading method.
- Task where it changed the work.
- One concrete effect.

Skill installation without a concrete effect is not evidence of skill use.

Frontend skills are required when frontend work starts. They are not required for database-only tasks.

## Completed work

### Planning and source workbook design

Status: `ACCEPTED AND COMMITTED`

Completed:

- Product requirements.
- Source workbook design.
- Synthetic data rules.
- Workbook generator test plan.
- Initial database schema design.

### Task 01: Source workbook generator

Status: `ACCEPTED AND COMMITTED`

Instructions:

```text
builder_docs/parent_instructions/01-workbook-generator.md
```

Response:

```text
builder_docs/responses/01-workbook-generator.md
```

Result:

- JavaScript generator created.
- One `.xlsx` workbook created.
- 10,000 synthetic employees created.
- Independent planner check passed.
- 121 tests passed.

### Task 02: Initial MySQL migration

Status: `ACCEPTED AND COMMITTED`

Result:

- Raw MySQL migration created.
- Migration runner created.
- Docker Compose MySQL 8 test service created.
- Automatic `.env` loading disabled in project Compose commands.
- Independent planner verification passed: 130 fast tests and 52 real-MySQL tests.

Instructions:

```text
builder_docs/parent_instructions/02-initial-migration.md
builder_docs/parent_instructions/02a-migration-review-fix.md
```

Responses:

```text
builder_docs/responses/02-initial-migration.md
builder_docs/responses/02-initial-migration-fix.md
```

### Task 03: Seed MySQL from the workbook

Status: `ACCEPTED AND COMMITTED`

Result:

- Approved workbook parser created.
- 10,000 employees inserted into MySQL.
- 10,000 initial compensation records inserted.
- Destructive replacement uses one transaction.
- Rollback behavior verified with a real MySQL failure.
- Independent planner verification passed: 159 fast tests and 66 real-MySQL tests.

Instructions:

```text
builder_docs/parent_instructions/03-workbook-database-seed.md
```

Response:

```text
builder_docs/responses/03-workbook-database-seed.md
```

## Current task

### Task 04: HR access-control foundation

Status: `ACCEPTED AND COMMITTED`

Result:

- HR user, scope, session, and audit tables created.
- Argon2id password hashing added.
- Two-hour JWT and database sessions added.
- Current access loads on every request.
- Last-active-administrator and administrator-scope protections added.
- Independent planner verification passed: 196 fast tests and 123 real-MySQL tests.

Instructions:

```text
builder_docs/parent_instructions/04-hr-access-control.md
```

Supporting documents:

```text
docs_human/05-access-control-raw.md
docs/10-access-control-design.md
docs/11-access-control-test-plan.md
```

Expected response:

```text
builder_docs/responses/04-hr-access-control.md
```

The builder must stop after the access-control migration, domain policy, session foundation, and tests pass. It must not start Express routes or frontend work.

## Current task

### Task 05: Backend TypeScript migration

Status: `ACCEPTED AND COMMITTED`

Independent planner verification passed: strict type check, lint, 202 fast tests, 123 real-MySQL tests, and the production build.

Instructions:

```text
builder_docs/parent_instructions/05-typescript-migration.md
```

Supporting documents:

```text
docs_human/06-typescript-migration-raw.md
docs/12-typescript-migration-design.md
docs/13-typescript-migration-test-plan.md
```

Expected response:

```text
builder_docs/responses/05-typescript-migration.md
```

The builder must stop after strict type checking, all existing tests, the production build, and compiled command smoke tests pass. It must not start Express routes or frontend work.

### Task 06: Express authentication API

Status: `ACCEPTED AND COMMITTED`

Independent planner verification passed: strict type check, lint, 263 fast tests, 137 real-MySQL tests, and production build.

Instructions:

```text
builder_docs/parent_instructions/06-authentication-api.md
```

Supporting documents:

```text
docs_human/07-auth-api-raw.md
docs/14-authentication-api-design.md
docs/15-authentication-api-test-plan.md
```

Expected response:

```text
builder_docs/responses/06-authentication-api.md
```

The builder must stop after the authentication endpoints, OpenAPI contract, rate limit, process smoke test, and all regression tests pass. It must not start employee routes or frontend work.

## Current task

### Task 07: Employee directory API

Status: `ACCEPTED AND COMMITTED`

Independent planner verification passed: strict type check, lint, 284 fast tests, 174 real-MySQL tests, production build, official exchange-rate evidence, and measured queries.

Instructions:

```text
builder_docs/parent_instructions/07-employee-directory-api.md
```

Supporting documents:

```text
docs_human/08-employee-directory-apis.md
docs/16-employee-directory-api-design.md
docs/17-employee-directory-api-test-plan.md
```

Expected response:

```text
builder_docs/responses/07-employee-directory-api.md
```

The builder must stop after the directory, options, detail, currency conversion, OpenAPI, authorization, and measured-query checks pass. It must not start frontend or mutation work.

## Next planned task

### Backend Task 08: Read-only AI assistant and MCP adapter

Status: `ACCEPTED - COMMIT REQUIRED`

Independent planner verification passed after review fixes: strict type check, lint, 332 fast tests, targeted real-MySQL assistant tests, and production build.

Instructions:

```text
builder_docs/parent_instructions/08-ai-assistant-mcp.md
```

Shared contract:

```text
builder_docs/shared/ai-assistant-contract.md
```

Expected response:

```text
builder_docs/responses/08-ai-assistant-mcp.md
```

The backend builder must not start this task until Task 07 is committed. The old parent task `08-frontend-directory.md` is superseded by the separate frontend-builder lane.

## Latest backend status

### Tasks 09 and 09a: Salary adjustments

Status: `IMPLEMENTED - WORKING TREE`

The backend salary workflow and idempotency correction are complete pending the current combined review and commit sequence.

### Task 10: Dashboard analytics API

Status: `IMPLEMENTED - WORKING TREE`

The dashboard read APIs and OpenAPI contract are available to the frontend builder.

### Task 11: HR access-management API

Status: `NEEDS REVIEW FIX`

Independent review found one recoverability gap: a successful create with a lost HTTP response leaves the generated temporary password unavailable, while the account remains active and no recovery operation exists.

Review:

```text
semantic-review/2026-11-16-200606-pr-backend-11.md
```

### Backend Task 11a: temporary-password recovery

Status: `IMPLEMENTED - FOLLOW-UP REQUIRED`

Task 11a fixed the original lost-create-response recovery gap. Independent review found two remaining issues: self-regeneration can lock out the actor, and sign-in can race password replacement and insert a session after revocation.

Review:

```text
semantic-review/2026-11-16-205936-pr-backend-11a.md
```

### Current backend task: 11b final review fixes

Status: `READY`

Instructions:

```text
builder_docs/parent_instructions/11b-backend-final-review-fixes.md
```

Expected response:

```text
builder_docs/responses/11b-backend-final-review-fixes.md
```

This task also fixes the confirmed soon-to-join dashboard commitment gap and adds missing dashboard failure coverage. The builder must stop after these bounded corrections.

## Response requirements

Every response must include:

- Task completed.
- Files changed.
- Main implementation decisions.
- Tests added.
- Defect that each important test can detect.
- Failed tests actually observed before implementation.
- Exact verification commands.
- Exact results.
- Known limitations.
- Open decisions.
- Confirmation that no Git command ran.
- Confirmation that no later task started.
