# AI Task 06: copy recorded AI data into the demo database

**Task:** `builder_docs/ai-builder/tasks/06-demo-data-import.md`

**Worktree:** `/Users/admin/Desktop/Projects/incubyte_take_home_ai_fixes` (it includes current master)

**Date:** 2026-11-17

**Status:** Complete and verified locally. Nothing is committed. I did not connect to Railway.

Three new guarded commands:
- `demo:import-ai-data` copies recorded AI data from a lane into the demo database.
- `demo:mcp-calls` makes three real MCP calls against a running backend.
- `demo:scenario` creates salary and HR-access activity through the product's own services.

The root README's "Known limitations" now says D1 and D2 are fixed in prompt v2 and wait for the evaluator's re-check. OpenAPI is unchanged: `openapi/openapi.json` has the same SHA-256 (`fe42c8c5…`) before and after regeneration.

## 1. How I worked with the sources

- **The live lanes refused my connection.** Neither `acme-ai-eval-mysql` (3324) nor `acme-qa-run-mysql` (3328) accepts the repository's fixed local credentials (`ER_ACCESS_DENIED_ERROR`), and their credentials are not documented anywhere in the repository. I did not inspect container environments to find them. My only contact with the live lanes was that one refused connection attempt per lane: no query ran and nothing was written.
- **I used the planner's dumps instead.** I restored `acme_lane_backups/acme_ai_eval_test-1804.sql` and `acme_qa_run_test-1804.sql`, read-only, into databases of the same names inside my own container `acme-demo-import-mysql` (3329). The dumps match the task's counts: 47 evaluator traces and 4 QA traces.
- **The operator runs the real import** against the live lanes with the lane credentials, which the operator has.

**Local target.** I started `acme-demo-import-mysql` on 127.0.0.1:3329 with database `acme_demo`, migrated it, seeded it with 10,000 employees from the default workbook (seed 20261114), and ran `db:seed-demo-users`. I generated random demo passwords inline and never printed or stored them.

**Full local rehearsal on `acme_demo`,** in the runbook's order:
1. Oracle fixtures, which picked `ACME00002` and `ACME00003`, the same employees as the evaluator lane.
2. The scenario.
3. The import from the evaluator copy, then from the QA copy.
4. Every step re-run, each writing nothing.

The end-state counts are in section 6. When I finished I removed `acme-demo-import-mysql` (`docker rm -f`). The source containers are still running and untouched.

## 2. `demo:import-ai-data`

```text
SOURCE_DATABASE_URL=… DATABASE_URL=… APP_ENV=demo \
  npm run demo:import-ai-data -- --source-database <name> --target-database <name> [--apply]
```

**Guards.** These reuse `src/evaluation/fixture-guard.ts`. I extended the guard with an optional `suffixes` and `flag`; the existing callers keep the same behaviour and messages. The command refuses when:
- `APP_ENV=production`, or `APP_ENV` is outside development, test, or demo;
- the source name does not end in `_test`;
- the target name does not end in `_demo`;
- either `--…-database` flag is missing or different;
- either connected `SELECT DATABASE()` differs from its flag.

It is a dry run unless `--apply` is given. It reads only the injected environment, never `.env`, and prints no URL.

**Preconditions, checked before any write:**
- `001`–`008` are applied on both sides.
- Same employee set: the count plus a SHA-256 of the sorted employee codes. Hashing is done in Node, not with `GROUP_CONCAT`, which truncates at 1,024 bytes.
- A warning if the target has no oracle fixtures, or if they cover different employees from the source's.

**HR users are mapped by email.** Every source HR user is matched by email to a target user. A source user missing on the target is created:
- inactive, as Scoped HR, with the same countries and departments;
- with an Argon2id hash of 32 random bytes that is thrown away, so nobody can sign in;
- with an `HR_USER_CREATED` audit event (system actor) whose reason begins "Imported with recorded AI data from …".

Each created user appears in the output. This applies to every missing source user, not only to users the copied rows reference. That is how the QA lane's "QA Scoped Reviewer" (`qa.scoped.reviewer@example.test`, India/Support) gets created even though none of its 4 traces belong to it.

**Copy order and transactions.** Each conversation is copied in one transaction, in this order: conversation → traces → messages → trace message links → model calls → tool calls → reviews. `mcp_tool_calls` are copied separately, one row per insert.

