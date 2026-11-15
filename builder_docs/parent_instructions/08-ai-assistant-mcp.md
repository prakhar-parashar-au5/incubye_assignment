# Backend Task 08: Read-only AI assistant and MCP adapter

**Status:** READY

## Goal

Build a permission-safe read-only compensation assistant with OpenAI tool calling. Expose the same tools through MCP.

## Read first

- `builder_docs/parent_instructions/index.md`
- `builder_docs/shared/ai-assistant-contract.md`
- `docs/16-employee-directory-api-design.md`
- `docs/18-review-findings-and-decisions.md`
- `builder_docs/responses/07-employee-directory-api.md`

## Required work

- Transport-independent typed tool registry.
- Permission-aware application operations for search, employee compensation, top compensation, recent changes, and summaries.
- OpenAI model adapter using the official SDK and Responses API.
- Fake model adapter for tests.
- `POST /api/v1/assistant/messages`.
- OpenAPI request and response schemas.
- Authenticated read-only MCP endpoint using the current official MCP TypeScript SDK.
- Deterministic tests and selected agent evaluations.

## Rules

- Strict TypeScript.
- No arbitrary SQL tool.
- No mutation tool.
- Principal comes only from current JWT authentication.
- Tools enforce scope in application code and SQL.
- Highest salary never compares raw INR and USD.
- Initial import is not reported as a recent salary change.
- Model does not calculate authoritative money.
- Tests never call OpenAI.
- Backend starts without `OPENAI_API_KEY`; assistant returns unavailable while ordinary routes work.
- Never read `.env` files.
- Never log chat, tool arguments, salary results, employee identity, JWTs, or API keys.
- Do not run Git commands.

## Builder research

Check current official OpenAI Responses API and official MCP TypeScript SDK documentation before coding. Record versions and source URLs. Do not use old Assistants API examples or obsolete MCP transports.

## Required tests

- Tool schemas reject malformed input.
- Admin and Scoped HR receive only permitted records.
- Out-of-scope employee is not disclosed.
- Highest salary with no native currency uses documented USD comparison.
- Missing exchange rate returns insufficiency, not a raw comparison.
- No manual changes returns an honest empty answer.
- Fake model selects each tool correctly in evaluation fixtures.
- Invalid model tool call fails safely.
- Tool-loop limit stops repeated calls.
- Model timeout and provider error return assistant unavailable.
- Normal auth and directory endpoints still work without OpenAI.
- MCP and in-product adapters call the same tool implementation and return the same authorized result.
- MCP rejects missing or invalid authentication.
- No mutation or arbitrary SQL tool exists.
- Logs contain no sensitive content.

## Scope limit

Do not add salary mutation, market web research, persistent chat history, embeddings, vector storage, or multi-agent orchestration.

## Response

Write:

```text
builder_docs/responses/08-ai-assistant-mcp.md
```

Include sources, model and SDK versions, architecture, tools, permission evidence, evaluations, tests, live smoke result only if the key is available, known limitations, and confirmation that no Git or mutation work ran.
