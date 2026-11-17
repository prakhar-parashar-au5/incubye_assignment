# Architecture viz Task 03: salary request flow and the database schema artifact

Status: **complete.** Both parts are done and every check passes. I stopped after Task 03.

## Commands and results

```text
$ node architecture-viz/flows/verify.ts
F1 F1-employees.json: 31 nodes, 32 edges, 3 alternatives — OK
F2 F2-assistant-tool-call.json: 35 nodes, 41 edges, 3 alternatives — OK
F3 F3-salary-request-approval.json: 35 nodes, 39 edges, 3 alternatives — OK
101 nodes checked, 0 problem(s).                         (exit 0)

$ node architecture-viz/render.ts      → out/F1–F3 .html and .png
$ node architecture-viz/schema.ts
wrote architecture-viz/out/schema.html: 20 tables (20 CREATE TABLE, all present), 31 foreign keys
wrote architecture-viz/out/schema.png                    (exit 0)
```

## Part A: F3, Rohan requests and Meera approves

**Files.** The flow data is `architecture-viz/flows/F3-salary-request-approval.json`: 35 nodes, 39 steps, 3 alternatives. The rendered page is `out/F3.html`, and its PNG is `out/F3.png` (1440×6617).

**Personas on one thread.** I made three small, backward-compatible additions to `schema.ts`:
- `Flow.personas` lists the actors on the thread.
- `FlowNode.persona` names who acts at each step. When a flow declares personas, the structure check requires every node to have one from that list.
- `Flow.id` now accepts any id of the form `F<n>`.

`verify.ts` now checks every `F*.json` file instead of a fixed list.

`render.ts` shows the personas as a coloured tag on each card: blue for Rohan, green for Meera, grey for System. The step column also gets a tag at the point where the actor changes.

### The path

Rohan previews the change (steps 1–12):
1. `runPreview` in the browser, then the `previewSalaryAdjustment` Server Action.
2. `requireAuth`, then `POST …/salary-adjustments/preview`, then `service.preview`.
3. **Scope check.** `findEmployee` and `canAccessEmployee` look up `employees ⋈ job_titles ⋈ departments`.
4. `loadContext` reads `compensation_records` (every version; `maxVersion` becomes the expected version) and `salary_bands`.
5. **Pending check.** `pendingRequestId` reads `compensation_change_requests`.
6. `previewTokens.sign` signs a token that binds the actor, session, employee, mode, expected version (`ver`), baseline version (`bv`), and a digest of the command.
7. Rohan sees the result in `PreviewPanel`.

Rohan submits the request (steps 13–22):
1. `confirm` creates one Idempotency-Key per confirmation.
2. `confirmSalaryAdjustment` calls `submitSalaryAdjustmentRequest`, which posts to `POST …/salary-adjustment-requests`. That route allows Scoped HR only.
3. `submitRequest` runs one transaction:
   - scope again, then `SELECT … FOR UPDATE` on the employee row;
   - the replay lookup on `request_idempotency_key`;
   - the pending check;
   - `confirmPreview`, the token and version check;
   - `INSERT INTO compensation_change_requests` with status PENDING.
4. Rohan sees "Pending approval".

Meera reads the queue (steps 23–27): `SalaryRequests` calls `GET /salary-adjustment-requests`. `listRequests` applies `scopeCondition` and reads the requests table.

Meera approves (steps 28–39):
1. `approve` in `request-decision.tsx`, with an Idempotency-Key per decision.
2. `approveSalaryRequest` calls `approveSalaryAdjustmentRequest`, which posts to `POST …/approve`. That route allows Admin HR only.
3. `service.approve` runs one transaction:
   - `lockRequest` (`FOR UPDATE`) and `priorDecision` on `decision_idempotency_key`;
   - `recheck`, the optimistic version check: `maxVersion === requested_against_version`, plus requester scope, eligibility, date, and band;
   - `INSERT INTO compensation_records` with version `maxVersion + 1`, `source_request_id`, and `changed_by_hr_user_id` = Meera;
   - `UPDATE … SET status = 'APPROVED'`, then `staleOtherPending`.
4. The response passes `SalaryRequestApproval.parse`, then `isSalaryRequestApproval`, then `router.refresh()`, and Meera sees "Approved".

### Alternatives

| Alternative | What the code does |
|---|---|
| **Stale version** | `recheck` finds that the version moved. It marks the request STALE, commits, and returns `409 STALE_VERSION` without inserting a compensation row. At submit time, `confirmPreview` returns the same 409. The database backstop is `uk_compensation_employee_version`. |
| **Second pending request** | `preview` and `submitRequest` return `PENDING_REQUEST_EXISTS` (409). The database backstop is `uk_ccr_one_pending` on the generated `pending_employee_id` column. |
| **Out-of-scope employee** | `canAccessEmployee` returns false. The response is 404 "Employee not found.", the same as for an unknown code. |

### Findings

- **Audit writes: none in this flow.** `access_audit_events` is written only by HR access management (`hr-users.ts:278`). For salary changes, the audit trail is the rows themselves:
  - the request row (requester, both versions, key);
  - the new compensation version (`changed_by_hr_user_id`, `source_request_id`, `previous_compensation_record_id`).

  The flow notes record this. Migration 003's own comment says the same: "No separate compensation audit table".
