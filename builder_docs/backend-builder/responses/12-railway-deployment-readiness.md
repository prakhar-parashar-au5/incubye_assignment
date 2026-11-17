# Backend task 12: Railway deployment readiness

**Task:** `builder_docs/backend-builder/tasks/12-railway-deployment-readiness.md`
**Worktree:** `/Users/admin/Desktop/Projects/incubyte_take_home_deploy`
**Date:** 2026-11-17
**Status:** Complete. Rehearsal passed. Nothing committed, and I ran no Git command.

## Summary

- The repo deploys as three Railway services. The operator follows `docs/deploy/railway-runbook.md`, which uses dashboard settings only, with no `railway.json`.
- One deploy blocker needed code: the Railway MySQL template creates only a database named `railway`, and the dashboard has no SQL editor for MySQL. I added a small idempotent `db:create:dist` command that creates the database named in `DATABASE_URL`. It is a new script with tests, and no product behaviour changed.
- I added compiled (`dist`) variants of migrate, seed, demo-user seed, and retention. The pre-deploy step runs `node dist/scripts/...`, not `tsx`.
- Node is pinned to `22.23.1` in both services.
- The full production rehearsal on MySQL `127.0.0.1:3330` passed, following the runbook steps in order.
- **Deviation from the task text:** I recommend `CLIENT_IP_SOURCE=socket`, not `railway-x-real-ip`. Reasons are below; please confirm.
- **Observed red outside my lane:** one frontend component test fails intermittently. Reported in `builder_docs/parent_instructions/issues/12-frontend-hr-access-test-flaky.md`.

## Files changed

**New**
- `express-backend/src/db/create-database.ts`: `targetDatabase()` splits the database name off `DATABASE_URL`, and `createDatabaseIfMissing()` runs `CREATE DATABASE IF NOT EXISTS … utf8mb4 / utf8mb4_0900_ai_ci`. The name must match `^[a-z0-9_]{1,64}$`, because it is interpolated into DDL.
- `express-backend/scripts/create-database.ts`: thin CLI. It never prints the URL or password.
- `express-backend/test/create-database.test.ts`: 9 fast tests.
  - URL split, keeping query options.
  - Five unsafe or empty paths refused: a backtick injection, uppercase, an empty path, a nested path, and a percent-encoded backtick.
  - Non-mysql, unparseable, and missing URLs refused.
  - The CLI refuses an unsafe name before connecting.
  - The CLI does not print credentials when the connection fails.
- `express-backend/.nvmrc`, `next-frontend/.nvmrc`: `22.23.1`.
- `docs/deploy/railway-runbook.md`
- `README.md` (root)
- `builder_docs/parent_instructions/issues/12-frontend-hr-access-test-flaky.md`
- This file.

**Changed**
- `express-backend/package.json`:
  - `engines.node` is now `22.23.1` (was `>=22`).
  - New scripts: `db:create` (tsx), `db:create:dist`, `db:migrate:dist`, `db:seed:dist`, `db:seed-demo-users:dist`, `ai:retention:dist`.
- `next-frontend/package.json`: `engines.node` is now `22.23.1` (was `>=22.13`).
- Both `package-lock.json` files: the root package's `engines` changed to match. Nothing else changed.
- `express-backend/README.md`: a short block listing the compiled commands, with a link to the runbook.

Not changed: any route, schema, migration, OpenAPI document, frontend source or test, or `docs_human/**`.

## Findings, item by item

### Backend

1. **Start without dev tools.**
   - `npm ci --omit=dev && npm run build` fails with `sh: tsc: command not found`, which I reproduced. The build needs dev dependencies.
   - Railway path: Railpack installs dev dependencies for the build, and `RAILPACK_PRUNE_DEPS=true` (a backend variable in the runbook) removes them afterwards.
   - Locally I ran `npm ci`, then `npm run build`, then `npm prune --omit=dev`. Afterwards `node_modules/typescript` and `node_modules/tsx` were gone.
   - On that pruned tree, these all ran from `dist/`: the server, `create-database`, `migrate`, `seed-database`, `seed-demo-users`, and `ai-retention`.
   - `jszip` stays, because `exceljs` (a production dependency) depends on it.
   - No file under `src/` or `scripts/` imports `tsx`, `jszip`, `supertest`, or `@modelcontextprotocol/client` (checked with grep).
