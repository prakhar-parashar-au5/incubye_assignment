# AI traces frontend task 01: shape brief for saved conversations and observability

Status: planning only. No production code, generated contract, `PRODUCT.md`, or `DESIGN.md` was changed. No Git command was run and no `.env` file was read.

## 0. Inputs and method

Read: `handoff.md`, `docs_human/13-ai-observability.md` (the spec), `docs/24-parallel-worktree-and-ai-evaluation-plan.md`, AI builder tasks 03 and 04, AI builder response 02, `PRODUCT.md`, `DESIGN.md`, the current `/assistant` page, chat component, Server Action, `lib/assistant.ts`, app shell, page states, Playwright config, the current generated OpenAPI, and (read-only, as evidence of gaps) `express-backend/db/migrations/005_ai_observability.sql` and the observability repository.

Impeccable `shape` was used with `impeccable context`. No structured question tool exists in this session, so the discovery interview was replaced by the approved spec and task documents. Every choice the spec does not fix is marked **Decision** (made here, open to correction) or listed in section 15 as an OpenAPI question. Field names in this brief describe meaning only. None of them is a backend field name. The repository and migration were read to find gaps, not to borrow names: they are not the contract.

## 1. Job, audience, mode

- **Saved conversations (`/assistant`).** Admin HR and Scoped HR ask read-only compensation questions and come back to earlier conversations. Mode: Operate.
- **AI traces and MCP calls (`/admin/...`).** Admin HR, and developers signed in as Admin HR, reconstruct one assistant turn, judge it, and remove a trace when needed. Mode: Operate. This is an investigation ledger: ruled records and an ordered timeline. No metric cards and no charts.
- Users are desk-first, with phones supported. The product principles that matter most here are "Honest states" and "Nothing that is not real": every row and status comes from the backend, and a missing outcome is shown as missing, never inferred.

## 2. Selected direction

- **Visual authority:** the existing ACME world in `DESIGN.md`, unchanged: navy rail, warm off-white ground, Public Sans, one blue accent, ruled records, the access-record form, inline confirmation (never a modal), alerts that take focus, static skeletons paired with status text. No new design system and no JSON-viewer or chart library.
- **Signature for this feature: the turn ledger.** A trace detail page is one ordered list of ruled steps. Each step has a fixed left column (step number and kind) and a body (status words plus evidence). A failure is a ruled "Stopped here" step at the exact position where the turn ended, not a banner placed elsewhere. The header uses the access-record form already in the product: `Status | Started | Duration | Model`.
- **Colour extension (to be recorded in `DESIGN.md` during Task 02, not now):** trace and call states reuse the dot-plus-words pattern. Completed or Succeeded uses `state-current`. Failed uses `error-red`. Rejected uses `state-upcoming`, because it marks a consequence to weigh. In progress, or Outcome not recorded, uses `state-historical`. The words always appear next to the dot.

## 3. Route map

| Route | Who | Content |
|---|---|---|
| `/assistant` | Admin, Scoped | Recording notice, new-conversation composer, and the owner's conversation list (page 1, or `?page=N`). |
| `/assistant/[conversationId]` | Owner only | Recording notice, saved thread, composer that continues this conversation. Unknown or unowned ID: the standard 404 page. |
| `/admin/ai-traces` | Admin (backend-enforced) | Filterable, paginated trace ledger. Filters live in the URL. |
| `/admin/ai-traces/[traceId]` | Admin | Header record, formatted/raw view switch, turn ledger, review panel, delete panel. Unknown or deleted ID: 404. |
| `/admin/mcp-calls` | Admin | Paginated MCP call ledger. **Decision:** a frontend route name, separate from the trace pages. |
| `/admin/mcp-calls/[mcpCallId]` | Admin | MCP call header, arguments, validation, result, and error. No model or token fields. |

URLs carry only IDs, page numbers, and filter values. The formatted/raw choice is never in the URL (section 7.4).

**Navigation.** The rail gains two links, "AI traces" and "MCP calls", rendered only when the session says Admin HR. They are ordinary items after "Assistant", with `aria-current="page"` handling the same as today. This hiding is presentation only. A Scoped HR user who types the URL gets the forbidden state from the backend's 403. "HR Access — Coming later" stays as it is.

## 4. User journeys

1. **First visit (any HR user).** `/assistant` shows the notice, suggestions, and an empty composer. The user sends a message. The conversation is created, the URL becomes `/assistant/[id]` (replace, not push), and the user turn appears at once with a working status. The answer then appears with tool activity, cards, and limitations.
2. **Return.** The user opens `/assistant` and picks a conversation from the list. The thread loads from the server in sequence order, with cards re-checked against the current scope. The user continues it.
3. **Reload mid-answer.** The thread shows the user message with "Still working on this message" and a "Check again" link.
4. **Failed turn.** The user message stays. A failed-turn record states what failed in safe words. "Retry" sends the same text as a new turn (new key, new trace). The failed turn stays in the history.
5. **Lost response.** Next.js cannot confirm the send (network drop, or the action call failed). The turn shows "This message may not have been received" with "Send again", which reuses the same idempotency key. Section 5.5 covers this.
6. **Admin investigation.** The Admin filters `/admin/ai-traces` to Failed in the last 7 days, opens a row, and reads the header and the "Stopped here" step. They expand the tool arguments. They open the Raw JSON view after the warning, copy one section, and save a review of "Incorrect" with a note and a fixture nomination.
7. **Stale review.** Another Admin saved first. A 409 shows the other reviewer's current review beside the user's kept draft. The user must choose "Replace with my review" again.
8. **Delete.** The Admin opens the Delete panel, reads time, HR user, status, and the irreversible scope, then confirms. The page is replaced by a deletion record taken from the backend's success response. A reload then gives 404.
9. **MCP audit.** The Admin opens "MCP calls", filters or pages, and opens one call to see principal, tool, validation, execution, timing, and result.
10. **Scoped HR on an Admin URL.** The forbidden state appears, with no trace metadata.

