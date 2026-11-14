# Builder response 03: Seed MySQL from the workbook

**Task:** `builder_docs/parent_instructions/03-workbook-database-seed.md`
**Status:** Complete and verified. Not committed. Waiting for review.
**Scope kept:** no Express routes, frontend, auth, access control, import preview, AI, or MCP.

## Task completed

`npm run db:seed -- --replace` reads the approved `.xlsx` workbook, validates all of it, inserts or verifies reference data, then replaces all employee and compensation data in one MySQL transaction.

Before starting I confirmed that Task 02 is `ACCEPTED AND COMMITTED` in the index and that its 52 DB tests pass.

## Files changed (all in `express-backend/`)

| File | Change |
|---|---|
| `src/seed/workbook-reader.js` | New. `readEmployeeWorkbook`, `toDecimalString`, `WorkbookError`. |
| `src/seed/seed-safety.js` | New. `assertSeedAllowed`, `SeedRefusedError`. |
| `src/seed/reference-data.js` | New. `ensureReferenceData`, `resolveJobTitleIds`, `ReferenceDataError`. |
| `src/seed/replace-employees.js` | New. `replaceEmployeeData`, batch inserts, `DEFAULT_BATCH_SIZE = 1000`. |
| `src/seed/seed-database.js` | New. `seedDatabase`: guard, then validate, then reference data, then replace. |
| `scripts/seed-database.js` | New. Thin command (`--replace`, `--workbook`, `--generation-date`). |
| `src/source-workbook/employee-validator.js` | `toMinorUnits` is now exported so the reader shares the exact two-decimal check. No behaviour change. |
| `test/support/workbook-fixtures.js` | New. Small hand-written `.xlsx` builder. |
| `test/workbook-reader.test.js` | New. 18 unit tests. |
| `test/seed-safety.test.js` | New. 11 unit tests, including command-line runs. |
| `test/db/seed-database.test.js` | New. 14 real-MySQL tests. |
| `package.json` | New `db:seed` script; description updated. No new dependencies. |
| `README.md` | Seed section and layout rows. |

## Parser design

- **Structure checks.**
  - The workbook must open as `.xlsx`.
  - It must have a worksheet named `Employees`, and that must be its only worksheet.
  - The sheet must not be empty.
  - Headers are checked for missing, unexpected, and repeated names first. If all 16 are present exactly once, their order is checked.
  - A sheet with headers but no employee rows is rejected.
- **Cell checks.** Every row is checked cell by cell before validation:
  - Formula cells, including shared formulas, are rejected.
  - Values beyond the 16 template columns are rejected.
  - Salary and bonus must be numeric cells. Text such as `'2500000'` is rejected.
  - Dates must be `YYYY-MM-DD` text. Excel date cells are rejected, because they depend on the reader's locale and time zone.
  - Other fields must be text cells.
  - Completely empty rows are skipped.
- **Row and data-set validation.**
  - Each row runs through the existing `validateEmployee`.
  - `seedDatabase` then runs the existing `validateEmployeeDataset`. That checks the 10,000-row count, the exact distributions, unique IDs and emails, the ID sequence, the 2,000 zero bonuses, and that every department has both countries.
  - Both validators need the generation date. The seed uses the approved `2026-11-14` by default and accepts `--generation-date`. See open decision 1.
- **Money.** `toDecimalString` uses the validator's integer cents conversion and formats exact strings: `1000000.1` becomes `"1000000.10"`, `0` becomes `"0.00"`. It throws instead of rounding when there are more than two decimal places, so the database never receives a value that `DECIMAL(15,2)` would silently round.
- **Errors.** Messages give the row number, field, and rule, and never cell values. A test confirms that a salary and a name do not appear. At most 20 errors are listed.

## Transaction design

1. `assertSeedAllowed`: refuses `APP_ENV=production`, then any `APP_ENV` other than `development`, `test`, or `demo`, then a missing `--replace`.
2. `resolveDatabaseUrl`: explicit argument or `process.env.DATABASE_URL` only. No `.env` file is read.
3. The whole workbook is read and validated: structure, cells, every row, and the complete data set.
4. One connection is opened (`openConnection`: UTC session, strict `sql_mode`, exact decimal strings).
5. `ensureReferenceData` runs in its own short transaction:
   - Inserts any missing approved countries (India/INR, United States/USD), the 5 departments, and the 44 job titles from `constants.js`.
   - Checks that existing rows match exactly, including letter case. A mismatch fails the seed.
   - Never deletes reference data.
6. `resolveJobTitleIds`: every row must resolve to a `job_titles.id` for its department, title, and level. Otherwise it throws before any deletion.
7. `replaceEmployeeData` runs on the same connection, in one transaction:
   - `DELETE FROM compensation_records`, then `DELETE FROM employees` (not `TRUNCATE`).
   - Insert 10,000 employees in batches.
   - Read back `id, employee_code` and map each employee code to its new internal ID.
   - Insert 10,000 compensation records with version `1`, reason `INITIAL_IMPORT`, and `effective_from` set to `salary_effective_date`.
   - Count both tables; a count other than the number of workbook rows throws.
   - `COMMIT`.
   - Any error: `ROLLBACK` and rethrow the original error.
