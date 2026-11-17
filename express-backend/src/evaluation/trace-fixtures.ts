// Guarded trace fixtures for the AI-traces UI (AI Task 04a, Option B of
// issues/04-frontend-deterministic-trace-fixtures.md).
//
// Writes every trace shape the traces UI must render through the real
// observability repository (trace-seed.ts), owned by the demo HR users, with
// start times spread over the last 30 days so the 24h, 7d, and 30d summaries
// differ. Each fixture is marked by its request ID (`trace-fixture:v1:<shape>`),
// so a re-run finds it and writes nothing. Same guards as the oracle fixtures
// (fixture-guard.ts); dry run unless `apply`. The manifest maps each shape to
// its trace or MCP call ID and holds no credentials or connection details.
import type { Pool, RowDataPacket } from 'mysql2/promise';

import { DEMO_USERS } from '../access/demo-users.js';
import { actorScopeOf } from '../assistant/actor-scope.js';
import { createObservabilityRepository } from '../assistant/observability/repository.js';
import { FixtureRefusedError, assertFixtureTarget } from './fixture-guard.js';
import { SEED_PERSON, seedTrace } from './trace-seed.js';
import type { SeedTool, SeedTraceInput } from './trace-seed.js';

const MARKER = 'trace-fixture:v1:';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Who = 'meera' | 'rohan';
interface TraceShape {
  shape: string;
  who: Who;
  ageMs: number;
  status: SeedTraceInput['status'];
  durationMs: number;
  tools?: SeedTool[];
  failure?: { stage: string; category: string };
  tokens?: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  /** Second turn of the conversation started by this shape. */
  continues?: string;
  review?: { verdict: 'CORRECT' | 'PARTIAL' | 'INCORRECT'; note: string; nominated: boolean };
  userText?: string;
}

const tokens = (inputTokens: number, outputTokens: number, reasoningTokens: number) => ({ inputTokens, outputTokens, reasoningTokens });
const ok = (name: string): SeedTool => ({ name, outcome: 'SUCCEEDED' });

/** Every shape the traces UI renders, in creation order. */
export const TRACE_SHAPES: readonly TraceShape[] = Object.freeze([
  { shape: 'completed-no-tool', who: 'meera', ageMs: 10 * MINUTE, status: 'COMPLETED', durationMs: 1_150, tokens: tokens(820, 64, 0), userText: 'What can you help me with?' },
  { shape: 'in-progress', who: 'rohan', ageMs: 25 * MINUTE, status: 'STARTED', durationMs: 0 },
  { shape: 'completed-one-tool', who: 'rohan', ageMs: 3 * HOUR, status: 'COMPLETED', durationMs: 2_480, tools: [ok('get_employee_compensation')], tokens: tokens(1_640, 142, 96) },
  { shape: 'completed-multi-tool', who: 'meera', ageMs: 20 * HOUR, status: 'COMPLETED', durationMs: 4_930, tools: [ok('search_employees'), ok('get_employee_compensation')], tokens: tokens(2_310, 188, 210) },
  { shape: 'rejected-tool-argument', who: 'rohan', ageMs: 2 * DAY, status: 'COMPLETED', durationMs: 1_870,
    tools: [{ name: 'search_employees', outcome: 'REJECTED', arguments: { query: '', password: 'synthetic-fixture-password' } }], tokens: tokens(1_120, 77, 40) },
  { shape: 'tool-failed', who: 'meera', ageMs: 4 * DAY, status: 'COMPLETED', durationMs: 3_420, tools: [{ name: 'get_compensation_summary', outcome: 'FAILED' }], tokens: tokens(1_480, 120, 64) },
  { shape: 'provider-timeout', who: 'rohan', ageMs: 6 * DAY, status: 'FAILED', durationMs: 45_000, failure: { stage: 'MODEL_CALL', category: 'timeout' } },
  { shape: 'persistence-failure', who: 'meera', ageMs: 9 * DAY, status: 'FAILED', durationMs: 1_330,
    tools: [{ name: 'search_employees', outcome: 'NO_OUTCOME' }], failure: { stage: 'TOOL_TRACE_WRITE', category: 'persistence_unavailable' }, tokens: tokens(900, 40, 0) },
  { shape: 'reviewed', who: 'rohan', ageMs: 12 * DAY, status: 'COMPLETED', durationMs: 2_060, tools: [ok('get_top_compensated_employees')], tokens: tokens(1_760, 156, 120),
    review: { verdict: 'PARTIAL', note: 'Correct ranking; the answer omitted the exchange-rate date.', nominated: true } },
  { shape: 'two-turn-first', who: 'meera', ageMs: 18 * DAY, status: 'COMPLETED', durationMs: 2_240, tools: [ok('search_employees')], tokens: tokens(1_300, 98, 64) },
  { shape: 'two-turn-second', who: 'meera', ageMs: 18 * DAY - 5 * MINUTE, status: 'COMPLETED', durationMs: 1_610, tools: [ok('get_employee_compensation')], tokens: tokens(1_950, 110, 72),
    continues: 'two-turn-first', userText: 'And her bonus?' },
  // Volume for meaningful 24h / 7d / 30d percentiles and series.
  ...([
    [2 * HOUR, 1_200, 'meera'], [5 * HOUR, 2_400, 'rohan'], [9 * HOUR, 1_800, 'meera'], [30 * HOUR, 3_100, 'rohan'], [50 * HOUR, 950, 'meera'],
    [3.5 * DAY, 4_200, 'rohan'], [5 * DAY, 2_700, 'meera'], [8 * DAY, 6_100, 'rohan'], [11 * DAY, 1_500, 'meera'], [15 * DAY, 3_600, 'rohan'],
    [21 * DAY, 2_200, 'meera'], [27 * DAY, 8_800, 'rohan'],
  ] as const).map(([ageMs, durationMs, who], i): TraceShape => ({
    shape: `load-${String(i + 1).padStart(2, '0')}`, who, ageMs, status: 'COMPLETED', durationMs,
    ...(i % 3 === 0 ? {} : { tools: [ok(i % 3 === 1 ? 'get_top_compensated_employees' : 'get_compensation_summary')] }),
    tokens: tokens(700 + i * 130, 60 + i * 9, i % 2 === 0 ? 0 : 48 + i * 4),
  })),
]);