## 5. Saved conversations

### 5.1 Layout

- **≥1280px:** a two-column main area. On the left is the conversation list (18rem, ruled list, its own heading "Your conversations", "Start a new conversation" button at the top). On the right is the thread (max 48rem) with the composer at the end of the flow, not fixed, matching today's page.
- **<1280px (including 200% zoom on a 1440 screen):** one column. `/assistant` shows the notice, the new-conversation composer, then "Your conversations". `/assistant/[id]` shows an "All conversations" link (to `/assistant`) above the heading, then the thread.
- Rail width plus a list column leaves too little room for the thread between 1024px and 1279px. That is why the split starts at 1280px.

### 5.2 Conversation list

- Server-paginated, 25 per page, newest first. On `/assistant` the list has "Newer" and "Older" page links (`?page=N`). The desktop list column on `/assistant/[id]` shows page 1 only, with an "Older conversations" link to `/assistant?page=2`.
- **Row label:** the conversation's preview text, if the backend provides one (Q-C2), then a muted line with start time (UTC, product format) and a message or turn count when provided. Without a preview, the label is "Conversation started 16 Nov 2026, 10:42 UTC". The frontend must not request each conversation's messages to build previews.
- The current conversation's row has `aria-current="page"` and the selected-row style. A row with no messages reads "No messages yet".
- **Empty:** "No saved conversations yet. Conversations are kept for 30 days."

### 5.3 Thread and ordering

- Messages are ordered strictly by the server's sequence, never by timestamps or arrival order. The thread is an `<ol aria-label="Conversation">`, as today.
- A user message keeps today's "You" block. An assistant message keeps today's `AssistantTurn`: plain-text answer, tool activity, cards with the "figures come from the directory tools" line, the withheld line, limitations, and the "Answered" time. This works only if the saved assistant message is returned in a shape that carries cards, tool activity, limitations, and generated time (Q-C4).
- **Scope on reload:** the existing `filterCardsToScope` defence runs in the Server Component against the **current** session scope. A Scoped HR user whose scope narrowed since the conversation was saved must not see out-of-scope rows from stored cards (Q-C5). The "Some results outside your access were not shown" line appears when rows are dropped.
- **Gaps:** an Admin delete or 30-day retention can remove turns. If the contract exposes message sequence numbers, a non-contiguous sequence renders a ruled muted marker: "Earlier messages in this conversation were removed." If it does not, no marker is shown. This depends on Q-C3.
- **Bounded history:** if the backend confirms that only recent turns go to the model (Q-C6), the composer hint adds: "The assistant considers your recent messages, not the whole conversation."

### 5.4 Turn states

| State | Source | Display |
|---|---|---|
| Sending (this tab) | Client, action in flight | The user block with "Sending…". A polite live status: "The assistant is working. This can take up to 45 seconds…". Send is disabled in this tab. |
| In progress (after reload) | Server says the turn's trace has not finished (Q-C3) | The user block plus the muted line "Still working on this message." "Check again" does a full reload. The composer stays enabled, because the backend allocates sequence numbers safely and a turn stuck in progress must not block the user. |
| Answered | Server | `AssistantTurn`. |
| Failed (recorded) | Server, failed turn with a safe category | A destructive alert in place: a title from the category map (5.6), one sentence of guidance, and "Retry". No assistant text. |
| Unconfirmed | Client, action threw or timed out before a result | A warning alert: "This message may not have been received." "Send again" (same key). |
| Rejected input | 400 | The composer field error. The draft is kept and no turn is added. |

### 5.5 Two retries, two words, two keys

- **"Send again" (same key).** Used only when the outcome is unknown. The browser keeps the pending submission's idempotency key and text in component memory. Resending the identical command returns the existing result or the current trace state. A 409 here means the content differs; the UI prevents that by sending the stored text, not the composer draft.
- **"Retry" (new key).** Used after a recorded failure. It sends the failed message's text as a new turn with a new key. The backend creates a new trace in the same conversation (and links it, Q-C7). The failed turn remains visible above it.
- **Key generation.** The client generates the key (`crypto.randomUUID()`) when the user presses Send or Retry, and passes it to the Server Action. The action validates format and length (Q-C8) and never invents a key on resubmission. Keys are never logged or stored outside memory.
- **Request shape.** The browser sends exactly `{ conversation reference or none, one message text, idempotency key }`. The old `askAssistant(history)` path and `conversationWindow` are removed from the authoritative flow, and the browser never sends earlier messages.
- **First message.** Creating the conversation and sending its first message are two backend calls inside one Server Action, unless the backend offers a combined or idempotent create (Q-C1). With two calls, an unconfirmed first send can leave an empty conversation behind on "Send again". The list shows it as "No messages yet". This is acceptable, but it is listed in Q-C1.

### 5.6 Error copy for the assistant

The existing `ERROR_TEXT` entries are kept and these are added or adjusted:

- 404 on a conversation: the standard not-found page, worded "This conversation does not exist or is not yours." The page must not reveal which of the two is true.
- 409 idempotency conflict: "This message conflicts with an earlier send. Reload the conversation to see what was recorded."
- 503 assistant unavailable (persistence or dependency): "The assistant is unavailable. Nothing was answered. The employee directory still works."
- 502 provider failed: "The language model did not answer. Your message was saved; select Retry to try again."
- 429: the existing copy, plus "Try again after {time}" only if the backend sends a retry time (Q-C9). The draft is kept.

### 5.7 Recording notice

The notice replaces today's "Synthetic data assistant" panel with one info panel (accent wash, `FlaskConical` icon) headed "Recorded for quality review". Its body is the spec text **verbatim**:

> Assistant conversations and tool results are recorded for 30 days for quality review. This demo uses synthetic employee data. Do not enter passwords, tokens, or real personal information.

