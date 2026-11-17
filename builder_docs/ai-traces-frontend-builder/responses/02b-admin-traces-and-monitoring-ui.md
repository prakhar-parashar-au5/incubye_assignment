# AI traces frontend Task 02b: Admin traces, MCP, and monitoring dashboard

Status: **complete.** All required checks pass. Nothing was committed.

I built the three views in the requested order: Overview, then Traces, then MCP calls. The contract decisions follow `builder_docs/ai-builder/responses/04-checkpoint-1.md`. None of the 8 frozen operations looked wrong, so I report no contract issue.

## What the Admin sees

Every Admin route gets the same shell treatment:
- **Rail:** a single "AI monitoring" item, rendered only when the session says Admin HR. Hiding it is presentation only.
- **View links:** Overview, Traces, and MCP calls (`aria-current`).
- **Page states:** each route has its own loading skeleton with status text, a forbidden state, a not-found page, a service-unavailable state, and an unreadable-response state.
- **Indexing:** `robots: noindex` on every route.

| Route | Content |
|---|---|
| `/admin/ai-monitoring?window=24h\|7d\|30d` | **Overview.** Built only from `getAdminAiTraceSummary`. |
| `/admin/ai-traces` | **Trace ledger.** The route the spec names. Server-side filters and pagination. |
| `/admin/ai-traces/[traceId]` | **Turn detail.** Formatted or raw view, review, and deletion. |
| `/admin/mcp-calls` and `/admin/mcp-calls/[mcpCallId]` | **MCP list and detail.** No model, token, or review data, and no link to an AI trace. |

**Overview.** This view has no card wall and no chart library.
- **Window and time:**
  - a window switch;
  - a ruled `From | To | Generated` record;
  - assistant turns: total, completed, failed, and in progress;
  - traces and failures per hour or per day, as one `aria-hidden` CSS bar chart. The same values are in a "Values by …" table, along with the busiest bucket.
- **Breakdowns:**
  - failures by stage and category;
  - p50, p95, and slowest duration;
  - input, output, reasoning (count only), and total tokens;
  - model calls by model;
  - review verdicts and the unreviewed count;
  - a tool-by-status table for assistant tool calls;
  - a tool-by-status table for MCP calls.
- **Links.** Every count with a matching list filter links to the pre-filtered list:
  - trace counts filter by status;
  - failure rows filter by `status=FAILED` and `errorCategory`;
  - model rows filter by `model`;
  - tool names filter by `tool`;
  - every MCP cell filters by `tool` and `status`;
  - day buckets filter by the date range.

  Durations, tokens, and verdicts have no list filter, so they are plain text, and the page says so.
- **Window boundaries.** The summary window is an exact instant range, but the list filters by whole UTC days. The page states that its links can include a few traces just outside the window.

**Trace list.**
- **Filters:** a plain GET form with from and to (UTC dates), HR user, status, model, tool, error category, and page size (25, 50, or 100).
  - The HR user, model, tool, and error-category choices come from `getAdminAiTraceOptions`.
  - URL keys are the backend's own query names.
  - Applying the form lands on `#results`, so focus starts at the results line.
- **Active filters** show as removable chips, plus "Clear all".
- **Results line:** "N traces · page p of P". Below it, Newer and Older pagination links.
- **Desktop table**, in its own focusable scroll region: Started (the row link), HR user, Status, Model, Tools, Duration, Tokens in · out · reasoning, Calls, and Error (stage label plus category).
- **Below 1024px:** each trace is a ruled list item.
- **Invalid URLs** are refused instead of silently dropping a filter: a repeated key, a bad date, `to` before `from`, `pageSize` over 100, or an unknown status. The backend's 400 shows the same alert with a "Clear filters" link.
- **No content in rows:** rows never show prompt or answer text.

**Trace detail.**
- **Header:** three ruled records.
  - Status, Started, Duration, Model.
  - HR user, turn, calls, and tokens.
  - Prompt version and hash, request ID, and previous and next turn links.