interface McpShape { shape: string; who: Who; ageMs: number; toolName: string; arguments: unknown; outcome: 'SUCCEEDED' | 'REJECTED' | 'FAILED'; durationMs: number }
export const MCP_SHAPES: readonly McpShape[] = Object.freeze([
  { shape: 'mcp-succeeded', who: 'rohan', ageMs: HOUR, toolName: 'search_employees', arguments: { query: 'Asha', limit: 5 }, outcome: 'SUCCEEDED', durationMs: 38 },
  { shape: 'mcp-rejected', who: 'meera', ageMs: 2 * DAY, toolName: 'get_employee_compensation', arguments: { employeeCode: 7 }, outcome: 'REJECTED', durationMs: 2 },
  { shape: 'mcp-failed', who: 'rohan', ageMs: 9 * DAY, toolName: 'get_compensation_summary', arguments: { groupBy: 'COUNTRY', metric: 'ANNUAL_BASE' }, outcome: 'FAILED', durationMs: 120 },
]);

export interface TraceFixtureManifest {
  kind: 'acme-ai-trace-ui-fixtures'; manifestVersion: 1; mode: 'DRY_RUN' | 'APPLIED'; generatedAt: string; database: string;
  traces: { shape: string; hrUser: string; status: string; traceId: string | null; created: boolean }[];
  mcpCalls: { shape: string; hrUser: string; status: string; mcpCallId: string | null; created: boolean }[];
}

const dbTime = (instant: Date): string => instant.toISOString().replace('T', ' ').replace('Z', '');

