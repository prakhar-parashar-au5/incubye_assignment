# Builder response 02: Initial MySQL migration

**Task:** `builder_docs/parent_instructions/02-initial-migration.md`
**Status:** Complete and verified. Not committed. Waiting for review.
**Scope kept:** no workbook import or seed, no Express routes, no auth, no audit tables, no frontend, no AI.

## Task completed

- Local MySQL 8 Docker Compose service.
- One raw SQL migration with the five approved tables.
- A small forward-only JavaScript migration runner.
- Real-MySQL integration tests for the runner and the schema.

## Files changed (all in `express-backend/`)

| File | Change |
|---|---|
| `docker-compose.yml` | New. MySQL `8.4` on `127.0.0.1:3317`, database `acme_test`, tmpfs data, UTC, utf8mb4. |
| `db/migrations/001_initial_schema.sql` | New. `countries`, `departments`, `job_titles`, `employees`, `compensation_records`. |
| `src/db/connection.js` | New. mysql2 connection and pool with session settings. |
| `src/db/migrate.js` | New. `runMigrations`, `listMigrationFiles`, `MigrationError`. |
| `scripts/migrate.js` | New. Thin command for `npm run db:migrate`. |
| `test/support/test-database.js` | New. `requireTestDatabaseUrl` guard and `resetTestDatabase`. |
| `test/test-database-guard.test.js` | New. Unit tests for the guard (no database). |
| `test/db/migration-runner.test.js` | New. Real-MySQL runner tests. |
| `test/db/initial-schema.test.js` | New. Real-MySQL schema tests. |
| `package.json`, `package-lock.json` | Added `mysql2@3.24.6` (MIT). New scripts: `test:db`, `db:up`, `db:down`, `db:migrate`. `test` now runs `test/*.test.js` only. |
| `README.md` | Added a database section and new layout rows. |

## SQL decisions

- **Engine and character sets.** All tables use `InnoDB`, `utf8mb4`, and `utf8mb4_0900_ai_ci`.
  - Code columns (`countries.code`, `employees.country_code`, `employee_code`) use `ascii` with `ascii_bin`, so matching is exact and case-sensitive. A lowercase `in` fails the country foreign key.
  - Text columns use the case-insensitive collation, so `Tech`/`tech` and `A@acme.com`/`a@acme.com` count as duplicates.
- **Keys.** Primary keys, unique keys, and foreign keys follow the design. Every constraint and index has an explicit name (for example `uk_employees_email`, `fk_compensation_employee`), so tests can assert which constraint fired.
- **Indexes.** `idx_employees_job_title`, `idx_employees_country`, and `idx_compensation_employee_effective (employee_id, effective_from, version)`. No directory-search indexes yet.
- **Foreign keys.** All four are `ON UPDATE RESTRICT ON DELETE RESTRICT`.
- **Check constraints.**
  - `chk_countries_code`: two uppercase letters.
  - `chk_employees_employee_code`: `^ACME[0-9]{5}$`, case-sensitive.
  - `chk_employees_end_date_status`: `LEFT` requires an end date; the other statuses require it to be null.
  - `chk_employees_end_after_hire`: end date strictly after hire date.
  - `chk_employees_version` and `chk_compensation_version`: version is at least 1.
  - `chk_compensation_salary_positive`: salary above 0.
  - `chk_compensation_bonus_non_negative`: bonus 0 or more.
  - No check uses the current date.
- **Additions beyond the design document.** `chk_employees_first_name` and `chk_employees_last_name` reject empty or whitespace-only names. The design calls these "non-empty application values"; the database check is extra protection. See open decision 4.
- **Money.** `DECIMAL(15,2)`. No monthly salary column, and no current-salary column on `employees`.
- **Timestamps.** `DATETIME(3)` with `DEFAULT CURRENT_TIMESTAMP(3)`. `employees.updated_at` also has `ON UPDATE CURRENT_TIMESTAMP(3)`. UTC comes from the server setting (`--default-time-zone=+00:00`) and from every application session (`SET time_zone = '+00:00'`).
- **Session settings.** Every connection sets an explicit strict `sql_mode` (`STRICT_ALL_TABLES` and others), so invalid ENUM values fail even if a server default changes. mysql2 runs with `decimalNumbers: false` (DECIMAL comes back as a string) and `dateStrings: true` (DATE comes back as `YYYY-MM-DD`).
- **`schema_migrations`.** The runner creates it (`name` primary key, `applied_at`), not migration 001, because the runner needs it before any migration runs.
- **No reference data in the migration.** The test plan inserts India, the US, and departments as test fixtures, so the migration creates structure only. See open decision 1.

## Migration runner decisions

