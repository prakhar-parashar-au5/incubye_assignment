import evolution from '@/artifacts/evolution.json';
import type { Source } from '@/lib/artifacts-content';

// Content for the Task 07a artifact pages. Hand-written summaries: the app has no markdown
// library, and next-frontend is built on its own on Railway, so docs/ is not there to render at
// run time. Every claim names its source; tests/unit/artifacts-more.test.ts checks each path.

// ---------------------------------------------------------------- Requirements

export const REQUIREMENTS_SOURCE = 'docs/requirements.md';
export const REQUIREMENTS_ORIGINAL = 'docs_human/requirements.md';

export const REQUIREMENTS: { heading: string; points: string[] }[] = [
  {
    heading: 'Goal',
    points: [
      'Replace the riskiest parts of ACME’s spreadsheet workflow for 10,000 employees across several countries.',
      'An HR manager finds an employee, understands current compensation, previews and records a salary change, and sees who changed what.',
      'Organisation summaries never combine currencies silently.',
    ],
  },
  {
    heading: 'Core workflow',
    points: ['Sign in, see an overview, find an employee by name or stable ID, filter by department and country, open the record, preview a percentage or replacement base-salary change, confirm it, and see the audit history and updated totals.'],
  },
  {
    heading: 'In scope',
    points: [
      'Demo access: Admin HR manages everything; Scoped HR sees only employees matching both an assigned country and an assigned department, enforced on every server operation.',
      'Employee directory: server-side search, filters, sorting, and pagination over 10,000 deterministic synthetic employees.',
      'Compensation model: exact money with explicit currency; annual base salary is authoritative and monthly salary is derived; different currencies are never added together.',
      'Salary changes: preview before confirming, reason and note, immediate and future-dated changes, immutable history; a stale change fails instead of overwriting; the change and its audit event are one transaction.',
      'Also listed: employee management, spreadsheet import, analytics grouped by currency, access management, a read-only “Raise Advisor”, and a finance CSV export.',
    ],
  },
  {
    heading: 'Deliberately excluded',
    points: ['Payroll payments, payslips, bank instructions, tax, currency conversion, payroll compliance, equity administration, broad natural-language database access, autonomous salary changes, MCP integration, bulk review cycles, and an agent dashboard.'],
  },
  {
    heading: 'Quality and success criteria',
    points: [
      'Loading, empty, validation, permission, stale-edit, and failure states; accessible, keyboard-operable controls; desktop and mobile widths; no salary data in logs.',
      'Fast unit tests for rules, real-MySQL tests for permissions, transactions, and stale writes, and a small browser suite.',
      'Success: the deployed demo completes the core workflow, the two apps run independently over a versioned REST contract, and the seed reproducibly creates 10,000 employees.',
    ],
  },
];

/** Where the build moved away from the requirements, each with the file that shows it. */
export const REQUIREMENTS_CHANGES: { change: string; sources: Source[] }[] = [
  {
    change: 'MCP was listed as excluded, then added later by decision: a read-only, authenticated MCP endpoint exposing the same tools as the assistant.',
    sources: [{ path: 'builder_docs/parent_instructions/08-ai-assistant-mcp.md' }, { path: 'builder_docs/shared/ai-assistant-contract.md', note: 'MCP' }],
  },
  {
    change: 'The AI work became a read-only compensation assistant with recorded traces, not the Raise Advisor described here.',
    sources: [{ path: 'builder_docs/parent_instructions/08-ai-assistant-mcp.md' }, { path: 'docs_human/13-ai-observability.md' }],
  },
  {
    change: 'Spreadsheet import and scheduled trace retention are not built yet.',
    sources: [{ path: 'README.md', note: 'Known limitations and next steps' }],
  },
];

// ---------------------------------------------------------------- Decisions

export type DecisionCard = { title: string; decision: string; options: string; why: string; cost: string; sources: Source[] };