**What is kept and what is remapped:**
- UUIDs, timestamps, statuses, all JSON (re-serialised from the parsed values), and the migration-007 scope snapshot are kept exactly.
- Message and model-call IDs are `AUTO_INCREMENT` numbers, so they are remapped: `user_message_id`, `final_message_id`, and `ai_tool_calls.model_call_id` point to the new target IDs.

**Idempotent.** A conversation whose ID, or any of whose trace IDs, already exists is skipped whole, and so is an existing MCP call. The output counts the skipped rows per table.

**Not copied:** salary data, employees, and salary requests.

**Output.** JSON with the copied and skipped counts per table, the created HR users (email, name, scope), the number of mapped users, and warnings. It contains no row content and no credentials. In a dry run, "copied" means "would copy".

**Results from the dumps** (dry run = apply):

| Source | Conversations | Messages | Traces | Model calls | Tool calls | Reviews | MCP calls | HR users created |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `acme_ai_eval_test` | 43 | 93 | 47 | 84 | 38 | 1 | 0 | none (Meera and Rohan mapped) |
| `acme_qa_run_test` | 3 | 4 | 4 | 0 | 0 | 1 | 0 | QA Scoped Reviewer (inactive) |

A second apply copied 0 rows and skipped them all.

## 3. `demo:mcp-calls`

```text
API_BASE_URL=… DEMO_EMAIL=… DEMO_PASSWORD=… npm run demo:mcp-calls      (inside the deployed backend: npm run demo:mcp-calls:dist)
```

**What it does:**
- Signs in through `/api/v1/auth/login`.
- Uses the official MCP SDK client against `<API_BASE_URL>/api/v1/mcp` with the Bearer token. It sends no Origin header, so the endpoint's Origin check passes.
- Signs out at the end.

**The three calls and what gets recorded:**

| Call | Recorded as |
|---|---|
| `search_employees { query: "ACME00001" }` | SUCCEEDED |
| `get_employee_compensation { employeeCode: "not-an-employee-code" }` | REJECTED, `INVALID_ARGUMENTS` |
| `delete_employee` | REJECTED, `UNKNOWN_TOOL` |

An unknown tool is recorded as REJECTED, not FAILED: that is the Task 04 contract. A FAILED MCP row needs a real tool failure, so the command does not try to produce one.

**URL check.** It refuses any `API_BASE_URL` that is not `https://…`, `http://127.0.0.1…`, or `http://localhost…` (exact host), and any URL that contains credentials. `http://localhost.evil.example` is refused.

**Output:** only the tool names and outcomes.

**Dependency change:** `@modelcontextprotocol/client` moved from `devDependencies` to `dependencies` (same 2.4.0).
- The deployed backend prunes dev dependencies (`RAILPACK_PRUNE_DEPS=true`), so without this the `:dist` script could not run inside the container (step 4 of the runbook).
- `package-lock.json` changed only in the dev flags of that package and of 3 packages it depends on (`eventsource`, `eventsource-parser`, `pkce-challenge`).

## 4. `demo:scenario`

```text
DATABASE_URL=… APP_ENV=demo npm run demo:scenario -- --database <name> [--apply]
```

It uses the same guard (`_demo` or `_test`). It is a dry run unless `--apply` is given.

**Every write goes through the services:**
- `createSalaryAdjustmentService`: preview, then `applyDirect`, `submitRequest`, `approve`, `cancel`.
- `createHrAccessService`: preview, then `create`, `change(SCOPES)`, `change(DEACTIVATE)`.

Bands, version chains, idempotency keys, and audit events therefore come from the product's own code. Temporary passwords from `create` are discarded and never printed.

**Actors:**
- Meera (Admin HR): direct adjustments and every decision on requests.
- Rohan and the scenario user Priya Nair (Scoped HR): the requests.

**Employee choice.** For each item: the lowest employee code in the item's country and department that is currently working, has only the initial import, has no request, is not an oracle-fixture employee, is not used by another item, and passes the preview.

**Marking and re-runs.** Salary writes carry the note `DEMO-SCENARIO v1 <item>`. HR users are found by email. A re-run writes nothing, and it completes a partly finished earlier run (for example, a request that exists but was not yet approved).

**Content:**
- **8 Admin direct base-salary increases.** Countries: India (Tech, Finance, HR, Operations) and US (Tech, Finance, Support, Operations). Reasons: PERFORMANCE, MARKET_ADJUSTMENT, PROMOTION. Five take effect today; three take effect in 14 or 21 days.
- **6 Scoped requests, effective in 7 to 21 days.**
  - Rohan (India Tech and Support): 1 pending, 1 approved by Meera, 1 cancelled by Meera with the reason "Superseded by the annual review cycle."
  - Priya: 2 pending, 1 approved by Meera.
  - In total: 3 pending, 2 approved, 1 cancelled.
