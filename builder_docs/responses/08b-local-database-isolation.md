# Response: Backend infrastructure fix 08b, isolate preview and test databases

**Status:** Complete. Ready for planner review.

## Result

```text
acme_dev   local frontend/backend preview   (migrated and seeded only by explicit commands)
acme_test  destructive integration tests    (reset by npm run test:db; guard unchanged)
```

Both databases live in the same local MySQL 8 container. A fresh container now creates both and grants the local `acme` user access to exactly these two.

## Changes

| File | Change |
| --- | --- |
| `express-backend/db/docker-init/01-create-acme-dev.sql` (new) | Runs as root on an empty data directory: `CREATE DATABASE IF NOT EXISTS acme_dev …` and `GRANT ALL PRIVILEGES ON \`acme\_dev\`.* TO 'acme'@'%'`. It drops nothing and creates no tables or data. |
| `express-backend/docker-compose.yml` | Mounts `./db/docker-init` read-only at `/docker-entrypoint-initdb.d`. The header comment describes both databases. Service name, container name, image, credentials, port `127.0.0.1:3317`, tmpfs, and healthcheck are unchanged. |
| `express-backend/README.md` | New "Local databases" section covering: the purpose of each database; separate injected `DATABASE_URL`s; the explicit migrate, seed, and demo-user commands for `acme_dev`; the test command for `acme_test`; and how to add `acme_dev` to an existing container without recreating it. |
| `express-backend/test/local-database-setup.test.ts` (new, 4 tests) | Static checks: the init script creates and grants `acme_dev` only; Compose mounts it and still creates `acme_test`; Compose scripts keep `COMPOSE_DISABLE_ENV_FILE=1`; the `_test` guard rejects `acme_dev`. |

Unchanged:

- The `_test` guard (`test/support/test-database.ts`).
- The production schema and migrations.
- Application code.
- The `db:up` / `db:down` scripts, which keep `COMPOSE_DISABLE_ENV_FILE=1`.
- Seed safety: `--replace` and `APP_ENV` are still required.
- Server startup, which still does no migration or seeding.
- Frontend files.

I added no setup command. The commands that already exist, with an explicit `DATABASE_URL`, cover setup. A combined command would hide the destructive `--replace` step.

## Implementation decision found during verification

The first version granted `` `acme_dev`.* ``. `SHOW GRANTS` in the temporary container showed this differs from the entrypoint's own grant, `` `acme\_test`.* ``. In MySQL grants, `_` is a wildcard, so `acme_dev` would also match a database such as `acmeXdev`.

I changed the grant to `` `acme\_dev`.* ``. I then verified it: `acme` was denied `CREATE TABLE` in a root-created `acmeXdev` (`ERROR 1142`).

## Verification

I did not recreate the existing `acme-take-home-mysql` container. It was still `Up 22 hours (healthy)` at the end.

All verification used a separate temporary container, `acme-08b-verify`: image `mysql:8.4`, the same environment, arguments, and tmpfs as Compose, the same init mount, on `127.0.0.1:3327`. I removed it afterwards.

1. **Fresh-container initialization.** The entrypoint log showed `running /docker-entrypoint-initdb.d/01-create-acme-dev.sql`. As `acme`:
   ```text
   SHOW DATABASES     acme_dev, acme_test (both utf8mb4_0900_ai_ci)
   SHOW GRANTS        USAGE ON *.*; ALL ON `acme\_dev`.*; ALL ON `acme\_test`.*
   ```
2. **Migrate and seed `acme_dev`** (synthetic demo passwords, injected on the command line):
   ```text
   DATABASE_URL=…3327/acme_dev npm run db:migrate                          + 002_hr_access_control.sql (001 and 002 applied)
   APP_ENV=development DATABASE_URL=… npm run db:seed -- --replace         Seeded 10000 employees and 10000 compensation records.
   APP_ENV=demo DATABASE_URL=… DEMO_*_PASSWORD=… npm run db:seed-demo-users meera.iyer@acme.com: created / rohan.mehta@acme.com: created
   ```
