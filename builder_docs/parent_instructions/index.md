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
    02-initial-migration.md          # Current task instructions
  responses/
    01-workbook-generator.md         # Completed builder report
    02-initial-migration.md          # Builder creates this after task 02
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

## Current task

### Task 02: Initial MySQL migration

Status: `IN PROGRESS`

Instructions:

```text
builder_docs/parent_instructions/02-initial-migration.md
```

Required supporting documents:

```text
docs/05-initial-database-schema.md
docs/06-schema-test-plan.md
```

Expected response:

```text
builder_docs/responses/02-initial-migration.md
```

The builder must stop after the migration and schema tests pass.

The builder must not write the workbook seed script during Task 02.

## Next planned task

### Task 03: Seed MySQL from the workbook

Status: `NOT READY`

Instructions:

```text
builder_docs/parent_instructions/03-workbook-database-seed.md
```

Supporting documents:

```text
docs/08-workbook-seed-design.md
docs/09-workbook-seed-test-plan.md
docs_human/04-workbook-database-seed-raw.md
```

Expected response:

```text
builder_docs/responses/03-workbook-database-seed.md
```

Task 03 is designed but blocked. The planner must accept Task 02 and change the Task 03 status to `READY` before the builder starts it.

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
