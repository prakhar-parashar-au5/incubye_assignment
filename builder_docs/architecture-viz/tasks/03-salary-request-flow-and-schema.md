# Architecture viz task 03: third flow and the database schema artifact

## Status

READY. Same worktree and the same rules as Tasks 01 and 02. Task 02 is accepted.

## Part A: flow F3, a salary request and its approval

Trace one flow from the real code, in the same JSON schema, and verify it with `verify.ts`:

**F3: Rohan (Scoped HR) previews and submits a salary-change request, then Meera (Admin HR) approves it.**

Show these steps:
- the preview;
- scope enforcement on the employee;
- the idempotency key;
- the request insert;
- the access or audit writes, if any;
- Meera's queue read;
- the approve step, with the optimistic version check (expected version);
- the new compensation version insert;
- the request status update;
- the response and the render.

Add these as alternatives:
- a stale version, giving a `409 STALE_VERSION`;
- a second pending request for the same employee being refused;
- an out-of-scope employee giving "not found".

Use two personas on the one thread: label each node with who acts. Keep the 15–35 node limit. Render it with `render.ts` to `out/F3.html` and `out/F3.png`.

## Part B: database schema artifact

Add `architecture-viz/schema.ts`. It generates `out/schema.html` and `out/schema.png` **from the migration SQL files** in `express-backend/db/migrations/` (001–008), not from a live database. Parse `CREATE TABLE`, `ALTER TABLE`, and the foreign keys and indexes that matter.

The page shows:
- **The tables grouped by domain:**
  - People and organisation: `employees`, `countries`, `departments`, `job_titles`, `salary_bands`.
  - Compensation: `compensation_records`, `compensation_change_requests`.
  - Access: `hr_users`, the scope tables, `hr_sessions`, `access_audit_events`.
  - AI observability: `ai_conversations`, `ai_messages`, `ai_traces`, `ai_model_calls`, `ai_tool_calls`, `ai_trace_reviews`, `mcp_tool_calls`.
  - `schema_migrations`.
- **Each table as a card:** its columns with types, PK and FK marks, and unique and important indexes.
- **Foreign keys** as lines between the cards, or as clear "→ table.column" links if lines get messy.
- **A short note under each group** on the key rules the schema enforces:
  - money stored as exact DECIMAL with a currency;
  - compensation versioned per employee;
  - the 007 scope snapshot and its CHECK constraint;
  - the 008 covering index for the monitoring summary.

  Take each note from the migrations themselves. Do not invent any.
- **A footer** with the migration list and the commit.

Use the same visual style as F1 and F2.

## Checks

- `verify.ts` passes for F1, F2, and F3.
- The schema generator lists every table in the migrations. Add a check that fails if a `CREATE TABLE` in the migrations is missing from the output.
- Put the PNGs in `responses/evidence-03/`.

## Rules

- No changes to app code.
- No Git, no `.env`, no database queries.

Write `responses/03-salary-request-flow-and-schema.md` and stop.