- **3 HR users:**
  - Priya Nair (`priya.nair.demo@acme.com`): active, India + Support.
  - Arjun Rao (`arjun.rao.demo@acme.com`): created with India + Tech, then its scope replaced once with US + Finance.
  - Kavya Menon (`kavya.menon.demo@acme.com`): created, then deactivated with the reason "Left the HR team."

  Together they produce `HR_USER_CREATED`, `SCOPES_REPLACED`, and `HR_USER_DEACTIVATED` audit events.

**Effective dates.** The service refuses past effective dates (`PAST_EFFECTIVE_DATE`), so "within the last 30 days" means recorded recently. "Recent changes" measures the recording time, and the future-dated changes fill "upcoming".

**Output:** each item's employee code and status (`CREATED`, `EXISTS`, `COMPLETED`, or `PLANNED`), request IDs, and HR-user emails and events.

## 5. Tests

**Shared setup.**
- The two-database tests use the `_test` database plus its **sibling `_demo` database** on the same server (`siblingDemoDatabaseUrl` and `resetSiblingDemoDatabase` in `test/support/test-database.ts`; the reset is guarded the same way).
- On 3322 I created `acme_ai_backend_demo` and granted `acme` access, using the local root account. `npm run test:db` needs that database from now on.

**`test/db/demo-import.test.ts`, 8 tests:**
- Every guard case refuses and writes nothing.
- A missing migration 008, or a changed employee code, stops the run before any write.
- The dry run writes nothing, reports the source counts, and warns that the oracle fixtures are missing.
- Apply gives the exact counts per table and the same trace UUIDs, owners by email, scope snapshots, times, and message sequences. Tool calls keep the right parent model call. The missing QA user is created inactive Scoped HR with its scope, an Argon2id hash, and the "Imported" audit event. Salary rows are untouched.
- A second apply writes nothing.
- Option C on imported data, through the conversation API: Rohan's imported answer is visible, then withheld after his Support scope is removed.
- The `demo:mcp-calls` URL rules.
- `demo:mcp-calls` against a local backend records exactly SUCCEEDED, REJECTED/`INVALID_ARGUMENTS`, and REJECTED/`UNKNOWN_TOOL`. A wrong password gives "sign-in failed with HTTP 401".

The source for these tests is seeded with the same workbook as the target, plus `eval:oracle-fixtures` and `eval:trace-fixtures`, plus one trace by a user who is missing on the target. User IDs differ on purpose between the two sides.

**`test/db/demo-scenario.test.ts`, 6 tests:**
- Guards, including missing demo users.
- The dry run writes nothing.
- Apply creates everything through the services: an actor and an idempotency key on each record, never an oracle employee, both countries, at least two departments and reasons, 3 pending, 2 approved, 1 cancelled with its reason, and the three HR users with their audit sequences.
- A re-run writes nothing.
- The seed is unchanged apart from the marked rows.
- Through the API:
  - `GET /salary-adjustment-requests?status=PENDING` returns 3 rows.
  - The dashboard summary shows 3 pending, 12 recent changes, and 6 upcoming changes.

**Mutation checks.** I broke the code on purpose and then restored it:

| Change | Test that failed |
|---|---|
| Remove the idempotent skip | "a second apply writes nothing" |
| Copy message IDs without remapping | "apply copies exact counts…" (message links) |

**No runtime path.** The existing test still passes: nothing under `src/` outside `src/evaluation/` imports `src/evaluation/`. After the build, `dist/src` outside `dist/src/evaluation/` has no such import either (checked with `grep`).

**Red-to-green.** These are new commands, so the tests were written alongside the code. The import tests passed on their first run; the mutation checks show that they guard the behaviour.

**Checks.** Run from `express-backend/`; the database is `acme_ai_backend_test` and its sibling `acme_ai_backend_demo` on 3322.

| Command | Result |
|---|---|
| `npm run openapi:generate` | exit 0, file byte-identical |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: **464 pass, 0 fail, 0 cancelled** |
| `npm run test:db` | exit 0: **404 pass, 0 fail, 0 cancelled** (+14: 8 import, 6 scenario) |
| `npm run build` | exit 0; `dist/scripts/demo-import-ai-data.js`, `demo-mcp-calls.js`, `demo-scenario.js` |
| `node --import tsx --test test/http-openapi.test.ts` | 16 pass (no drift) |
| CLI smoke | `APP_ENV=production` refused; a `_demo` source refused; missing `--database` refused; `API_BASE_URL=http://example.com` refused (all exit 1) |