8. The connection is always closed. Auto-increment values are never reset.

## Batch size and reason

The batch size is 1,000 rows per `INSERT`. Inserts use `connection.execute`, which sends server-side prepared statements, with generated `(?, …)` placeholders. Table and column names are constants.

- **Placeholders:** 1,000 employees × 9 columns = 9,000, far below MySQL's 65,535-per-statement limit.
- **Statement size:** about 200 KB, well under the default 64 MB `max_allowed_packet`.
- **Round trips:** 10 per table instead of 10,000.
- **Measured:** the replacement transaction takes about 340 ms (below). I did not compare other batch sizes.

## Tests added and the defects they detect

**Workbook reader (18, `test/workbook-reader.test.js`)**

| Test | Detects |
|---|---|
| Reads all 10,000 rows of the approved generated workbook | Dropped or duplicated rows |
| Maps ACME00001, ACME00027, and ACME00024 exactly; money as strings | Column shifts, altered text or dates, float money. Expected values are literals taken from the approved workbook |
| Accepts a small valid workbook | An over-strict parser (would make the rejection tests meaningless) |
| Rejects: no `Employees` sheet; extra sheet; missing, unexpected, or repeated header; wrong order; empty workbook; headers with no rows; formula cell | Each structural defect, including a stored `monthly_salary` column |
| Rejects an invalid row through the existing validator | Row rules bypassed |
| Rejects salary stored as text, and a date stored as an Excel date cell | Loose typing; dates that change with locale or time zone |
| Error messages contain no values | Salary or name leakage |
| `toDecimalString`: exact formatting; rejects a third decimal and NaN | `"1000000.1"`, scientific notation, silent rounding |

**Seed safety (11, `test/seed-safety.test.js`)**

| Test | Detects |
|---|---|
| Refuses without `--replace` | Destructive run without explicit intent |
| Refuses `production` | Wiping production data |
| Refuses missing, empty, `prod`, `staging`, `Development`, `dev` | A default that lets the seed run when `APP_ENV` is missing or misspelled |
| Accepts `development`, `test`, `demo` | An over-strict guard |
| Command: no `--replace`, `production`, missing `APP_ENV`, missing `DATABASE_URL`, unknown flag | Non-zero exit and a message, before any connection. The URL points at port 1, so a connection attempt would show `ECONNREFUSED` instead |
| Command: connection failure output has no password, user, or `mysql://` | Credentials in logs |
| Command: missing workbook gives a short message and exit 1 | Stack traces or a 0 exit code |

**Seed against real MySQL (14, `test/db/seed-database.test.js`)**

The file calls `requireTestDatabaseUrl` at import, so it refuses databases not ending in `_test`.

| Test | Detects |
|---|---|
| Reference data: 2 countries, 5 departments, 44 titles (Finance 7, HR 9, Operations 7, Support 6, Tech 15) | Missing or misspelled reference rows |
| Reference data again: still 2/5/44 | Duplicates on every seed |
| Existing IN with currency USD is refused | "Insert if missing" that accepts a wrong existing row |
| Unresolved department/title/level throws with the employee code | An unresolved title reaching the delete step |
| 10,000 employees and 10,000 compensation records, and the summary | Appends, skipped batches |
| Unique codes and emails | Duplicate rows |
| Every employee has exactly 1 record | Records attached to the wrong employee |
| All records are `1:INITIAL_IMPORT` | Wrong version or reason |
| Three rows joined through department and job title match literal workbook values | Mapping, rounding, date, or job-title join errors |
| Country, department, level, and status totals | Distribution drift between file and database |
| Invalid workbook leaves IDs and counts unchanged | Deletion starting before validation |
| Marker employee ACME99999 is gone after a re-seed; still 10,000/10,000 | Append or upsert instead of replacement |
| Rollback after a failure inside the transaction | Deletes committed early (`TRUNCATE`, autocommit, a second connection) |
| Seed after the rolled-back run gives 10,000/10,000 | Leftover state after a rollback |

## Rollback test evidence

1. After a successful seed, the test adds marker employee `ACME99999` with one compensation record (10,001 rows each). It records every `employees.id` and `compensation_records.id`.
2. It adds a test-only `CHECK (created_at <= <current UTC time>)` on `compensation_records`. Every existing row passes, and every new row fails.
3. The seed therefore fails on the first compensation insert. By then it has run both `DELETE`s and inserted all 10,000 employees inside the transaction.
4. The seed rejects with `ER_CHECK_CONSTRAINT_VIOLATED` naming `test_only_fail_seed`. The constraint is dropped in `finally`.
5. After the failure:
   - `employees` IDs are identical to before. Re-inserted rows would have new auto-increment IDs, so identical IDs prove no partial rows remain.
   - `compensation_records` IDs are identical to before.
   - `ACME99999` still exists.
6. **Mutation check:** with `beginTransaction()` temporarily commented out, this test failed (`# pass 12, # fail 1`). With it restored, all tests pass. I confirmed the restore with a search.

