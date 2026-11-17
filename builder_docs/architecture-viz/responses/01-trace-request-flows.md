# Architecture viz Task 01: trace two request flows from the real code

Status: **complete, and the verify script passes.** I am waiting for planner acceptance before starting Task 02.

The worktree is `/Users/admin/Desktop/Projects/incubyte_take_home_arch_viz`, branch `feat/architecture-flows`, master `9236ac4`. I took the branch name and commit from the task; I ran no Git command.

## Output

| File | Content |
|---|---|
| `architecture-viz/flows/schema.ts` | TypeScript types (`Flow`, `FlowNode`, `FlowEdge`, `FlowAlternative`) and `structuralProblems()`. No dependencies. |
| `architecture-viz/flows/F1-employees.json` | 30 nodes, 31 edges, 3 alternatives |
| `architecture-viz/flows/F2-assistant-tool-call.json` | 35 nodes, 41 edges, 3 alternatives |
| `architecture-viz/flows/verify.ts` | Checks every node against the code, plus the flow structure |

### Fields beyond the task's list

These are optional, so Task 02 can mark the special steps:
- `observability: true` marks a node that writes `ai_*` data.
- `failClosed` holds text describing what stops at that point if the step fails.
- `scopeRule` holds the access rule applied at that step.

### Other conventions

- **Flow header:** each flow records `traceBase`. F2 also records `evidence`: the trace ID, its source, and the steps I observed.
- **Edges:** each `order` is unique and runs from 1 to n with no gaps.
- **Repeated steps:** F2's second model call reuses the same nodes at orders 29 to 33.

## Verify

```text
$ node architecture-viz/flows/verify.ts
F1 F1-employees.json: 30 nodes, 31 edges, 3 alternatives — OK
F2 F2-assistant-tool-call.json: 35 nodes, 41 edges, 3 alternatives — OK
65 nodes checked, 0 problem(s).          (exit 0)
```

- **How it runs:** with Node 22's built-in type stripping, so it needs no install.
- **What it checks for every node:**
  - the file exists;
  - `symbol` appears within 3 lines of `line`.
- **What it checks for each flow:**
  - kinds and lanes are valid;
  - `db-table` nodes have `table` and `operation` and sit in the `mysql` lane;
  - edge endpoints exist, and the edge order runs from 1 to n;
  - every node is on at least one edge;
  - each flow has 15 to 35 nodes and at most 3 alternatives.
- **Proof that it catches mistakes:** I moved `scopeCondition` to line 150 temporarily. The verifier then failed, reporting "not within ±3 … (first seen at line 133)", and exited 1. After I restored the file it passed again.

## F1: Admin clicks "Employees"

**The path:**
1. Browser: the rail `Navigation` and its `Link`.
2. Next.js: the `proxy` cookie check, then `EmployeesPage` and `EmployeesDirectory`.
3. `loadSessionAndToken` and `resolveSession`, which calls `GET /auth/me`.
4. `parseDirectoryQuery`, `listEmployees`, then a server-side `fetch` with the Bearer token.
5. Express: `requestLog`, then `requireAuth` and `authenticate`. These verify the JWT, then reload `hr_sessions ⋈ hr_users`, `hr_user_country_scopes`, and `hr_user_department_scopes` from MySQL.
6. The `GET /employees` route and its `DirectoryQueryParams` validation.
7. `directory.list`, `buildListQueries`, and `scopeCondition`.
8. SQL over `employees`, `job_titles`, `departments`, and the lateral `compensation_records` join.
9. `DirectoryResponse.parse` in Express, then the Ajv check `isDirectoryResponse` in Next.
10. `DirectoryResults` renders, and the browser commits the result into `DirectoryNavigationProvider`.

**Scope rule:** `scopeCondition` (in `directory-repository.ts`, line 133) is the step that limits Rohan's view. It adds `e.country_code IN (?) AND d.name IN (?)` to the SQL. Rows, totals, and pages are therefore all limited inside MySQL, and nothing is filtered in the browser.

**Alternatives:**
- Scoped HR.
- An expired or revoked session gives 401, which redirects to `/session/expired`.
- No cookie: the proxy redirects to `/sign-in`.

**Notes:**
- `requireAuth` runs once for `/auth/me` and again for `/employees`.
- The parallel `getDirectoryOptions` call follows the same path and is not drawn.

## F2: Admin asks "Who earns the most in Tech in India?"

