# Builder response 02 fix: no fix instruction found

**Task:** Task 02, status `REVIEW - ONE FIX REQUIRED` in `builder_docs/parent_instructions/index.md`
**Result:** No fix applied. The required fix is not described in any file the builder can read.

## What the builder checked

- `builder_docs/parent_instructions/index.md`: it gives the status `REVIEW - ONE FIX REQUIRED` but does not say what the fix is.
- `builder_docs/parent_instructions/02-initial-migration.md`: unchanged since before Task 02 started (last modified 20:23).
- `builder_docs/parent_instructions/03-workbook-database-seed.md`: Task 03 instructions, `NOT READY`. They contain no Task 02 fix.
- `builder_docs/responses/02-initial-migration.md`: no reviewer notes added.
- `docs/`: no file changed after Task 02 started. `docs/08-workbook-seed-design.md` and `docs/09-workbook-seed-test-plan.md` describe Task 03 only.
- `docs_human/04-workbook-database-seed-raw.md`: Task 03 notes only. Its last line says Task 03 waits for the first migration to pass review.
- A search of the whole repository (excluding `node_modules`) for reviewer notes, `TODO`, `FIXME`, "fix required", and "planner" found nothing about a Task 02 fix.

## Change made while checking

The Task 02 response said the schema test file had 38 tests. A re-run showed 47:

```text
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' node --test test/db/initial-schema.test.js
# tests 47, pass 47, fail 0
DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' node --test test/db/migration-runner.test.js
# tests 5, pass 5, fail 0
```

The number in `builder_docs/responses/02-initial-migration.md` is corrected from 38 to 47. The reported total of 52 DB tests was already right.

If this was the required fix, it is done. Otherwise it is unrelated.

## Request to the planner

Please write the required fix into the index or into the Task 02 instruction file. The builder will then:

1. Apply only that fix.
2. Re-run `npm run lint`, `npm test`, and `npm run test:db`.
3. Update the Task 02 response with the change and the exact results.

## Confirmations

- No code, SQL, or test changes were made.
- No Git command was run.
- No `.env` file was read.
- `index.md`, `docs/`, and `docs_human/` were not edited.
- Task 03 was not started.

---

# Fix 02a: Disable automatic `.env` loading

**Instruction:** `builder_docs/parent_instructions/02a-migration-review-fix.md`
**Result:** Applied and verified.

## Official documentation checked

- Docker Docs, "Configure pre-defined environment variables in Docker Compose". Page: https://docs.docker.com/compose/how-tos/environment-variables/envvars/. Source on `main`: https://github.com/docker/docs/blob/main/content/manuals/compose/how-tos/environment-variables/envvars.md. Its `COMPOSE_DISABLE_ENV_FILE` section says the variable disables the default `.env` file: `true` or `1` makes Compose ignore it, and the default `0` makes Compose look for it in the project directory.
- Docker Docs, "Set, use, and manage variables in a Compose file with interpolation": https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/. It confirms the default: if `--env-file` is not set, Compose reads `.env` from the project directory.
- I confirmed that the installed Compose plugin (`/Users/admin/.docker/cli-plugins/docker-compose`, Docker Compose v5.4.0) recognises the setting: the string `COMPOSE_DISABLE_ENV_FILE` appears in the binary.

## Mechanism selected

Each Compose command in `package.json` is prefixed with `COMPOSE_DISABLE_ENV_FILE=1`.

- The setting is passed inline for each command, so it overrides any `COMPOSE_DISABLE_ENV_FILE=0` in the user's shell.
- I rejected `--env-file /dev/null` as the alternative. It is a workaround, not the documented disable switch, and it is not portable.

## Files changed

| File | Change |
|---|---|
| `express-backend/package.json` | `db:up` is now `COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d --wait`. `db:down` is now `COMPOSE_DISABLE_ENV_FILE=1 docker compose down`. |
| `express-backend/README.md` | Says to use the npm scripts instead of plain `docker compose`, why, and how to prefix a hand-run Compose command. It also notes that `docker-compose.yml` uses no `${VAR}` substitution. |

No SQL, migration runner, schema test, or Task 03 code changed.

## Commands run and results

Run from `express-backend/`:

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | 130 tests, 130 pass, 0 fail, exit 0 |
| `npm run db:down` | container `acme-take-home-mysql` and network `acme-take-home_default` removed, exit 0. The container no longer appeared in `docker ps` |
| `npm run db:up` | npm printed `> COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d --wait`. Container started and became healthy, exit 0 |
| `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` | 52 tests, 52 pass, 0 fail, exit 0, on the freshly started container |
| `docker ps` | `acme-take-home-mysql` healthy. The unrelated `acme-mysql` container kept running, untouched |

## Limits of this verification

- Verification shows the setting is passed and both commands work. It does not show Compose ignoring a real `.env` file, because the instruction forbids creating or reading one.
- `COMPOSE_DISABLE_ENV_FILE` disables only the default `.env` file. If a shell sets `COMPOSE_ENV_FILES` or a command passes `--env-file`, Compose still loads those named files. The project scripts do neither.
- The inline `VAR=value command` form works in POSIX shells (macOS, Linux). It does not work in Windows `cmd.exe`. The project currently runs on macOS.
- Running plain `docker compose` by hand, without the prefix, still uses the default behaviour. The README now says to use the scripts or the prefix.

## Confirmations

- No `.env` file was created, inspected, or read. A directory listing of `express-backend/` showed no entry named `.env`; no file contents were read.
- Task 03 was not started.
- No Git command was run.
- `index.md`, `docs/`, and `docs_human/` were not edited.