I first wrote the failure condition as a `BEFORE INSERT` trigger. MySQL refused to create it: `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER`, because binary logging is on and the `acme` user lacks SUPER. I replaced it with the temporary CHECK instead of raising privileges.

## Red tests actually observed

| Slice | Red before implementation |
|---|---|
| Workbook reader | 18 of 18 failed against stubs |
| Seed safety | 10 of 11 failed against stubs. "Accepts development, test, and demo" passed against the empty stub, as a guard test should |
| Seed DB | 13 of 13 failed. 4 reference tests failed directly; the 9 seed tests failed through their setup step (the `not implemented yet` placeholder) |

After implementation, 2 seed DB tests failed:
- **Replacement test.** A test bug: `COUNT(*)` came back as the string `'0'` because of `bigNumberStrings`. Fixed with `Number(...)` in the test.
- **Rollback test.** The trigger privilege error above; the test now uses a temporary CHECK.

Lint then failed once: the `performance` global was undefined for ESLint. Fixed by importing it from `node:perf_hooks`.

Never red: "invalid workbook leaves data untouched". I added it after the seed was implemented, to cover a case in the raw notes. It has no mutation check.

## Commands and results

Run from `express-backend/`, with `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test'` for the DB commands:

| Command | Result |
|---|---|
| `npm run test:db` (before any Task 03 change) | 52 pass, 0 fail |
| `npm run lint` | exit 0 |
| `npm test` | 159 tests, 159 pass, 0 fail. This includes all 121 workbook generator tests, unchanged |
| `npm run test:db` | 66 tests, 66 pass, 0 fail, about 4.2 s (schema 47, runner 5, seed 14) |
| `APP_ENV=development npm run db:seed -- --replace` (run twice, timed with `/usr/bin/time -p`) | Both print `Seeded 10000 employees and 10000 compensation records.`, exit 0, `real 0.99` s each |
| Count after the repeat runs | `employees` 10000, `compensation_records` 10000 |

## Local seed measurement

- **Machine:** Apple M4 Pro, 12 CPU cores, 24 GB RAM, macOS 15.1, Node v22.23.1.
- **Database:** MySQL 8.4.13 in Docker Desktop (12 CPUs, about 7.7 GB for Docker), data on tmpfs, localhost port 3317.
- **Settings:** batch size 1,000.
- **Data:** the approved workbook `generated/acme-employees.xlsx` (seed `20261114`), loaded into an already-seeded database.

| Run | Replacement transaction | `seedDatabase` total (read + validate + reference data + replace) |
|---|---:|---:|
| 1 | 342 ms | 709 ms |
| 2 | 350 ms | 640 ms |
| 3 | 336 ms | 624 ms |

The full command, including Node startup, took 0.99 s. These are local numbers on tmpfs, not a production guarantee.

## Final counts

`employees` 10,000. `compensation_records` 10,000. The totals match the approved distributions (the test above).

## Skill use

- Source: https://github.com/mattpocock/skills, revision `5863806dd4e15c63174bee4e7515a4256792ecfa`, unchanged since Task 02. Files: `skills/engineering/tdd/SKILL.md`, `mocking.md`, read through `gh api` in Task 02. I did not re-read them for this task.
- Effects on this task:
  - **No mocked database.** Following `mocking.md`'s preference for a real test database, the rollback test causes a real MySQL constraint failure inside the real transaction. It does not stub `connection.execute` to throw.
  - **Tests through public functions.** The DB tests drive `seedDatabase` and check results through SQL queries. Parser tests use real small `.xlsx` files through `readEmployeeWorkbook`. Neither suite calls internal helpers.

## Known limitations

- **Reference data commits separately.** If the replacement then fails, newly inserted reference rows remain. They are approved values, so this is harmless.
- **No seed lock.** Two concurrent seeds are not prevented by an explicit lock. InnoDB row locks serialise the deletes, and the last commit wins.
- **Memory.** The whole workbook is held in memory (10,000 rows). The later HR import would need streaming for much larger files.
- **Strict parsing.** Text money, Excel date cells, formulas, and extra sheets are rejected. This suits the generated file; a hand-edited HR spreadsheet may need clearer guidance later.
- **Missing workbook path.** It is reported as "workbook cannot be read as an .xlsx file", without saying whether the file is missing or corrupt.
- **One-machine measurement.** No other batch sizes were compared.

## Open decisions

1. **Generation date.** The workbook does not store its generation date, but the date rules need it. The seed uses the approved `2026-11-14` by default and accepts `--generation-date`. Should a future workbook carry this date, for example in a metadata sheet?
2. **Extra worksheets.** These are rejected, reading "one worksheet named `Employees`" strictly. Confirm, or allow extra sheets and ignore them.
3. **Reference-data mismatch.** A mismatch (for example IN stored with USD) fails the seed instead of correcting the row. Confirm.

## Confirmations

- No Git command was run.
- No `.env` file was read, and no code reads one.
- No later feature was started: no Express API, frontend, auth, import preview, AI, or MCP.
- `index.md`, `docs/`, and `docs_human/` were not edited.
