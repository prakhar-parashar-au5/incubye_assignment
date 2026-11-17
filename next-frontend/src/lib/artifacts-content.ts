// Written content for /artifacts/tech-stack and /artifacts/how-it-was-built. Every claim names
// the repository file that shows it; tests/unit/artifacts.test.ts checks that each cited path
// exists, so a moved or deleted source makes the test fail rather than leaving a dead claim.

export type Source = { path: string; note?: string };

export type StackRow = {
  layer: string;
  choice: string;
  version: string;
  why: string;
  sources: Source[];
};

export const STACK: readonly StackRow[] = [
  {
    layer: 'Web app',
    choice: 'Next.js App Router with React, Cache Components on',
    version: 'next 16.4.6, react 19.3.1',
    why: 'Server Components render the data; the Next server is the only caller of the API (backend for frontend), so the browser never holds the session token.',
    sources: [{ path: 'next-frontend/package.json' }, { path: 'next-frontend/next.config.ts', note: 'cacheComponents: true' }, { path: 'docs/20-frontend-architecture.md', note: 'Frontend and backend boundary' }],
  },
  {
    layer: 'BFF boundary',
    choice: "One server-only API client; session JWT in an HttpOnly cookie (SameSite=Lax, __Host- prefix in production)",
    version: 'server-only 0.0.1',
    why: 'Browser → Next server → Express. The client adds the Bearer token, applies a timeout, and maps public errors.',
    sources: [{ path: 'next-frontend/src/server/api/client.ts' }, { path: 'next-frontend/src/server/cookie-policy.ts' }],
  },
  {
    layer: 'UI kit',
    choice: 'shadcn/ui components in the base-nova style, on Base UI, with Tailwind CSS and Lucide icons',
    version: '@base-ui/react 1.9.0, shadcn 4.23.0, tailwindcss 4.3.5, lucide-react 1.73.0',
    why: 'Copied, editable components (button, input, alert, sheet, native select) instead of a dependency; native controls kept where possible.',
    sources: [{ path: 'next-frontend/components.json' }, { path: 'next-frontend/src/components/ui/sheet.tsx' }, { path: 'DESIGN.md' }],
  },
  {
    layer: 'API server',
    choice: 'Express with strict TypeScript',
    version: 'express 5.3.0; typescript 6.0.3 (backend), 5.9.3 (frontend)',
    why: 'Express owns every business rule, access check, and recording. The backend was moved from JavaScript to TypeScript before the HTTP layer grew.',
    sources: [{ path: 'express-backend/package.json' }, { path: 'docs/18-review-findings-and-decisions.md', note: 'JavaScript was corrected before HTTP growth' }],
  },
  {
    layer: 'Contract',
    choice: 'Zod schemas → OpenAPI 3.1 document → generated frontend types, validated again at runtime with Ajv',
    version: 'zod 4.6.7, openapi-typescript 7.13.0, ajv 8.20.0',
    why: 'One source of truth for request and response shapes. Both sides have drift checks, and the frontend does not trust a response it has not validated.',
    sources: [{ path: 'express-backend/src/http/openapi.ts', note: 'z.toJSONSchema' }, { path: 'express-backend/openapi/openapi.json' }, { path: 'next-frontend/scripts/generate-api-contract.mjs' }, { path: 'next-frontend/src/server/api/contract.ts', note: 'Ajv2020' }],
  },
  {
    layer: 'Database',
    choice: 'MySQL 8.4 with the mysql2 driver and plain SQL migrations',
    version: 'mysql:8.4 image, mysql2 3.24.6',
    why: 'Exact DECIMAL money, transactions and row locks for salary changes, and real-MySQL tests for constraints and scope.',
    sources: [{ path: 'express-backend/docker-compose.yml' }, { path: 'express-backend/db/migrations/001_initial_schema.sql' }],
  },
  {
    layer: 'Assistant model',
    choice: 'OpenAI Responses API (responses.create), read-only tool loop',
    version: 'openai 7.57.0; default model gpt-6.1-sol, override with OPENAI_MODEL; 20 s call timeout; 1,500 output tokens',
    why: 'The model only calls read-only tools that apply the caller’s scope; without a key the app still works and records an "assistant is not configured" turn.',
    sources: [{ path: 'express-backend/src/assistant/openai-model.ts' }, { path: 'express-backend/src/http/config.ts', note: 'OPENAI_MODEL' }],
  },
  {
    layer: 'MCP',
    choice: 'MCP SDK v2: a stateless Streamable HTTP server at /api/v1/mcp, sharing the assistant’s tool registry',
    version: '@modelcontextprotocol/server 2.4.0, /node 2.1.2, /client 2.4.0',
    why: 'Non-browser agents get the same scoped, read-only tools as the assistant. The client package is used by the demo command.',
    sources: [{ path: 'express-backend/src/http/mcp-routes.ts' }, { path: 'express-backend/src/evaluation/demo-mcp-calls.ts' }],
  },
  {
    layer: 'Passwords and sessions',
    choice: 'Argon2id (19 MiB, t=2, p=1); HS256 JWT for two hours carrying only user and session IDs, checked against an hr_sessions row on every request',
    version: 'argon2 0.45.2, jose 6.2.17',
    why: 'OWASP minimum Argon2id parameters. Role, status, and scope are loaded from the database per request, so deactivation and scope changes apply on the next request.',
    sources: [{ path: 'express-backend/src/access/passwords.ts' }, { path: 'express-backend/src/access/session-tokens.ts' }, { path: 'express-backend/db/migrations/002_hr_access_control.sql', note: 'hr_sessions' }],
  },
  {
    layer: 'Tests',
    choice: 'Vitest with Testing Library (frontend); the Node test runner with tsx and Supertest (backend), plus a real-MySQL suite',
    version: 'vitest 5.1.0, @testing-library/react 16.3.3; node --test, tsx 4.23.15, supertest 7.3.2',
    why: 'Fast unit and component tests on each side, and separate database tests for constraints, transactions, and SQL scope.',
    sources: [{ path: 'next-frontend/vitest.config.mts' }, { path: 'express-backend/package.json', note: 'test, test:db' }],
  },
  {
    layer: 'Browser tests',
    choice: 'Playwright on desktop and mobile projects, with axe accessibility checks',
    version: '@playwright/test 1.65.1, @axe-core/playwright 4.14.0',
    why: 'Integrated journeys against production builds and a real backend; serious or critical axe findings fail the run.',
    sources: [{ path: 'next-frontend/playwright.config.ts' }],
  },
  {
    layer: 'Hosting',
    choice: 'Railway: three services (MySQL, express-backend, next-frontend); only the frontend has a public domain',
    version: 'Node 22.23.1 (engines and .nvmrc)',
    why: 'Configured from the dashboard following the runbook, with no railway.json. The backend pre-deploy step creates the database and runs migrations.',
    sources: [{ path: 'docs/deploy/railway-runbook.md' }, { path: 'next-frontend/.nvmrc' }],
  },
  {
    layer: 'Agent tooling',
    choice: 'An orchestrator with specialist builder and tester agents, one git worktree each; a semantic reviewer; computer-use testers; the Impeccable design skill',
    version: 'Not versioned',
    why: 'Parallel work with explicit ownership, independent review, and evidence files instead of trust in a builder’s report.',
    sources: [{ path: 'docs/26-multi-agent-build-journey.md' }, { path: 'semantic-review/2026-11-16-220122-pr-frontend-04.md' }, { path: 'docs/20-frontend-architecture.md', note: 'Impeccable design process' }],
  },
];