- **Node budget.** To stay at 35 nodes, I left a few trivial wrappers out as separate nodes and named them on the edges instead: the preview API client, the list API client, and the employee lock. `requireAuth` is drawn once, at step 2. Every later request goes through it the same way, and a note says so.

## Part B: database schema artifact

**Files.** The generator is `architecture-viz/schema.ts`. It writes `out/schema.html` and `out/schema.png` (1440×5883).

**Source.** It works from the migration files only: `express-backend/db/migrations/001` to `008`, plus the `schema_migrations` table that the migration runner creates in `src/db/migrate.ts`. It runs no database query.

**What it parses:**
- `CREATE TABLE` statements, including columns and their types;
- nullability and generated columns;
- `PRIMARY KEY`, `UNIQUE KEY`, and `KEY`;
- `CONSTRAINT … FOREIGN KEY … REFERENCES … ON DELETE …`;
- `CHECK` constraints;
- `ALTER TABLE` items: `ADD COLUMN`, `MODIFY COLUMN`, `ADD KEY` and `ADD UNIQUE KEY`, and `ADD CONSTRAINT`.

Comments are stripped before parsing, and statements are split outside quotes and parentheses. Data statements (the `UPDATE` in 004) are ignored. Any other DDL makes the run fail, so the generator never skips something silently.

**Groups.** The tables are grouped as the task specifies:

| Group | Tables |
|---|---|
| People and organisation | 5 |
| Compensation | 2 |
| Access | 5 |
| AI observability | 7 |
| Migration bookkeeping | `schema_migrations` |

**Cards.** Each table is a card:
- columns with their types, and PK / FK / UQ marks;
- "null" and "generated" flags;
- `→ table.column` links for foreign keys, with a red CASCADE or SET NULL marker when the delete rule is not RESTRICT;
- an `+003`-style marker on columns and indexes added by a later migration;
- the table's unique keys and indexes;
- a count of CHECK constraints, with their names.

I used FK links instead of drawn lines, which the task allows when lines get messy. There are 31 foreign keys.

**Group notes are quoted from the migrations, not written by me.** Each note is the full comment block in a migration that contains a fixed anchor phrase, with its `file:line` cited. If an anchor is missing, the run fails. Two parsed facts are added under their groups:
- under Compensation, `UNIQUE KEY uk_compensation_employee_version (employee_id, version)`, which is how compensation is versioned per employee;
- under AI observability, the 007 CHECK `chk_ai_traces_actor_scope` and the 008 covering index `idx_ai_traces_summary`, both printed from the parsed SQL.

| Required note | Source |
|---|---|
| Money as DECIMAL with a currency | 001:73, "Immutable compensation history … Currency is stored per record … DECIMAL(15,2) rounds a third decimal place …" |
| Compensation versioned per employee | The unique key above, plus 003:55 "Highest compensation version when the request was made (the expected version)" |
| 007 scope snapshot and its CHECK | The 007 header comment, plus the parsed CHECK expression |
| 008 covering index | The 008 comment, plus the parsed index columns |

**Footer.** It lists the migration files in order and the base commit text. The commit ID itself is not read, because there is no Git in this lane.

### Schema checks

The run exits 1 if any check fails:
- every `CREATE TABLE` in the migrations is in exactly one group;
- every table a group lists actually exists;
- every table appears in the HTML (`id="t-<table>"`);
- every FK points at an existing table and column;
- every note anchor is found.

**Proof that the check works.** I temporarily removed `access_audit_events` from its group. The run then failed, reporting "table access_audit_events … is in 0 groups" and "missing from the output", and exited 1. After I restored the file, it passed.

**Counts cross-check.** The SQL contains 19 `CREATE TABLE` and 31 `FOREIGN KEY`. Adding `schema_migrations` gives the generator's 20 tables, and its 31 foreign keys match.

## Visual check

I looked at full-page and full-resolution crops of both pages.

**Fixes:**
- **F3 cylinders.** Long table names (`compensation_change_requests`) pushed the operation label out of the cylinder. The cylinder is now CSS with a fixed-height cap that grows with its text, and names break at underscores. F1 and F2 were re-rendered with the same fix.
- **Schema cards.** The cards were too narrow for the compensation tables, so I widened them to a minimum of 420 px, which gives three per row at 1440 px.
- **Schema styling.** The index-list class clashed with the KEY badge class, so I renamed it.

**Result:** both pages are self-contained, with no `<script>` and no external resources.

## Evidence

- `builder_docs/architecture-viz/responses/evidence-03/F3.png`
- `builder_docs/architecture-viz/responses/evidence-03/schema.png`

## Files

| Status | Files |
|---|---|
| New | `architecture-viz/flows/F3-salary-request-approval.json`, `architecture-viz/schema.ts`, `architecture-viz/out/{F3.html,F3.png,schema.html,schema.png}`, `evidence-03/*`, this response |
| Changed | `architecture-viz/flows/schema.ts` (personas and `F<n>` ids), `architecture-viz/flows/verify.ts` (finds every flow file), `architecture-viz/render.ts` (persona tags, CSS cylinders); `out/F1` and `out/F2` re-rendered |

## Confirmations

- No application code changed.
- No Git, no `.env`, no database queries.
- No ports used: the generators only open local `file://` pages in Playwright.