- **Failure banner:** a failed trace adds "Stopped at {Group · label}: {category}" and a "Go to step N" link.
- **Tabs:** Formatted | Raw JSON. These are WAI-ARIA tabs with manual activation. They are buttons, so the view never enters the URL.
- **Turn ledger:** an ordered list built from sequence numbers only.
  - Steps run: prompt, then each model call followed by the tool calls it requested (matched by `modelCallSequence`), then the final response, then "Stopped here" or "In progress" at the end of the turn.
  - Each step has an h3, "Step n of N: kind — status words".
  - Model steps show latency, tokens, the reasoning count with the gloss "content is not recorded", the tool decision, and "No tool requested" where no tool was requested.
  - Tool steps show validation and execution separately. "Not executed: rejected by validation" marks a rejected call. "Outcome not recorded" is shown for the backend's `OUTCOME_NOT_RECORDED` category.
- **Formatted view** is the backend's formatted view, with the backend's redaction note printed. Placeholders read `Employee n` and `EMPLOYEE-n`, and salary values are shown.
- **JSON sections:**
  - each stored value is a `<details>`, with its size in the summary;
  - values over 2 KB or 40 lines start collapsed, and model inputs, tool schemas, and decisions are always collapsed;
  - the text is computed only on open, as one `<pre>` in a focusable scroll region of at most 32rem;
  - "Copy JSON" only copies on click.
- **Raw JSON:**
  - The Raw JSON tab first shows a warning panel with the spec sentence, and focus moves to its heading.
  - The `loadRawTrace` Server Action (`view=raw`) runs only after "Show raw trace data". The action refuses a response that is not `view: "raw"`.
  - The raw data lives only in component state. It is cleared on "Back to formatted", when the route is hidden, and on navigation, so the warning appears on every visit.
  - If the raw data cannot be shown, an alert appears, and the formatted view still works.
- **Aside** (sticky at 1280px and wider; below the ledger on narrow screens, with a "Go to review" link):
  - **Review:**
    - The form has verdict radios with a legend, a note with a 2,000-character counter, and a nomination checkbox with the "nothing is copied automatically" note.
    - It sends `expectedVersion`, which is 0 for the first review.
    - **Stale reviews:** a `409 STALE_VERSION` re-reads the detail. The page then shows the other reviewer's saved review in a focused warning, keeps the draft, and asks for "Replace with my review", which sends the new version.
    - **Other errors:** `409 ASSISTANT_TURN_IN_PROGRESS` and a 404 (trace deleted) each have their own copy. A running turn shows no form.
  - **Delete:**
    - The confirmation is inline, never a modal. It shows the trace time, HR user, status, and the irreversible scope, including counts and whether a review exists, and focus moves to the question. Back returns focus.
    - `DELETE ?confirm=<same id>` is sent with no request body. Success counts only when the backend confirms this exact trace ID. The page is then replaced by a deletion record with the backend's counts. Nothing is put in the URL, so a reload shows "Trace not found".

**MCP calls.**
- **List:**
  - filters: from, to, principal (HR user), tool, and execution status;
  - columns: Started, Principal, Tool, Validation, Execution, Duration, and Error category.
- **Detail:**
  - two header records;
  - the same Formatted and warned Raw JSON switch, using `loadRawMcpCall`;
  - sections for arguments, validation errors, result, and safe error.

## Contract changes (frontend)

- **Allowlist:** I added the 8 frozen Task 04 operation IDs to the allowlist and ran `npm run api:generate`.
- **Validators:** each response type gets an Ajv validator compiled from the generated contract file.
- **Client methods:** I added one method per operation. The request type now also allows `DELETE`.
- **Schemas:** none were written by hand. `tests/unit/api-contract.test.ts` lists the exact operations, schemas, and paths.

## Security boundaries

- **Server Actions:** the 4 new actions (`loadRawTrace`, `loadRawMcpCall`, `saveTraceReview`, `deleteTrace`) are untrusted entry points. Each validates its input:
  - IDs must be UUIDs, otherwise the request never reaches the backend;
  - the verdict must be in its enum;
  - the note must be a string of at most 2,000 characters;
  - `nominated` must be a boolean;
  - `expectedVersion` must be a non-negative safe integer.

  Each action uses only the server cookie token and maps the backend's 401, 403, 404, and 409 responses.
