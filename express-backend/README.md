# express-backend

Strict TypeScript (ESM, Node 22). Completed milestones: workbook generator, MySQL schema and migration runner, workbook seed, and HR access-control foundation. There is no Express API yet.

The approved rules live in `../docs/01-source-workbook.md`, `../docs/02-synthetic-data-rules.md`, and `../docs/05-initial-database-schema.md`.

## Commands

```sh
npm install
npm run check                                 # lint + strict type check + fast tests
npm run typecheck                             # tsc, no emit; includes test/types/type-contracts.ts
npm test                                      # fast tests (node --test through tsx)
npm run build                                 # clean dist/, then compile src/ and scripts/ (no tests)
npm run generate:workbook                     # writes generated/acme-employees.xlsx
npm run generate:workbook -- --overwrite      # replace an existing file
npm run generate:workbook -- --output /tmp/a.xlsx --seed 7 --generation-date 2025-01-31
npm run generate:workbook -- --help
```

Defaults: seed `20261114`, generation date `2026-11-14`. The generator never uses the computer's date, the network, a database, or `.env` files. It refuses to replace an existing file unless `--overwrite` is given. Exit codes: `0` success, `1` existing output or invalid data, `2` invalid command input.

## Layout

| File | Concern |
|---|---|
| `src/source-workbook/constants.ts` | Approved values, ranges, distributions, titles |
| `src/source-workbook/seeded-random.ts` | Seeded random numbers (mulberry32) and shuffle |
| `src/source-workbook/iso-date.ts` | `YYYY-MM-DD` checks and UTC day arithmetic |
| `src/source-workbook/names.ts` | Fixed synthetic name lists |
| `src/source-workbook/employee-generator.ts` | Generates the 10,000 employees |
| `src/source-workbook/employee-validator.ts` | Rules for one employee |
| `src/source-workbook/employee-dataset.ts` | Rules for the complete data set |
| `src/source-workbook/workbook-writer.ts` | ExcelJS writing |
| `src/source-workbook/source-workbook.ts` | Validate, then write through a temporary file |
| `src/source-workbook/cli-options.ts` | Command-line parsing |
| `scripts/generate-workbook.ts` | Thin command-line entry point |
| `db/migrations/001_initial_schema.sql` | Initial schema (five tables) |
| `src/db/connection.ts` | mysql2 connections with UTC, strict mode, exact decimals |
| `src/db/migrate.ts` | Forward-only migration runner |
| `scripts/migrate.ts` | Thin migration entry point |
| `test/support/test-database.ts` | `_test` name guard and test database reset |
| `src/paths.ts` | Package-root asset paths (migrations, workbook) for source and `dist/` |
| `src/http/contract.ts` | Zod request/response schemas, public error codes, paths |
| `src/http/openapi.ts` | OpenAPI 3.1 document built from the contract |
| `src/http/app.ts` | Express application factory (injected dependencies) |
| `src/http/auth-routes.ts` | Login, current user, logout, Bearer middleware |
| `src/http/rate-limit.ts` | Failed-login limiter, client IP source, clocked store |
| `src/http/errors.ts` | Public error mapping |
| `src/http/request-log.ts` | Safe request logging |
| `src/http/config.ts` | Zod-validated server environment |
| `src/server.ts` | Process entry point and graceful shutdown |
| `src/errors.ts` | Narrowing helpers for caught `unknown` values |
| `src/seed/workbook-reader.ts` | Reads and validates the `.xlsx`; money as exact decimal strings |
| `src/seed/seed-safety.ts` | `--replace` and `APP_ENV` guard |
| `src/seed/reference-data.ts` | Inserts or verifies countries, departments, job titles |
| `src/seed/replace-employees.ts` | One-transaction delete and batch insert |
| `src/seed/seed-database.ts` | Seed order: guard, validate, reference data, replace |
| `scripts/seed-database.ts` | Thin seed entry point |
| `db/migrations/002_hr_access_control.sql` | HR users, scopes, sessions, access audit |
| `src/access/access-policy.ts` | Pure country AND department rule; who can manage HR users |
| `src/access/passwords.ts` | Argon2id hash and verify |
| `src/access/session-tokens.ts` | Two-hour HS256 JWTs (`jose`) |
| `src/access/sessions.ts` | Sign-in, per-request authentication, sign-out |
| `src/access/hr-users.ts` | Admin HR user changes with audit, one transaction each |
| `src/access/demo-users.ts` | Meera and Rohan demo accounts |
| `scripts/seed-demo-users.ts` | Thin demo-user entry point |

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