export const DECISION_CARDS: readonly DecisionCard[] = [
  {
    title: 'MySQL 8 with raw SQL',
    decision: 'MySQL 8 through mysql2, plain SQL queries and migrations, no ORM.',
    options: 'An ORM versus raw SQL is recorded. SQLite or another database is not discussed anywhere in the repository.',
    why: 'The schema and queries stay visible, and an ORM adds little at this size. Salary changes rely on row locks (SELECT … FOR UPDATE) and DECIMAL columns, and the tests run against real MySQL 8, not mocks.',
    cost: 'Every query is hand-written. MySQL DDL is not transactional, so migrations are forward-only and a failed one is not rolled back automatically.',
    sources: [{ path: 'docs_human/04-workbook-database-seed-raw.md', note: 'basic choices' }, { path: 'docs_human/11-salary-adjustments.md', note: 'Compensation version and row lock' }, { path: 'docs/06-schema-test-plan.md' }, { path: 'docs/18-review-findings-and-decisions.md', note: 'MySQL schema migrations are not fully transactional' }],
  },
  {
    title: 'The Next server is the only API caller',
    decision: 'Browser → Next.js server → Express. The session JWT lives in an HttpOnly cookie and the API base URL is server-only.',
    options: 'A browser that calls Express directly with a public base URL (NEXT_PUBLIC_API_BASE_URL) is ruled out.',
    why: 'The browser never receives a JWT, an Authorization header, a database URL, or a backend secret.',
    cost: 'One more hop per request, a server-side API client with its own timeout and error mapping, and Express sees the Next server as the caller, which shaped the login rate limit.',
    sources: [{ path: 'docs/20-frontend-architecture.md', note: 'Frontend and backend boundary' }, { path: 'docs/18-review-findings-and-decisions.md', note: 'IP-only rate limiting did not fit the Next.js boundary' }],
  },
  {
    title: 'Scope comes from MySQL on every request',
    decision: 'A two-hour JWT carries identity and session only. Session, status, and scopes are loaded from the database for every authenticated request.',
    options: 'A 24-hour JWT that carries access was the initial idea.',
    why: 'With access in the token, a deactivated user could keep reading or changing compensation until it expired.',
    cost: 'A database read on every authenticated call.',
    sources: [{ path: 'docs/18-review-findings-and-decisions.md', note: 'Sessions must use current database authority' }, { path: 'docs/10-access-control-design.md', note: 'Sessions' }],
  },
  {
    title: 'Versioned compensation, stale checks, idempotency keys',
    decision: 'Compensation is immutable versions. Every change carries the expected version, locks the employee row, and needs an idempotency key bound to the exact command.',
    options: 'Overwriting a salary column on the employee. For idempotency, matching on the outcome rather than a fingerprint of the command, which the first build did.',
    why: 'History and future-dated changes survive, a stale change fails instead of overwriting, and a retried request replays its result rather than applying twice.',
    cost: 'Reads must pick the current version by effective date. Each mutation needs a lock, a version re-read, and a stored command fingerprint; the same key with a different command is a conflict.',
    sources: [{ path: 'docs/18-review-findings-and-decisions.md', note: 'Compensation moved to an effective-dated ledger' }, { path: 'docs_human/11-salary-adjustments.md', note: 'Idempotency' }, { path: 'builder_docs/parent_instructions/09a-salary-idempotency-review-fix.md' }],
  },
  {
    title: 'Exact decimal money, one currency at a time',
    decision: 'Amounts have at most two decimals, use exact decimal arithmetic with half-up rounding once, and are stored as DECIMAL(15,2). Different currencies are never added together.',
    options: 'JavaScript floating point for authoritative amounts is ruled out. Trusting MySQL to reject a third decimal place does not work: it rounds silently.',
    why: 'Compensation must be exact, and a sum of INR and USD has no meaning.',
    cost: 'Input is validated before insertion, and every total is per currency, so there is no single company-wide figure.',
    sources: [{ path: 'docs_human/11-salary-adjustments.md', note: 'Money and rounding' }, { path: 'docs/18-review-findings-and-decisions.md', note: 'MySQL rounds a third decimal place' }, { path: 'docs/requirements.md', note: 'Compensation model' }],
  },
  {
    title: 'USD only as a dated comparison',
    decision: 'Native compensation stays authoritative. USD equivalents are computed in the directory query from a saved, dated rate snapshot.',
    options: 'A stored USD salary column used for sorting.',
    why: 'A stored column goes stale when the rate changes and conflicts with the rule against silent conversion.',
    cost: 'Salary sorting is refused when a required rate is missing.',
    sources: [{ path: 'docs/18-review-findings-and-decisions.md', note: 'Stored USD salary would become stale' }],
  },
  {
    title: 'Existence privacy',
    decision: 'An employee outside the caller’s scope gets the same 404 as one that does not exist, and search and counts reveal nothing outside scope.',
    options: 'A 403 for an inaccessible employee would confirm that it exists.',
    why: 'Scoped HR must not learn names, IDs, or counts outside its access. Saved conversations follow the same rule.',
    cost: 'Scoped HR cannot tell “no such employee” from “not yours”.',
    sources: [{ path: 'docs_human/08-employee-directory-apis.md', note: 'Permission behavior' }, { path: 'docs_human/13-ai-observability.md', note: 'same 404 for unknown and unowned conversations' }],
  },
  {
    title: 'Zod is the contract source',
    decision: 'Zod schemas validate requests at run time and generate the OpenAPI document. The frontend generates its types from that file and validates responses again.',
    options: 'A handwritten copy of backend response interfaces in the frontend is ruled out.',
    why: 'One source for request and response shapes, with a drift check on each side.',
    cost: 'A generation step and two drift checks to keep green, and the frontend repeats validation with Ajv.',
    sources: [{ path: 'docs/14-authentication-api-design.md', note: 'OpenAPI' }, { path: 'docs/20-frontend-architecture.md', note: 'API contract' }, { path: 'express-backend/src/http/openapi.ts' }],
  },
  {
    title: 'AI recording fails closed',
    decision: 'Each step is recorded before it runs and its outcome after. If the trace cannot be saved, the assistant does not call the model or a tool and returns a generic error.',
    options: 'Best-effort logging after the fact.',
    why: 'Every model and tool call can then be reviewed. A failure in the AI path must not affect any other feature.',
    cost: 'A trace-storage failure stops the assistant.',
    sources: [{ path: 'docs_human/13-ai-observability.md', note: 'Trace lifecycle' }],
  },
  {
    title: 'Option C: withhold saved answers when scope narrows',
    decision: 'Each trace records the actor’s role and scope. If the current scope no longer covers it, the whole saved answer is withheld and left out of model history.',
    options: 'A: keep the partial re-filtering of rows. B: drop summaries and replace prose whenever any row was removed. C: record the scope and compare.',
    why: 'Narrowing a Scoped HR user’s scope is a supported HR Access workflow, and summaries and answer prose cannot be re-checked row by row.',
    cost: 'A migration (007), and a user loses access to earlier answers after the scope shrinks. Stored data is not modified.',
    sources: [{ path: 'builder_docs/ai-builder/issues/03-saved-content-after-scope-change.md' }, { path: 'builder_docs/ai-builder/responses/03a-persistent-assistant-review-fixes.md', note: 'Option C' }],
  },
  {
    title: 'A read-only assistant and read-only MCP tools',
    decision: 'The assistant and the MCP endpoint share one registry of read-only, scope-aware tools. No mutation tool and no arbitrary SQL.',
    options: 'The requirements allowed an advisor that could create a proposal for the normal workflow; direct agent mutation was deferred.',
    why: 'Salary changes keep their preview, confirm, version, and audit path. After evaluation 01, refusals name the page where the change is made.',
    cost: 'The assistant cannot do work for the user; every change goes through the UI.',
    sources: [{ path: 'builder_docs/shared/ai-assistant-contract.md' }, { path: 'docs_human/11-salary-adjustments.md', note: 'Deliberately excluded: agent-executed mutation' }, { path: 'builder_docs/ai-builder/responses/05-eval-01-hard-gate-fixes.md', note: 'D2' }],
  },
  {
    title: 'MCP uses the app’s Bearer JWT, no OAuth',
    decision: 'MCP requests authenticate with the same Bearer JWT and the same database access check as the API.',
    options: 'A separate MCP authorization scheme such as OAuth is not discussed in the repository.',
    why: 'One principal, loaded from MySQL, for every caller; the server never takes identity from tool arguments.',
    cost: 'An MCP client must sign in with HR credentials first. On Railway the backend has no public domain, so the MCP endpoint is reachable only on the private network.',
    sources: [{ path: 'builder_docs/shared/ai-assistant-contract.md', note: 'MCP' }, { path: 'docs_human/13-ai-observability.md', note: 'principal comes from the server' }, { path: 'README.md', note: 'Architecture' }],
  },
  {
    title: 'What was left out on purpose',
    decision: 'No payroll, payslips, tax, bank instructions, or equity administration. No SSO, MFA, password reset, or email. No bulk review cycles or multi-stage approval.',
    options: 'The requirements list payroll, tax, equity, and review cycles as excluded; the HR access API lists SSO, MFA, password reset, and email as out of scope.',
    why: 'They would dilute the core workflow or need compliance and operational controls beyond this assessment.',
    cost: 'Temporary passwords are shared outside the app, and Admin HR regenerates a lost one.',
    sources: [{ path: 'docs/requirements.md', note: 'Deliberately excluded' }, { path: 'builder_docs/responses/11-hr-access-management-api.md', note: 'out of scope' }, { path: 'docs_human/11-salary-adjustments.md', note: 'Deliberately excluded' }],
  },
];

