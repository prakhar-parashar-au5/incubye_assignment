# AI traces frontend task 01: shape saved conversations and observability

## Status

READY

Planning only. Do not write production frontend code.

## Goal

Create an implementation-ready UX brief for:

1. Saved assistant conversations for Admin and Scoped HR.
2. Admin AI trace list and detail.
3. Admin MCP call list and detail.
4. Trace review and controlled deletion.

## Read

```text
docs_human/13-ai-observability.md
docs/24-parallel-worktree-and-ai-evaluation-plan.md
builder_docs/ai-traces-frontend-builder/handoff.md
builder_docs/ai-builder/tasks/03-persistent-recorded-assistant.md
builder_docs/ai-builder/tasks/04-mcp-and-admin-observability-api.md
PRODUCT.md
DESIGN.md
```

Read the relevant Impeccable shape guidance. Keep the existing product world and treat this as an Operate surface.

Do not invent backend field names. Put every required contract field that is not fixed by the human specification into a precise OpenAPI question section.

## Saved conversation brief

Define:

- `/assistant` conversation list and active conversation layout.
- Start-new-conversation action.
- Reload and return behavior.
- Conversation pagination and naming/preview strategy.
- Message ordering.
- Pending turn.
- Failed turn and Retry as a new linked trace.
- Idempotent network retry versus user-selected Retry.
- Recording notice.
- Scoped ownership and not-found behavior.
- Existing structured cards, limitations, currency context, and read-only refusal behavior.
- Desktop/mobile layout, keyboard/focus, loading, empty, unavailable, and rate-limit states.

The browser must submit one new user message and a conversation reference. It must not send authoritative historical messages.

## Admin trace list brief

Route:

```text
/admin/ai-traces
```

Define:

- Admin-only navigation.
- Newest-first table/list.
- Time, HR user, status, model, distinct tools, duration, input/output/reasoning tokens, call counts, error category, and failure stage.
- Date, HR user, status, model, tool, and error filters.
- URL state.
- Server pagination, default 25 and maximum 100.
- No raw content in list rows.
- Empty, invalid-filter, forbidden, unavailable, and partial-error states.
- Desktop, mobile, keyboard, and 200% zoom behavior.

Avoid a wall of cards and decorative charts. This is an investigation ledger.

## Trace detail brief

Define an ordered timeline for:

1. User prompt.
2. Model-call input/output metadata.
3. Tool decision.
4. Requested/validated arguments.
5. Rejected, failed, or successful tool result.
6. Later model/tool rounds.
7. Final response.
8. Timing/tokens.
9. Failure stage.
10. Admin review.

Provide:

- Formatted default view with employee name/code redaction in tool results.
- Raw JSON view behind an explicit synthetic-data warning.
- Collapsed large JSON sections.
- Explicit copy action.
- No raw content in URL, browser storage, analytics, or logs.
- Clear distinction between model failure, validation rejection, tool failure, and persistence failure.
- Deleted/not-found behavior.

Do not expose hidden or encrypted reasoning.

## Review and deletion brief

Define:

- Verdicts `CORRECT`, `PARTIAL`, `INCORRECT`.
- Note up to 2,000 characters.
- Evaluation-fixture nomination.
- Expected review version and stale conflict.
- Delete confirmation showing trace time, HR actor, status, and irreversible scope.
- Success states based on trusted server state, not caller-controlled URL claims.

Deletion removes one trace turn, not the whole conversation.

## MCP observability brief

Define separate Admin routes/navigation or tabs for MCP calls. Show principal, tool, validation/execution status, arguments, result, timing, and errors. Do not imply an MCP call has a model trace.

## Accessibility and responsive behavior

Specify:

- Timeline semantics.
- Keyboard navigation and focus after filters, review, delete, raw-view warning, and pagination.
- Screen-reader names for status and sequence.
- JSON code-region behavior.
- No page-level horizontal overflow.
- Touch-safe controls.
- 200% zoom.
- Loading skeletons that never look like final evidence.
- Axe browser checks.

## Browser test plan

Include real-backend journeys for:

- Admin and Scoped saved conversations.
- Reload/continue/new conversation.
- No-tool, one-tool, multi-tool, rejected, failed, and provider-timeout traces using deterministic test setup where required.
- Admin list filters and pagination.
- Scoped 403.
- Formatted redaction and warned raw view.
- Review and stale-review conflict.
- Disposable trace deletion.
- Separate MCP list/detail.
- Large JSON rendering.
- Mobile, keyboard, zoom, and accessibility.
- Secret absence without inspecting actual credentials.

## Output

Write:

```text
builder_docs/ai-traces-frontend-builder/responses/01-shape-saved-conversations-and-observability.md
```

Include:

- Route map.
- User journeys.
- Information hierarchy.
- Component/state model.
- Desktop/mobile behavior.
- Accessibility/focus behavior.
- Browser test journeys.
- Exact backend/OpenAPI questions.
- Assumptions and exclusions.

Do not modify production code, generated contracts, `PRODUCT.md`, or `DESIGN.md` in this shape task. Do not run Git. Stop after the brief.