2. **Migrations from `dist`.**
   - The pre-deploy command is `npm run db:create:dist && npm run db:migrate:dist`.
   - `src/paths.ts` walks up to `package.json`, so `dist/` code reads these from the service root:
     - `db/migrations/` (8 files);
     - `data/exchange-rates/usd-inr.json`;
     - `generated/acme-employees.xlsx`;
     - `openapi/openapi.json`.
   - The workbook exists in this worktree, and no `.gitignore` excludes `generated/`. I could not confirm it is tracked without Git, so runbook §1 asks the operator to check the GitHub tree.
   - Rollback is safe across migrations: `runMigrations` ignores recorded migrations that the code doesn't have.
3. **Config.** Every variable, with its value source, is in the runbook tables (§3 and §5). Points that differ from or add to the task text:
   - `PORT` is set explicitly on the backend (`8080`). The frontend's `API_BASE_URL=http://${{express-backend.RAILWAY_PRIVATE_DOMAIN}}:${{express-backend.PORT}}` needs a known port, and a reference to `PORT` resolves only if the service defines it.
   - `OPENAI_MODEL=gpt-6-luna` must be set, because the code default is `gpt-6.1-sol`.
   - `DATABASE_URL=mysql://${{MySQL.MYSQLUSER}}:${{MySQL.MYSQLPASSWORD}}@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/acme_demo`
   - **`CLIENT_IP_SOURCE`.** `railway-x-real-ip` is right only for traffic that comes through Railway's public edge, as the comment in `rate-limit.ts` says.
     - The backend has no public domain. Its only caller is the Next.js server over the private network, and that client never sends `X-Real-IP`.
     - With `railway-x-real-ip`, every login would therefore land in the shared `unknown-client` bucket, and any private-network caller could choose its own bucket by setting the header.
     - `socket` keys on the frontend's private address, which is honest.
     - Both values still include the email HMAC, so in practice there are 5 failures per account per 15 minutes either way, and neither causes an outage.
     - I put `socket` in the runbook. I did not write an issue file, because nothing is blocked and no code changes. If you want `railway-x-real-ip` anyway, it is a one-variable change.
4. **Health.** `/health` returns `200 {"status":"ok"}` without MySQL. With the MySQL container paused (`docker pause`), it still answered `200` in 1 ms. The runbook says so, and points out that the pre-deploy migration is the real database check. It also notes that Railway calls the health check only at deploy time.
5. **Node version.**
   - The lanes and this rehearsal ran on `v22.23.1`.
   - Railpack resolves the version from `RAILPACK_NODE_VERSION`, then `engines`, then `.nvmrc`, so an `engines` range of `>=22` would not have pinned it.
   - Both services now have exact `engines` plus `.nvmrc`.
   - Developers on another version get an npm `EBADENGINE` warning, not an error.
6. **Config as code.**
   - Railway's docs (docs.railway.com/config-as-code) mark `railway.json`/`railway.toml` as deprecated.
   - Existing files keep working only until 2026-12-01, and new services cannot opt in.
   - The replacement, Infrastructure as Code (`.railway/railway.ts`), is applied through the CLI with a login, which this task forbids.
   - I added no config files. The runbook gives the exact dashboard settings instead.
   - Next step if wanted: an IaC file, written and applied by someone with a Railway login.

### Frontend

