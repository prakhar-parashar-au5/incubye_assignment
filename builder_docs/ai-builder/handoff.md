# AI builder handoff

You are the dedicated AI builder for the Incubyte take-home project.

The active repository is:

```text
/Users/admin/Desktop/Projects/incubyte_take_home
```

## Aim

Build a complete, polished submission for a Senior TypeScript Craftsperson role at Incubyte.

The submission must show:

- Product judgment.
- Strong TypeScript and Node.js engineering.
- Clear frontend and backend boundaries.
- Exact money handling.
- Relational database design.
- Meaningful tests.
- Permission enforcement.
- Responsible AI design.
- Intentional use of coding agents.
- Honest incremental development history.
- Decisions that Prakhar can explain in an interview.

Do not maximize feature count. Finish coherent workflows.

Prakhar is the product owner. The planner reviews decisions and builder results. Do not silently add product behavior.

## Important current fact

The AI assistant already exists.

Do not rebuild it from scratch.

Your job is to understand, verify, and extend the current assistant only through an approved task.

## Product

ACME has 10,000 synthetic employees in India and the United States.

The main user is an HR manager.

The application replaces risky spreadsheet salary workflows with a trustworthy compensation ledger.

Core workflows include:

- Sign in.
- Search and filter employees.
- Inspect compensation.
- Inspect compensation history.
- Compare salaries without mixing currencies.
- Ask a read-only assistant about employees and compensation.
- Later: preview and apply or request salary changes.
- Later: dashboard analytics.
- Later: HR access management.
- Later: spreadsheet import.

The application is not payroll software. It does not issue bank instructions, calculate tax, or file payroll returns.

## Repository layout

```text
express-backend/     Express, TypeScript, MySQL, OpenAI, MCP
next-frontend/       Next.js, React, TypeScript
builder_docs/        Builder instructions and responses
tester_docs/         Independent HR browser testing
docs/                Reviewed design, tests, decisions, and code reviews
docs_human/          Prakhar's product specifications
PRODUCT.md            Impeccable product context
DESIGN.md             Frontend design system
```

Do not edit files under `docs_human/` unless Prakhar explicitly asks.

## Current stack

Backend:

- Node.js 22.
- Strict TypeScript.
- Express 5.
- Raw SQL through `mysql2`.
- MySQL 8.4.
- Zod runtime validation.
- OpenAPI 3.1.
- Argon2id passwords.
- `jose` JWTs.
- OpenAI Node SDK and Responses API.
- MCP TypeScript SDK v2.
- Node built-in test runner with `tsx`.

Frontend:

- Next.js App Router.
- React.
- Strict TypeScript.
- Tailwind CSS.
- Selected shadcn/ui source components.
- Generated OpenAPI types.
- Ajv runtime response validation.
- Vitest and Testing Library.
- Playwright and axe.
- Impeccable design skill.

## Data and money

The source workbook contains one row per employee and current compensation.

Stable employee IDs use:

```text
ACME00001 ... ACME10000
```

`annual_base_salary` is authoritative.

The system does not store a second monthly salary value.

Money uses MySQL `DECIMAL(15,2)` and exact decimal strings or BigInt minor units in TypeScript.

Do not use JavaScript floating-point arithmetic for authoritative money.

Native currencies are INR and USD.

Never compare raw INR and USD values.

A saved Federal Reserve H.10 snapshot provides USD comparison. The current saved fixture says:

```text
1 USD = 93.9100 INR
effective date 2026-11-06
```

Native compensation remains authoritative. USD comparison is informational.

## Database

Main tables:

```text
countries
departments
job_titles
employees
compensation_records
hr_users
hr_user_country_scopes
hr_user_department_scopes
hr_sessions
access_audit_events
schema_migrations
```

Compensation is an immutable effective-dated ledger.

The first workbook seed creates compensation version `1` with reason `INITIAL_IMPORT`.

Current compensation is selected by effective date and version.

The current product uses one organization-wide UTC business date.

## Authentication and authorization

Roles:

```text
ADMIN
SCOPED
```

Admin HR can access all employees.

Scoped HR requires:

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

Matching inside each list uses OR.

An empty country or department list grants no employee access.

Current HR status and scopes load from MySQL for every authenticated request.

JWT contains only:

- HR user ID.
- Session ID.
- Issued time.
- Expiry time.

Session lifetime is two hours.

The frontend stores JWT in an HTTP-only, SameSite=Lax cookie. The browser does not call Express directly. Next.js server code sends the Bearer token to Express.

Admin scope rows are forbidden. The last active Admin HR cannot be deactivated.

## Directory

Backend endpoints:

```text
GET /api/v1/employees
GET /api/v1/employees/:employeeCode
GET /api/v1/employee-directory/options
```

Directory supports:

- Name, employee ID, and exact-email search.
- Department, country, currency, level, and status filters.
- SQL sorting and pagination.
- Current, Upcoming, and Historical compensation states.
- Compensation history.
- Native and USD-equivalent values.
- Permission-filtered counts and options.

Unknown and inaccessible employees return the same public result.

## Existing AI assistant

Frontend route:

```text
/assistant
```

Backend endpoint:

```text
POST /api/v1/assistant/messages
```

MCP endpoint:

```text
POST /api/v1/mcp
```

The in-product assistant calls shared tool implementations directly. It does not call its own MCP endpoint.

MCP exposes the same tools to an authenticated external client.

### Tools

```text
search_employees
get_employee_compensation
get_top_compensated_employees
get_recent_compensation_changes
get_compensation_summary
```

There is no arbitrary SQL tool.

There is no mutation tool.

All tools receive the authenticated principal from server code. The model cannot supply HR user ID, role, or scope.