## 6. Operator runbook for Railway

**Before you start:**
- Deploy this branch. Step 4 needs the `:dist` MCP script and the client as a production dependency in the deployed backend.
- On your machine, in `express-backend/`, run `npm ci`.
- Keep the local lanes running: `acme-ai-eval-mysql` (3324) and `acme-qa-run-mysql` (3328).

**Values, all entered by you in your own shell:**
- `DATABASE_URL` is the Railway MySQL **public proxy** URL with the path `/acme_demo`. Type it without echoing:

  ```text
  read -rs DATABASE_URL && export DATABASE_URL
  ```

- `SOURCE_DATABASE_URL` is the local lane URL with the lane's own credentials, for example `mysql://<lane user>:<lane password>@127.0.0.1:3324/acme_ai_eval_test`.
- Every command takes `APP_ENV=demo`.

None of the commands prints a URL or password. Run each command first **without `--apply`** (a dry run) and read the output, then add `--apply`.

**Step 1: oracle fixtures**

```text
APP_ENV=demo npm run eval:oracle-fixtures -- --database acme_demo            # dry run
APP_ENV=demo npm run eval:oracle-fixtures -- --database acme_demo --apply > oracle-manifest.json
```

Check in DataGrip:

```sql
SELECT e.employee_code, c.version, c.effective_from, c.created_at FROM compensation_records c JOIN employees e ON e.id = c.employee_id
WHERE c.change_note LIKE 'EVAL-ORACLE-FIXTURE v1%' ORDER BY e.employee_code;
```

Expect 2 rows: `ACME00002` (effective on the run date) and `ACME00003` (effective 45 days later), the same employees as in the evaluator lane.

The effective and recorded **dates** will be the Railway run date, not 17 November 2026. Recorded answers that quote those dates will differ by date only; the amounts are the same.

**Step 2: demo scenario**

```text
APP_ENV=demo npm run demo:scenario -- --database acme_demo
APP_ENV=demo npm run demo:scenario -- --database acme_demo --apply > scenario.json
```

Check:

```sql
SELECT 'direct' k, COUNT(*) v FROM compensation_records WHERE change_note LIKE 'DEMO-SCENARIO v1 direct-%'
UNION ALL SELECT CONCAT('request ', status), COUNT(*) FROM compensation_change_requests WHERE note LIKE 'DEMO-SCENARIO v1 %' GROUP BY status
UNION ALL SELECT 'scenario HR users', COUNT(*) FROM hr_users WHERE email LIKE '%.demo@acme.com'
UNION ALL SELECT 'non-import records', COUNT(*) FROM compensation_records WHERE change_reason <> 'INITIAL_IMPORT';
```

Expect `direct` 8; `request PENDING` 3, `request APPROVED` 2, `request CANCELLED` 1; `scenario HR users` 3; `non-import records` 12 (2 oracle + 8 direct + 2 approved). The figure is higher only if earlier demo activity already exists in Railway.

**Step 3: recorded AI data**, evaluator lane first, then QA lane:

```text
SOURCE_DATABASE_URL=<evaluator lane URL> APP_ENV=demo npm run demo:import-ai-data -- --source-database acme_ai_eval_test --target-database acme_demo
SOURCE_DATABASE_URL=<evaluator lane URL> APP_ENV=demo npm run demo:import-ai-data -- --source-database acme_ai_eval_test --target-database acme_demo --apply
SOURCE_DATABASE_URL=<QA lane URL>        APP_ENV=demo npm run demo:import-ai-data -- --source-database acme_qa_run_test --target-database acme_demo
SOURCE_DATABASE_URL=<QA lane URL>        APP_ENV=demo npm run demo:import-ai-data -- --source-database acme_qa_run_test --target-database acme_demo --apply
```

- The dry run's `tables` must show the lane's current counts and no `warnings`.
- An "employee set differs" refusal means Railway was not seeded with the default workbook: stop.
- An oracle warning means step 1 was skipped.

Check:

```sql
SELECT (SELECT COUNT(*) FROM ai_conversations) conversations, (SELECT COUNT(*) FROM ai_messages) messages, (SELECT COUNT(*) FROM ai_traces) traces,
       (SELECT COUNT(*) FROM ai_model_calls) model_calls, (SELECT COUNT(*) FROM ai_tool_calls) tool_calls, (SELECT COUNT(*) FROM ai_trace_reviews) reviews,
       (SELECT COUNT(*) FROM hr_users WHERE email = 'qa.scoped.reviewer@example.test' AND status = 'INACTIVE') qa_user;
```