1. **`PORT`.** `next start` reads `PORT` (commander `.env('PORT')`, default 3000) and binds `0.0.0.0`. The rehearsal ran with `PORT=3230` and answered on that port.
2. **`API_BASE_URL`.**
   - The parser accepts `http:` or `https:` and rejects credentials, a query, or a fragment, so `http://express-backend.railway.internal:8080` is accepted.
   - It is read at request time, on the server only.
   - The build needs neither `API_BASE_URL` nor the backend: `next build` succeeded with an empty environment. This matters because the private network is not available during Railway builds.
3. **Other variables.**
   - `DEMO_SHARED_PASSWORD` must equal both seeded demo passwords. The sign-in page says "Both accounts use this public password".
   - Re-seeding never changes an existing user's password: the demo-user seed reports `already present`.
   - `API_TIMEOUT_MS` defaults to 5000 and `API_ASSISTANT_TIMEOUT_MS` to 50000. Both are in the runbook table.
4. **No secret in the browser.**
   - `NEXT_PUBLIC` appears nowhere in `src/` or `next.config.ts`.
   - After the build, `.next/static` contains none of `API_BASE_URL`, `DEMO_SHARED_PASSWORD`, `JWT_SIGNING_KEY`, or `OPENAI`.

## Production rehearsal

**Setup**
- Container: `acme-deploy-rehearsal-mysql`, `mysql:8.4` (8.4.13), `127.0.0.1:3330`, tmpfs. It was shaped like the Railway template: `root` user, default database `railway`, and no server flags.
- Backend on `4230`, frontend on `3230`. Neither port is on the forbidden list.
- All passwords and keys were synthetic placeholders.
- Both apps ran as production builds (`NODE_ENV=production`) with no `OPENAI_API_KEY`.

**Runbook steps, in order**

| Step | Result |
|---|---|
| `db:create:dist` | `Created database acme_demo.` On the second run: `Database acme_demo already exists.` |
| `db:migrate:dist` | `Applied 8 migration(s); 0 already applied.` (001–008) |
| `APP_ENV=demo db:seed:dist -- --replace` | `Seeded 10000 employees and 10000 compensation records.` |
| `APP_ENV=demo db:seed-demo-users:dist` | `meera.iyer@acme.com: created`, `rohan.mehta@acme.com: created` |
| Full first-deploy pre-deploy chain, run again as one `sh -c` string (exact runbook §4 text) | exit 0: already exists, 0 applied, reseeded 10,000, both users `already present` |
| Backend start | `{"event":"server_listening","port":4230,"clientIpSource":"socket","assistant":"unavailable"}`. `/health` returns 200 on IPv4 and on `[::1]`. |
| Frontend start | `▲ Next.js 16.4.6`, `✓ Ready`. `/sign-in` returns 200 on IPv4 and IPv6, and the page shows the placeholder demo password. |
| Sign in as Meera (Playwright, Chromium) | Landed on `/employees`, which showed "10,000 employees". Cookie `__Host-acme_session` was set on `http://localhost`. |
| Dashboard | Scope "All employees". People, currency tables, and "Needs attention" loaded. The Country breakdown tab showed India 5,936 (INR). |
| Assistant, "Summarize annual base salary by department." | "The assistant is not configured … Your message was saved." Conversation URL `/assistant/<uuid>`. |
| AI monitoring | 1 trace, Failed 1, "Model · Model call failed", `not_configured` 1. AI traces lists 1 row, "Failed · not-configured · 9 ms". |
| Sign out, then sign in as Rohan | Dashboard scope "India, Support and Tech (permission filtered)", currently working 3,901. AI monitoring: "Your HR role cannot view AI monitoring." |
| `ai:retention:dist -- --retention-days 30` with `NODE_ENV=production` | Dry run, exit 0. Adding `--execute` without `--acknowledge-production` was refused (exit 1). |
| `SIGTERM` to the backend | `server_stopping`, `server_stopped`, `database_pool_closed` |
| `docker rm -f acme-deploy-rehearsal-mysql` | Removed. `docker ps -a` shows no such container. |

