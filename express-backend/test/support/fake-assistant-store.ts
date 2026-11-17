// In-memory AssistantStore for fast tests and fault injection.
//
// It follows the repository's rules that the assistant depends on: owned
// conversations, ordered sequences, idempotency key + command hash, a model
// outcome before its tool calls, terminal-state guards, and the same JSON
// scrubbing and size limits (boundedJson) at every write. `failOn` makes one
// chosen operation throw, as an unavailable database would.
import { randomUUID } from 'node:crypto';

import { parseActorScope } from '../../src/assistant/actor-scope.js';
import type { ActorScope } from '../../src/assistant/actor-scope.js';
import type { AssistantStore } from '../../src/assistant/assistant-store.js';
import { ConflictError } from '../../src/assistant/observability/repository.js';
import { PAYLOAD_LIMITS, boundedJson } from '../../src/assistant/observability/validation.js';

export type StoreOperation = 'createConversation' | 'listConversationSummaries' | 'readConversation' | 'findTraceByIdempotency'
  | 'createTrace' | 'startModelCall' | 'finishModelCall' | 'startToolCall' | 'finishToolCall' | 'finishTrace';

type In<K extends StoreOperation, I extends number = 0> = Parameters<AssistantStore[K]>[I];

export interface FakeTrace {
  id: string; conversationId: string; actorId: number; sequence: number; previousTraceId: string | null;
  idempotencyKey: string | undefined; commandHash: string | undefined; status: 'STARTED' | 'COMPLETED' | 'FAILED';
  failureStage: string | null; errorCategory: string | null; model: string; promptVersion: string; promptHash: string;
  userContent: unknown; modelMessages: unknown; finalResponse: unknown; userMessageSequence: number | null; finalMessageSequence: number | null;
  startedAt: string; durationMs: number | null;
  /** Trace-time authorization snapshot (migration 007); null models a trace recorded before it. */
  actorScope: ActorScope | null;
}
export interface FakeModelCall { id: string; traceId: string; sequence: number; status: string; start: unknown; finish: unknown }
export interface FakeToolCall { id: string; traceId: string; modelCallId: string; sequence: number; status: string; start: unknown; finish: unknown }

/** A copy as stored: scrubbed and size-checked exactly like the repository. */
const stored = (value: unknown, limit: number): unknown => JSON.parse(boundedJson(value, limit)) as unknown;