Scope is enforced in SQL and checked again before employee-bearing results are returned.

### Model loop

Read:

```text
express-backend/src/assistant/assistant-service.ts
```

The loop:

1. Receives authenticated principal and conversation messages.
2. Sends system instructions, conversation, and strict tool schemas to OpenAI.
3. Receives either final text or tool calls.
4. Parses and validates model tool arguments.
5. Calls the shared tool registry with the server principal.
6. Sends sanitized tool output back to the model.
7. Repeats within bounded rounds.
8. Returns model text, tool status, structured cards, limitations, and generated time.

Limits include:

- Four tool rounds.
- Four calls per round.
- Tool-output size limit.
- Answer-size limit.
- Eight cards.
- 45-second total deadline.
- 20 assistant requests per authenticated HR user per 15 minutes.

Normal HR routes work when OpenAI is unavailable.

### Recent changes

`get_recent_compensation_changes` uses `compensation_records.created_at`.

It answers what was recorded recently, not what became effective recently.

It excludes `INITIAL_IMPORT`.

It includes a future-effective change when HR recorded it inside the selected window.

### OpenAI policy

- Use Responses API, not Assistants API.
- Use strict function tools.
- `store: false`.
- No hosted web-search tool in the current assistant.
- Automated tests use a fake model adapter.
- Never require `OPENAI_API_KEY` for tests or normal server startup.
- Provider failures become `ASSISTANT_UNAVAILABLE`.
- Do not log provider response bodies.

Current default model is configurable through `OPENAI_MODEL`.

The OpenAI key comes only from the backend process environment.

Never put it in source, `.env`, frontend variables, prompts, reports, or logs.

## MCP policy

The MCP endpoint uses the current official TypeScript SDK v2.

MCP requests require the same Bearer JWT and current database access.

Each tool is read-only, non-destructive, and closed-world.

MCP rejects browser Origin headers.

MCP handlers call the shared tool registry. They do not query MySQL directly.

Do not add mutation tools without a later proposal, preview, exact confirmation, idempotency, stale-version check, and transaction design.

## Frontend assistant

The assistant page:

- Clearly labels synthetic data.
- Shows suggested prompts.
- Keeps conversation in memory only.
- Sends through a Next.js server action.
- Renders model text as escaped plain text.
- Renders structured cards separately.
- Shows tool status and limitations.
- Shows native currency and exchange-rate context.
- Handles timeout, unavailable, rate limit, session expiry, and invalid response.

The frontend must never receive the OpenAI key or JWT.

## Current logging

Current stdout logs intentionally contain only:

- Request ID.
- Route pattern.
- HTTP status.
- Duration.
- Tool name.
- Tool status.
- Tool duration.
- Model failure category.

Current logs do not persist:

- Prompts.
- Model responses.
- Tool arguments.
- Tool results.
- Token usage.
- Conversation history.

No AI observability tables exist yet.

## Approved AI observability work

The product specification is complete:

```text
docs_human/13-ai-observability.md
```

The storage foundation and its focused review corrections are implemented:

```text
builder_docs/ai-builder/tasks/01-observability-storage-foundation.md
builder_docs/ai-builder/tasks/02-observability-storage-review-fixes.md
```

Do not start live assistant, MCP, Admin-route, or frontend integration until the planner assigns the next bounded task.

Required table boundaries are:

```text
ai_conversations
ai_messages
ai_traces
ai_model_calls
ai_tool_calls
mcp_tool_calls
ai_trace_reviews
```

Do not store hidden chain-of-thought or encrypted reasoning content. OpenAI requests continue to use `store: false`.

## Salary adjustment work

Prakhar is currently writing the salary-adjustment implementation with the planner to learn the code and test style.

Do not modify:

```text
express-backend/src/compensation/adjustment.ts
express-backend/test/compensation-adjustment.test.ts
```

Do not implement salary mutations through AI.

## Tests and evidence

Important backend tests:

```text
express-backend/test/assistant-service.test.ts
express-backend/test/assistant-tools.test.ts
express-backend/test/openai-model.test.ts
express-backend/test/http-assistant.test.ts
express-backend/test/http-assistant-rate-limit.test.ts
express-backend/test/db/assistant-tools.test.ts
```

Important frontend tests:

```text
next-frontend/tests/unit/assistant.test.ts
next-frontend/tests/component/assistant-chat.test.tsx
next-frontend/tests/e2e/assistant.spec.ts
```

Builder reports:

```text
builder_docs/responses/07-employee-directory-api.md
builder_docs/responses/08-ai-assistant-mcp.md
builder_docs/responses/08-ai-assistant-mcp-fix.md
builder_docs/frontend-builder/responses/02-directory-and-assistant.md
builder_docs/frontend-builder/responses/02a-tester-review-fixes.md
```

Independent tester report:

```text
tester_docs/responses/01-hr-browser-review.md
```

Review triage:

```text
docs/code-reviews/01-tester-feedback-triage.md
```

## Working rules

- Read before editing.
- Do not run Git commands.
- Do not commit or push.
- Never read `.env` files.
- Do not ask Prakhar to paste a key.
- Use fake-model fixtures for automated tests.
- Keep normal HR workflows independent of model availability.
- Do not add services, queues, vector stores, or frameworks without evidence.
- Do not edit human specifications.
- Do not alter salary-adjustment files owned by Prakhar.
- Record actual checks only.
- Do not fabricate red tests or live evaluations.
- Stop when the approved task is complete.

## Current action

Task 02 has returned its correction report:

```text
builder_docs/ai-builder/responses/02-observability-storage-review-fixes.md
```

There is no approved implementation task after Task 02 yet. Stop and wait for planner review. Do not start live assistant integration, MCP integration, Admin HTTP routes, or frontend work.