// ---------------------------------------------------------------- Specs

export type SpecPair = { topic: string; human: string; agent: string[]; basis: string };

/** Human spec → agent documents built from it. `basis` says how the pairing is shown in the repo. */
export const SPEC_PAIRS: readonly SpecPair[] = [
  { topic: 'Requirements', human: 'docs_human/requirements.md', agent: ['docs/requirements.md'], basis: 'Same document, expanded' },
  { topic: 'Source workbook', human: 'docs_human/01-source-workbook.md', agent: ['docs/01-source-workbook.md', 'docs/02-synthetic-data-rules.md', 'docs/03-generator-test-plan.md'], basis: 'docs/18 pairs it with docs/01; the others have the same topic' },
  { topic: 'Generator tests', human: 'docs_human/02-generator-tests-raw.md', agent: ['docs/03-generator-test-plan.md'], basis: 'Same topic' },
  { topic: 'Database schema', human: 'docs_human/03-db-schema-raw.md', agent: ['docs/05-initial-database-schema.md', 'docs/06-schema-test-plan.md'], basis: 'docs/18 pairs it with the design; the test plan has the same topic' },
  { topic: 'Workbook seed', human: 'docs_human/04-workbook-database-seed-raw.md', agent: ['docs/08-workbook-seed-design.md', 'docs/09-workbook-seed-test-plan.md'], basis: 'Same topic' },
  { topic: 'Access control', human: 'docs_human/05-access-control-raw.md', agent: ['docs/10-access-control-design.md', 'docs/11-access-control-test-plan.md'], basis: 'docs/18 pairs it with the design; the test plan has the same topic' },
  { topic: 'TypeScript migration', human: 'docs_human/06-typescript-migration-raw.md', agent: ['docs/12-typescript-migration-design.md', 'docs/13-typescript-migration-test-plan.md'], basis: 'docs/18 pairs it with the design; the test plan has the same topic' },
  { topic: 'Authentication API', human: 'docs_human/07-auth-api-raw.md', agent: ['docs/14-authentication-api-design.md', 'docs/15-authentication-api-test-plan.md'], basis: 'Same topic; docs/18 cites the human spec' },
  { topic: 'Employee directory API', human: 'docs_human/08-employee-directory-apis.md', agent: ['docs/16-employee-directory-api-design.md', 'docs/17-employee-directory-api-test-plan.md'], basis: 'docs/18 pairs it with the design; the test plan has the same topic' },
  { topic: 'Frontend directory', human: 'docs_human/09-frontend-directory.md', agent: ['docs/19-frontend-directory-spec-draft.md', 'docs/20-frontend-architecture.md', 'docs/21-frontend-test-plan.md'], basis: 'docs/19 and docs/20 cite it' },
  { topic: 'Compensation dashboard', human: 'docs_human/10-compensation-dashboard.md', agent: ['builder_docs/parent_instructions/10-dashboard-analytics-api.md', 'builder_docs/frontend-builder/tasks/04-dashboard-ui.md'], basis: 'The tasks cite it' },
  { topic: 'Salary adjustments', human: 'docs_human/11-salary-adjustments.md', agent: ['builder_docs/parent_instructions/09-salary-adjustments-backend.md', 'builder_docs/parent_instructions/09a-salary-idempotency-review-fix.md', 'builder_docs/frontend-builder/tasks/03-salary-adjustments-ui.md', 'builder_docs/frontend-builder/tasks/03b-salary-review-fixes.md'], basis: 'The tasks cite it' },
  { topic: 'HR access management', human: 'docs_human/12-hr-access-management.md', agent: ['builder_docs/parent_instructions/11-hr-access-management-api.md', 'builder_docs/frontend-builder/tasks/05-hr-access-management-ui.md'], basis: 'The tasks cite it' },
  { topic: 'AI observability', human: 'docs_human/13-ai-observability.md', agent: ['builder_docs/ai-builder/tasks/01-observability-storage-foundation.md', 'builder_docs/ai-builder/tasks/03-persistent-recorded-assistant.md', 'builder_docs/ai-builder/tasks/04-mcp-and-admin-observability-api.md'], basis: 'The tasks cite it' },
];