export function fakeAssistantStore() {
  const conversations = new Map<string, { id: string; actorId: number; createdAt: string }>();
  const messages: { conversationId: string; traceId: string | null; sequence: number; role: 'USER' | 'ASSISTANT'; content: unknown; createdAt: string }[] = [];
  const traces: FakeTrace[] = [];
  const modelCalls: FakeModelCall[] = [];
  const toolCalls: FakeToolCall[] = [];
  /** Every successful write, in order. */
  const events: string[] = [];
  let failOn: ((operation: StoreOperation, input: unknown) => boolean) | null = null;
  let nextId = 0;

  const check = (operation: StoreOperation, input?: unknown): void => {
    if (failOn?.(operation, input)) throw Object.assign(new Error('injected storage failure: connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };
  const nextMessage = (conversationId: string) => Math.max(0, ...messages.filter((m) => m.conversationId === conversationId).map((m) => m.sequence)) + 1;
  const activeTrace = (traceId: string) => {
    const trace = traces.find((t) => t.id === traceId);
    if (trace?.status !== 'STARTED') throw new ConflictError('trace is not active');
    return trace;
  };
  const turn = (t: FakeTrace) => ({
    id: t.id, sequence: t.sequence, previousTraceId: t.previousTraceId, status: t.status, failureStage: t.failureStage,
    errorCategory: t.errorCategory, startedAt: t.startedAt, userMessageSequence: t.userMessageSequence, finalMessageSequence: t.finalMessageSequence,
    actorScope: t.actorScope === null ? null : { ...t.actorScope, countries: [...t.actorScope.countries], departments: [...t.actorScope.departments] },
  });

  const store: AssistantStore = {
    async createConversation(actorId, createdAt) {
      check('createConversation');
      const id = randomUUID();
      conversations.set(id, { id, actorId, createdAt });
      events.push('createConversation');
      return { id, actorId, createdAt };
    },
    async listConversationSummaries(actorId, limit = 25, offset = 0) {
      check('listConversationSummaries');
      const owned = [...conversations.values()].filter((c) => c.actorId === actorId).reverse();
      return {
        total: owned.length,
        items: owned.slice(offset, offset + limit).map((c) => {
          const own = messages.filter((m) => m.conversationId === c.id);
          const first = own.find((m) => m.role === 'USER')?.content as { text?: string } | undefined;
          return { id: c.id, createdAt: c.createdAt, messageCount: own.length, lastMessageAt: own.at(-1)?.createdAt ?? null, firstUserText: first?.text ?? null };
        }),
      };
    },
    async readConversation(conversationId, actorId) {
      check('readConversation');
      const found = conversations.get(conversationId);
      if (found === undefined || found.actorId !== actorId) return null;
      return {
        id: found.id, createdAt: found.createdAt,
        messages: messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.sequence - b.sequence)
          .map((m) => ({ traceId: m.traceId, sequence: m.sequence, role: m.role, content: m.content, createdAt: m.createdAt })),
        turns: traces.filter((t) => t.conversationId === conversationId).sort((a, b) => a.sequence - b.sequence).map(turn),
      };
    },
    async findTraceByIdempotency(conversationId, key) {
      check('findTraceByIdempotency');
      const t = traces.find((x) => x.conversationId === conversationId && x.idempotencyKey === key);
      return t === undefined ? null : { ...turn(t), commandHash: t.commandHash ?? '', finalResponse: t.finalResponse };
    },
    async createTrace(input: In<'createTrace'>) {
      check('createTrace', input);
      const userContent = stored(input.userContent, PAYLOAD_LIMITS.message);
      const modelMessages = stored(input.modelMessages, PAYLOAD_LIMITS.modelInput);
      const conversation = conversations.get(input.conversationId);
      if (conversation?.actorId !== input.actorId) throw new ConflictError('conversation unavailable');
      const existing = traces.find((t) => t.conversationId === input.conversationId && t.idempotencyKey === input.idempotencyKey && input.idempotencyKey !== undefined);
      if (existing) {
        if (existing.commandHash !== input.commandHash) throw new ConflictError('idempotency key reused with different command');
        return { id: existing.id, sequence: existing.sequence, reused: true, userMessageSequence: null };
      }
      const id = randomUUID();
      const sequence = traces.filter((t) => t.conversationId === input.conversationId).length + 1;
      const userMessageSequence = nextMessage(input.conversationId);
      traces.push({
        id, conversationId: input.conversationId, actorId: input.actorId, sequence, previousTraceId: input.previousTraceId ?? null,
        idempotencyKey: input.idempotencyKey, commandHash: input.commandHash, status: 'STARTED', failureStage: null, errorCategory: null,
        model: input.model, promptVersion: input.promptVersion, promptHash: input.promptHash, userContent, modelMessages,
        finalResponse: null, userMessageSequence, finalMessageSequence: null, startedAt: input.startedAt, durationMs: null,
        actorScope: input.actorScope === undefined ? null : parseActorScope(input.actorScope.role, input.actorScope.countries, input.actorScope.departments),
      });
      messages.push({ conversationId: input.conversationId, traceId: id, sequence: userMessageSequence, role: 'USER', content: userContent, createdAt: input.startedAt });
      events.push('createTrace');
      return { id, sequence, reused: false, userMessageSequence };
    },
    async startModelCall(input: In<'startModelCall'>) {
      check('startModelCall', input);
      const start = { ...input, input: stored(input.input, PAYLOAD_LIMITS.modelInput), tools: stored(input.tools, PAYLOAD_LIMITS.modelInput) };
      activeTrace(input.traceId);
      nextId += 1;
      const call = { id: String(nextId), traceId: input.traceId, sequence: modelCalls.filter((c) => c.traceId === input.traceId).length + 1, status: 'STARTED', start, finish: null };
      modelCalls.push(call);
      events.push('startModelCall');
      return { id: call.id, sequence: call.sequence };
    },
    async finishModelCall(callId, input: In<'finishModelCall', 1>) {
      check('finishModelCall', input);
      const finish = { ...input, output: input.output === undefined ? undefined : stored(input.output, PAYLOAD_LIMITS.modelOutput), decisions: input.decisions === undefined ? undefined : stored(input.decisions, PAYLOAD_LIMITS.modelOutput) };
      const call = modelCalls.find((c) => c.id === callId);
      if (call?.status !== 'STARTED') throw new ConflictError('model call is not active');
      call.status = input.status;
      call.finish = finish;
      events.push(`finishModelCall:${input.status}`);
    },
    async startToolCall(input: In<'startToolCall'>) {
      check('startToolCall', input);
      const start = { ...input, arguments: stored(input.arguments, PAYLOAD_LIMITS.toolArguments) };
      activeTrace(input.traceId);
      const model = modelCalls.find((c) => c.id === input.modelCallId && c.traceId === input.traceId);
      if (model?.status !== 'SUCCEEDED') throw new ConflictError('successful model outcome must be recorded before tool execution');
      nextId += 1;
      const call = { id: String(nextId), traceId: input.traceId, modelCallId: input.modelCallId, sequence: toolCalls.filter((c) => c.traceId === input.traceId).length + 1, status: 'STARTED', start, finish: null };
      toolCalls.push(call);
      events.push('startToolCall');
      return { id: call.id, sequence: call.sequence };
    },
    async finishToolCall(callId, input: In<'finishToolCall', 1>) {
      check('finishToolCall', input);
      const finish = { ...input, ...(input.result === undefined ? {} : { result: stored(input.result, PAYLOAD_LIMITS.toolResult) }) };
      const call = toolCalls.find((c) => c.id === callId);
      if (call?.status !== 'STARTED') throw new ConflictError('tool call is not active');
      call.status = input.status;
      call.finish = finish;
      events.push(`finishToolCall:${input.status}`);
    },
    async finishTrace(traceId, input: In<'finishTrace', 1>) {
      check('finishTrace', input);
      const response = input.finalResponse === undefined ? null : stored(input.finalResponse, PAYLOAD_LIMITS.assistantResponse);
      const trace = activeTrace(traceId);
      if (input.status === 'FAILED') {
        for (const c of [...modelCalls, ...toolCalls]) if (c.traceId === traceId && c.status === 'STARTED') c.status = 'FAILED';
      } else if ([...modelCalls, ...toolCalls].some((c) => c.traceId === traceId && c.status === 'STARTED')) {
        throw new ConflictError('trace has unfinished calls');
      }
      let finalMessageSequence: number | null = null;
      if (input.status === 'COMPLETED') {
        finalMessageSequence = nextMessage(trace.conversationId);
        messages.push({ conversationId: trace.conversationId, traceId, sequence: finalMessageSequence, role: 'ASSISTANT', content: response, createdAt: input.completedAt });
      }
      Object.assign(trace, {
        status: input.status, finalResponse: response, failureStage: input.failureStage ?? null, errorCategory: input.errorCategory ?? null,
        durationMs: input.durationMs, finalMessageSequence,
      });
      events.push(`finishTrace:${input.status}`);
      return { finalMessageSequence };
    },
  };

  return {
    store,
    conversations, messages, traces, modelCalls, toolCalls, events,
    /** Make one operation (or every call matching the predicate) fail like an unavailable database. */
    failOn(predicate: ((operation: StoreOperation, input: unknown) => boolean) | null) { failOn = predicate; },
  };
}
export type FakeAssistantStore = ReturnType<typeof fakeAssistantStore>;