- **Inputs.** Only an explicit `databaseUrl` argument or `process.env.DATABASE_URL`. No `.env` reading.
- **File discovery.** Files must match `NNN_name.sql` and are sorted by name. Any other `.sql` name stops the run before anything is applied, so a mistyped file can't be skipped silently.
- **Locking.** `GET_LOCK('acme_schema_migrations', 30)` prevents two concurrent runs. The lock is released in `finally`.
- **Execution.** Each file runs as one multi-statement query on a dedicated connection. The record is inserted with a parameterized `execute` only after the file's SQL succeeds.
- **Failure.** On failure the runner throws a `MigrationError` that names the file, and stops. Later files are not applied.
- **Cleanup.** The connection is always closed.
- **Forward-only.** No rollback framework. A test shows that MySQL keeps a DDL statement that ran before the failing statement in the same file.

## Test database safety

- `requireTestDatabaseUrl` accepts only a `mysql:` URL whose database name matches `^[a-z0-9_]+_test$`. It rejects `acme`, `acme_test_copy`, `test`, `acme_TEST`, a `_test` user name on a non-test database, a missing name, a missing URL, and non-MySQL URLs. Error messages never include the URL or password.
- Both DB test files call the guard at import, before any connection. Results:
  - Without `DATABASE_URL`: exit code 1.
  - With database `acme`: exit code 1, "refusing to run".
- `resetTestDatabase` repeats the guard. It also checks that `SELECT DATABASE()` equals the guarded name, then drops every table in that database. It never drops or creates databases.
- Fixtures are small and hand-written. The 10,000 workbook rows are not used.
- `test:db` runs with `--test-concurrency=1`, because both files share one database.
- Every pool and connection is closed after its tests.

## Tests and the defects they detect

**Guard unit tests (9, `test/test-database-guard.test.js`)**
- Destructive setup against a non-test database.
- A guard that only searches for `_test` anywhere in the URL.
- Silently using a default database.
- A password appearing in error output.

**Migration runner (5, `test/db/migration-runner.test.js`)**

Each test uses throwaway migrations written to a temporary directory.

| Test | Detects |
|---|---|
| Applies in file-name order and records each | Directory or numeric ordering (`010` before `002`); unrecorded migrations |
| Does not re-apply a recorded migration | Duplicate data or "table exists" failures on every deploy |
| Applies only the new file on a later run | A runner that stops applying once anything is recorded |
| Stops at a failing migration, does not record it | Failed migration marked applied; later files applied after a failure. Also documents partial DDL persistence |
| Rejects a badly named `.sql` file | A mistyped migration skipped silently |

**Schema (47 test cases, `test/db/initial-schema.test.js`)**

| Area | Tests | Detects |
|---|---|---|
| Repeat run | Real migration repeat applies nothing | Re-applying 001, or 001 never recorded |
| Structure | Exact table list with engine; exact keys and indexes; exact foreign keys with rules; money column types | Missing or extra tables, a missing or misnamed key, CASCADE or SET NULL deleting history, FLOAT money, a stored monthly salary |
| Reference data | India/INR and US/USD; duplicate country code and name; malformed country code; duplicate department including case variant; title for a missing department; duplicate department + title + level; unsupported currency and level | Missing uniqueness, a case-sensitive collation, VARCHAR where ENUM was approved, non-strict SQL mode |
| Employees | Valid employee with `José` and version 1; UTC `created_at`; `updated_at` moves on update; duplicate code; duplicate email including case variant; 4 malformed codes; unknown or lowercase country; unknown title; unsupported status; blank names; the status/end-date rules for all three statuses; end date equal to or before hire; valid `LEFT`; version 0 | Each check, unique key, foreign key, and default in the design. Also `end >= hire` used instead of `end > hire` |
| Compensation | Valid version 1; exact decimal string `1000000.10`; third-decimal rounding; unknown employee; zero or negative salary; negative bonus with zero allowed; unsupported currency, frequency, and reason; version 0; duplicate employee + version; same-date versions where the higher version wins; a future record not current earlier, current from its date, and no record before the first | Float conversion of money, missing checks, a unique key on effective date that blocks same-day corrections, an as-of rule that picks future raises |
| Delete protection | Employee with compensation; referenced country; referenced department; referenced job title | Cascading or unrestricted deletes |

The rounding test documents a real MySQL limit. It does not show a rejection: `DECIMAL(15,2)` turns `1000000.105` into `1000000.11` with only a note, even in strict mode. The test plan's "reject more than two decimal places before insert" therefore has to be done by the importer. The existing workbook validator already rejects it (`employee-validator.test.js`).

## Red tests actually observed

| Slice | Red before implementation |
|---|---|
| Guard | 9 of 9 failed against a stub returning `''` |
| Runner | 5 of 5 failed with `AssertionError` against a stub returning `{}`, on real MySQL |
| Schema: structure + reference data | 12 of 12 failed with no migration file. After the reference tables were added, 8 passed and 4 structure tests stayed red |
| Schema: employees | 19 of 19 failed, all for one shared reason (the table did not exist). This is a weaker red than an assertion failure |
| Schema: compensation + delete | 16 failed. 3 delete tests (country, department, job title) already passed, because the employee foreign keys existed |