**The path:**
1. Browser and Server Action: `send` and `run`, which creates the Idempotency-Key, then the `sendConversationMessage` Server Action.
2. The conversation is created: `createAssistantConversation`, then `POST /assistant/conversations` → `ai_conversations` INSERT.
3. The message reaches Express: `sendAssistantConversationMessage`, then `requireAuth`, `assistantRequestLimiter`, and the `POST …/messages` route (Idempotency-Key check and `AssistantMessageRequest`).
4. `submit` prepares the turn:
   - `readConversation` (ownership);
   - `findTraceByIdempotency`;
   - `selectHistory`, a bounded history built on the server;
   - `createTrace` → `ai_traces` INSERT and `ai_messages` INSERT.
5. `runTurn`, model call 1:
   - `ai_model_calls` INSERT, then `session.next` → OpenAI `responses.create`;
   - the tool decision is recorded in the `ai_model_calls` UPDATE.
6. The tool call:
   - `ai_tool_calls` INSERT;
   - `runTyped` validates with `TOOL_INPUT_SCHEMAS`;
   - `get_top_compensated_employees` → `insights.topCompensated` (scope rule) → `employees` and its joins;
   - `ai_tool_calls` UPDATE.
7. Model call 2: `ai_model_calls` INSERT, then OpenAI, then UPDATE.
8. Finalisation: `finishTrace` → `ai_messages` INSERT (assistant) and `ai_traces` UPDATE.
9. Response checks: `AssistantTurnResponse.parse`, then `isAssistantTurnResponse`.
10. Render: the `/assistant/[id]` Server Component, then `buildThread`, then `AnswerView` with its cards.

**Observability writes:** steps 5, 14 to 16, 18, 22, 23, 28, 29, and 33 to 36. Each of these nodes is flagged in the data.

**Fail-closed points:**
- `createTrace` (TRACE_CREATE): if it fails, the request gets 503 and OpenAI is never called.
- Every `persist()` in `runTurn` (MODEL_TRACE_WRITE and TOOL_TRACE_WRITE): no unrecorded provider call or tool run happens, and no decision or card is used before its outcome is saved.
- `finishTrace` (FINAL_TRACE_WRITE): the answer is never returned without being recorded.
- `runTurn` with no model configured: it fails before any call is made.

**Alternatives:**
- A model failure becomes 502, and a recorded failed turn appears with Retry.
- A rejected tool call (unknown name or invalid arguments) is recorded as REJECTED, does not run, and the error goes back to the model.
- A same-key replay creates no new trace and makes no model call: the stored result is returned, or 409 is returned.

**Evidence:**
- **Trace used:** `88f78a0a-c3c3-452a-a9ce-b87bf81929b0`.
- **How I read it:** read-only, through `http://localhost:3224/admin/ai-traces` as Meera. I signed in with the published demo credential shown on the sign-in page, which my script read from the page and never printed.
- **Observed order:** user prompt, model call 1, tool call `get_top_compensated_employees` (Succeeded), model call 2, final response. That matches orders 17 to 33 in the data.
- **Two-tool case:** trace `8cf829cd-8576-4953-b26f-69118e4af51f` shows one model call requesting two tools, both recorded before model call 2.
- **Actions taken:** I sent no message, saved no review, and deleted nothing.

## Findings

1. **The lane has no trace for the exact F2 question, and I was not allowed to create one.** The prompt of `88f78a0a` is "Who earns the most?". It uses the same tool and the same shape: 2 model calls and 1 tool call. Before rendering the exact wording as observed behaviour, the planner may want one real run of "…in Tech in India?" in the evaluator lane.
2. **No assistant tool can filter by department or country.** `get_top_compensated_employees` accepts only `{ metric, currency, comparisonCurrency, limit }`. For "in Tech in India", the model can only restrict by currency (INR) or rank everyone in scope.
   - For Admin HR, "Tech" therefore cannot be applied as a filter.
   - A department or country argument would be rejected as `INVALID_ARGUMENTS`, which is the rejected-tool alternative.

   This is a product and backend matter. I recorded it as a note in F2 and did not change any code.

## Confirmations

- No application code changed. New files are only under `architecture-viz/flows/` and this response.
- No Git commands. No `.env` read. No database queries.
- I used only the evaluator lane's Admin UI on port 3224, read-only. No other ports.
- No blockers, so no `docs/27` report was needed. Task 02 has not started; I am waiting for acceptance.