export const SALARY_EXAMPLE = {
  human: [
    'Admin HR applies a change directly; Scoped HR submits a request that Admin HR approves or cancels.',
    'Every change is previewed first; the preview returns the expected compensation version.',
    'Money: at most two decimals, exact arithmetic, half-up rounding once.',
    'The transaction locks the employee row (SELECT … FOR UPDATE) and re-reads the latest version.',
    'Idempotency keys on request creation, direct change, approval, and cancellation: same key and command replays, a different command conflicts.',
    'Excluded: bulk changes, review cycles, multi-stage approval, currency changes, agent-executed mutation.',
  ],
  humanSources: [{ path: 'docs_human/11-salary-adjustments.md' }] as Source[],
  agents: [
    { added: 'Split the spec into a backend task with named tests, then a frontend task and its UI shape.', sources: [{ path: 'builder_docs/parent_instructions/09-salary-adjustments-backend.md' }, { path: 'builder_docs/frontend-builder/tasks/03-salary-adjustments-ui.md' }] },
    { added: 'Review found that a direct change stored the key but not the command, so two different inputs that round to the same result would replay. Fix: a SHA-256 fingerprint of the canonical command.', sources: [{ path: 'builder_docs/parent_instructions/09a-salary-idempotency-review-fix.md' }] },
    { added: 'Review found a success message that a URL parameter could fake, and an approval screen without the current compensation. Fix: outcome notices from stored state, and the full compensation before the decision.', sources: [{ path: 'semantic-review/2026-11-16-200222-pr-frontend-03.md' }, { path: 'builder_docs/frontend-builder/tasks/03b-salary-review-fixes.md' }, { path: 'docs/26-multi-agent-build-journey.md', note: 'What the orchestrator does' }] },
  ] as { added: string; sources: Source[] }[],
};