export type Decision = { decision: string; tradeOff: string; source: Source };

export const DECISIONS: readonly Decision[] = [
  {
    decision: 'Compensation is an effective-dated ledger of immutable versions, not a salary column on the employee.',
    tradeOff: 'History and future-dated changes are kept without overwriting, but every read must select the current row by effective date and version.',
    source: { path: 'docs/18-review-findings-and-decisions.md', note: 'Compensation moved to an effective-dated ledger' },
  },
  {
    decision: 'A short JWT proves identity only; the session, status, and scope come from MySQL on every request.',
    tradeOff: 'Deactivation, revocation, and scope changes apply on the next request, at the cost of a database read per authenticated call.',
    source: { path: 'docs/18-review-findings-and-decisions.md', note: 'Sessions must use current database authority' },
  },
  {
    decision: 'The browser talks only to the Next server, which talks to Express with a server-only base URL.',
    tradeOff: 'No token or backend URL reaches the browser, but every request takes one more hop and the frontend needs its own error mapping.',
    source: { path: 'docs/20-frontend-architecture.md', note: 'Frontend and backend boundary' },
  },
  {
    decision: 'INR and USD stay native. USD equivalents are computed in the directory query from a saved, dated rate snapshot.',
    tradeOff: 'No stale converted column, but salary sorting is refused when a required rate is missing.',
    source: { path: 'docs/18-review-findings-and-decisions.md', note: 'Stored USD salary would become stale' },
  },
  {
    decision: 'The login limit is keyed by caller network key plus a hash of the normalized email.',
    tradeOff: 'Users behind the shared Next server do not block each other; a per-browser-IP limit at the Next boundary is left as future work.',
    source: { path: 'docs/18-review-findings-and-decisions.md', note: 'IP-only rate limiting did not fit the Next.js boundary' },
  },
  {
    decision: 'Assistant tools are read-only, and complete AI inputs and outputs are recorded because the data is synthetic.',
    tradeOff: 'Full traces make evaluation possible, but this policy must be replaced with designed redaction before any real employee data is used.',
    source: { path: 'docs_human/13-ai-observability.md', note: 'Sensitive data policy' },
  },
];

