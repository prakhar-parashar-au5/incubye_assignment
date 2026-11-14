# express-backend

Completed milestones: the deterministic source workbook generator, and the initial MySQL schema with a forward-only migration runner. There is no Express API or workbook import yet.

The approved rules live in `../docs/01-source-workbook.md`, `../docs/02-synthetic-data-rules.md`, and `../docs/05-initial-database-schema.md`.

## Commands

```sh
npm install
npm run lint
npm test
npm run generate:workbook                     # writes generated/acme-employees.xlsx
npm run generate:workbook -- --overwrite      # replace an existing file
npm run generate:workbook -- --output /tmp/a.xlsx --seed 7 --generation-date 2025-01-31
npm run generate:workbook -- --help
```

Defaults: seed `20261114`, generation date `2026-11-14`. The generator never uses the computer's date, the network, a database, or `.env` files. It refuses to replace an existing file unless `--overwrite` is given. Exit codes: `0` success, `1` existing output or invalid data, `2` invalid command input.

## Layout

| File | Concern |
|---|---|
| `src/source-workbook/constants.js` | Approved values, ranges, distributions, titles |
| `src/source-workbook/seeded-random.js` | Seeded random numbers (mulberry32) and shuffle |
| `src/source-workbook/iso-date.js` | `YYYY-MM-DD` checks and UTC day arithmetic |
| `src/source-workbook/names.js` | Fixed synthetic name lists |
| `src/source-workbook/employee-generator.js` | Generates the 10,000 employees |
| `src/source-workbook/employee-validator.js` | Rules for one employee |
| `src/source-workbook/employee-dataset.js` | Rules for the complete data set |
| `src/source-workbook/workbook-writer.js` | ExcelJS writing |
| `src/source-workbook/source-workbook.js` | Validate, then write through a temporary file |
| `src/source-workbook/cli-options.js` | Command-line parsing |
| `scripts/generate-workbook.js` | Thin command-line entry point |
| `db/migrations/001_initial_schema.sql` | Initial schema (five tables) |
| `src/db/connection.js` | mysql2 connections with UTC, strict mode, exact decimals |
| `src/db/migrate.js` | Forward-only migration runner |
| `scripts/migrate.js` | Thin migration entry point |
| `test/support/test-database.js` | `_test` name guard and test database reset |
| `src/seed/workbook-reader.js` | Reads and validates the `.xlsx`; money as exact decimal strings |
| `src/seed/seed-safety.js` | `--replace` and `APP_ENV` guard |
| `src/seed/reference-data.js` | Inserts or verifies countries, departments, job titles |
| `src/seed/replace-employees.js` | One-transaction delete and batch insert |
| `src/seed/seed-database.js` | Seed order: guard, validate, reference data, replace |
| `scripts/seed-database.js` | Thin seed entry point |

## Generation choices not fixed by the approved documents

- `SOON_TO_JOIN` hire dates are 1–90 days after the generation date.
- Salaries are whole currency units, rounded to 100.
- Non-zero bonuses use a percentage of at least 0.01%, so exactly 2,000 employees (20%) have a zero bonus. The bonus is rounded down to two decimal places, then capped.
- A "management title" is a title approved for the `MANAGER` level. `Program Manager` is an approved `SENIOR` Operations title, so it is allowed for `SENIOR`.
- Email name parts keep only the letters `a`–`z` after accents are removed, so `Mary Ann O'Brien` becomes `maryann.obrien.<id>@acme.com`.

## Known limitations

- Same seed and date give the same logical data. File bytes can differ (ZIP metadata), so tests compare logical data.
- ExcelJS 4.4.0 was last released in October 2023. `npm audit` reports a moderate advisory in its `uuid` dependency (buffer bounds in v3/v5/v6 when a buffer is passed). The generator does not call those functions.
- Validation lists cover the six fixed-value columns. `job_title` has no list because its allowed values depend on department and level.

## Database (MySQL 8)

```sh
npm run db:up      # local MySQL 8.4 on 127.0.0.1:3317, database acme_test, data in tmpfs
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run db:migrate
npm run db:down
```

- Use `npm run db:up` and `npm run db:down` rather than plain `docker compose`. By default, Docker Compose automatically loads a `.env` file from the project directory. Both scripts set `COMPOSE_DISABLE_ENV_FILE=1`, the documented setting that turns that off. If you must run Compose by hand, prefix the command the same way: `COMPOSE_DISABLE_ENV_FILE=1 docker compose ...`.
- `docker-compose.yml` uses no `${VAR}` substitution, so it needs no environment file.
- The Compose credentials are fixed local test values, not secrets.
- Code reads only an explicit argument or the injected `DATABASE_URL`. Nothing reads `.env` files.
- `npm test` runs the fast unit tests only. `npm run test:db` runs the real-MySQL tests one file at a time, because they share one database.
- The DB tests refuse to start unless the database name ends with `_test`. Each test file drops every table in that database before it runs.
- Migrations live in `db/migrations/` as `NNN_name.sql`. They are forward-only: MySQL commits DDL implicitly, so a failed migration can leave earlier statements applied. Fix it with a new migration.
- Every connection sets `time_zone = '+00:00'` and a strict `sql_mode`. DECIMAL values come back as exact strings and DATE values as `YYYY-MM-DD` strings.

## Seeding from the workbook (development, test, demo only)

```sh
APP_ENV=development DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run db:seed -- --replace
npm run db:seed -- --replace --workbook path/to/file.xlsx --generation-date 2026-11-14
```

- **Destructive.** The seed deletes every employee and compensation record, then loads the workbook. It refuses to run without `--replace`, and unless `APP_ENV` is `development`, `test`, or `demo`.
- **Order.**
  1. Check the guards.
  2. Read and validate the whole workbook: the template, cell types, every row, and the complete data set.
  3. Insert or verify the reference data.
  4. Run one transaction: `DELETE`, then batch inserts of 1,000 rows, then count checks, then commit. Any failure rolls the transaction back, so the old data stays.
- **Dates.** `--generation-date` must match the date the workbook was generated for, because the status and date rules depend on it. The default is the approved `2026-11-14`.
- **Database IDs.** Internal IDs change after each seed, because auto-increment values are not reset. Use `employee_code` as the stable identifier.
