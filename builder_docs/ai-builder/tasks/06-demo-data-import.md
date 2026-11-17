# AI builder task 06: copy recorded AI data into the demo database

## Status

READY. Task 05 is accepted and merged into master. The app is deployed on Railway (database `acme_demo`).

## Goal

The demo database must contain the real assistant conversations and traces that the evaluator and the QA tester recorded, so that AI monitoring has real content in the deployed demo. You build a guarded copy command. The operator runs it against the Railway database. You never connect to Railway.

## Sources (local, read-only for you)

| Lane | Database | How to reach it |
|---|---|---|
| Evaluator | `acme_ai_eval_test` | MySQL container `acme-ai-eval-mysql`, `127.0.0.1:3324` |
| QA tester | `acme_qa_run_test` | MySQL container `acme-qa-run-mysql`, `127.0.0.1:3328` |

Today, the evaluator lane has 47 traces and the QA lane has 4. Both are tmpfs. The planner keeps a SQL dump of each in `/Users/admin/Desktop/Projects/acme_lane_backups/`. Do not write to either source. Do not stop or remove their containers.

The target is the demo database. Its name must end in `_demo`. In Railway it is `acme_demo`. To develop, use your own target: start a local container `acme-demo-import-mysql` on `127.0.0.1:3329` with database `acme_demo`, then migrate and seed it the same way the lanes were seeded (10,000 employees, the default `SEED`, then `db:seed-demo-users`).

## Command

```text
SOURCE_DATABASE_URL=… DATABASE_URL=… APP_ENV=demo \
  npm run demo:import-ai-data -- --source-database <name> --target-database <name> [--apply]
```

- **Guards.** Reuse `src/evaluation/fixture-guard.ts`; do not copy it.
  - The source name must end in `_test`.
  - The target name must end in `_demo`.
  - Both `--…-database` flags must exactly match the connected databases.
  - `APP_ENV=production` is refused.
  - Dry run is the default.
  - Never read `.env`.
  - Never print a connection string.
- **Preconditions on the target.** Check these before writing anything; on failure, stop with a clear message:
  - Migrations 001 to 008 are applied.
  - The employee set matches the source (count, plus a checksum of employee codes).
- **HR users are mapped by email,** never by ID.
  - Meera and Rohan exist on both sides.
  - Any source HR user who is missing on the target (for example the QA lane's "QA Scoped Reviewer") is created on the target as INACTIVE Scoped HR with the same scope, a random unusable password hash, and an access-audit event that says it was imported. Record each one in the output.
- **Tables copied,** in dependency order, all in one transaction per conversation:
  - `ai_conversations`
  - `ai_messages`
  - `ai_traces`
  - `ai_model_calls`
  - `ai_tool_calls`
  - `ai_trace_reviews`
  - `mcp_tool_calls`
- **What is kept:** UUIDs, timestamps, and the trace-time scope snapshot (migration 007), exactly as stored.
- **Idempotent.** Rows whose IDs already exist on the target are skipped. A second run writes nothing.
- **Salary data is not copied,** and neither are employees or salary requests. The evaluator's answers refer to the oracle fixtures, so the operator runs `eval:oracle-fixtures --database acme_demo --apply` on the target first. The `_demo` suffix passes that guard. Print a warning if those fixtures are missing on the target.
- **Output.** Write to stdout: rows copied and skipped per table and per source, HR users created, and warnings. Print no content and no credentials.

## MCP demo calls

The MCP page is empty on every lane, because only external MCP clients call `/api/v1/mcp`. Add a second command:

```text
API_BASE_URL=… DEMO_EMAIL=… DEMO_PASSWORD=… npm run demo:mcp-calls
```

It signs in through the normal login API, then uses the MCP SDK client against `<API_BASE_URL>/api/v1/mcp` with that Bearer token. It makes one successful lookup, one call with invalid arguments, and one call to an unknown tool. The result is real `SUCCEEDED`, `REJECTED`, and `FAILED`/unknown rows. It prints only tool names and statuses. It refuses any `API_BASE_URL` that is not `http://127.0.0.1…`, `http://localhost…`, or `https://…`.

## Demo scenario: salary and HR-access activity (planner addition, 2026-11-17)

The local lanes contain very little non-AI activity: 2 fixture salary changes and 1 cancelled request. That is not enough for the deployed dashboard, the salary-request queue, or the HR Access audit. Add a third guarded command:

```text
DATABASE_URL=… APP_ENV=demo npm run demo:scenario -- --database <name> [--apply]
```

- It uses the same guard as the others: the database name must end in `_demo` or `_test`, it does a dry run by default, and it never reads `.env`.
- **Every write goes through the product's own services**, never through raw SQL: salary preview and apply, request submit, approve and cancel, and the HR-user create, scope, and deactivate operations. Bands, version chains, idempotency, and audit events then stay correct.
- **Actors:** Meera, Rohan, and the scenario's own HR users.
- **Deterministic and idempotent.** Choose employees by rule, for example the lowest eligible codes per country and department. Mark every write so that a re-run finds it and writes nothing.
- **Do not touch the oracle-fixture employees.** The evaluator's answers depend on them.
- **Content.** Effective dates must fall within the last 30 days, or soon after today, so that the dashboard's "recent changes" and "upcoming" sections have data. The scenario must create:
  - About 8 Admin direct adjustments, across India and US, at least two departments, and at least two reasons.
  - About 6 scoped requests from Rohan and from one scenario Scoped HR user:
    - 3 pending, left in Meera's queue;
    - 2 approved by Meera;
    - 1 cancelled with a reason.
  - 3 HR users:
    - 1 active Scoped HR user, India and Support;
    - 1 Scoped HR user whose scope was replaced once;
    - 1 deactivated user, so the audit shows each event type.

    Their temporary passwords are discarded and never printed.
- **Output:** what was created per type, with employee codes and request IDs. No passwords.

Test it like the import: guards, dry run, apply, idempotent re-run, the seed left unchanged apart from the scenario rows, and the dashboard and request-list API showing the expected counts.

## Operator order on Railway (put this in the runbook)

Run every step from the operator's machine, against `acme_demo` through the MySQL public proxy URL. The operator enters that URL. You never see it.

1. `eval:oracle-fixtures --database acme_demo --apply`
2. `demo:scenario --database acme_demo --apply`
3. `demo:import-ai-data` from `acme_ai_eval_test`, then from `acme_qa_run_test`
4. `demo:mcp-calls` against the public frontend's backend. **Note:** the backend has no public domain, and the `/api/v1/mcp` endpoint refuses browser Origins. Say how the operator should run it: for example, by temporarily enabling a backend domain, or by `railway ssh` from inside the project. Choose the safest option and explain the trade-off.
5. A check after each step: a short read-only SQL query the operator runs in DataGrip, with the expected counts.

## Tests

- Guards refuse each bad case and write nothing.
- A dry run writes nothing.
- An apply into a test target gives the exact row counts.
- A second apply writes nothing.
- An email-mapping test, including a missing HR user.
- The precondition failures stop the run.
- Traces imported for Rohan stay withheld or covered under the Option C rule. Check this through the conversation API.
- `demo:mcp-calls` against a local test backend records the three rows.

Run lint, typecheck, `npm test`, `npm run test:db`, build, and the OpenAPI drift test. The OpenAPI must not change.

## Rules

No Git, no `.env`, no live OpenAI key, no `next-frontend/**` or `docs_human/**`. Remove `acme-demo-import-mysql` when you finish.

Write `responses/06-demo-data-import.md`. Include the exact operator runbook for Railway: the order of the commands, which values go where, and what to check after each step. Stop.