export async function prepareTraceFixtures({ pool, apply, clock = () => new Date(), appEnv, databaseName, confirmDatabase }: {
  pool: Pool; apply: boolean; clock?: () => Date; appEnv: unknown; databaseName: string; confirmDatabase: unknown;
}): Promise<TraceFixtureManifest> {
  await assertFixtureTarget(pool, { appEnv, databaseName, confirmDatabase });
  const now = clock();
  const repo = createObservabilityRepository(pool);

  const users = new Map<Who, { id: number; displayName: string; scope: ReturnType<typeof actorScopeOf> }>();
  for (const demo of DEMO_USERS) {
    const [found] = await pool.query<RowDataPacket[]>("SELECT id FROM hr_users WHERE email = ? AND status = 'ACTIVE'", [demo.email]);
    if (!found[0]) throw new FixtureRefusedError('refusing: the demo HR users do not exist (run npm run db:seed-demo-users first)');
    users.set(demo.key, { id: Number(found[0].id), displayName: demo.displayName, scope: actorScopeOf(demo) });
  }
  const user = (who: Who) => {
    const found = users.get(who);
    if (!found) throw new FixtureRefusedError(`missing demo user ${who}`);
    return found;
  };
  const findTrace = async (shape: string) => {
    const [found] = await pool.query<RowDataPacket[]>('SELECT id, conversation_id FROM ai_traces WHERE request_id = ? ORDER BY started_at LIMIT 1', [`${MARKER}${shape}`]);
    return found[0] ? { traceId: String(found[0].id), conversationId: String(found[0].conversation_id) } : null;
  };

  const traces: TraceFixtureManifest['traces'] = [];
  const created = new Map<string, { traceId: string; conversationId: string }>();
  for (const spec of TRACE_SHAPES) {
    const owner = user(spec.who);
    const existing = await findTrace(spec.shape);
    if (existing || !apply) {
      if (existing) created.set(spec.shape, existing);
      traces.push({ shape: spec.shape, hrUser: owner.displayName, status: spec.status, traceId: existing?.traceId ?? null, created: false });
      continue;
    }
    const first = spec.continues === undefined ? undefined : created.get(spec.continues) ?? await findTrace(spec.continues) ?? undefined;
    if (spec.continues !== undefined && first === undefined) throw new FixtureRefusedError(`fixture ${spec.shape} needs ${spec.continues}`);
    const seeded = await seedTrace(repo, {
      actorId: owner.id, actorScope: owner.scope, startedAt: new Date(now.getTime() - spec.ageMs).toISOString(), status: spec.status,
      durationMs: spec.durationMs, model: 'gpt-5-mini', requestId: `${MARKER}${spec.shape}`,
      ...(spec.tools === undefined ? {} : { tools: spec.tools }),
      ...(spec.failure === undefined ? {} : { failure: spec.failure }),
      ...(spec.tokens === undefined ? {} : { tokens: spec.tokens }),
      ...(spec.userText === undefined ? {} : { userText: spec.userText }),
      ...(first === undefined ? {} : { conversationId: first.conversationId, previousTraceId: first.traceId }),
    });
    if (spec.review) {
      await repo.upsertReview({ traceId: seeded.traceId, reviewerId: user('meera').id, ...spec.review, expectedVersion: 0, now: dbTime(now) });
    }
    created.set(spec.shape, seeded);
    traces.push({ shape: spec.shape, hrUser: owner.displayName, status: spec.status, traceId: seeded.traceId, created: true });
  }

  const mcpCalls: TraceFixtureManifest['mcpCalls'] = [];
  for (const spec of MCP_SHAPES) {
    const owner = user(spec.who);
    const [found] = await pool.query<RowDataPacket[]>('SELECT id FROM mcp_tool_calls WHERE request_id = ? LIMIT 1', [`${MARKER}${spec.shape}`]);
    if (found[0] || !apply) {
      mcpCalls.push({ shape: spec.shape, hrUser: owner.displayName, status: spec.outcome, mcpCallId: found[0] ? String(found[0].id) : null, created: false });
      continue;
    }
    const at = dbTime(new Date(now.getTime() - spec.ageMs));
    const call = await repo.startMcpCall({ actorId: owner.id, requestId: `${MARKER}${spec.shape}`, toolName: spec.toolName, arguments: spec.arguments, startedAt: at });
    const timing = { durationMs: spec.durationMs, completedAt: at };
    if (spec.outcome === 'SUCCEEDED') await repo.finishMcpCall(call.id, { status: 'SUCCEEDED', result: { data: { employees: [SEED_PERSON] }, cards: [], limitations: [] }, ...timing });
    else if (spec.outcome === 'REJECTED') await repo.finishMcpCall(call.id, { status: 'REJECTED', validation: { reason: 'INVALID_ARGUMENTS' }, ...timing });
    else await repo.finishMcpCall(call.id, { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { errorName: 'Error' }, ...timing });
    mcpCalls.push({ shape: spec.shape, hrUser: owner.displayName, status: spec.outcome, mcpCallId: call.id, created: true });
  }

  return { kind: 'acme-ai-trace-ui-fixtures', manifestVersion: 1, mode: apply ? 'APPLIED' : 'DRY_RUN', generatedAt: now.toISOString(), database: databaseName, traces, mcpCalls };
}