Failures after implementation, fixed before reporting:
- **Runner.** `GET_LOCK` came back as the string `'1'` because of `bigNumberStrings`, so all runner calls failed with "lock held". Fixed in `migrate.js` with `Number(locked)`.
- **Schema structure test.** A test bug: MySQL 8 returns the unaliased column as `ENGINE`. Fixed with an alias in the test.

Never red: the repeat-run test, added after 001 existed.

## Commands and results

Run from `express-backend/`:

| Command | Result |
|---|---|
| `npm install --save-exact mysql2@3.24.6` | installed |
| `docker compose up -d --wait` | container `acme-take-home-mysql` healthy |
| `SELECT VERSION(), @@sql_mode, @@time_zone` (via `docker exec`) | `8.4.13`, strict mode includes `STRICT_TRANS_TABLES`, `+00:00` |
| `npm run lint` | exit 0 |
| `npm test` (workbook tests + guard) | 130 tests, 130 pass, 0 fail |
| `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` | 52 tests, 52 pass, 0 fail, about 0.36 s |
| Same command again | exit 0 |
| `env -u DATABASE_URL npm run test:db` | exit 1, "DATABASE_URL must be set…" |
| `DATABASE_URL=…/acme npm run test:db` | exit 1, "refusing to run…" |
| Reset, then `npm run db:migrate` | "Applied 1 migration(s); 0 already applied." `+ 001_initial_schema.sql` |
| `npm run db:migrate` again | "Applied 0 migration(s); 1 already applied.", exit 0 |
| `env -u DATABASE_URL npm run db:migrate` | "Error: migration run failed: DATABASE_URL is not set" |

- **MySQL version:** 8.4.13 (`mysql:8.4` image).
- **Repeat-run result:** the second run applies nothing, and `schema_migrations` holds one row (`001_initial_schema.sql`).
- **Workbook regression:** all 121 earlier workbook tests still pass. They are included in the 130.

## Skill use

- Source: https://github.com/mattpocock/skills, revision `5863806dd4e15c63174bee4e7515a4256792ecfa`, unchanged since Task 01. The TDD folder's last change was `3f59913` (2026-10-07).
- Re-read `skills/engineering/tdd/SKILL.md` and `mocking.md` through `gh api` at that revision.
- New effects on this task:
  - **No database mocks.** `mocking.md` says to prefer a test DB for databases. Every schema and runner test runs against the real MySQL container.
  - **Runner tested at its own interface.** The runner tests drive `runMigrations({ migrationsDir })` with throwaway migrations in a temporary directory, not the real schema. A schema change can't break the runner tests, and a runner bug can't hide behind schema tests.
  - **Vertical slices.** The schema was built table by table (reference tables, then employees, then compensation), with each slice red first, instead of writing the full SQL file up front.

## Known limitations

- **Partial migrations.** DDL is not transactional. A migration that fails partway leaves earlier statements applied and unrecorded. Recovery needs manual repair or a corrective migration.
- **No checksums.** Editing an already-applied migration file is not detected.
- **Decimal places.** The database cannot reject a third decimal place; it rounds. The importer must validate first.
- **Weak UTC test.** The `created_at` test can't fail through the server setting, because the server is also UTC. It would catch a session time zone set to something else.
- **Test database only.** Compose defines only `acme_test`, with tmpfs data that is lost on restart. There is no persistent development database yet.
- **Port choice.** Port 3307 was already used by another running container, `acme-mysql` (`mysql:8.4`), so this project uses 3317. I did not touch that container.
- **Compose and `.env`.** Docker Compose automatically reads a `.env` file in `express-backend/` for variable substitution if one exists. None exists, and `docker-compose.yml` uses no substitution.
- **`npm audit`.** It still reports the moderate `uuid` advisory through ExcelJS from Task 01. `mysql2` added no new advisory.

## Open decisions

1. **Reference data.** Where should the approved countries, departments, and job titles be inserted: a migration `002_reference_data.sql`, or the Task 03 import? Not done in this task.
2. **More than two decimal places.** The test plan says to reject them before insert. MySQL can't; I documented the rounding instead. Please confirm the Task 03 importer owns this check.
3. **Case-insensitive uniqueness.** Uniqueness for `email`, `countries.name`, and `departments.name` is case-insensitive. Please confirm this is intended.
4. **Name checks.** I added database checks that reject blank names. They can be removed if you want the application to be the only guard.

## Confirmations

- No Git command was run.
- No `.env` file was read, and no code reads one.
- Workbook import and seeding were not started. No Express API work was done.
- `builder_docs/parent_instructions/`, `docs/`, and `docs_human/` were not edited.