// ---------------------------------------------------------------- Performance and testing

export const PERFORMANCE_DOC = 'docs/performance.md';
export const TESTING_DOC = 'docs/testing.md';
const EVIDENCE = 'builder_docs/backend-builder/responses/13-evidence';

/** A measured row. Times are wall time of the whole service call in ms over 30 runs (p50 / p95). */
export type MeasuredRow = { query: string; rows: string; p50: string; p95: string; note: string };
export type MeasuredTable = { id: string; title: string; caption: string; rows: MeasuredRow[]; sources: Source[] };

export const PERFORMANCE_SETUP: { label: string; value: string }[] = [
  { label: 'Date', value: 'Every figure is from runs on 2026-11-17' },
  { label: 'Machine', value: 'Apple M4 Pro, 12 cores, 24 GB; Docker VM with 12 CPUs, 7.7 GB' },
  { label: 'Database', value: 'Fresh mysql:8.4 (8.4.13) on tmpfs, migrations 001–008' },
  { label: 'Data', value: '10,000 employees, 10,012 compensation records, 6 salary requests, 5 HR users, 10,000 AI traces over 90 days' },
  { label: 'Method', value: 'Real services through a pool wrapper that records each SQL statement; p50 and p95 over 30 runs after 2 warm-up calls; rows examined from performance_schema; plans from EXPLAIN' },
  { label: 'Limits', value: 'Local and single-user, no concurrency. History is thin (12 non-import changes), so history-heavy queries were measured at that volume only.' },
];

