# Builder report 01: Source workbook generator

**Task:** `docs/04-builder-task-workbook-generator.md`
**Status:** Built and verified. Not committed. Waiting for Prakhar's review.
**Scope:** `express-backend/` only. No database, API, migration, frontend, or later feature.

This folder holds one builder report per long task, for the reviewer session. Reports state facts and open questions. They do not record product decisions; those stay in `docs/`.

## What was built

A JavaScript command that generates `express-backend/generated/acme-employees.xlsx`: one `Employees` sheet, one header row, 10,000 synthetic employees, current compensation only.

| File | Concern |
|---|---|
| `src/source-workbook/constants.js` | Approved values, ranges, distributions, titles |
| `src/source-workbook/seeded-random.js` | Seeded random numbers (mulberry32) and shuffle |
| `src/source-workbook/iso-date.js` | `YYYY-MM-DD` checks and UTC day arithmetic |
| `src/source-workbook/names.js` | Fixed synthetic name lists |
| `src/source-workbook/employee-generator.js` | Generates the employees; pure, no validation |
| `src/source-workbook/employee-validator.js` | Rules for one employee |
| `src/source-workbook/employee-dataset.js` | Rules for the complete data set |
| `src/source-workbook/workbook-writer.js` | ExcelJS writing |
| `src/source-workbook/source-workbook.js` | Validate, then write through a temporary file |
| `src/source-workbook/cli-options.js` | Command-line parsing |
| `scripts/generate-workbook.js` | Thin entry point |

Other files: `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.js`, `README.md`, five test files under `test/`.

Data flow: parse options → refuse if output exists without `--overwrite` → generate → validate the complete data set → write to `<output>.<pid>.tmp` → move to the output path → delete the temporary file. If validation fails, nothing is written.

## Dependencies

- Runtime: `exceljs@4.4.0` (MIT).
- Dev: `eslint@9.39.5`, `@eslint/js@9.39.5`, `jszip@3.10.2` (already installed by ExcelJS; declared so one test can read the raw sheet XML).
- Test runner: built-in `node:test`.

**Library choice.** ExcelJS supports frozen panes, filters, number formats, validation lists, and read-back in its free version. The free SheetJS edition does not document frozen panes, filters, or validation lists, and its npm package is stuck at 0.18.5 with known advisories. Caveat: ExcelJS was last released in October 2023. `npm audit` reports one moderate advisory in its `uuid` dependency, in functions the generator does not call.

## TDD skill use

- Source: https://github.com/mattpocock/skills (not a fork; owner `mattpocock`; MIT).
- Revision: `5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-12).
- Files read: `skills/engineering/tdd/SKILL.md`, `tests.md`, `mocking.md`.
- Loaded by fetching the raw files at that revision with `gh api`. Nothing was installed.
- Effects:
  - Tests use literal values from the approved tables, never `constants.js`. Mutation check: changing India JUNIOR max to 1,300,000 and India pay frequency to `ANNUAL` made 14 tests fail. Both values were restored.
  - Work was done in 8 vertical slices, not all tests first.
  - Seed and generation date are always passed in; no clock faking needed.
- The skill asks for seams to be agreed first. The approved test plan was treated as that agreement.

## Red tests observed

Each slice first ran against a stub that returned empty values.

| Slice | Failed before implementation |
|---|---|
| 1. Required values | 3 of 4 |
| 2. ID, email, allowed values, country rules, titles | 28 |
| 3. Salary and bonus | 13 |
| 4. Dates and status rules | 18 |
| 5. Generator | 15 of 18 |
| 6. Data set validator | 9 of 10 |
| 7. Workbook output | 14 (11 through a failed setup step, 3 individually) |
| 7b. Overlapping validation ranges | 1 |
| 8. Command line | 6 |

Slice 7b found a real defect: ExcelJS's per-cell merge wrote overlapping validation ranges (for example `E2:E10001` and `E10:E10001`), which can make Excel offer to repair the file. Fixed by registering one range per column.

Never red: the "accepts valid X" guard tests, and three literal salary/bonus/currency tests added last. The mutation check above is their evidence.

## Verification

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | 121 tests, 121 pass, 0 fail, about 1.8 s |
| `npm run generate:workbook` | exit 0, 10,000 rows |
| Same command again, no `--overwrite` | exit 1, file unchanged |
| `--seed nope` | exit 2 |
| `--overwrite` | exit 0, file replaced |

Read-back of the final file: sheet `Employees`; 10,001 rows; header frozen; filter `A1:P10001`; IN 7,000 / US 3,000; 8,500 working / 1,000 left / 500 soon to join; Tech 4,000 / Support 2,500 / Operations 2,000 / Finance 800 / HR 700; JUNIOR 2,500 / MID 3,500 / SENIOR 2,500 / LEAD 800 / MANAGER 700; 2,000 zero bonuses; 10,000 unique IDs and emails; 0 data set errors; logical-data hash matches a fresh generation (`cf360158af8634e4`).

## Open questions for Prakhar

1. Raw test notes say junior max 10L INR and floor 3L. The approved JUNIOR range is 5L–12L INR. Followed the approved docs.
2. `Program Manager` is an approved SENIOR Operations title, but non-managers must not have a management title. Treated only MANAGER-list titles as management titles.
3. "Dates from 2012 through the generation date" conflicts with future `SOON_TO_JOIN` hire dates. Chose 1–90 days after the generation date.
4. A 0% bonus is allowed for JUNIOR, MID, and SENIOR, which would break "exactly 20% zero". Non-zero bonuses use at least 0.01%.
5. A capped bonus can fall below the level's percentage floor (US LEAD, US MANAGER). The validator accepts it, per "smaller of percentage and cap".
6. Examples in `docs/01`: `Backend Engineer` is not an approved title; salary 1,500,000 is below the SENIOR minimum. Suggest fixing the examples.

## What the reviewer should check

- `employee-validator.js`: bonus floor and cap logic in integer minor units.
- `employee-generator.js`: exact-total shuffles; date generation per status.
- `source-workbook.js`: no file is created when validation fails; no overwrite without the option.
- `workbook-writer.js`: the `dataValidations.add` range workaround (undocumented ExcelJS API, stable in 4.4.0).
- Whether the generated `.xlsx` (about 850 KB) should be committed.

## Known limitations

- Same seed and date give the same logical data, not identical file bytes.
- `job_title` has no Excel validation list; its allowed values depend on department and level.
- If another process creates the output file between the existence check and the final copy, the run fails with "already exists" and leaves that file in place.

## Not done

- No Git commands, commits, or pushes.
- No changes to `docs/` or `docs_human/`.
- Database schema task not started.
