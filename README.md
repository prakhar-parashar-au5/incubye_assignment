# ACME Compensation Manager

A compensation ledger for ACME's HR team: 10,000 synthetic employees across several countries. HR managers find an employee, see current compensation in its native currency, preview and record salary changes (directly as Admin HR, or as a request that Admin HR approves), and see who changed what. A read-only AI assistant answers compensation questions within the user's access, and Admin HR can inspect every assistant turn.

Native currency is authoritative and currencies are never added together. Every server operation checks the caller's role and scope in MySQL. Salary history is effective-dated and never edited in place. All data is synthetic.

## Architecture

```mermaid
flowchart LR
  Browser -- HTTPS --> Next["next-frontend<br/>Next.js 16 App Router<br/>(server-side API client)"]
  Next -- "HTTP + Bearer JWT<br/>(server only)" --> Express["express-backend<br/>Express 5, TypeScript"]
  MCPClient["MCP client<br/>(non-browser)"] -. "Bearer JWT<br/>/api/v1/mcp" .-> Express
  Express --> MySQL[("MySQL 8<br/>employees, compensation,<br/>HR users, AI traces")]
  Express -- "assistant turns" --> OpenAI["OpenAI API"]
```

- The browser talks only to Next.js. It never calls Express and never sees the session JWT, which lives in an `HttpOnly` cookie.
- Express owns all business rules, access control, and recording. The assistant and the MCP endpoint (`/api/v1/mcp`) call the same read-only tool registry, which applies the caller's scope.
- On Railway, only `next-frontend` has a public domain. Express and MySQL are reachable on the private network only, so the MCP endpoint is not reachable from outside Railway in that deployment.

| Directory | What it is | Details |
|---|---|---|
| `express-backend/` | API, migrations, seed, assistant, MCP server | [`express-backend/README.md`](express-backend/README.md) |
| `next-frontend/` | Web app | [`next-frontend/README.md`](next-frontend/README.md) |
| `docs/` | Requirements, designs, test plans | start with [`docs/requirements.md`](docs/requirements.md) |
| `docs/deploy/` | Railway runbook | [`docs/deploy/railway-runbook.md`](docs/deploy/railway-runbook.md) |

## Local setup

Requirements: Node `22.23.1` (`.nvmrc` in each service), Docker. Nothing reads `.env` files; pass variables in the shell.

**1. MySQL** (MySQL 8.4 on `127.0.0.1:3317`, tmpfs storage, databases `acme_dev` and `acme_test`, fixed local-only credentials):

```sh
cd express-backend
npm ci
npm run db:up
```

**2. Backend** (schema, 10,000 employees, the two demo users, then the API on port 4000):

```sh
export DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_dev'
npm run db:migrate
APP_ENV=development npm run db:seed -- --replace          # destructive: replaces employee data in acme_dev
APP_ENV=demo DEMO_MEERA_PASSWORD='<synthetic, ≥ 12 chars>' DEMO_ROHAN_PASSWORD='<same>' npm run db:seed-demo-users
PORT=4000 JWT_SIGNING_KEY='<any local value, ≥ 32 bytes>' npx tsx src/server.ts
```

Add `OPENAI_API_KEY=…` (and optionally `OPENAI_MODEL=gpt-6-luna`) to enable the assistant. Without it the assistant records an "assistant is not configured" turn and everything else works.

**3. Frontend** (on port 3000):

```sh
cd next-frontend
npm ci
API_BASE_URL=http://localhost:4000 DEMO_SHARED_PASSWORD='<the demo password>' npm run dev
```

Open `http://localhost:3000/sign-in`.

## Tests

| Where | Command | What runs |
|---|---|---|
| `express-backend` | `npm run check` | lint, typecheck, fast tests (`node --test`) |
| `express-backend` | `DATABASE_URL='mysql://acme:acme_local@127.0.0.1:3317/acme_test' npm run test:db` | real-MySQL tests. Refuses any database not ending in `_test`, and drops its tables. |
| `express-backend` | `npm run build` | compiles `src/` and `scripts/` to `dist/` |
| `next-frontend` | `npm run check` | OpenAPI contract drift, lint, typecheck, Vitest unit and component tests |
| `next-frontend` | `npm run build && E2E_API_BASE_URL=… E2E_DEMO_PASSWORD=… npm run test:e2e` | Playwright, desktop and mobile, against a real backend (see the frontend README) |

## Demo personas

Both use the synthetic password shown on the sign-in page.