export const PERFORMANCE_TABLES: readonly MeasuredTable[] = [
  {
    id: 'perf-directory',
    title: 'Employee directory',
    caption: 'Selected directory measurements',
    rows: [
      { query: 'Partial name search, Admin', rows: '20,149', p50: '10.8', p95: '12.4', note: "LIKE '%…%' scans every employee" },
      { query: 'Exact employee code, Admin', rows: '20,053', p50: '11.4', p95: '12.1', note: 'The OR with name search stops MySQL using the unique code index' },
      { query: 'Partial name, Scoped HR', rows: '13,641', p50: '9.4', p95: '10.1', note: 'Scope in SQL narrows the scan' },
      { query: 'Filter currency USD, Admin', rows: '25,933', p50: '27.9', p95: '28.7', note: 'The count also needs the compensation join' },
      { query: 'Sort by employee code, page 1', rows: '10,149', p50: '1.6', p95: '2.9', note: 'Best case: read in index order' },
      { query: 'Sort by annual base salary (USD comparison), page 1', rows: '30,097', p50: '31.6', p95: '32.9', note: 'Slowest page-1 sort' },
      { query: 'Sort by name, last page (400)', rows: '40,072', p50: '31.2', p95: '32.5', note: 'Offset cost: page 1 of the same sort is 6.6 ms' },
      { query: 'Employee detail with history', rows: '2', p50: '0.7', p95: '0.8', note: 'Unique-key lookup' },
      { query: 'Directory options, Scoped HR', rows: '11,112', p50: '11.9', p95: '12.2', note: 'Filter choices' },
    ],
    sources: [{ path: PERFORMANCE_DOC, note: 'Directory' }, { path: `${EVIDENCE}/harness-directory.jsonl` }],
  },
  {
    id: 'perf-dashboard',
    title: 'Dashboard',
    caption: 'Selected dashboard measurements',
    rows: [
      { query: 'Summary, Admin (8 statements in parallel)', rows: '141,160', p50: '47.6', p95: '52.7', note: 'The heaviest call in the app: 14× the employee count' },
      { query: 'Summary, Scoped HR', rows: '88,522', p50: '33.3', p95: '35.5', note: '' },
      { query: 'Breakdown by department with median, Admin', rows: '8,500', p50: '37.7', p95: '38.6', note: 'Window function in SQL' },
      { query: 'Recent changes, 90 days, Admin', rows: '20,134', p50: '2.9', p95: '3.1', note: 'Full scan of compensation_records; grows with history' },
      { query: 'Without adjustment in 12 months, page 1, Admin', rows: '44,239', p50: '25.0', p95: '25.8', note: 'The count does most of the work' },
    ],
    sources: [{ path: PERFORMANCE_DOC, note: 'Dashboard' }, { path: `${EVIDENCE}/harness-dashboard.jsonl` }],
  },
  {
    id: 'perf-tools',
    title: 'Assistant tools (the tool only, not the model)',
    caption: 'Selected assistant tool measurements',
    rows: [
      { query: 'get_employee_compensation, Admin', rows: '2', p50: '0.9', p95: '1.5', note: 'Unique-key lookup' },
      { query: 'get_employee_compensation, out of scope', rows: '0', p50: '0.4', p95: '0.6', note: 'Stops at the first statement' },
      { query: 'get_top_compensated_employees, annual cash, Admin', rows: '35,505', p50: '25.1', p95: '26.0', note: 'Ranks every current employee in SQL, returns 5' },
      { query: 'get_compensation_summary by department, Admin', rows: '35,510', p50: '21.8', p95: '23.0', note: '' },
    ],
    sources: [{ path: PERFORMANCE_DOC, note: 'Assistant tools' }, { path: `${EVIDENCE}/harness-tools.jsonl` }],
  },
];

export const PERFORMANCE_FINDINGS: { title: string; body: string; sources: Source[] }[] = [
  {
    title: 'Tool calls are far inside the turn budget',
    body: 'The slowest tool call measured is 26.0 ms at p95, against the assistant’s 45 s turn budget.',
    sources: [{ path: PERFORMANCE_DOC, note: 'Assistant tools' }],
  },
  {
    title: 'Migration 008 removes full scans from the AI summary',
    body: 'For the 30-day window with 10,000 traces, the summary examines 30,056 rows with the covering index and 56,712 without it, where the plans fall back to a full index scan and a full table scan. The wall-time difference at this size is small and not consistent: p50 5.9–6.4 ms with the index, 6.0 ms without.',
    sources: [{ path: PERFORMANCE_DOC, note: 'AI monitoring summary and migration 008' }, { path: `${EVIDENCE}/admin-observability-query-plans.txt` }],
  },
  {
    title: 'Stale statistics right after a bulk seed',
    body: 'On a freshly seeded database the Admin dashboard summary took 10,190.0 ms (median of 5). After ANALYZE TABLE compensation_records, employees it took 42.3 ms. The department and country breakdowns dropped from 8,850.7 and 8,349.4 ms to 37.2 and 34.6 ms. Nothing in the code runs ANALYZE TABLE today.',
    sources: [{ path: PERFORMANCE_DOC, note: 'Stale statistics after a bulk load' }, { path: `${EVIDENCE}/stale-statistics-fresh-seed.txt` }, { path: `${EVIDENCE}/stale-statistics-after-analyze.txt` }],
  },
  {
    title: 'Seed time',
    body: 'Loading 10,000 employees and 10,000 compensation records took 1.03–1.20 s with the compiled script over 5 runs, and 1.25–1.32 s through tsx over 3 runs, Node start-up included.',
    sources: [{ path: PERFORMANCE_DOC, note: 'Seed' }],
  },
  {
    title: 'Cross-checks agree',
    body: 'The existing measurement scripts give medians in line with the harness: directory default page 6.5 ms, base-salary sort 30.7 ms; Admin dashboard summary 40.1 ms.',
    sources: [{ path: `${EVIDENCE}/measure-directory.txt` }, { path: `${EVIDENCE}/measure-dashboard.txt` }],
  },
];