3. **Preview sessions.** I started the compiled backend (`node dist/src/server.js`) against `acme_dev` and logged in as both demo users. The tokens were kept in `/tmp` files, never printed, and deleted afterwards. `/auth/me` returned 200 for both. The directory reported `totalRows` 10000 for Meera and 4599 for Rohan.
4. **Fingerprint of `acme_dev` before the tests:** counts plus SHA-256 checksums of compensation rows, demo password hashes, and session rows. No hashes or tokens were printed.
   ```text
   employees 10000; compensation_records 10000; hr_users 2; hr_sessions_total 2; hr_sessions_active 2
   compensation_checksum        524a09dd…1442
   demo_password_hash_checksum  5a116c9e…b017
   hr_sessions_checksum         b1a98a44…b086
   ```
5. **Destructive suite against `acme_test` in the same container:**
   ```text
   DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3327/acme_test' npm run test:db
   # tests 199  # pass 199  # fail 0
   ```
6. **After the tests,** the `acme_dev` fingerprint was identical (`diff` empty: "acme_dev UNCHANGED"). The two tokens issued before the tests still worked: `/auth/me` returned 200 for both, and `totalRows` was still 10000 and 4599. Demo sessions, passwords, employees, and compensation were not changed.
7. **Guard:** `DATABASE_URL=…/acme_dev node --import tsx --test test/db/initial-schema.test.ts` stopped with `refusing to run: the DATABASE_URL database name must end with _test (lowercase)`. `acme_dev` still had 10,000 employees afterwards.
8. **README command for existing containers:** I ran the documented `docker exec … CREATE DATABASE IF NOT EXISTS … GRANT …` against the temporary container after seeding. It was idempotent: the grant was the same and `acme_dev` still had 10,000 employees.

### Red observed

`test/local-database-setup.test.ts` before the init script and mount existed: **2 failed, 2 passed**. The guard and Compose `.env` tests passed already, as expected.

After the change, the first run had 1 failure. My test's "no `acme_test`" check also matched the SQL comments, so I narrowed it to statement lines. Separately, the grant-wildcard finding above changed the script and its test.

### Checks

```text
npm run check                                   lint and typecheck clean; # tests 336  # pass 336  # fail 0   (was 332)
npm run build                                   exit 0
COMPOSE_DISABLE_ENV_FILE=1 docker compose config --quiet   valid
npm run test:db (temporary container, acme_test)           199 / 199 pass
```

## What you need to do for the current container

The running `acme-take-home-mysql` was created before `db/docker-init/` existed, so it has no `acme_dev`. Choose one:

- **Without recreating it** (additive, idempotent): run the `docker exec … CREATE DATABASE IF NOT EXISTS acme_dev …; GRANT … \`acme\_dev\`.* …` command from the README, then migrate, seed, and create demo users with `DATABASE_URL=mysql://acme:acme_local@127.0.0.1:3317/acme_dev`.
- **Recreate it:** run `npm run db:down && npm run db:up`. This needs your approval: tmpfs data, including `acme_test` and anything else in that container, is lost.

Then point the preview backend at `…/acme_dev` and keep `npm run test:db` on `…/acme_test`. I did not change the frontend's configuration.

## Known limits

- **Storage:** the container uses tmpfs, so a restart or recreation loses `acme_dev` as well. Preview data has to be migrated and seeded again after each fresh start, by explicit command.
- **Shared server:** both databases share one MySQL server and one user. Isolation rests on the `_test` name guard and the separate URLs, not on separate credentials.
- **Init timing:** the init script runs only on an empty data directory. Containers created earlier need the one-time command above.

## Confirmations

- No Git command ran.
- The existing local container was not recreated or modified. A temporary container was used and then removed.
- No `.env` file was read. The Compose commands still disable `.env` loading.
- No frontend files were modified.
- No production schema, migration, or application behaviour changed.
- Nothing was committed, and no later task started.