export const ROLES: readonly { role: string; does: string; source: Source }[] = [
  { role: 'Orchestrator', does: 'Turns decisions into bounded tasks, routes them, reads the code, reruns the checks itself, and sends confirmed findings back as correction tasks.', source: { path: 'docs/26-multi-agent-build-journey.md', note: 'What the orchestrator does' } },
  { role: 'Backend builder', does: 'Express, MySQL, authorization, transactions, exact money, migrations, and OpenAPI.', source: { path: 'builder_docs/parent_instructions/index.md' } },
  { role: 'Frontend builder', does: 'Next.js pages, Server Actions, the generated contract, responsive layout, accessibility, and browser tests.', source: { path: 'builder_docs/frontend-builder/index.md' } },
  { role: 'AI backend builder', does: 'The read-only assistant, model adapter, tool loop, MCP adapter, trace recording, and Admin observability APIs.', source: { path: 'builder_docs/ai-builder/handoff.md' } },
  { role: 'AI traces frontend builder', does: 'Saved conversations and the Admin trace dashboard, from the accepted observability contract.', source: { path: 'builder_docs/ai-traces-frontend-builder/handoff.md' } },
  { role: 'QA tester', does: 'Uses only the visible app through computer use, as Admin HR and Scoped HR, and reports reproducible defects.', source: { path: 'docs/25-parallel-agent-launch-prompts.md', note: 'General HR computer-use tester' } },
  { role: 'AI evaluator', does: 'Judges each answer as an HR user, then checks the Admin trace and an independent source of the facts.', source: { path: 'tester_docs/ai-assistant-tester/handoff.md' } },
];

export type Step = { title: string; body: string; sources: Source[] };

export const WORKED_EXAMPLE: readonly Step[] = [
  {
    title: 'The AI evaluator finds two hard-gate failures',
    body: 'In live evaluation 01, D1: Scoped HR answers called in-scope results "company-wide". D2: refusals to change data gave no safe next step. Both are in section 8 of the evaluator’s report.',
    sources: [{ path: 'tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md', note: 'section 8' }],
  },
  {
    title: 'The orchestrator verifies them and writes AI Task 05',
    body: 'The task restates D1 and D2 with examples, fixes the scope of the change, bumps the prompt version, and lists the tests that must prove it.',
    sources: [{ path: 'builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md' }],
  },
  {
    title: 'The AI builder fixes D1 in two layers, and D2',
    body: 'Layer 1: every Scoped ranking, summary, and aggregate tool result carries a fixed limitation built from the user’s scope, such as "Covers only employees in your access: India; Support, Tech." Layer 2: prompt v2 adds the rule never to call scoped results company-wide. D2: refusals now name the page where each role can do the action.',
    sources: [{ path: 'builder_docs/ai-builder/responses/05-eval-01-hard-gate-fixes.md' }, { path: 'express-backend/src/assistant/tools.ts', note: 'scopeLimitation' }],
  },
  {
    title: 'The orchestrator reruns the checks',
    body: 'The task names the checks: lint, typecheck, the fast tests, the MySQL tests, the build, and OpenAPI drift. The orchestrator runs checks itself before accepting a task, instead of taking the builder’s report as proof. Traces from the fix carry the new prompt version, assistant-instructions-v2.',
    sources: [{ path: 'docs/26-multi-agent-build-journey.md', note: 'What the orchestrator does, item 7' }, { path: 'express-backend/src/assistant/assistant-service.ts', note: 'PROMPT_VERSION' }],
  },
  {
    title: 'The fix is merged; the evaluator re-checks D1 and D2',
    body: 'The task had no live-model rerun on purpose. The re-check of D1 and D2 is scheduled for the evaluator after the merge.',
    sources: [{ path: 'builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md', note: 'Not in scope' }],
  },
];

export const FLAKY_EXAMPLE: readonly Step[] = [
  {
    title: 'The deploy builder reports a red test outside its lane',
    body: 'One HR Access component test failed 4 times in 15 full runs and passed when run alone. It filed an issue instead of editing the frontend.',
    sources: [{ path: 'builder_docs/parent_instructions/issues/12-frontend-hr-access-test-flaky.md' }, { path: 'builder_docs/backend-builder/responses/12-railway-deployment-readiness.md' }],
  },
  {
    title: 'The orchestrator reproduces it',
    body: 'It failed in 2 of 6 full runs, and the orchestrator routed it to the frontend builder.',
    sources: [{ path: 'builder_docs/frontend-builder/tasks/07-artifacts-section.md', note: 'records the orchestrator’s counts' }],
  },
  {
    title: 'The frontend builder finds the root cause',
    body: 'A requestAnimationFrame focus move from the previous test fired during the next one and took focus while it typed. The fix cancels the pending frame on unmount or when the route is hidden, with a regression test; no retries were added.',
    sources: [{ path: 'builder_docs/frontend-builder/responses/06-qa-run-03-fixes.md', note: 'Follow-up: flaky test' }, { path: 'next-frontend/src/app/hr-access/hr-access-workspace.tsx', note: 'focusSoon' }],
  },
  {
    title: 'The orchestrator confirms it',
    body: 'Zero failures in 5 full runs.',
    sources: [{ path: 'builder_docs/frontend-builder/tasks/07-artifacts-section.md', note: 'records the orchestrator’s counts' }],
  },
];

/** Cited paths that are not on master yet. They render as text, not as links that would 404. */
export const NOT_ON_MASTER: ReadonlySet<string> = new Set<string>([]);