- Expect the sum of the two lanes' `copied` counts plus whatever Railway already had.
- With the 18:04 dumps, the sums are 46 / 97 / 51 / 84 / 38 / 2, and `qa_user` = 1.
- The live lanes may have grown since then; the command's output is the authority.

**Step 4: MCP demo calls (recommended: `railway ssh`)**

```text
railway ssh --service express-backend
# inside the container:
read -rs DEMO_PASSWORD && export DEMO_PASSWORD
API_BASE_URL="http://127.0.0.1:${PORT}" DEMO_EMAIL=meera.iyer@acme.com npm run demo:mcp-calls:dist
unset DEMO_PASSWORD
```

**Why `railway ssh`:** the backend has no public domain, and it should stay that way.
- Running the command inside the backend container calls the API over loopback. Nothing new is exposed, and no browser Origin is involved.
- The password is typed with `read -s`, so it stays out of shell history and output.
- Cost: you need Railway CLI access to the project, and this branch must be deployed first.

**Alternative:** temporarily generate a public domain for the backend and run `API_BASE_URL=https://<domain> … npm run demo:mcp-calls` from your machine.
- This needs no new deploy and no SSH.
- But for that window the whole backend API, including login, is reachable from the internet, outside the frontend.
- If you choose this, remove the domain straight after and check that it is gone.

Check:

```sql
SELECT tool_name, status, JSON_UNQUOTE(JSON_EXTRACT(validation_errors, '$.reason')) reason FROM mcp_tool_calls ORDER BY started_at DESC LIMIT 3;
```

Expect `search_employees SUCCEEDED NULL`, `get_employee_compensation REJECTED INVALID_ARGUMENTS`, and `delete_employee REJECTED UNKNOWN_TOOL`.

**After all steps:**
- **AI monitoring:** open the Admin AI traces page and its 24h / 7d / 30d summary.
- **MCP:** open the MCP page.
- **Dashboard:** expect 3 pending requests, plus recent and upcoming changes.
- **Salary requests:** the 3 pending requests appear in Meera's queue.
- **HR Access:** the audit shows created, scope-replaced, and deactivated events.

Re-running any step writes nothing.

## 7. Files changed (under `express-backend/` unless noted)

**New:**
- `src/evaluation/demo-import.ts`, `src/evaluation/demo-mcp-calls.ts`, `src/evaluation/demo-scenario.ts`
- `scripts/demo-import-ai-data.ts`, `scripts/demo-mcp-calls.ts`, `scripts/demo-scenario.ts`
- `test/db/demo-import.test.ts`, `test/db/demo-scenario.test.ts`

**Changed:**
- `src/evaluation/fixture-guard.ts`: optional `suffixes` and `flag`.
- `test/support/test-database.ts`: sibling `_demo` helpers.
- `package.json`: the `demo:import-ai-data`, `demo:mcp-calls`, `demo:mcp-calls:dist`, and `demo:scenario` scripts, and `@modelcontextprotocol/client` moved to `dependencies`.
- `package-lock.json`: the matching dev flags.
- `README.md` (repo root): the Known limitations entry for D1/D2.

**Docs:** this file.

**Not changed:** routes, schemas, migrations, OpenAPI, `next-frontend/**`, and `docs_human/**`.

## 8. Known limits and confirmations

**Known limits:**
- The source lanes were exercised through the planner's dumps (section 1). The first run against the live lanes is the operator's.
- `demo:mcp-calls` cannot produce a FAILED MCP row on demand.
- The oracle-fixture clock defect reported in Task 05 is still open (`recordedWithinRecentWindow` can be `false` by milliseconds). It does not affect this task.

**Confirmations:**
- **One accidental Git command.** A chained shell command contained `git --version`, which prints only the Git version and touches no repository. No other Git command ran, and nothing was committed or pushed.
- I did not read or create `.env`, and used no live OpenAI key.
- I made no Railway access of any kind.
- I printed no connection strings or passwords. They appear only in my own tool commands, for the local fixed-credential containers.
- I wrote nothing to the source lanes 3324 and 3328, and did not stop or remove their containers.
- I wrote only to my own 3329 container (now removed) and to the 3322 test server, where I added the sibling `acme_ai_backend_demo` database.
- Work stopped after Task 06.