A second paragraph keeps the existing read-only, scope, and model-written sentence. The panel sits above the suggestions on `/assistant` and above the thread on `/assistant/[id]`. It is always visible in full: not dismissible, not collapsed, not a tooltip. It is the first content after the page heading, so it is read before the first message.

### 5.8 Page states

- **Loading:** a static skeleton of the list and two thread blocks with "Loading conversation…" status text.
- **Session expired:** the existing "Sign in again" flow.
- **Backend down:** `ServiceUnavailable`.
- **Unreadable response:** `UnexpectedResponse`. Nothing is shown from the failing response.

## 6. Admin trace list (`/admin/ai-traces`)

### 6.1 Hierarchy

1. Heading "AI traces", with the subline "Recorded assistant turns from the last 30 days. Synthetic data."
2. Filter bar.
3. Results line: "{n} traces · page {p} of {P}" (or "Showing 26–50" if no total is returned, Q-T3). This line is the focus target after filter or page changes.
4. Ledger.
5. Pagination and page size (25, 50, 100, same control as the directory).

### 6.2 Columns and rows

Order: Started (UTC) · HR user · Status · Model · Tools · Duration · Tokens · Calls · Error.

- **Started** is the row link to detail. Its accessible name is "Trace started {time} by {HR user}, {status}".
- **HR user:** a display name (Q-T1). A bare numeric user ID is not an acceptable display.
- **Status:** dot plus Completed, Failed, or In progress.
- **Tools:** the distinct tool names in first-use order, comma-separated, wrapping. "None" in muted text when there are zero.
- **Duration:** "1.42 s", or "—" while in progress.
- **Tokens:** "in 1,204 · out 310 · reasoning 96". Reasoning is shown only as a count.
- **Calls:** "2 model · 3 tool".
- **Error:** the failure-stage label (7.5) above the error category code in muted text. Empty when the trace completed.

The list never shows prompts, answers, arguments, or results, and must not ask the backend for them.

The desktop table follows the directory's rules: 13px body, hairline rows, horizontal scroll inside a focusable region labelled "AI traces table" below 1440px, and no page-level horizontal scroll. Below 1024px each trace becomes one ruled list item: line 1 is time link and status, line 2 is HR user and model, line 3 is tools, line 4 is duration, tokens, and calls, line 5 is the error when present.

### 6.3 Filters (all server-side, all in the URL)

- **Fields:** date from, date to (UTC dates, native `<input type="date">`, Q-T4); HR user (select, Q-T2); status (select: All, Completed, Failed, In progress); model (select, Q-T2); tool (select, Q-T2); error category (select, Q-T2).
- **Frontend URL keys (Decision, frontend-owned, mapped to backend query names after Checkpoint B):** `from`, `to`, `user`, `status`, `model`, `tool`, `error`, `page`, `pageSize`. Changing a filter resets `page`.
- **Desktop:** apply on change, plus removable chips and "Clear all", matching the directory. **Mobile:** a filter sheet with "Apply", matching the directory.
- **Invalid filters** (400, or values the page itself rejects such as `to` before `from` or a page size over 100): no rows are shown. An inline destructive alert says "These filters could not be applied." with a "Clear filters" link. Focus moves to the alert.
- **Filter options unavailable** (if they come from a separate call): the ledger still loads. Each affected select is replaced by the text "Filter unavailable", with an info line under the filter bar. This is the "partial error" state for the list.

### 6.4 States

- **Loading:** a static skeleton of 8 ruled rows plus "Loading traces…". The skeleton has no status dots and no numbers, so it cannot pass for evidence.
- **Empty (no filters):** "No assistant traces have been recorded in the last 30 days."
- **Empty (filtered):** "No traces match these filters." plus "Clear all".
- **Forbidden:** `ForbiddenState`, a new shared page state: "Admin HR only. Your HR role cannot view AI traces." No rail change is needed, because the links are already hidden.
- **Backend down:** `ServiceUnavailable`.
- **Unreadable:** `UnexpectedResponse`.

## 7. Trace detail (`/admin/ai-traces/[traceId]`)

### 7.1 Hierarchy

1. A back link "AI traces" that returns to the list, keeping the filters if they are in the referrer's URL (passed as a validated `back` query of known keys only, otherwise plain `/admin/ai-traces`).
2. Heading "Trace {short id}". The full ID is in a copyable muted line.
3. **Header record (access-record form):** `Status | Started | Duration | Model`. Then a second ruled line: `HR user | Conversation turn {n} | Model calls | Tool calls | Tokens in · out · reasoning`. Then a third: `Prompt version {v} · hash {first 12 chars}`, request ID, and previous trace as a link when present and readable (Q-T7).
4. **Failure summary,** only when failed: one destructive line, "Stopped at {stage label}: {category}", with a "Go to step {k}" in-page link. The fragment is `#step-k`, which is a sequence number only.
5. View switch: Formatted | Raw JSON (7.4).
6. The turn ledger.
7. Review panel, then Delete panel.

At ≥1280px, items 7 sit in a 22rem right column that is sticky to the viewport top, so a reviewer can read and judge side by side. Below 1280px they follow the ledger, and the header has a "Go to review" link.

### 7.2 Turn ledger: step model

The ledger is an `<ol aria-label="Turn timeline">`. Each `<li id="step-k">` starts with a heading (h3): "Step {k} of {N}: {kind}{, name} — {status words}".

Steps are built from server sequence numbers only: trace → model calls by sequence → each model call's tool calls by sequence → final response. The frontend never reorders by timestamp.