- **Backend authority:** every Admin page renders the backend's 403 as `ForbiddenState`. Hiding the rail item is presentation only.
- **Raw data stays out of storage:** raw content never enters URLs, storage, the router cache, logs, or titles. Tests assert that `localStorage`, `sessionStorage`, and `document.cookie` are empty, and that the URL is unchanged after the raw view opens.
- **Escaping:** JSON, notes, and model text render as React text only.
- **Logs:** client logs are unchanged. They carry the operation, the failure kind, and the status.
- **HTTP status:** `forbidden()` and `authInterrupts` are experimental in the installed Next.js 16.4.6 docs, so I did not use them. The forbidden state therefore renders with HTTP 200, and the backend's 403 remains the authority.

## Files

**New source:**
- `src/lib/ai-monitoring.ts`
- `src/server/actions/ai-monitoring.ts`
- `src/components/ai-monitoring/{monitoring-ui,list-parts,json-section,turn-ledger,mcp-body,view-switch,review-panel,delete-panel}.tsx`
- `src/app/admin/ai-monitoring/page.tsx`
- `src/app/admin/ai-traces/page.tsx`
- `src/app/admin/ai-traces/[traceId]/{page,not-found}.tsx`
- `src/app/admin/mcp-calls/page.tsx`
- `src/app/admin/mcp-calls/[mcpCallId]/{page,not-found}.tsx`

**New tests:**
- `tests/unit/ai-monitoring.test.ts`
- `tests/component/ai-monitoring.test.tsx`
- `tests/support/monitoring-fixtures.ts`
- `tests/e2e/ai-monitoring.spec.ts`
- `tests/e2e/support/seed-ai-traces.mts`

**Edited:**
- `scripts/generate-api-contract.mjs`
- `src/generated/*`
- `src/server/api/{client,contract}.ts`
- `src/components/shell/app-shell.tsx` (Admin-only item)
- `src/components/shell/page-states.tsx` (`ForbiddenState`)
- `tests/unit/api-contract.test.ts`
- `tests/e2e/assistant.spec.ts` (selects only the visible `main`)
- `PRODUCT.md` (capability line)
- `DESIGN.md` (components for saved conversations, AI monitoring, the turn ledger, JSON sections, the raw view, review and delete, and the forbidden state)

**Evidence:** `builder_docs/ai-traces-frontend-builder/responses/evidence-02b/*.png`

## Test data provenance

**Lane setup** (same as 02a):
- MySQL `acme-ai-traces-e2e-mysql` on 3326 (tmpfs), database `acme_ai_traces_e2e_test`, migrations 001 to 008;
- backend production build on 4226, with a fresh in-process `JWT_SIGNING_KEY` and no `OPENAI_API_KEY`.

**Real data:**
- Overview, list, filters, pagination, Scoped HR 403, review, stale review, and both MCP views run on real data.
- The deletion journey creates 2 real recorded turns through the conversation API. Each is a `MODEL_NOT_CONFIGURED` failure, since the lane has no model. The journey deletes the first turn.
- MCP rows come from real `tools/call` requests to `/api/v1/mcp`: a success, an invalid-arguments rejection, and an unknown tool.

**Seeded data.** The lane has no model, so `tests/e2e/support/seed-ai-traces.mts` writes the trace shapes a model would produce.
- **How it writes:** through the backend's own `createObservabilityRepository`, imported read-only, so it uses the same ordering checks, scrubbing, and size limits as the assistant.
- **Shapes seeded:**
  - no tool;
  - several tools, including a rejected call whose `password` argument is stored as `[REDACTED]`;
  - a tool failure;
  - a provider timeout after a tool;
  - a tool attempt left without an outcome, which becomes `OUTCOME_NOT_RECORDED`;
  - a result of about 200 KB.
- **Safety:** it refuses any database whose name does not end in `_test`.
- **Without the database URL:** these journeys are skipped with a reason.