**Runbook fixes made during the rehearsal**
- Added the `db:create:dist` step. Without it, the first migrate against a Railway-shaped server fails, because `acme_demo` does not exist.
- Set `PORT` explicitly on the backend.
- Required the same demo password in all three demo variables.
- Added the step to remove the seed from the pre-deploy command, plus the warning about what happens otherwise.

**Not rehearsable here (no Railway login):**
- Railway reference-variable resolution;
- private DNS;
- the edge's headers for Next.js server actions;
- Railpack's own prune and Node resolution;
- volume backups;
- the `railway ssh` seeding alternative.

Runbook §8 lists each of these next to what was checked.

## Checks

| Command | Result |
|---|---|
| `express-backend`: `npm run check` (lint, typecheck, fast tests) | exit 0. **458 tests, 458 pass**, 0 fail, 0 skipped (includes the 9 new tests). |
| `express-backend`: `npm run build` | exit 0. `dist/scripts/create-database.js` present. |
| `express-backend`: `npm run test:db` | **Not run.** No existing DB code changed. The new DB path (`createDatabaseIfMissing`) was exercised against real MySQL 8.4 in the rehearsal, not in an automated DB test. |
| `next-frontend`: `npm run api:check`, `lint`, `typecheck` | all exit 0 |
| `next-frontend`: `npm test` | **Intermittent red.** 4 of 15 full runs failed one test: `hr-access-workspace.test.tsx` › "offers password regeneration after a create replay…", `Unable to find role="button" and name "Create HR user"`. That file alone passed 4 of 4 runs. Task 12 changed no file Vitest loads. Reported as a CROSS_LANE_DEFECT in `builder_docs/parent_instructions/issues/12-frontend-hr-access-test-flaky.md`. |
| `next-frontend`: `npm run build` (empty environment) | exit 0. 23 routes; `/sign-in` and the app pages are partial prerenders. |

## README

The root `README.md` covers:
- the product;
- a Mermaid architecture diagram;
- local setup for MySQL, the backend, and the frontend;
- tests;
- the demo personas;
- AI observability: what is recorded, fail-closed recording, Admin-only access, formatted versus warned raw view, and 30-day retention as a manual guarded command;
- deployment, linking to the runbook;
- known limitations.

Sources for the limitations:
- **Name-only redaction gap:** `builder_docs/ai-builder/responses/04-mcp-and-admin-observability-api.md` §9.
- **Deprecated `/assistant/messages`:** `src/http/assistant-routes.ts` (`Deprecation` and `Link` headers). The rehearsal confirmed the frontend uses the conversation route (`sendAssistantConversationMessage` in the frontend log).
- **Two trace seed paths:** the backend's `eval:trace-fixtures` (`src/evaluation/trace-seed.ts`) and the frontend's `tests/e2e/support/seed-ai-traces.mts`.
- **HR-access lifecycle journeys:** Playwright has only the create-and-sign-in journey (`tests/e2e/hr-access.spec.ts`).
- **D1/D2:**
  - Source: `/Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_run/tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md` §8, read only.
  - Fix status: assigned as AI builder task 05 (`incubyte_take_home_ai_fixes`). That worktree has no response 05 yet.
  - This build still runs `PROMPT_VERSION = 'assistant-instructions-v1'`, so the README says D1 and D2 are open in this build.

## Confirmations

- No Git command was run, and nothing was committed.
- No `.env` file was read or written. No real secret was used; every value was a placeholder.
- I did not log in to Railway.
- Ports used: MySQL 3330, backend 4230, frontend 3230. None is on the forbidden list, and I left the other running containers alone.
- `docs_human/**` was read, not edited.
- Left in the worktree, all gitignored: `express-backend/node_modules` (pruned to production dependencies; run `npm ci` before local development), `express-backend/dist`, `next-frontend/node_modules`, and `next-frontend/.next`.
- Work stopped after Task 12.