## HR access control (foundation only: no routes yet)

- **Roles.** `ADMIN` sees everyone and manages HR users. `SCOPED` sees an employee only if the employee's country is in the user's countries AND the employee's department is in the user's departments. An empty list grants nothing.
- **Sessions.** Sign-in creates an `hr_sessions` row and a two-hour HS256 JWT. The JWT contains only `sub` (HR user ID), `sid` (session ID), `iat`, and `exp`. Every `authenticate()` call re-reads the session, the user's status, and the scopes. Revocation, deactivation, and scope changes therefore apply on the next request.
- **Signing key.** `JWT_SIGNING_KEY` comes from the injected environment and must be at least 32 bytes. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and store it in the deployment's secret settings, never in a file in the repository.
- **Passwords.** Argon2id (`m=19456, t=2, p=1`) through the `argon2` package. Only the PHC hash string is stored.
- **Audit.** Each HR user change and its `access_audit_events` row commit together. Audit states contain role, status, countries, and departments only.

### Demo users (development, test, demo only)

Run after `npm run db:seed`, because the scopes need the departments:

```sh
APP_ENV=demo DATABASE_URL='mysql://…' \
DEMO_MEERA_PASSWORD='<at least 12 characters>' DEMO_ROHAN_PASSWORD='<at least 12 characters>' \
npm run db:seed-demo-users
```

- **Meera Iyer** (`meera.iyer@acme.com`): ADMIN.
- **Rohan Mehta** (`rohan.mehta@acme.com`): SCOPED; countries `IN`; departments `Tech` and `Support`.
- These are synthetic demo accounts. The passwords come only from the environment, and only their hashes are stored.
- A rerun creates nothing and does not change passwords. It fails if an existing demo user's role, status, or scopes differ from the approved values.

## TypeScript build and assets

- **Toolchain.** TypeScript 6.0.3 (`strict`, `module`/`moduleResolution: nodenext`), `tsx` for running source and tests, and `typescript-eslint` for lint.
  - TypeScript 7 is not used: typescript-eslint 8 supports TypeScript `<6.1.0`, because TypeScript 7.0 has no programmatic API yet.
  - Relative imports use `.js` specifiers, which work both in `tsx` and in compiled Node output.
- **Build output.** `npm run build` writes `dist/src/...` and `dist/scripts/...`. Run the compiled commands with `node dist/scripts/<name>.js`.
- **Assets.** SQL migrations and the generated workbook are not copied into `dist/`. `src/paths.ts` finds the package root by walking up to the nearest `package.json`, which is `express-backend/` from both `src/` and `dist/src/`. Both `db:migrate` and the compiled `migrate.js` therefore read `express-backend/db/migrations/`, and the generator and seed both default to `express-backend/generated/acme-employees.xlsx`. A deployment must ship `db/migrations/` (and the workbook, if the seed runs there) next to `dist/`.
- **Type policy.**
  - No explicit `any`, `@ts-ignore`, or `@ts-nocheck`; lint enforces this, and `test/lint-policy.test.ts` proves the rules are active.
  - Untrusted values (workbook cells, environment, CLI input, future HTTP input) are typed `unknown` and narrowed by the existing runtime validators.
  - `test/types/type-contracts.ts` holds compile-time checks, using `@ts-expect-error` with a reason.

## HTTP API (authentication only)

