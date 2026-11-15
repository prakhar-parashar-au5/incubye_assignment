# Backend Task 08 review fixes

**Status:** READY

The AI assistant and MCP implementation passes its main checks. Apply only the two corrections below.

## 1. Add an assistant request limit

The assistant currently has no request limit. This can create uncontrolled OpenAI cost after deployment.

Add a backend limit for:

```text
POST /api/v1/assistant/messages
```

Policy:

```text
20 requests per authenticated HR user per 15 minutes
```

Requirements:

- Authenticate before selecting the rate-limit key.
- Key by the verified current HR user ID, not IP, email, JWT text, or client input.
- Return the existing HTTP 429 `RATE_LIMITED` response.
- Do not log chat content, user email, JWT, or tool arguments.
- Keep a single-process in-memory store for this demo and document that multiple replicas need a shared store.
- Do not apply the OpenAI cost limit to normal directory or authentication routes.
- MCP does not call OpenAI, so this specific cost limit does not apply to MCP.

Tests must cover limit, separate HR users, window reset with injected time, authentication before limiting, and normal routes remaining available.

## 2. Define recent changes by record creation time

The user question is "What new changes were made?". `effective_from` answers when compensation becomes effective, not when HR entered the change.

Change `get_recent_compensation_changes` to select records by:

```text
compensation_records.created_at
```

The tool must still return `effective_from` in each result.

Policy:

- Window ends at the current injected time.
- Exclude `INITIAL_IMPORT`.
- Include a future-effective change if HR recorded it inside the requested recent window.
- Exclude an old record even if its effective date is recent.
- Order by `created_at` descending, then stable record order.
- Keep current scope enforcement.

Update tool descriptions and tests so the model understands that "recent" means recently recorded.

Do not change the public tool name or card type unless the existing contract cannot represent `created_at`. If a new response field is added, update OpenAPI and tell the frontend builder to regenerate.

## Live model

Do not require `OPENAI_API_KEY` for automated tests.

If the user has started a backend process with the key, run the sanitized live evaluation. Do not inspect process environment variables or print model response bodies containing employee data.

## Verification

Run lint, type check, fast tests, MySQL tests, production build, OpenAPI drift checks, and fake-model evaluations.

## Scope limits

Do not add mutations, persistent chat, web search, embeddings, or frontend code.

## Response

Write:

```text
builder_docs/responses/08-ai-assistant-mcp-fix.md
```

Include files changed, test evidence, exact checks, known limits, whether live evaluation ran, and confirmation that no Git or later work ran.
