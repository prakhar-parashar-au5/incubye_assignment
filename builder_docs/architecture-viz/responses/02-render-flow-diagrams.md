# Architecture viz Task 02: render each flow as one static page

Status: **complete.** The response to Task 01 also covers the three planner corrections below. I stopped after Task 02.

## Task 01 corrections (done first)

I confirmed each correction in the code before changing the flow JSON:

1. **F1, `hr_users`.** `authenticate` reads `FROM hr_sessions s JOIN hr_users u` (`sessions.ts:175`). I added the db-table node `t-hr-users` (SELECT) and step 12, "JOIN hr_users …". `hr_sessions` now covers only expiry and revocation.
2. **F2, `compensation_records`.** `topCompensated` uses `SELECTED_COMPENSATION` (`compensation-insights.ts:127`), which is a `LEFT JOIN LATERAL … FROM compensation_records c` (`directory-repository.ts:93`). I added the db-table node `t-compensation` (SELECT) and step 27.
3. **F2, AI Task 05.**
   - **Lines that moved.** The verifier caught them (`runTurn` 240→255, `runTyped` 307→328, the `get_top_compensated_employees` handler 200→221), and I updated all three.
   - **New node.** I added `scopeLimitation` (`tools.ts:63`), with step 28, `withScope(principal, …)`. Its scope note says it returns null for Admin HR and adds the fixed coverage statement for Scoped HR.
   - **Prompt version.** `createTrace` and the payload of model call 1 now say `assistant-instructions-v2` (`PROMPT_VERSION`, `assistant-service.ts:45`).
   - **Evidence note.** It now says the evidence trace was recorded before Task 05, and that Task 05 does not change the step order.
   - **Unchanged.** The finding that no tool takes a department or country argument still holds. `get_top_compensated_employees` still accepts only metric, currency, comparisonCurrency, and limit.

### Node count

Adding two F2 nodes would have exceeded the 35-node cap, so I merged two trivial steps into neighbours. Neither merge hides a real step.

| Merged node | Into |
|---|---|
| `read-conversation` (the owned-conversation read) | `submit`'s description |
| `client-create` (a one-line client wrapper) | the edge from the Server Action to `POST /assistant/conversations` |

### Result

```text
$ node architecture-viz/flows/verify.ts
F1 F1-employees.json: 31 nodes, 32 edges, 3 alternatives — OK
F2 F2-assistant-tool-call.json: 35 nodes, 41 edges, 3 alternatives — OK
66 nodes checked, 0 problem(s).          (exit 0)
```

## Task 02 build

### Command

```text
node architecture-viz/render.ts
```

The script needs nothing extra to run: Node 22 strips the TypeScript types, so no `tsx` is required.

### What it does

- **Input.** It reads every `architecture-viz/flows/F*.json` and rejects any flow that fails `structuralProblems`.
- **HTML.** It writes `architecture-viz/out/F1.html` and `F2.html`:
  - self-contained, with inline CSS;
  - no JavaScript, framework, or external resources (I checked: no `<script>`, no URLs).
- **PNG.** It takes a full-page Playwright screenshot of each HTML file at a 1440 px viewport: `out/F1.png` (1440×4218) and `out/F2.png` (1440×6573).
- **Nothing hard-coded.** Every node, step, label, payload, badge, note, and side note comes from the JSON.
- **Playwright.** It loads Playwright from `next-frontend/node_modules`. That directory was not installed in this worktree, so I ran `npm ci` in `next-frontend`. This uses the existing lockfile, and `/node_modules` is gitignored.

### Layout (from the task)

- **Thread.** One vertical thread, read top to bottom. The step number sits on the line, with the edge label next to it and the payload in grey monospace underneath.
  - Steps that do not start at the previous node say "from X".
  - Steps that make no await are tagged `sync`.
- **Lanes.** Five tinted columns: Browser, Next server, Express, MySQL, OpenAI. The thread moves sideways when a call crosses into another lane.
- **Shapes:**
  - Function: a rounded card showing the label, the `symbol` in monospace, and `file:line`.
  - Table: an SVG cylinder in the database accent colour (amber), showing the table name and its operation.
  - OpenAI: an SVG hexagon in the second accent colour (purple).
  - The click is a pill at the top, and the final screen is a pill at the bottom.
  - A node reached again is tagged `again` (the second model call reuses its nodes).
- **Return path.** It is dashed blue and the step number has a dashed ring. An edge counts as a return when it moves toward the browser or arrives at a response or render step. Any sideways jump toward the browser is also dashed.
- **Badges and notes:**
  - Badges: `writes trace`, `fails closed`, `scope rule`.
  - The fail-closed and scope texts are small notes under the step that first reaches that node.
  - Alternatives are side notes under the step where they branch (Scoped HR, 401, no cookie, model failure, rejected tool, idempotent replay). They have no threads of their own.
- **Header and footer.** The header gives the title, the actor, and the size in one sentence, plus a legend. The footer gives the trace base commit text, "Generated from flows/<file>.json", the F2 evidence trace ID, and the flow notes.
- **Look:**
  - Colours from DESIGN.md: ground, navy ink, the blue accent, warm hairlines.
  - One sans font stack (Public Sans first) and one monospace stack.
  - No gradients and no emoji.
  - Print styles keep the tints, and rows never split across pages.

### Visual check

I opened both pages and looked at full-page and full-resolution crops.

- **Fixed after the first look:**
  - The jump back from MySQL to the Next server in F1 step 15 was solid; it is now dashed as a return.
  - The header's "hover" hint now says it applies to the HTML only.
- **Readable at 1440 px:** the cylinders, the hexagon, the dashed returns, the fail-closed notes, and the branch notes.

## Evidence

- `builder_docs/architecture-viz/responses/evidence-02/F1.png`
- `builder_docs/architecture-viz/responses/evidence-02/F2.png`

## Limits

- **Footer commit.** The footer shows the flow's `traceBase` text, not a commit read from Git, because Git is not allowed in this lane. F2's base reads "master 9236ac4, re-checked after the merge of master with AI Task 05". The planner can set the exact commit ID in `traceBase`.
- **Hover text.** The "does" text for each node is a hover title in the HTML and does not appear in the PNG. The PNG shows the label, symbol, file:line, badges, and notes.
- **Long pages.** F2 is 6,573 px tall, because each of its 41 steps gets one row.

## Files

| Status | Files |
|---|---|
| New | `architecture-viz/render.ts`, `architecture-viz/out/{F1,F2}.{html,png}`, `builder_docs/architecture-viz/responses/evidence-02/{F1,F2}.png`, this response |
| Changed for the Task 01 corrections | `architecture-viz/flows/F1-employees.json`, `architecture-viz/flows/F2-assistant-tool-call.json` |

## Confirmations

- No application code changed.
- No Git and no `.env`.
- No database queries and no ports used: the renderer opens local `file://` pages only.
