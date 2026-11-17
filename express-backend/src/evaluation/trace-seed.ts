// Writes one recorded assistant trace through the real observability
// repository, step by step, exactly as the recorded assistant loop would:
// trace and user message, then each model-call attempt and outcome, each
// tool-call attempt and outcome, then the terminal trace. Used by the
// eval:trace-fixtures command and by test/db/admin-observability.test.ts.
// Evaluator and test code only: the server never imports src/evaluation/.
import type { ActorScope } from '../assistant/actor-scope.js';
import type { createObservabilityRepository } from '../assistant/observability/repository.js';

type Repo = Pick<ReturnType<typeof createObservabilityRepository>,
  'createConversation' | 'createTrace' | 'startModelCall' | 'finishModelCall' | 'startToolCall' | 'finishToolCall' | 'finishTrace'>;

/** Synthetic employee used in seeded tool results and prose. */
export const SEED_PERSON = Object.freeze({ employeeCode: 'ACME00601', name: 'Asha Rao', annualBaseSalary: Object.freeze({ amount: '1500000.00', currency: 'INR' }) });
export const SEED_PROMPT = 'How much does Asha Rao (ACME00601) earn?';
export const SEED_ANSWER = 'Asha Rao earns INR 1500000.00.';
const PROMPT_HASH = 'a'.repeat(64);

export interface SeedTool {
  name: string;
  /** NO_OUTCOME leaves the attempt open: the trace must then be FAILED, which closes it as OUTCOME_NOT_RECORDED. */
  outcome: 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'NO_OUTCOME';
  arguments?: unknown;
  result?: unknown;
  durationMs?: number;
}
export interface SeedTraceInput {
  actorId: number;
  actorScope: ActorScope;
  /** ISO instant. */
  startedAt: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  durationMs?: number;
  model?: string;
  /** One tool per model round, in order. */
  tools?: readonly SeedTool[];
  /** Trace failure; for a tool-free FAILED trace the first model call fails with `category`. */
  failure?: { stage: string; category: string };
  previousTraceId?: string;
  conversationId?: string;
  /** Reported by the first model call only (later calls report none). */
  tokens?: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  requestId?: string;
  userText?: string;
  answer?: string;
}

const db = (iso: string): string => iso.replace('T', ' ').replace('Z', '');
const plusMs = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

export async function seedTrace(repo: Repo, input: SeedTraceInput): Promise<{ traceId: string; conversationId: string }> {
  const { actorId, startedAt, status, durationMs = 100, model = 'fake-model', tools = [], failure } = input;
  const usage = input.tokens ?? { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 };
  const userText = input.userText ?? SEED_PROMPT;
  const answer = input.answer ?? SEED_ANSWER;
  const at = db(startedAt);
  const conversationId = input.conversationId ?? (await repo.createConversation(actorId, at)).id;
  const trace = await repo.createTrace({
    conversationId, actorId, requestId: input.requestId ?? `req-${startedAt}`, promptVersion: 'v1', promptHash: PROMPT_HASH, model,
    userContent: { text: userText, retryOfTraceId: null }, modelMessages: [{ role: 'user', content: userText }], startedAt: at,
    actorScope: input.actorScope, ...(input.previousTraceId === undefined ? {} : { previousTraceId: input.previousTraceId }),
  });
  if (status === 'STARTED') return { traceId: trace.id, conversationId };

  const startModel = (extra: Record<string, unknown> = {}) => repo.startModelCall({
    traceId: trace.id, provider: 'fake', model, input: { messages: [{ role: 'user', content: userText }], ...extra }, tools: [], promptVersion: 'v1', promptHash: PROMPT_HASH, startedAt: at,
  });
  let openAttempt = false;
  const exchanges: unknown[] = [];
  for (const [round, tool] of tools.entries()) {
    const call = await startModel(round === 0 ? {} : { exchanges });
    const args = tool.arguments ?? { employeeCode: SEED_PERSON.employeeCode, authorization: 'Bearer leaked' };
    await repo.finishModelCall(call.id, {
      status: 'SUCCEEDED', output: { text: null }, decisions: [{ callId: `call_${round + 1}`, name: tool.name, arguments: args }],
      ...(round === 0 ? usage : {}), latencyMs: 5 + round, completedAt: at,
    });
    const toolCall = await repo.startToolCall({ traceId: trace.id, modelCallId: call.id, providerToolCallId: `call_${round + 1}`, toolName: tool.name, arguments: args, startedAt: at });
    const timing = { durationMs: tool.durationMs ?? 3, completedAt: at };
    if (tool.outcome === 'NO_OUTCOME') { openAttempt = true; break; }
    if (tool.outcome === 'SUCCEEDED') {
      const result = tool.result ?? { data: { employee: SEED_PERSON }, cards: [], limitations: [] };
      await repo.finishToolCall(toolCall.id, { status: 'SUCCEEDED', result, ...timing });
      exchanges.push({ calls: [{ callId: `call_${round + 1}`, name: tool.name }], outputs: [{ callId: `call_${round + 1}`, output: (result as { data?: unknown }).data ?? null }] });
    } else if (tool.outcome === 'REJECTED') {
      await repo.finishToolCall(toolCall.id, { status: 'REJECTED', validation: { reason: 'INVALID_ARGUMENTS' }, ...timing });
      exchanges.push({ calls: [{ callId: `call_${round + 1}`, name: tool.name }], outputs: [{ callId: `call_${round + 1}`, output: { error: 'INVALID_ARGUMENTS' } }] });
    } else {
      await repo.finishToolCall(toolCall.id, { status: 'FAILED', errorCategory: 'TOOL_FAILED', safeError: { errorName: 'Error' }, ...timing });
      exchanges.push({ calls: [{ callId: `call_${round + 1}`, name: tool.name }], outputs: [{ callId: `call_${round + 1}`, output: { error: 'TOOL_FAILED' } }] });
    }
  }
  if (!openAttempt) {
    if (tools.length > 0 && status === 'COMPLETED') {
      const final = await startModel({ exchanges });
      await repo.finishModelCall(final.id, { status: 'SUCCEEDED', output: { text: answer }, decisions: [], latencyMs: 7, completedAt: at });
    } else if (tools.length === 0) {
      const first = await startModel();
      if (status === 'COMPLETED') {
        await repo.finishModelCall(first.id, { status: 'SUCCEEDED', output: { text: 'Hello.' }, decisions: [], ...usage, latencyMs: 5, completedAt: at });
      } else {
        const category = failure?.category ?? 'timeout';
        await repo.finishModelCall(first.id, { status: 'FAILED', failureCategory: category, safeError: { category }, latencyMs: 5, completedAt: at });
      }
    }
  }
  const completedAt = db(plusMs(startedAt, durationMs));
  await repo.finishTrace(trace.id, status === 'COMPLETED'
    ? { status, durationMs, completedAt, finalResponse: { answer, toolCalls: tools.map((t) => ({ name: t.name, status: t.outcome === 'SUCCEEDED' ? 'completed' : t.outcome === 'REJECTED' ? 'rejected' : 'failed' })), cards: [], limitations: [], generatedAt: plusMs(startedAt, durationMs) } }
    : { status, durationMs, completedAt, failureStage: failure?.stage ?? 'MODEL_CALL', errorCategory: failure?.category ?? 'timeout' });
  return { traceId: trace.id, conversationId };
}
