# Architecture viz task 01: trace two request flows from the real code

## Status

READY. Branch `feat/architecture-flows`, worktree `/Users/admin/Desktop/Projects/incubyte_take_home_arch_viz`, from master `9236ac4`. Owner: the code tracer (read-only on application code).

## Goal

Produce exact, verified data that shows what happens in the code when a user performs an action. A second agent (Task 02) renders this data as an animated flow diagram. Your output is the single source of truth, so every node must point to real code.

## Flows

1. **F1: Admin clicks "Employees" in the side navigation.** Cover the full path:
   - the browser;
   - the Next.js route, proxy, and session check;
   - the Server Component;
   - the server API client;
   - Express: middleware, auth (principal reloaded from MySQL), the directory route, and validation;
   - the service and repository;
   - the SQL tables read;
   - the response, its validation in the Next server, and rendering.
   - Include the scope rule. Show which step limits Rohan's view.
2. **F2: Admin types "Who earns the most in Tech in India?" in the assistant.** Cover the full path:
   - the Server Action;
   - the conversation endpoint;
   - idempotency;
   - trace creation (`ai_traces`, `ai_messages`);
   - history selection;
   - model call 1 to OpenAI (`ai_model_calls`);
   - the tool decision;
   - tool validation;
   - tool execution: the repository, the SQL tables, and `ai_tool_calls`;
   - model call 2;
   - finalization;
   - the response with cards;
   - rendering.
   - Mark every step where the code writes observability data, and the fail-closed points.

## Output

Write `architecture-viz/flows/F1-employees.json` and `F2-assistant-tool-call.json`, using one schema that you define in `architecture-viz/flows/schema.ts` (Zod or TypeScript types).

**Nodes.** Each node has:
- `id`;
- `kind`: one of `ui-event`, `browser`, `next-route`, `server-action`, `api-client`, `http`, `middleware`, `route-handler`, `service`, `repository`, `db-table`, `external-api`, `response`, `render`;
- `label`, which is short;
- `file`;
- `symbol`, the exact function or component name;
- `line`;
- a one-line `does`;
- `lane`: `browser`, `next-server`, `express`, `mysql`, or `openai`.
- `db-table` nodes also have `table` and `operation` (`SELECT`, `INSERT`, or `UPDATE`).

**Edges.** Each edge has:
- `from` and `to`;
- `order`, the step number;
- `label`: the call, query, or HTTP request with its method and path;
- `payload`: the shape that moves along this edge, for example `{ q, page, pageSize } → DirectoryResponse`, using schema names from `contract.ts` where they exist;
- `async`, true or false.

**Branches** go under `alternatives`: a Scoped HR filter, a 401, a model failure, a rejected tool call. Keep them short, at most 3 per flow.

Target between 15 and 35 nodes per flow. If a step is real but trivial, merge it into another node. Do not invent steps.

## Verify

For every node, open the file and confirm that the `symbol` exists at that `line` (give or take 3). Add a small script, `architecture-viz/flows/verify.ts`, that does this check by searching for each `symbol` in each `file`. It must pass. In F2, use a real trace from the evaluator lane, read through the UI only at `http://localhost:3224/admin/ai-traces` as Meera, to confirm the order of the model and tool steps. Record the trace ID you used. Do not send assistant messages.

## Rules

- Do not change application code.
- No Git, no `.env`, no database queries.
- Do not use ports other lanes own.
- Report blockers per `docs/27-agent-blocker-reporting-protocol.md`.

Write `builder_docs/architecture-viz/responses/01-trace-request-flows.md` and stop.