| Person | Email | Role | Access |
|---|---|---|---|
| Meera Iyer | `meera.iyer@acme.com` | Admin HR | All employees; applies and approves salary changes; HR access management; AI monitoring |
| Rohan Mehta | `rohan.mehta@acme.com` | Scoped HR | India, Support and Tech; raises salary requests; his own assistant conversations only |

The sign-in page also offers "Another HR account" for users that Admin HR creates in **HR Access**.

## AI observability

- **What is recorded.** Every assistant turn is a trace: the user's message, the instructions and prompt version sent to the model, each model call (model, duration, input/output/reasoning token counts, outcome), each tool call (requested arguments, validation result, the complete tool result or error class), the final answer, and where a failure happened. Arguments are scrubbed, so a `password` key is stored as `[REDACTED]`. Hidden model reasoning and credentials are never stored. Calls to the MCP endpoint are recorded separately, attempt first, so an invalid or failed call is still on record.
- **Fail closed.** The assistant does not call the model or a tool unless the attempt was recorded first.
- **Who sees it.** HR users see their own saved conversations. Only Admin HR can open **AI monitoring**: the overview (counts, failures by stage, p50/p95 duration, tokens, reviews), the trace list and detail, reviews (correct / partially correct / incorrect), controlled deletion, and MCP calls. The backend checks the role in MySQL on every request.
- **Formatted and raw views.** The formatted view replaces employee identities with placeholders (`Employee n`, `EMPLOYEE-n`). The raw view shows the exact stored JSON, unredacted, only after a synthetic-data warning.
- **30-day retention.** The assistant page tells users that conversations and tool results are kept for 30 days. Deletion is a guarded manual command (`ai:retention:dist`, dry run by default, `--execute --acknowledge-production` in production). It is not scheduled yet.
- This recording policy is approved for synthetic data only. Real employee data needs storage and display redaction first ([`docs_human/13-ai-observability.md`](docs_human/13-ai-observability.md)).

## Deployment

Railway, three services: MySQL, `express-backend` (private), `next-frontend` (public). Step-by-step clicks, variables, first-deploy seeding, the smoke checklist, rollback, and the list of what can break are in **[`docs/deploy/railway-runbook.md`](docs/deploy/railway-runbook.md)**.

## Known limitations and next steps

- **Name-only redaction gap.** The formatted trace view does not recognise a first name or surname typed on its own; only full identities are replaced. The raw view is unredacted by design. Acceptable for synthetic data, not for real data.
- **Deprecated `POST /assistant/messages`.** The old browser-history route still exists for compatibility and returns `Deprecation` and `Link` headers. Each call becomes a recorded turn in a new conversation using only the last user message. The frontend uses the conversation API. Next step: remove the route.
- **Two trace seed paths.** Deterministic trace fixtures are written by two separate scripts: the backend's `npm run eval:trace-fixtures` (`src/evaluation/trace-seed.ts`) and the frontend Playwright seed `next-frontend/tests/e2e/support/seed-ai-traces.mts`. Both write through the backend's observability repository, but they define their trace shapes separately and can drift. Next step: have the browser tests use the backend command.
- **HR-access lifecycle browser journeys are not automated.** Playwright covers "Admin creates a Scoped HR account and the user signs in". Later lifecycle steps (for example deactivating a user, changing scopes, regenerating a temporary password) are covered by API and component tests only.
- **Live-evaluation hard gates D1 and D2 (fixed in prompt v2, waiting for the evaluator's re-check).** The live evaluation on `gpt-6-luna` found two hard-gate failures. D1 (medium): for Scoped HR, answers described in-scope results as "company-wide" or "for the whole organization". D2 (low): refusals of change requests did not say where in the app the change is made. Everything else in that evaluation passed. Both are fixed in this build (AI task 05, prompt version `assistant-instructions-v2`):
  - Every Scoped HR ranking, summary, and recent-change result carries a fixed limitation built from the user's current scope (for example "Covers only employees in your access: India; Support, Tech."), and the instructions forbid calling such results company-wide.
  - Refusals name the place in the app for the user's role ("Adjust compensation", "Salary requests", and "HR Access" for Admin HR only).
  - These are verified by automated tests with a fake model only. The evaluator has not yet re-run the live cases, so D1 and D2 stay open until that re-check passes.
- **Single backend replica.** Login and assistant rate limits live in process memory.
- **Not built yet:** spreadsheet import, scheduled retention.
