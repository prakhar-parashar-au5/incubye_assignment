# Builder task: Generate the source workbook

**Status:** Ready after the design and test documents are committed

## Read first

- `docs/requirements.md`
- `docs/01-source-workbook.md`
- `docs/02-synthetic-data-rules.md`
- `docs/03-generator-test-plan.md`
- `docs_human/01-source-workbook.md`
- `docs_human/02-generator-tests-raw.md`

The candidate made the product and data decisions. Do not change salary ranges, distributions, columns, or validation rules without asking.

## Task

Create a small JavaScript project under `express-backend/`.

Write a deterministic script that creates the approved 10,000-row `.xlsx` workbook.

Use JavaScript for this phase. Do not convert the project to TypeScript.

## Required work order

1. Inspect the approved documents.
2. Fetch and read the original Matt Pocock TDD skill instructions.
3. Record the source URL, revision, files read, and one concrete effect on this task.
4. Select the workbook library after a short check of its current documentation and license.
5. Create the smallest package setup required for this task.
6. Write focused failing tests from `docs/03-generator-test-plan.md`.
7. Implement employee validation.
8. Implement deterministic employee generation.
9. Implement workbook writing.
10. Read the written workbook in tests and verify its structure.
11. Run lint and tests.
12. Generate the final sample workbook.
13. Stop. Do not create database tables or application APIs.

## Suggested boundaries

Keep these concerns separate without adding a framework:

- Approved constants and value lists.
- Seeded random selection.
- Employee generation.
- Employee validation.
- Workbook writing.
- Command-line entry point.

The command-line entry point must be thin. Tests should call functions directly where practical.

## Command behavior

The script must accept:

- Output file path.
- Random seed.
- Generation date.
- Explicit overwrite option.

Provide safe defaults from the approved data rules.

The script must not:

- Read `.env` files.
- Use network access.
- Connect to a database.
- Log all employee records.
- Overwrite an existing file without explicit permission.
- Generate data during module import.

## Output

Use a clear path such as:

```text
express-backend/generated/acme-employees.xlsx
```

Commit policy is outside this task. Do not run Git commands. Return the changed files, test results, generated row count, output path, library choice, and known limits to the candidate and planner.

Frontend design skills are not needed for this task. Use them when frontend work begins. Do not claim that an unused frontend skill affected this generator.