export const PERFORMANCE_NEXT = {
  note: 'Listed as actions at 10× (100,000 employees). Nothing was measured at that size.',
  items: [
    'Run ANALYZE TABLE at the end of the seed and any bulk import (the measured fix above).',
    'Exact-match fast paths for a full employee code or email.',
    'Keyset pagination for deep pages, and cached or approximate totals.',
    'Store the selected compensation per employee to remove the per-employee lateral join.',
    'An index on compensation_records (created_at) for recent changes.',
  ],
  sources: [{ path: PERFORMANCE_DOC, note: 'At 10× (100,000 employees)' }] as Source[],
};

export const TESTING_LAYERS: { layer: string; command: string; tests: string; result: string; time: string }[] = [
  { layer: 'Backend fast: unit, HTTP with fakes, CLI', command: 'npm test (express-backend)', tests: '464 in 38 files', result: '464 pass, 0 fail, 0 skipped', time: '4.8–5.9 s over 3 runs' },
  { layer: 'Backend against real MySQL', command: 'npm run test:db (express-backend)', tests: '404 in 21 files', result: '404 pass, 0 fail, 0 skipped', time: '95.0 s, one file at a time' },
  { layer: 'Frontend unit and component (Vitest)', command: 'npm test (next-frontend)', tests: '299 in 18 files', result: '299 pass in each of 6 runs', time: '2.1–2.6 s' },
  { layer: 'Playwright, desktop 1440 px and mobile 390 px', command: 'npm run test:e2e (next-frontend)', tests: '138 test runs in 7 specs', result: '129 passed, 9 skipped, 0 failed (cited from the frontend builder, not rerun)', time: '5.7 min' },
];

export const TESTING_COVERAGE: { suite: string; lines: string; branches: string }[] = [
  { suite: 'Backend fast suite', lines: '78.5% (10,409 / 13,263)', branches: '88.8% (1,430 / 1,611)' },
  { suite: 'Backend MySQL suite', lines: '98.3% (13,572 / 13,804)', branches: '87.0% (2,786 / 3,204)' },
  { suite: 'Frontend', lines: 'Not measured', branches: 'Not measured: no coverage provider is installed' },
];

export const TESTING_POINTS: { title: string; body: string; sources: Source[] }[] = [
  {
    title: 'Why the fast suites are deterministic',
    body: 'A fixed workbook seed and generation date, injected clocks in the services and the rate limiter, a fake model that never calls OpenAI, a fake backend at the frontend boundary, no network, and MySQL tests split out so the fast suite runs without Docker in about 5 s.',
    sources: [{ path: TESTING_DOC, note: 'Why the fast suites stay fast and deterministic' }, { path: 'express-backend/test/support/fake-model.ts' }, { path: 'next-frontend/tests/support/fake-backend.ts' }],
  },
  {
    title: 'Isolated test databases',
    body: 'The test helper refuses any database whose name does not end in _test, and each MySQL test file drops every table before it runs. The two suites cover different code: SQL-heavy services have low fast-suite line coverage and 96–100% in the MySQL suite.',
    sources: [{ path: 'express-backend/test/support/test-database.ts' }, { path: TESTING_DOC, note: 'Coverage' }],
  },
];

export const TESTS_THAT_MATTER: { name: string; proves: string; source: Source }[] = [
  { name: 'Two concurrent direct changes against one version', proves: 'Exactly one gets 201 and the other 409 STALE_VERSION; one new version is stored. Prevents a lost salary update.', source: { path: 'express-backend/test/db/salary-adjustments.test.ts' } },
  { name: 'Out-of-scope, unknown, and malformed detail requests return identical 404 bodies', proves: 'Scoped HR cannot learn that a hidden employee exists.', source: { path: 'express-backend/test/db/employee-directory.test.ts' } },
  { name: 'A saved answer is withheld once the current scope stops covering the trace-time scope', proves: 'Option C: a narrowed scope hides earlier answers; storage is unchanged.', source: { path: 'express-backend/test/db/assistant-conversations.test.ts' } },
  { name: 'Attempt-write failure: the tool never runs; outcome-write failure: no result is returned', proves: 'Fail-closed MCP recording: no unaudited data read.', source: { path: 'express-backend/test/http-mcp-recording.test.ts' } },
  { name: 'The committed openapi/openapi.json matches the generated contract', proves: 'The frontend’s generated types cannot drift from what the API returns.', source: { path: 'express-backend/test/http-openapi.test.ts' } },
];

// ---------------------------------------------------------------- AI evaluation

export const EVAL_REPORT = 'tester_docs/ai-assistant-tester/responses/01-live-assistant-and-trace-evaluation.md';
export const EVAL_TASK = 'tester_docs/ai-assistant-tester/tasks/01-live-assistant-and-trace-evaluation.md';

