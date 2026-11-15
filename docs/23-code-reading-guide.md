# Code reading guide

Use this guide to understand the application without reading every file in directory order.

## System map

```text
Browser
  → Next.js page or server action
  → server-only frontend API client
  → Express route
  → application service
  → permission-aware repository or tool
  → MySQL
```

Assistant path:

```text
Assistant UI
  → Next.js assistant server action
  → Express assistant route
  → AssistantService tool loop
  → OpenAI model adapter
  → shared ToolRegistry
  → directory or compensation insights
  → MySQL
```

MCP path:

```text
MCP client
  → Express MCP route
  → current JWT and database session
  → same ToolRegistry
  → same permission-aware operations
```

## Backend reading order

### 1. Process and HTTP composition

Read:

```text
express-backend/src/server.ts
express-backend/src/http/app.ts
```

Understand:

- How configuration, pool, auth, directory, assistant, and MCP dependencies are created.
- Why `createApp` does not start a listener.
- How graceful shutdown closes the HTTP server and database pool.

### 2. Public contract

Read:

```text
express-backend/src/http/contract.ts
express-backend/src/http/openapi.ts
express-backend/openapi/openapi.json
```

Understand:

- Zod validates runtime input and output.
- OpenAPI describes the frontend contract.
- TypeScript alone does not validate HTTP values.

### 3. Authentication path

Read:

```text
express-backend/src/http/auth-routes.ts
express-backend/src/access/sessions.ts
express-backend/src/access/session-tokens.ts
express-backend/src/access/passwords.ts
```

Follow:

```text
login route
→ password verification
→ database session
→ JWT
→ /me authentication
→ current status and scopes
```

Important functions:

- `authRoutes`
- `requireAuth`
- `createAuthService`
- `createSessionTokens`
- `hashPassword`
- `verifyPassword`

### 4. HR authorization

Read:

```text
express-backend/src/access/access-policy.ts
express-backend/src/access/hr-users.ts
```

Important functions:

- `canAccessEmployee`
- `canManageHrUsers`
- `createHrUser`
- `setCountryScopes`
- `setDepartmentScopes`
- `setHrUserStatus`

Understand:

- OR inside each scope list.
- AND across country and department.
- Empty scope denies access.
- Last active administrator protection.
- HR changes and audit events share one transaction.

### 5. Directory path

Read:

```text
express-backend/src/http/directory-routes.ts
express-backend/src/directory/directory-repository.ts
express-backend/src/directory/exchange-rate.ts
express-backend/src/money/decimal.ts
```

Important functions:

- `createDirectoryService`
- `buildListQueries`
- `scopeCondition`
- `escapeLike`
- `convertToUsd`
- `addMoney`

Understand:

- Scope enters SQL before count and pagination.
- One compensation record is selected by employment status and effective date.
- Salary conversion occurs before SQL sorting.
- Native compensation stays authoritative.

### 6. Assistant and MCP path

Read:

```text
express-backend/src/http/assistant-routes.ts
express-backend/src/assistant/assistant-service.ts
express-backend/src/assistant/tool-schemas.ts
express-backend/src/assistant/tools.ts
express-backend/src/assistant/compensation-insights.ts
express-backend/src/assistant/openai-model.ts
express-backend/src/http/mcp-routes.ts
```

Important functions:

- `createAssistantService`
- `createToolRegistry`
- `createCompensationInsights`
- OpenAI model adapter creation.
- MCP route and per-request tool registration.

Understand:

- The model chooses a tool.
- Application code validates and executes it.
- The principal never comes from model input.
- MCP and OpenAI use the same tool registry.
- Tool rounds, call count, output size, and deadline are bounded.

### 7. Database and seed

Read:

```text
express-backend/db/migrations/001_initial_schema.sql
express-backend/db/migrations/002_hr_access_control.sql
express-backend/src/db/migrate.ts
express-backend/src/seed/seed-database.ts
express-backend/src/seed/replace-employees.ts
```

Understand:

- Raw migrations are forward-only.
- MySQL DDL is not fully transactional.
- Employee replacement uses DML inside one transaction.
- `DELETE` is used instead of `TRUNCATE`.
- Stable employee code is separate from internal ID.

## Backend tests to read first

### Money

```text
express-backend/test/money.test.ts
```