| Step kind | Shown in Formatted view |
|---|---|
| User prompt | The exact user text (plain text, `pre-wrap`). |
| Model call {i} | Status; latency; tokens in, out, total, and reasoning count; provider request ID. "Input sent to the model" ({m} messages, collapsed JSON section). "Tools offered" (names inline; schemas in a collapsed section). "Output" (text when present, plain). Failure category and safe error when failed. |
| Tool decision | Nested under its model call: the list of requested tool names with provider tool-call IDs. Hidden when the model requested none, and replaced by the muted line "No tool requested". |
| Tool call {j}: {name} | Validation status and execution status, as separate words. Duration. "Requested arguments" (collapsed JSON). Validation errors when rejected. Then a result: the result (formatted, redacted, 7.3) for Succeeded; "Not executed: rejected by validation" for Rejected; error category and safe error for Failed; "Outcome not recorded. The assistant stopped here." for an attempt left without an outcome. |
| Final response | The final assistant text, plain. Absent on failed turns. A failed trace never shows a fabricated answer. |
| Stopped here | Present only on failure, at the point where the turn ended: stage label, category, safe details. |
| Totals | Duration, tokens, call counts repeated as a closing ruled line, so totals sit next to the evidence. |

A no-tool turn renders model calls with "No tool requested" and no tool steps. The ledger must not assume every model call has a child.

Requested arguments and validated arguments are both listed in the task. The spec stores requested arguments and validation status or errors only. A distinct "validated arguments" value is shown only if the backend returns one (Q-T8). Otherwise the step shows requested arguments plus validation outcome.

**Hidden reasoning:** never shown, and no placeholder is rendered for it. The reasoning-token count carries the inline gloss "count only; reasoning content is not recorded".

### 7.3 Formatted view and redaction

- Redaction is the **backend's** formatted view (task 04). The frontend renders what it receives and does not attempt its own identity redaction of raw data. The frontend also never switches to raw data to "fill in" redacted fields.
- How redacted identities look depends on Q-T5. Preferred: stable per-trace placeholders (for example "Employee A") so a reviewer can follow one person across steps. Fallback: the fixed marker. Either way, a muted line above the first tool result reads "Employee names and codes are hidden in this view. Salary values are shown."
- Tool results are displayed by Q-T6. If the formatted response gives typed values (money with currency), money uses the product money format (currency code always, Indian grouping for INR, tabular figures). If it gives generic JSON, the result is shown in the JSON section component with no inference of currency from bare numbers.
- Model input messages: a ruled list of role and text, collapsed beyond the first two messages, with "Show all {m} messages".

### 7.4 Raw JSON view behind the warning

- The view switch is a two-tab WAI-ARIA tablist with manual activation (same pattern as the dashboard breakdown tabs, but tabs are buttons, not links, because the view choice must not enter the URL).
- Selecting "Raw JSON" first shows a warning panel (warning wash) that takes focus. The heading is "Raw trace data". The body is the spec text verbatim:

  > Raw trace data contains complete synthetic employee identities and compensation values.

  The buttons are "Show raw trace data" (primary) and "Back to formatted" (outline). If the backend supplies its own warning metadata in the raw response (task 04), that text is shown, and the page must not contradict it (Q-T9).