```sh
npm run build
DATABASE_URL='mysql://…' JWT_SIGNING_KEY='<32+ bytes>' PORT=3000 CLIENT_IP_SOURCE=socket npm start
npm run openapi:generate      # rewrites openapi/openapi.json from the Zod contract
```

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{ "status": "ok" }` only |
| `POST /api/v1/auth/login` | `{ email, password }` (strict) → `{ token, expiresAt, user }` |
| `GET /api/v1/auth/me` | `Authorization: Bearer <JWT>` → current user, scopes, session expiry |
| `POST /api/v1/auth/logout` | `Authorization: Bearer <JWT>` → `204`. Revokes the session; safe to repeat |
| `GET /api/v1/openapi.json` | OpenAPI 3.1, generated from `src/http/contract.ts` |

- **Errors.** Always `{ "error": { "code", "message" } }`, with one of these codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `RATE_LIMITED`, `NOT_FOUND`, `INTERNAL_ERROR`. Internal authentication reasons are never returned.
- **Failed-login limit.** 5 failed attempts per caller and account per 15 minutes; successful logins do not count.
  - The key is `ip:<caller key>|email:<HMAC-SHA256 of the trimmed, lowercased email>`, using a random key per process. Plain emails are never stored or logged.
  - A missing or non-string email uses the bucket `ip:<caller key>|email:none`.
  - Through the Next.js server, all users share one caller key, so the email part keeps one account's failures from blocking the others. A per-browser-IP limit in Next.js is future work.
  - The caller key comes from `CLIENT_IP_SOURCE`:
    - `socket` (default): the TCP peer. Forwarded headers are ignored.
    - `railway-x-real-ip`: the `X-Real-IP` header, which Railway's public edge sets and overwrites. Use this only when the service is reachable solely through Railway's public domain. Railway's private network (`*.railway.internal`) can send its own headers.

  Express `trust proxy` stays off, because Railway documents no fixed hop count.
- **Browser access.** No CORS and no cookies: the Next.js server calls this API and owns the browser cookie.
- **Logs.** JSON lines with request ID, method, path without the query string, status, and duration only.
- **Shutdown.** On `SIGTERM`/`SIGINT` the server stops accepting connections, closes the MySQL pool, and exits. It is forced to exit after 10 s.

## Local databases

One local MySQL 8 container (`npm run db:up`, port `127.0.0.1:3317`, tmpfs storage) holds two databases:

| Database | Use | Reset by |
|---|---|---|
| `acme_dev` | Local frontend/backend preview | Only your explicit `db:seed -- --replace` |
| `acme_test` | Destructive integration tests (`npm run test:db`) | Every test run (tables dropped and recreated) |

`acme_test` comes from `MYSQL_DATABASE`. `acme_dev` and the `acme` user's grant on it come from `db/docker-init/01-create-acme-dev.sql`, which MySQL runs on a fresh, empty data directory. The grant is limited to exactly `acme_dev` (`acme\_dev`, because `_` is a wildcard in grants). The database suite refuses any database whose name does not end in `_test`, so it cannot reset `acme_dev`.

Every command takes its database from an injected `DATABASE_URL`. Nothing reads a `.env` file, and the project Compose commands set `COMPOSE_DISABLE_ENV_FILE=1`. The server never migrates or seeds on startup.

Preview database (local-only, fixed credentials):

```sh
DEV='mysql://acme:acme_local@127.0.0.1:3317/acme_dev'
DATABASE_URL=$DEV npm run db:migrate
APP_ENV=development DATABASE_URL=$DEV npm run db:seed -- --replace     # destructive: replaces employee data in acme_dev
APP_ENV=demo DATABASE_URL=$DEV DEMO_MEERA_PASSWORD=... DEMO_ROHAN_PASSWORD=... npm run db:seed-demo-users
DATABASE_URL=$DEV JWT_SIGNING_KEY=... npm start                       # or: npx tsx src/server.ts
```

Destructive integration tests:

```sh
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db
```

A container created before `db/docker-init/` existed has no `acme_dev`. Either recreate it (`npm run db:down && npm run db:up`; tmpfs data, including `acme_test` and any preview data, is lost), or add the database to the running container without recreating it:

```sh
docker exec acme-take-home-mysql mysql -uroot -pacme_local_root \
  -e "CREATE DATABASE IF NOT EXISTS acme_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON \`acme\\_dev\`.* TO 'acme'@'%';"
```

Then migrate and seed `acme_dev` as above.
