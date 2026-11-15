# Tester feedback triage 01

**Source:** `tester_docs/responses/01-hr-browser-review.md`  
**Tester mode:** Black-box desktop HR workflow  
**Status:** Findings verified and routed

## Confirmed frontend fixes

### Sort indicators are visually detached from labels

**Severity:** Low usability defect.

The tester observed sort icons at inconsistent positions near wrapped table headers. Code review found that sortable headers use `items-start`, and right-aligned headers reverse icon and label order. This can place an icon near the adjacent column.

**Decision:** Keep each sort icon directly beside its own label. Align label and icon consistently. Verify at 1024, 1280, 1440, and 1920 pixel widths.

### Conversation remains after leaving Assistant

**Severity:** Low behavior defect.

The approved behavior says the memory-only conversation clears after leaving the page. The tester navigated to Employees and back to Assistant and observed the previous turns.

**Decision:** Clear the conversation after leaving and returning. Add a browser regression test using client-side navigation.

The planner attempted to reproduce this after running backend database tests, but those tests had replaced the live demo session. The tester supplied exact black-box steps and accessibility-tree evidence. Route this as a confirmed regression for the frontend builder.

### Rate-limit recovery text is inaccurate

**Severity:** Medium usability defect.

The assistant UI says `Wait a minute`, while the backend assistant limit uses a 15-minute fixed window.

**Decision:** Use accurate text that does not promise a one-minute recovery. Prefer `Wait and try again later` unless the API returns a reset time.

### Exact count of filtered security records

**Severity:** Low information-disclosure defect in a defense-in-depth path.

The frontend can say that an exact number of out-of-scope records was removed from a tool result. A correct backend returns no such records. If the defense path activates, the UI must not reveal the hidden record count.

**Decision:** Keep the server-side defensive filter, but show a generic warning without the number. Do not add client-side authorization as a replacement for backend enforcement.

## Accepted observations with no fix

- Directory `Coming later` labels add some visual noise. The named sections are planned next, so no temporary redesign is needed.
- The independent tester did not complete mobile or automated accessibility review. The frontend builder reported separate Playwright mobile and axe coverage. A later tester pass will repeat these after fixes.
- Scope wording is alphabetically sorted as `India, Support and Tech`. Keep stable sorting instead of hard-coded prose order.

## Backend review result

The backend AI review fixes pass independent checks:

```text
Lint and strict type check: passed
Fast tests: 332 passed
Targeted real-MySQL assistant tests: 25 passed
Production build: passed
```

Accepted changes:

- 20 assistant requests per authenticated HR user per 15 minutes.
- Recent changes use `compensation_records.created_at`.
- Future-effective records entered recently are included.
- Initial imports remain excluded.
- `recordedAt` is added to recent-change cards and OpenAPI.

The frontend must regenerate the OpenAPI contract.

## Environment isolation issue

The local preview and destructive database tests both use `acme_test`. Running the database suite invalidated the live browser session and changed demo-user passwords. This makes concurrent testing unreliable.

**Decision:** Before the next broad browser pass, separate the preview database from the destructive test database. Use `acme_dev` for local servers and keep `acme_test` for integration tests.

This requires a backend infrastructure task and a deliberate synthetic-data reset. It does not change production schema.

## Routed work

### Frontend builder

Instruction:

```text
builder_docs/frontend-builder/tasks/02a-tester-review-fixes.md
```

### Backend builder

Instruction:

```text
builder_docs/parent_instructions/08b-local-database-isolation.md
```

## Tester follow-up

After both fixes, run a second tester pass for:

- Mobile directory and assistant.
- Keyboard-only journey.
- Automated accessibility scan.
- Correct sort-header alignment.
- Conversation reset.
- Rate-limit copy.
- Stable live session while backend database tests use `acme_test`.