- Only after "Show raw trace data" does the page call a Server Action that fetches the raw view through the explicit backend view parameter. The result lives in React state of that client component only. It is cleared on tab switch back, on route hide (same `useLayoutEffect` cleanup pattern as today's chat), and on navigation. It is never put in the URL, in `localStorage`, `sessionStorage`, IndexedDB, cookies, the router cache, or a console call. Each new page visit asks again.
- **Decision:** the warning is acknowledged per page visit, not remembered.
- Raw content is laid out as the same ordered steps, each with one JSON section per stored JSON value. A step does not mix in formatted content.
- If raw content fails to load or render (non-JSON, too large to render, Server Action error), a destructive inline alert says "Raw trace data could not be displayed." with "Back to formatted". The formatted view is untouched and still works.

### 7.5 Failure-stage labels (fixed by the spec)

| Stage | Group word | Label |
|---|---|---|
| TRACE_CREATE | Recording | Recording failed before the model was called |
| MODEL_CALL | Model | Model call failed |
| MODEL_TRACE_WRITE | Recording | Recording the model result failed |
| TOOL_VALIDATION | Validation | Tool request failed validation |
| TOOL_EXECUTION | Tool | Tool failed while running |
| TOOL_TRACE_WRITE | Recording | Recording the tool result failed |
| FINAL_TRACE_WRITE | Recording | Recording the final answer failed |

The group word is printed before the label ("Recording · Recording the tool result failed"), so the four kinds of failure can be told apart without colour. A provider timeout is a MODEL_CALL failure whose category is shown verbatim. Friendly category words wait for an enumerated list (Q-T10). An unknown stage or category value is printed verbatim and never hidden.

A rejected tool call inside a completed trace is not a trace failure. It shows "Rejected" on its step, and the trace header still says "Completed".

### 7.6 JSON section component (shared by formatted, raw, and MCP)

- It is a `<details>` (collapsed by default when the value is over about 2 KB or 40 lines; small values are open). The summary shows the name plus size, for example "Requested arguments · 1.8 KB · 42 lines".
- `JSON.stringify(value, null, 2)` is computed only when the section opens, and rendered as text inside `<pre><code>`, never as HTML and never as a DOM tree of nodes. One text node keeps a 256 KB result responsive.
- The open content sits in a scroll region with a max height of about 32rem and its own horizontal scroll. The region has `tabindex="0"`, `role="region"`, and `aria-label="{name} JSON"`. The page never scrolls sideways.
- "Copy JSON" is an explicit button per section, using `navigator.clipboard.writeText`, with a polite status "Copied" or "Copy failed". There is no automatic copy and no copy-all for the whole trace.
- "Expand all" and "Collapse all" apply per step, not per page, so a single click cannot render several megabytes at once.

### 7.7 Not found and deleted

`notFound()` renders the standard not-found page: "This trace does not exist or was deleted." with a link to AI traces. Its wording is the same whichever case is true.

## 8. Review

- The panel heading is "Review".
- **Current review** (if any) is a ruled record from server state, in the third person: "Partially correct · reviewed by Meera Iyer · updated 16 Nov 2026, 11:05 UTC". The note is plain text, and "Nominated as an evaluation-fixture candidate" appears when nominated. Reviewer display name: Q-R2.
- **Form:**
  - Verdict as a radio group with a visible legend "Verdict": Correct, Partially correct, Incorrect (values CORRECT, PARTIAL, INCORRECT).
  - "Note (optional)" textarea with a live counter "{n} of 2,000 characters" that turns into the field error over 2,000. The send button is disabled over the limit, and the backend validates too.
  - A checkbox "Nominate as an evaluation-fixture candidate", described by: "A developer still inspects and redacts it by hand. Nothing is copied automatically."
  - The button reads "Save review", or "Replace review" when one exists.
- The Server Action sends the expected review version from the loaded detail (Q-R1). On success the panel refreshes from the server and a success alert "Review saved." takes focus. The alert states the saved verdict from the response, not from the form.
- **Stale (409):** a warning alert takes focus: "Another review was saved while you were editing." It shows the current server review (refetched, Q-R3) with the user's verdict and note kept in the form. The button changes to "Replace with my review", which sends the new version. Nothing is saved automatically. This follows the salary "superseded result" pattern.
- **Trace deleted while reviewing (404):** a destructive alert "This trace was deleted. The review was not saved." and a link to the list.
- **Review of an in-progress trace:** Q-R4. Until that is answered, the form is shown but disabled with the line "Reviews open when the turn finishes."

## 9. Deletion

- The Delete panel contains one outline-destructive button "Delete this trace…". It opens an inline confirmation in place (no modal), and the question takes focus: "Delete this trace permanently?"
- The confirmation shows a ruled record of trace start time, HR user, and status (all from server state). The consequence text reads: "This removes this turn's user message and answer, its {m} model calls and {t} tool calls, and its review. Other turns in this conversation are kept. This cannot be undone." The text is generic if counts are unavailable.
- The buttons are "Delete trace" (destructive) and "Back" (focus returns to the opening button). The Server Action sends the backend's explicit confirmation data (Q-D1).
- **Success** is the backend's 2xx. The whole detail content is replaced with a success record that takes focus: "Trace deleted. Started {time} by {HR user}." with a link "Back to AI traces". The record uses values held from the loaded detail, and is shown only because the backend confirmed it. Nothing is placed in a URL such as `?deleted=1`, and the list page never claims a deletion happened.
- **404 on delete:** "This trace was already deleted or does not exist." with no other changes.
- **403:** the forbidden state.
- **Other failure:** a destructive alert; the trace remains shown.

## 10. MCP observability

- The MCP pages are separate pages under their own rail item. Their subline reads: "Calls from MCP clients. These calls do not use the language model, so they have no model calls, tokens, or reviews."
- **List columns:** Started (UTC, row link) · Principal (HR user or approved client principal, Q-M1) · Tool · Validation · Execution · Duration · Error category. Mobile uses ruled items. Pagination is 25/50/100 if supported (Q-M2). Filters are added only for parameters the backend publishes (Q-M2). If it publishes none, the page shows none rather than filtering on the client.
- **Detail:** a header record `Execution | Started | Duration | Tool`, then `Principal | Request ID | Validation`. Then three JSON sections: Requested arguments, Validation result, Result. Then the error (category plus safe details).
- **Identity display (Q-M3):** if the backend offers a redacted formatted MCP view plus a warned raw view, the pages use the same pattern as traces. If the backend returns complete results only, the Result section stays behind the same synthetic-data warning and button before it is fetched or rendered. The page never shows unredacted identities without the warning.
- There are no model, token, or review fields, and no link to an AI trace.

## 11. Component and state model

| Unit | Kind | Owns | Notes |
|---|---|---|---|
| `AssistantPage`, `ConversationPage` | Server Components, dynamic per request | Session, conversation list page, thread fetch, scope re-filter | Never cached across users. Before coding, check the installed Next 16.4.6 docs for Cache Components behaviour on per-user data. |
| `ConversationList` | Server | Ruled list, pagination links | — |
| `ConversationThread` | Client | Optimistic user turn, pending, unconfirmed, retry state, idempotency key in memory | Initial turns come from server props. After success it calls `router.refresh()` so the thread becomes server truth. |
| `RecordingNotice` | Server | Verbatim notice | One source string, tested for exact text. |
| `sendConversationMessage` | Server Action | Validates `{conversationId?, text, key}`, creates the conversation if needed, posts the message, maps errors | Uses the cookie token only. Returns the conversation ID and outcome, with no token. |
| `TraceListPage` | Server | URL parse and validation, backend query, ledger | Parse failures render the invalid-filters state without calling the backend. |
| `TraceFilters` | Client | Desktop apply-on-change, mobile sheet | Reuses the `NativeSelect`, chips, and sheet from the directory. |
| `TraceDetailPage` | Server | Formatted detail fetch, header, ledger | — |
| `TraceViewSwitch` | Client | Tabs, warning acknowledgement, raw fetch through a Server Action, raw state cleared on hide | — |
| `TurnLedger`, `LedgerStep` | Server-renderable | Ordered steps from sequence numbers | Pure functions of contract data, so they can be unit-tested. |
| `JsonSection` | Client | Lazy stringify, collapse, copy | No library. |
| `ReviewPanel` | Client + Server Action `saveTraceReview` | Form, version, 409 flow | — |
| `DeletePanel` | Client + Server Action `deleteTrace` | Inline confirmation, success replacement | — |
| `McpListPage`, `McpDetailPage` | Server (+ `JsonSection`, warning) | — | — |
| `ForbiddenState` | Server | New shared page state in `page-states.tsx` | Check the installed Next docs for `forbidden()` support, so the page can return HTTP 403. Otherwise it renders with the default status, and the backend 403 stays the authority. |

All response types come from regenerated OpenAPI types and runtime validators. A response that fails validation renders `UnexpectedResponse`, and no field is cast into existence.

## 12. Desktop and mobile

| Width | Assistant | Trace list | Trace detail | MCP |
|---|---|---|---|---|
| ≥1440 | List column + thread | Full table | Ledger + sticky 22rem aside | Full table |
| 1280–1439 | List column + thread | Table in its own scroll region | Ledger + aside | Table in region |
| 1024–1279 | One column | Table in region | Stacked; review after ledger | Table in region |
| <1024 (phones, 200% zoom) | One column, mobile shell | Ruled list items, filter sheet | Stacked; header record lines become label/value rows | Ruled items |

- Touch targets are at least 40px tall on phones (inputs are already 40px; buttons on phones use the 40px size).
- Long IDs, hashes, tool names, and category codes use `overflow-wrap: anywhere`.
- No page-level horizontal overflow at 320px, 390px, 1024px, 1440px, or 1440px at 200% zoom.

## 13. Accessibility and focus

- **Semantics:** the thread and turn ledger are ordered lists. Each ledger step has a heading with its sequence ("Step 3 of 9"), kind, name, and status words. Status dots are `aria-hidden`, and the words always carry the status. The trace list table has a caption "AI traces, newest first" and uses `<th scope="col">`.
- **Live regions:** a polite status for assistant working, copy result, and results count after filters. Alerts that appear after an action take focus, per `DESIGN.md`.
- **Focus targets:**

  | After | Focus goes to |
  |---|---|
  | Filter applied or cleared (desktop) | Results line |
  | Mobile sheet "Apply" | Results line; sheet closes and its trigger is not refocused |
  | Pagination | Results line |
  | Invalid filters | The invalid-filters alert |
  | First message sent | Stays on the composer. The working status announces progress, and when the answer arrives the composer keeps focus. "Answer received" is announced politely. |
  | Raw JSON tab selected | Warning heading |
  | "Show raw trace data" | Raw view heading ("Raw trace data, step 1 of N") |
  | "Back to formatted" / raw display error | Formatted tab, or the error alert |
  | Review saved / stale / deleted-trace | The respective alert |
  | Delete opened / Back | The question / the "Delete this trace…" button |
  | Delete succeeded | The deletion record heading |
  | "Go to step k" / "Go to review" | The target heading (`tabindex="-1"`) |

- **JSON regions:** focusable, labelled, and scrollable with the keyboard. "Copy JSON" has the accessible name "Copy {section name} JSON".
- **Keyboard:** everything is reachable by Tab. The tabs use arrow keys with manual activation. `<details>` toggles with Enter or Space. In the composer, Enter sends and Shift+Enter adds a new line (unchanged).
- **Skeletons:** static, `aria-hidden`, with no dots or digits, always paired with a status text that names what is loading.
- **Reduced motion:** there are no animations other than the existing 150ms colour transitions.
- **Axe:** no serious or critical findings on all six routes in their loaded, empty, forbidden, raw-warning, raw-open, review-stale, and delete-confirm states.

## 14. Data-handling rules for implementation

- Model text, user text, notes, and JSON render as React text only. There is no `dangerouslySetInnerHTML` and no Markdown.
- Server Actions are untrusted entry points. Each one authenticates through the server cookie, validates every argument (IDs as opaque strings within length limits, enum verdicts, note ≤ 2,000, key format, page and limit bounds), and treats the backend's 401, 403, and 404 as the authority.
- No `console.*` calls in these modules. `error.tsx` boundaries show generic copy and never render `error.message`. No analytics or third-party scripts are added.
- No trace content, prompt, note, preview, or key goes into URLs, storage, cookies, or `metadata` titles. Page titles are "AI trace" and "Conversation" with no content.
- Admin pages emit `robots: noindex`.

## 15. Backend and OpenAPI questions

Each question names the meaning the UI needs. The backend owner chooses the names. The frontend does not build any affected element until the answer is in the Checkpoint B OpenAPI.

### Conversations

- **Q-C1. First message.** Does `POST /assistant/conversations` accept an idempotency key, or can the message endpoint create a conversation? If neither, confirm that an empty conversation left by an unconfirmed first send is acceptable.
- **Q-C2. List summary.** What does each conversation summary contain? The UI needs ID, created time, last-activity time, a short preview (server-truncated first user message, or a title), and message or turn count. Which field orders the list: created time (the current repository orders by `created_at`) or last activity? Last activity is the recommendation. What pagination parameters are used, and is a total count returned?
- **Q-C3. Thread messages.** For each message, which of these are returned: ID, sequence number, role, created time, owning turn or trace reference, and the turn's state (in progress, completed, or failed with a safe category)? Without turn state, the UI cannot show "Still working", a recorded failure, or Retry after reload. Are messages paginated for long conversations?
- **Q-C4. Saved assistant content.** Is a saved assistant message returned in the same structure as today's assistant response (answer, tool activity with statuses, cards, limitations, generated time), so the existing `AssistantTurn` and card components render it unchanged? If the structure differs, what is it?
- **Q-C5. Scope on read.** When a Scoped HR user's scope narrows, does the conversation read endpoint re-scope stored cards, or return them as stored? The frontend re-filters either way as a second defence. The answer affects whether the UI says "Some results outside your access were not shown" for reasons that are not errors.
- **Q-C6. History bound.** What is the bounded history policy (for example, the last N complete turns)? Should it be published so the UI can say which turns the model considers?
- **Q-C7. Retry link.** Does a user-selected Retry tell the backend that it retries a specific failed turn, or is the link implicit through "previous trace"? If explicit, what does the request carry?
- **Q-C8. Idempotency key.** Is the key sent as a header or a body field? What format and maximum length apply (the migration allows 100 ASCII characters)? Is a UUID v4 acceptable?
- **Q-C9. Rate limit.** Does the 429 response include a retry time?
- **Q-C10. Message response.** What does the message endpoint return on success, failure (502, 503), and replay of the same command while the original is still running? The UI needs the conversation ID, the new turn's state, and either the assistant content or the safe failure category.
- **Q-C11. Old endpoint.** When is `POST /api/v1/assistant/messages` removed? The frontend stops calling it in Task 02 either way.

### Trace list

- **Q-T1. HR user display.** Does each list row (and the detail) include the HR user's display name, or only an ID? The UI needs a name. An ID-only response needs a documented, Admin-only lookup.
- **Q-T2. Filter options.** Where do the choices for HR user, model, tool name, and error category come from? An options endpoint is preferred. Free-text model or tool inputs are the fallback, and only if exact-match filtering is documented.
- **Q-T3. Pagination.** Is pagination offset or cursor, what are the parameter names, and is a total count returned? Is page size an explicit parameter with max 100, and what happens over 100 (400 or clamp)?
- **Q-T4. Date filters.** Are dates UTC calendar dates or timestamps? Are both ends inclusive? Is the filter applied to start time?
- **Q-T11. Status filter.** Can the list filter on "in progress" (STARTED) traces as well as COMPLETED and FAILED?

### Trace detail

- **Q-T5. Redaction form.** How do redacted names and codes appear in the formatted view: the fixed `[REDACTED]` marker, or stable per-trace placeholders? Which JSON paths are redacted? Are names in model input or output text redacted, or only tool results, as the spec says?
- **Q-T6. Formatted tool results.** Are formatted tool results typed per tool (for example, money with currency), or generic JSON with identities replaced?
- **Q-T7. Navigation fields.** Does the detail include conversation ID, turn sequence, previous trace ID, and the next trace ID if one exists?
- **Q-T8. Validated arguments.** Is there a validated or normalized argument value distinct from the requested arguments? The spec stores requested arguments and validation errors only.
- **Q-T9. Raw view.** What is the view parameter's name and values? What warning metadata does the raw response carry? Is the raw response the same step structure with full JSON, or one document?
- **Q-T10. Enumerations.** Is there a published, closed list of model-call statuses, tool validation statuses, tool execution statuses (including a status for an attempt with no recorded outcome), failure stages, and error categories? Is the model-call failure category a separate field from the trace error category?
- **Q-T12. Sequence numbers.** Are model-call and tool-call sequence numbers both trace-wide (the spec says "unique tool-call sequence within a trace"), and does every tool call include its parent model-call reference?
- **Q-T13. Size.** What is the maximum total detail payload? What controlled error does the UI receive if a stored value cannot be returned?

### Review

- **Q-R1. Version.** What is the review version's name and type? Is it present on the trace detail (null when no review exists)? What value does the first review send?
- **Q-R2. Reviewer.** Is the reviewer's display name returned, with the created and updated times?
- **Q-R3. Stale response.** Is the stale response 409 `CONFLICT` or the existing `STALE_VERSION` code, and does its body include the current review? If not, the UI refetches detail.
- **Q-R4. In-progress traces.** Can a STARTED trace be reviewed?
- **Q-R5. Review response.** What does a successful review POST return: the saved review with its new version?

### Deletion

- **Q-D1. Confirmation data.** What exact confirmation data does `DELETE` require (for example, echoing the trace ID, or a boolean flag), and where does it go? Some proxies drop request bodies on `DELETE`.
- **Q-D2. Delete response.** What does a successful delete return (204, or a summary of removed counts)? Should the consequence text use counts from the detail or from a delete preview?

### MCP

- **Q-M1. Principal.** How is the principal represented: HR user (with display name) or approved client principal (with what label)?
- **Q-M2. MCP list.** What filters, sort, and pagination does it support? The UI assumes newest first, 25 default, 100 max, unless stated otherwise.
- **Q-M3. MCP redaction.** Does MCP detail have a formatted (redacted) view and a raw view, like traces? If not, does the backend agree that the frontend gates the complete result behind the synthetic-data warning?

### Test setup

- **Q-E1. Deterministic model.** Can the backend lane at port 4223 run with a scripted, non-OpenAI model adapter selected by process configuration (never by an API request)? It would be used to produce no-tool, one-tool, multi-tool, rejected (including arguments with a `password` key), tool-failed, and provider-timeout turns. If not, does the backend provide a fixture seed that writes these trace shapes through the repository into `acme_ai_ui_test`?
- **Q-E2. Persistence failure.** How can a persistence-failure trace (for example, TOOL_TRACE_WRITE) exist for display? Persistence failed, so the trace may be partial or absent. Is it a seeded fixture, or covered only by the frontend fake backend (allowed by Task 02)?

## 16. Browser test journeys

The lane uses frontend 3223, backend 4223, MySQL 3323, and database `acme_ai_ui_test`. Production builds only. Projects are desktop (1440×900) and mobile (390×844, touch). **Real** means the real backend with either the deterministic model (Q-E1) or seeded traces. **Fake** means the existing test-only fake backend pattern, used only where Task 02 allows it (provider timeout, persistence failure) and labelled as such in the report.

| # | Journey | Backend | Checks |
|---|---|---|---|
| B1 | Scoped HR first conversation | Real | Notice text is exact and appears before the first message. Send moves the URL to `/assistant/[id]` with ID only. Answer, cards, and limitations appear. The request carries one message and no history (assert the Server Action payload). |
| B2 | Reload and continue | Real | Reload shows the same messages in the same order. A second turn appends. The list shows the conversation. |
| B3 | New conversation | Real | "Start a new conversation" gives an empty thread. The list shows two conversations, newest first. |
| B4 | Admin saved conversations | Real | The same flow as Admin. Admin sees only their own conversations in `/assistant`. |
| B5 | Cross-user conversation | Real | Rohan opens Meera's conversation URL and gets the 404 page with no content. An unknown UUID gives an identical page. |
| B6 | Failed turn and Retry | Fake (provider failure) | The failed turn shows a safe alert and no assistant text. Retry sends a new key. The failed turn stays and a new turn is answered. |
| B7 | Unconfirmed send | Fake (drop the first response) | "Send again" reuses the same key. One trace results. |
| B8 | Rate limit | Fake | The 429 copy appears and the draft is kept. |
| B9 | Read-only refusal | Real | A mutation request ("raise Sneha's salary by 10%") is refused, and the UI states it is read-only. |
| T1 | Trace list default | Real | Newest first, 25 rows, every column present, no prompt or result text in the DOM (assert the known prompt strings are absent). |
| T2 | Filters and URL | Real | Each filter changes the URL and the results. Reload keeps them. Clear all resets. Page 2 and page size 100 work. Focus lands on the results line. |
| T3 | Invalid filters | Real | `?pageSize=500` and `to<from` show the invalid-filters alert with focus. |
| T4 | Scoped 403 | Real | Rohan sees no rail links, and the direct URLs of the list, a detail, MCP, and the review and delete Server Actions all give the forbidden state or a refusal, with no metadata. |
| T5 | No-tool trace | Real | Model calls show "No tool requested" and there are no tool steps. Totals match the header. |
| T6 | Multi-tool trace | Real | Every model and tool call appears once, in order. Step headings carry the sequence. Counts match. |
| T7 | Rejected tool | Real | "Rejected", "Not executed", validation errors, and requested arguments are shown. The `password`-keyed argument shows `[REDACTED]`. The trace header says Completed if the turn completed. |
| T8 | Tool failed | Real | "Tool failed while running", the category, and safe error. No stack text. |
| T9 | Provider timeout after a tool | Real (deterministic) or Fake | Earlier steps are visible. "Stopped here: Model call failed" is at the exact position. "Go to step" moves focus. |
| T10 | Persistence failure | Fake | "Recording · …" label. "Outcome not recorded" step. No final answer. |
| T11 | Formatted redaction | Real | Known seeded employee names and codes are absent from the formatted DOM. Salary values are present. The redaction note is shown. |
| T12 | Raw warning and view | Real | The warning text is exact and takes focus. Before "Show", known names are not in the DOM. After "Show", they are present. The URL is unchanged. `localStorage`, `sessionStorage`, and IndexedDB contain no trace text. Navigating away and back requires the warning again. |
| T13 | Large JSON | Real (seeded near the 256 KB result limit) | Sections are collapsed with size labels. Expanding one keeps the main thread responsive (an input typed during expansion still registers within 1 s). No page-level horizontal scroll. "Copy JSON" copies only that section. |
| T14 | Review | Real | Save Partially correct with a note and nomination. The record shows the reviewer and time. Reload persists it. A note over 2,000 characters is blocked. |
| T15 | Stale review | Real (two browser contexts) | Context A loads, B saves, A saves and gets the stale alert with B's review and A's draft kept. "Replace with my review" succeeds. |
| T16 | Delete | Real (a disposable trace created in this run) | Confirmation shows time, HR user, status, and scope. Back returns focus. Delete shows the record. Reload gives 404. The neighbouring turn in the same conversation is still readable from `/assistant/[id]` and from its trace detail. |
| M1 | MCP list and detail | Real (MCP calls made by the test against the backend MCP endpoint) | A separate page. No model or token fields. Rejected and succeeded calls render. The result gating follows Q-M3. |
| A1 | Mobile | Both projects | All six routes at 390px have no page-level horizontal overflow. The filter sheet traps focus and Escape closes it. Ruled list items are used. |
| A2 | Zoom | Desktop at 200% (720 CSS px) | Mobile layouts, no overflow, all controls reachable. |
| A3 | Keyboard | Desktop | Complete T2, T12, T14, and T16 without the mouse. Every focus target in section 13 is asserted. |
| A4 | Axe | Both | No serious or critical findings in every state listed in section 13. |
| S1 | Secret absence | Real | Across the HTML, raw view text, URLs, storage, and captured console messages of every journey: no match for `Bearer `, `sk-`, a JWT shape (`eyJ…\.…\.`), `mysql://`, `Set-Cookie`, or `authorization` with a value. Only pattern matches are used. The test never reads, prints, or compares actual credential values. No network request goes to any origin other than the Next server. |

## 17. Assumptions and exclusions

**Assumptions (correct any of these):**

1. Conversation and trace lists show times in UTC with a "UTC" label, matching existing pages.
2. `/assistant` does not open the last conversation automatically. Returning users choose one from the list.
3. Raw-view acknowledgement lasts for one page visit only.
4. MCP gets its own rail item and routes (`/admin/mcp-calls`), not a tab inside AI traces.
5. Review and delete sit in a sticky right column at ≥1280px.
6. Admin HR cannot open another user's conversation through `/assistant`. The trace detail is the only Admin view of others' turns.
7. Unknown enum values are displayed verbatim rather than hidden or mapped to a guess.

**Excluded:**

- Charts, aggregate metrics, or dashboards of traces.
- Automatic polling of in-progress turns.
- Editing of trace content.
- Bulk delete.
- A retention-cleanup UI (the cleanup is a command-line tool).
- Exporting fixtures.
- An LLM-judge UI.
- Showing hidden or encrypted reasoning.
- Client-side redaction.
- Client-side filtering or sorting of trace pages.
- Any change to backend code, the OpenAPI, `PRODUCT.md`, or `DESIGN.md` in this task.

**Recorded for Task 02 (not done here):** the `DESIGN.md` additions for the turn ledger, trace and call state colours, the JSON section, and `ForbiddenState`. The `PRODUCT.md` capability line for saved conversations and AI observability.
