# Frontend Task 07b: Artifacts order and plain language

**Status:** Done. The section is reordered and has had a light plain-language pass. Only wording and order changed.
- `npm run check` passes: 21 files, 357 passed.
- `npm run build` passes, with no warnings.
- `tests/e2e/artifacts.spec.ts` in the lane (3325/4225): 10 passed.

**Workspace:** `/Users/admin/Desktop/Projects/incubyte_take_home_artifacts`. No Git commands were run, and no backend files were changed.

## New order

The overview now has three group headings. Each group is a short ruled list, so it is not a card wall.

| # | Group | Entry |
|---|---|---|
| 1 | Thinking | Requirements |
| 2 | Thinking | Decisions and trade-offs |
| 3 | Thinking | Tech stack |
| 4 | Thinking | How it was built |
| 5 | Thinking | Human specs and AI specs |
| 6 | How it works | Database schema |
| 7 | How it works | F1: Opening the employee directory |
| 8 | How it works | F2: An assistant question with a tool call |
| 9 | How it works | F3: A salary request and its approval |
| 10 | Quality and history | AI evaluation |
| 11 | Quality and history | Testing |
| 12 | Quality and history | Performance |
| 13 | Quality and history | Evolution |

**Implementation:**
- Each card in `src/lib/artifacts.ts` has a `group` field, and `ARTIFACT_CARDS` is in this order.
- `ArtifactCardList` renders one `<nav aria-label="Artifacts">` containing three sections. Each section has an h2 group heading and a list labelled by that heading. The card titles moved from h2 to h3.
- There is no next/previous navigation in the section, so the overview is the only list to reorder.

## Language pass

I changed wording only in:
- the card summaries in `artifacts.ts`;
- the tech-stack "why" lines, decision trade-offs, worked-example and flaky-test steps in `artifacts-content.ts`;
- several decision cards, the evaluation method, and the performance setup in `artifacts-more.ts`;
- 8 page subtitles.

**Glosses added the first time a term appears on a page:**
- BFF (backend for frontend), on Tech stack and Decisions;
- HttpOnly cookie ("which page scripts cannot read");
- optimistic concurrency and idempotency key, on Decisions;
- existence privacy ("never reveals whether a hidden record exists");
- fail closed ("if a step cannot be recorded, it does not run");
- hard gates ("pass-or-fail checks that block acceptance"), on AI evaluation;
- p50/p95 ("the median and the 95th-percentile time"), on Performance;
- requestAnimationFrame, in the flaky-test example.

Trade-off lines now lead with the gain, then "The cost: …".

**Three before-and-after examples:**

1. **Decision 4, versioned compensation.**
   - Before: "Compensation is immutable versions. Every change carries the expected version, locks the employee row, and needs an idempotency key bound to the exact command."
   - After: "Compensation is stored as immutable versions. Every change carries the version it expects (optimistic concurrency: a change made from an out-of-date screen fails instead of overwriting) and locks the employee row. It also needs an idempotency key bound to the exact command (so a retried click does not apply the change twice)."
2. **Tech stack, contract row.**
   - Before: "Both sides have drift checks, and the frontend does not trust a response it has not validated."
   - After: "Both sides check for drift, and the frontend checks every response before using it."
3. **Key decision, BFF trade-off.**
   - Before: "No token or backend URL reaches the browser, but every request takes one more hop and the frontend needs its own error mapping."
   - After: "No token or backend URL reaches the browser. The cost: one more hop per request, and the frontend needs its own error mapping."

**Unchanged:**
- facts, numbers, sources, links and versions;
- the "not discussed in the repository" notes on the SQLite and OAuth cards;
- the "Nothing was measured at that size" and "Not measured" notes;
- the generated pages and `docs/`.

**One wording change also removes an unsupported claim.** The F2 summary said the assistant "calls an MCP tool". The F2 page never mentions MCP, and the shared AI contract says the in-product assistant calls its tools directly, not through MCP. The summary now says "calls a tool limited to the HR user's access, and is recorded". This removes a claim the sources do not support and adds nothing new.

## Tests

- **Component** (`tests/component/artifacts.test.tsx`):
  - the 13 links appear in the new order;
  - card titles are h3;
  - a new test checks the three group headings and their sizes (5, 4, 4);
  - the queries now target the "Artifacts" navigation.
- **e2e** (`tests/e2e/artifacts.spec.ts`): the journey checks all 13 card titles in the new order and the three group headings, and clicks through the "Artifacts" navigation.
- **Content tests unchanged and passing:**
  - every cited path exists;
  - versions match the `package.json` files;
  - the decision cards cover the required topics;
  - each card summary is one sentence;
  - every number on the Performance and Testing pages is in its source document.

## Results

| Command | Result |
|---|---|
| `npm run check` | API contract current; lint and typecheck clean; 21 files, 357 passed. |
| `npm run build` | Passed, no warnings. |
| `npx playwright test tests/e2e/artifacts.spec.ts` (lane: MySQL 8.4 on `127.0.0.1:3325`, tmpfs, fresh seed; backend `dist` on 4225) | 10 passed (desktop and mobile). |

I looked at the desktop overview screenshot: three headed groups, ruled entries, nothing out of place.

**Teardown:** I stopped the backend, the Next servers and the test proxies, removed the container, `test-results/` and the `/tmp` helpers. Ports 3325, 4225 and 3900 to 3909 are free.

No `.env` file was read or written. No backend, `docs/`, `docs_human/`, `architecture-viz/` or generated files were changed.