**Labelled limitation:** the seeded shapes are repository-level evidence. They were not produced by a live model loop.

## Checks (from `next-frontend/`)

| Command | Result |
|---|---|
| `npm run api:check` | "Generated API contract is current." |
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. 15 files, **269 tests passed** (220 from 02a plus 49 new). |
| `npm run build` | Exit 0. Six new Admin routes. |
| `npm run test:e2e` (fresh lane database) | **119 passed, 9 skipped, 0 failed** in 5.0 min. |
| Impeccable `detect --json` on the changed UI | `[]` |

The `test:e2e` run used `E2E_API_BASE_URL=http://127.0.0.1:4226`, `E2E_DATABASE_URL`, and `E2E_MYSQL_CONTAINER`, against a freshly migrated and seeded lane database.

**The 20 AI-monitoring journeys** (desktop and mobile):
- Rail, then Overview sections, then the window switch, then a "failed" count opens the filtered list.
- Rohan sees no link, and 5 Admin URLs show only "Admin HR only", with no trace data.
- List filters live in the URL and survive a reload. Page size 100, pagination, and 3 invalid URLs are refused. No content appears in rows.
- **Several-tool trace:**
  - the exact ordered step headings;
  - `[REDACTED]` in the rejected arguments;
  - the formatted view has placeholders and salary values but no real names or codes;
  - the warning takes focus;
  - the raw view shows real identities, with the URL unchanged, no secrets, and empty storage;
  - after leaving and returning, the warning appears again.
- No-tool, tool-failed, timeout (the earlier tool step stays visible, then "Stopped here", then "Go to step"), and unrecorded-outcome turns are each told apart.
- A large result is collapsed, opens, and the page stays responsive.
- Review and stale review, using two contexts on desktop: the draft is kept, then "Replace with my review", and a reload shows the saved review.
- **Delete:**
  - confirm, then the deletion record, then a reload shows "Trace not found";
  - the next turn's "Previous turn" reads None (`ON DELETE SET NULL`);
  - the conversation shows the "Earlier messages … removed" marker.
- MCP list and detail: placeholders in the formatted view, and identities only after the warning.
- Keyboard tabs, plus 200% zoom (720 CSS px) on four routes, with no overflow and no serious axe findings.

**The 9 skips** are the suite's existing conditional skips: desktop-only or mobile-only journeys and the no-rate-file dashboard journey. They also include the two new desktop-only journeys here (the two-context review and 200% zoom), skipped in the mobile project.

**A first full run had 4 unrelated failures.** Two salary journeys and two dashboard journeys failed when the suite ran a second time on the same lane database. They depend on unadjusted, freshly seeded employees. On a recreated database, all of them pass. This is existing test-data coupling, not a regression: the only salary-code change in 02a and 02b is 8 generic entries in `REASON_MESSAGES`.

**Screenshots** (`evidence-02b/`):
- Overview, trace list, formatted trace, raw trace, MCP list, and delete confirmation, each at desktop and mobile size;
- `monitoring-zoom-200.png`.

## Limitations and deviations

- **Redaction gap (backend):** a first name or surname typed on its own in prose is not replaced in the formatted view. The UI does not try to fix this.
- **No mobile filter sheet:** the brief asked for apply-on-change on desktop and a sheet on mobile, as in the directory. The lists use one GET form with "Apply filters" at every width instead. It works without JavaScript and keeps focus behaviour through `#results`, but submitting it leaves empty keys in the URL until a chip or pagination link normalises them.
- **No stage or verdict filters:** the list has no failure-stage or review-verdict filter, so those Overview counts are not links, and the page says so.
- **Forbidden pages return HTTP 200** (see Security boundaries).
- **Cleanup:** the lane container, the backend on 4226, the preview server on 3226, and the Playwright servers were all stopped and removed. The temporary launcher in `/tmp` was deleted.

## Confirmations

- No Git commands, commits, or pushes.
- No `.env` read or created. No API key handled.
- No change to `express-backend/**` or `docs_human/**`. The seed script only imports backend modules.
- All database writes went to the isolated lane `*_test` database.