export const EVAL_METHOD: { title: string; body: string; sources: Source[] }[] = [
  { title: 'Two passes per prompt', body: 'First the visible answer, cards, limitations, and latency are judged as an HR user would see them. Only then is the matching Admin trace opened and reconciled: model calls, tool calls, arguments, results, tokens, and the final answer.', sources: [{ path: EVAL_TASK, note: 'Two-pass rule' }] },
  { title: 'Hard gates kept apart from quality scores', body: 'Deterministic gates (scope, existence privacy, exact money, currency, time, no mutation, tool validity, trace completeness, no secrets) pass or fail on their own. Answer quality is scored 0 to 3 per dimension, and a hard-gate failure blocks acceptance whatever the scores.', sources: [{ path: 'tester_docs/ai-assistant-tester/handoff.md' }, { path: EVAL_TASK, note: 'Hard gates' }, { path: EVAL_REPORT, note: 'verdict' }] },
  { title: 'Independent oracles', body: 'Answers are checked against the frozen app’s directory, detail, and dashboard values and approved fixture values, not against the trace alone, because an answer and its trace can share the same wrong tool result.', sources: [{ path: EVAL_TASK, note: 'Independent oracle' }, { path: 'tester_docs/ai-assistant-tester/oracle-fixture-manifest.json' }] },
];

export const EVAL_RUN: { label: string; value: string }[] = [
  { label: 'Model', value: 'gpt-6-luna (operator override); the product default is gpt-6.1-sol' },
  { label: 'Prompt version', value: 'assistant-instructions-v1' },
  { label: 'Corpus', value: 'All 28 live cases; 47 turns on luna plus 1 on sol' },
  { label: 'Personas', value: 'Meera (Admin HR) and Rohan (Scoped HR), in separate browser contexts' },
];

export const EVAL_GATES: { gate: string; result: string }[] = [
  { gate: 'D1: honest scope (grounding)', result: 'Failed, 0 of 3' },
  { gate: 'D2: refusal gives a safe next action', result: 'Failed: E24 1 of 3, E25 0 of 1, E26 0 of 1; E27 passed' },
  { gate: 'Scope, existence privacy, exact money, currency, time, no mutation, tool validity, trace complete, no secrets, no guess, context', result: 'Passed on every applicable turn' },
];

export const EVAL_DEFECTS: { id: string; finding: string; fix: string }[] = [
  {
    id: 'D1 (medium)',
    finding: 'Rohan asked for the company-wide top five and the whole-organization total. The data was correct and in scope, but the answer called it “company-wide … across 3,901 employees”.',
    fix: 'Every Scoped HR ranking, summary, and recent-change result now carries a fixed limitation built from the user’s scope, and prompt v2 forbids calling such results company-wide.',
  },
  {
    id: 'D2 (low)',
    finding: 'Requests to raise a salary, approve a request, or deactivate an HR account got a bare “I’m read-only”. No tool was called and nothing changed.',
    fix: 'Refusals now name the page for the user’s role: “Adjust compensation”, “Salary requests”, and “HR Access” for Admin HR only.',
  },
];

export const EVAL_RECHECK = {
  status: 'Not run yet. The fixes are verified by automated tests with a fake model; D1 and D2 stay open until the evaluator re-runs the live cases.',
  sources: [{ path: 'README.md', note: 'Known limitations: live-evaluation hard gates D1 and D2' }, { path: 'builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md', note: 'Not in scope' }] as Source[],
};

// ---------------------------------------------------------------- Evolution

export type Milestone = { hash: string; date: string; title: string };

const HASH = /^[0-9a-f]{7,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the operator-supplied commit list. Throws at build time if an entry is malformed. */
export function readMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) throw new Error('evolution.json must be an array');
  return raw.map((entry, index) => {
    const { hash, date, title } = (entry ?? {}) as Record<string, unknown>;
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error(`evolution.json[${index}]: hash must be 7 to 40 lowercase hex characters`);
    if (typeof date !== 'string' || !DATE.test(date)) throw new Error(`evolution.json[${index}]: date must be YYYY-MM-DD`);
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error(`evolution.json[${index}]: title must be 1 to 200 characters`);
    return { hash, date, title: title.trim() };
  });
}

export const MILESTONES: readonly Milestone[] = readMilestones(evolution);

export const COMMIT_BASE = 'https://github.com/prakhar-parashar-au5/incubye_assignment/commit/';
export function commitHref(hash: string): string {
  return `${COMMIT_BASE}${hash}`;
}