Look for exact decimal addition, subtraction, average, conversion, and rounding.

### Access policy

```text
express-backend/test/access-policy.test.ts
express-backend/test/db/access-admin-rules.test.ts
```

Look for AND scope semantics, empty scopes, and concurrent last-admin deactivation.

### Seed rollback

```text
express-backend/test/db/seed-database.test.ts
```

Read the test that forces a database failure after deletion and proves rollback.

### Directory authorization and sorting

```text
express-backend/test/db/employee-directory.test.ts
```

Focus on:

- Scoped HR visibility.
- Identical hidden and unknown 404 behavior.
- Compensation selection.
- Cross-currency salary ordering before pagination.

### Assistant tool loop

```text
express-backend/test/assistant-service.test.ts
express-backend/test/db/assistant-tools.test.ts
```

Focus on:

- Invalid tool calls.
- Tool-round limits.
- Model failure.
- Scope enforcement.
- MCP and in-product tool equivalence.
- Mutation request refusal.

### HTTP boundary

```text
express-backend/test/http-app.test.ts
express-backend/test/http-rate-limit.test.ts
express-backend/test/http-openapi.test.ts
```

Understand why delivery tests can use injected services while domain and database rules have separate real-MySQL tests.

## Frontend reading order

### 1. Server boundary

Read:

```text
next-frontend/src/server/api/client.ts
next-frontend/src/server/config.ts
next-frontend/src/server/session.ts
next-frontend/src/server/session-cookie.ts
next-frontend/src/server/actions/auth.ts
next-frontend/src/server/actions/assistant.ts
```

Understand:

- JWT remains server-only.
- Next.js owns the HTTP-only cookie.
- Express remains the authority.
- API failures become explicit frontend states.

### 2. Sign-in and shell

Read:

```text
next-frontend/src/app/sign-in/page.tsx
next-frontend/src/app/sign-in/sign-in-form.tsx
next-frontend/src/components/shell/app-shell.tsx
```

Understand:

- Demo account key maps to email on the server.
- The client cannot choose an arbitrary login email.
- Role and scope remain visible.

### 3. Directory UI

Read:

```text
next-frontend/src/app/employees/page.tsx
next-frontend/src/app/employees/directory-controls.tsx
next-frontend/src/app/employees/directory-results.tsx
next-frontend/src/server/directory-query.ts
next-frontend/src/lib/directory-url.ts
```

Understand:

- URL is the directory state.
- API types come from OpenAPI.
- Desktop and mobile use different presentations of the same results.
- Native money remains primary.

### 4. Employee detail

Read:

```text
next-frontend/src/app/employees/[employeeCode]/page.tsx
next-frontend/src/components/directory/money.tsx
```

Follow compensation state, USD context, history, and safe return-path handling.

### 5. Assistant UI

Read:

```text
next-frontend/src/app/assistant/page.tsx
next-frontend/src/app/assistant/assistant-chat.tsx
next-frontend/src/components/assistant/assistant-cards.tsx
next-frontend/src/lib/assistant.ts
```

Understand:

- Conversation is memory-only.
- Model text renders as plain text.
- Cards carry structured values.
- Errors have distinct recovery states.

## Frontend tests to read first

```text
next-frontend/tests/unit/auth-actions.test.ts
next-frontend/tests/unit/directory.test.ts
next-frontend/tests/unit/assistant.test.ts
next-frontend/tests/component/assistant-chat.test.tsx
next-frontend/tests/e2e/auth.spec.ts
next-frontend/tests/e2e/directory.spec.ts
next-frontend/tests/e2e/assistant.spec.ts
```

Read one unit test, one component test, and one browser journey before reading all tests.

## Suggested review sessions

### Session 1: Authentication

Trace one login from form to cookie to `/me`.

### Session 2: Directory

Trace one Scoped HR query from URL to SQL and back to the table.

### Session 3: Transaction safety

Read the seed rollback and access-audit rollback tests.

### Session 4: AI tools

Trace `Who has the highest annual cash compensation?` from chat input to model tool call, SQL, card, and final answer.

For each session, explain:

1. What enters the system.
2. Where runtime validation occurs.
3. Where permission checks occur.
4. Where exact calculations occur.
5. Which test catches the most likely defect.
