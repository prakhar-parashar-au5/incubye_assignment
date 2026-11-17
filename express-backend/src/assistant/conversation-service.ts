// Server-owned assistant conversations and recorded turns (Task 03).
//
// A conversation belongs to one HR user. Unknown and unowned conversations
// give the same NOT_FOUND. A submitted message is one user message; history
// comes from MySQL, never from the browser.
//
// One submitted message (state machine):
//   1. Load the owned conversation (404 otherwise).
//   2. Idempotency: the same key and command replays the stored outcome; the
//      same key with another command is DUPLICATE_OPERATION.
//   3. Select bounded history (selectHistory below).
//   4. Create the STARTED trace and the user message, before any model call.
//   5. Run the recorded tool loop (assistant-service.ts): every model and tool
//      step is persisted before and after it runs.
//   6. Persist the final assistant message and COMPLETED trace; only then
//      return the answer. Any failure finalizes the trace as FAILED (best
//      effort) with its stage, and returns a safe error with no answer.
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { Principal } from '../access/sessions.js';
import { PUBLIC_MESSAGES } from '../http/contract.js';
import type { AssistantMessagesResponse, ErrorReason, PublicErrorCode } from '../http/contract.js';
import { actorScopeOf, coversRecordedScope } from './actor-scope.js';
import type { ActorScope } from './actor-scope.js';
import type { Logger } from '../http/request-log.js';
import { TurnFailure, dbTime } from './assistant-service.js';
import type { AssistantService, FailureStage, TurnFailureCategory, TurnRecorder } from './assistant-service.js';
import type { AssistantStore } from './assistant-store.js';
import type { ModelMessage } from './model.js';
import { ConflictError } from './observability/repository.js';

/**
 * History policy: the most recent complete turns (a user message and the
 * final assistant answer of the same COMPLETED trace), at most 4 turns and at
 * most 16,000 characters of message text, taken newest first and stopping at
 * the first turn that does not fit, so the selection is a contiguous recent
 * suffix. Failed and in-progress turns are excluded, as is the trace being
 * retried, and (Task 03a) any turn whose answer the caller's current scope no
 * longer covers. Tool calls and results never cross turns, so no tool/result pair
 * can be split. With the current 2,000-character message limit the model
 * input is at most 18,000 characters of conversation text.
 */
export const HISTORY_POLICY = Object.freeze({ maxTurns: 4, maxChars: 16_000 });
export const CONVERSATION_TITLE_LENGTH = 80;

export class AssistantApiError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;
  readonly reason: ErrorReason | undefined;
  readonly publicMessage: string | undefined;
  /** True when this is the stored outcome of an earlier submission with the same key. */
  readonly replayed: boolean;

  constructor(status: number, code: PublicErrorCode, { reason, message, replayed = false }: { reason?: ErrorReason; message?: string; replayed?: boolean } = {}) {
    super(code);
    this.name = 'AssistantApiError';
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.publicMessage = message;
    this.replayed = replayed;
  }
}

export interface ConversationSummary {
  conversationId: string;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  title: string | null;
}
export interface ConversationMessage {
  sequence: number;
  role: 'user' | 'assistant';
  traceId: string | null;
  createdAt: string;
  text: string;
  response: Omit<AssistantMessagesResponse, 'answer'> | null;
  /** True when the saved answer is hidden because the current scope no longer covers the trace-time scope. */
  withheld: boolean;
}
export interface ConversationTurn {
  traceId: string;
  sequence: number;
  previousTraceId: string | null;
  retryOfTraceId: string | null;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  userMessageSequence: number | null;
  assistantMessageSequence: number | null;
  error: { code: PublicErrorCode; message: string; reason: ErrorReason | null } | null;
}
export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  turns: ConversationTurn[];
}
export type TurnResult = AssistantMessagesResponse & {
  conversationId: string;
  traceId: string;
  previousTraceId: string | null;
  userMessageSequence: number;
  assistantMessageSequence: number;
  withheld: boolean;
};

export interface ConversationService {
  create(principal: Principal): Promise<ConversationSummary>;
  list(principal: Principal, page: { page: number; pageSize: number }): Promise<{ conversations: ConversationSummary[]; page: { number: number; size: number; totalRows: number; totalPages: number } }>;
  read(principal: Principal, conversationId: string): Promise<ConversationDetail>;
  submit(principal: Principal, conversationId: string, command: { content: string; retryOfTraceId?: string | undefined }, idempotencyKey: string, requestId: string): Promise<{ value: TurnResult; replayed: boolean }>;
  /** Deprecated POST /assistant/messages: one new recorded single-turn conversation. */
  legacy(principal: Principal, content: string, requestId: string): Promise<AssistantMessagesResponse>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const toIso = (dbText: string): string => `${dbText.replace(' ', 'T')}Z`;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const notFound = (): AssistantApiError => new AssistantApiError(404, 'NOT_FOUND', { message: 'Conversation not found.' });
const unavailable = (reason: ErrorReason, replayed = false): AssistantApiError => new AssistantApiError(503, 'ASSISTANT_UNAVAILABLE', { reason, replayed });

/** Canonical command of one message submission. The key is unique per conversation. */
export function messageCommandHash(conversationId: string, content: string, retryOfTraceId: string | null): string {
  return sha256(`acme assistant message v1\n${JSON.stringify([conversationId, content, retryOfTraceId])}`);
}

const MODEL_REASONS: Readonly<Record<string, ErrorReason>> = Object.freeze({
  timeout: 'MODEL_TIMEOUT',
  rate_limited: 'MODEL_RATE_LIMITED',
  provider_error: 'MODEL_ERROR',
  invalid_response: 'MODEL_INVALID_RESPONSE',
});

/** The public error for a failed turn, from its stored stage and category. */
export function turnError(stage: string | null, category: string | null, replayed = false): AssistantApiError {
  if (stage === 'MODEL_CALL' && category !== null && category in MODEL_REASONS) {
    return new AssistantApiError(502, 'MODEL_PROVIDER_FAILED', { reason: MODEL_REASONS[category], replayed });
  }
  if (stage === 'MODEL_CALL' && category === 'not_configured') return unavailable('MODEL_NOT_CONFIGURED', replayed);
  if (stage === 'TOOL_EXECUTION' && category === 'turn_timeout') return unavailable('TURN_TIMEOUT', replayed);
  return unavailable('TRACE_UNAVAILABLE', replayed);
}

type StoredConversation = NonNullable<Awaited<ReturnType<AssistantStore['readConversation']>>>;
type StoredMessage = StoredConversation['messages'][number];
type StoredTurn = StoredConversation['turns'][number];

const textOf = (content: unknown, key: 'text' | 'answer'): string => {
  const value: unknown = typeof content === 'object' && content !== null ? Reflect.get(content, key) : undefined;
  return typeof value === 'string' ? value : '';
};
const retryOf = (content: unknown): string | null => {
  const value: unknown = typeof content === 'object' && content !== null ? Reflect.get(content, 'retryOfTraceId') : undefined;
  return typeof value === 'string' ? value : null;
};

/** Fixed text shown instead of a saved answer the caller's current scope no longer covers (Task 03a, Option C). */
export const WITHHELD_ANSWER = 'This answer is hidden because your access has changed since it was given.';

/** Model and provider recorded on a trace when no model is configured (the columns are NOT NULL). */
export const UNCONFIGURED_MODEL = Object.freeze({ provider: 'none', name: 'not-configured' });

/** A saved completed answer as the current caller may see it: unchanged, or the fixed withheld state. */
function visibleAnswer(principal: Principal, recorded: ActorScope | null, response: AssistantMessagesResponse): { response: AssistantMessagesResponse; withheld: boolean } {
  if (coversRecordedScope(principal, recorded)) return { response, withheld: false };
  return { response: { answer: WITHHELD_ANSWER, toolCalls: [], cards: [], limitations: [], generatedAt: response.generatedAt }, withheld: true };
}

/** The deterministic bounded history (see HISTORY_POLICY). Oldest first. */
type HistoryTurn = Omit<StoredTurn, 'actorScope'> & { actorScope?: ActorScope | null };
export function selectHistory(
  conversation: { messages: StoredConversation['messages']; turns: readonly HistoryTurn[] },
  { excludeTraceId, principal }: { excludeTraceId?: string | undefined; principal?: Principal } = {},
): ModelMessage[] {
  const bySequence = new Map<number, StoredMessage>(conversation.messages.map((m) => [m.sequence, m]));
  const complete = conversation.turns.flatMap((turn) => {
    if (turn.status !== 'COMPLETED' || turn.id === excludeTraceId || turn.userMessageSequence === null || turn.finalMessageSequence === null) return [];
    // Task 03a: a withheld answer (and its question) never reaches the model again.
    if (principal !== undefined && !coversRecordedScope(principal, turn.actorScope ?? null)) return [];
    const user = bySequence.get(turn.userMessageSequence);
    const assistant = bySequence.get(turn.finalMessageSequence);
    if (user?.role !== 'USER' || assistant?.role !== 'ASSISTANT') return [];
    return [{ user: textOf(user.content, 'text'), assistant: textOf(assistant.content, 'answer'), order: turn.userMessageSequence }];
  }).sort((a, b) => a.order - b.order);
  const selected: typeof complete = [];
  let chars = 0;
  for (const turn of [...complete].reverse()) {
    const size = turn.user.length + turn.assistant.length;
    if (selected.length === HISTORY_POLICY.maxTurns || chars + size > HISTORY_POLICY.maxChars) break;
    selected.unshift(turn);
    chars += size;
  }
  return selected.flatMap((t) => [{ role: 'user' as const, content: t.user }, { role: 'assistant' as const, content: t.assistant }]);
}

export function createConversationService({ store, assistant, logger, clock = () => new Date() }: {
  store: AssistantStore;
  assistant: AssistantService;
  logger: Logger;
  clock?: () => Date;
}): ConversationService {
  /** A store read or write outside a turn: unavailable storage is 503, never a model call. */
  async function storage<T>(requestId: string, stage: FailureStage, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AssistantApiError) throw error;
      logger({ event: 'assistant_trace_failure', requestId, traceId: null, stage, category: 'persistence_unavailable' });
      throw unavailable('TRACE_UNAVAILABLE');
    }
  }

  function summary(record: { id: string; createdAt: string; messageCount: number; lastMessageAt: string | null; firstUserText: string | null }): ConversationSummary {
    return {
      conversationId: record.id,
      createdAt: toIso(record.createdAt),
      lastMessageAt: record.lastMessageAt === null ? null : toIso(record.lastMessageAt),
      messageCount: record.messageCount,
      title: record.firstUserText === null ? null : record.firstUserText.slice(0, CONVERSATION_TITLE_LENGTH),
    };
  }

  async function create(principal: Principal): Promise<ConversationSummary> {
    const created = await storage('', 'TRACE_CREATE', () => store.createConversation(principal.hrUserId, dbTime(clock())));
    return summary({ ...created, messageCount: 0, lastMessageAt: null, firstUserText: null });
  }

  async function list(principal: Principal, { page, pageSize }: { page: number; pageSize: number }) {
    const found = await storage('', 'TRACE_CREATE', () => store.listConversationSummaries(principal.hrUserId, pageSize, (page - 1) * pageSize));
    return {
      conversations: found.items.map(summary),
      page: { number: page, size: pageSize, totalRows: found.total, totalPages: Math.ceil(found.total / pageSize) },
    };
  }

  async function owned(principal: Principal, conversationId: string, requestId: string): Promise<StoredConversation> {
    if (!UUID.test(conversationId)) throw notFound();
    const found = await storage(requestId, 'TRACE_CREATE', () => store.readConversation(conversationId, principal.hrUserId));
    if (found === null) throw notFound();
    return found;
  }

  async function read(principal: Principal, conversationId: string): Promise<ConversationDetail> {
    const found = await owned(principal, conversationId, '');
    const userContent = new Map(found.messages.filter((m) => m.role === 'USER').map((m) => [m.sequence, m.content]));
    const recordedScope = new Map(found.turns.map((t) => [t.id, t.actorScope]));
    const first = found.messages.find((m) => m.role === 'USER');
    const last = found.messages.at(-1);
    return {
      conversation: {
        conversationId: found.id,
        createdAt: toIso(found.createdAt),
        lastMessageAt: last === undefined ? null : toIso(last.createdAt),
        messageCount: found.messages.length,
        title: first === undefined ? null : textOf(first.content, 'text').slice(0, CONVERSATION_TITLE_LENGTH),
      },
      messages: found.messages.map((m): ConversationMessage => {
        // The user's own message is always shown.
        if (m.role === 'USER') return { sequence: m.sequence, role: 'user', traceId: m.traceId, createdAt: toIso(m.createdAt), text: textOf(m.content, 'text'), response: null, withheld: false };
        const recorded = m.traceId === null ? null : recordedScope.get(m.traceId) ?? null;
        const { response, withheld } = visibleAnswer(principal, recorded, m.content as AssistantMessagesResponse);
        if (withheld) return { sequence: m.sequence, role: 'assistant', traceId: m.traceId, createdAt: toIso(m.createdAt), text: WITHHELD_ANSWER, response: null, withheld: true };
        return {
          sequence: m.sequence, role: 'assistant', traceId: m.traceId, createdAt: toIso(m.createdAt), text: response.answer,
          response: { toolCalls: response.toolCalls, cards: response.cards, limitations: response.limitations, generatedAt: response.generatedAt },
          withheld: false,
        };
      }),
      turns: found.turns.map((t: StoredTurn): ConversationTurn => {
        const failure = t.status === 'FAILED' ? turnError(t.failureStage, t.errorCategory) : null;
        return {
          traceId: t.id,
          sequence: t.sequence,
          previousTraceId: t.previousTraceId,
          retryOfTraceId: t.userMessageSequence === null ? null : retryOf(userContent.get(t.userMessageSequence)),
          status: t.status,
          userMessageSequence: t.userMessageSequence,
          assistantMessageSequence: t.finalMessageSequence,
          error: failure === null ? null : { code: failure.code, message: failure.publicMessage ?? PUBLIC_MESSAGES[failure.code], reason: failure.reason ?? null },
        };
      }),
    };
  }

  /** The stored outcome for an existing trace with this key. */
  function replay(principal: Principal, conversationId: string, existing: NonNullable<Awaited<ReturnType<AssistantStore['findTraceByIdempotency']>>>, commandHash: string): { value: TurnResult; replayed: boolean } {
    if (existing.commandHash !== commandHash) throw new AssistantApiError(409, 'DUPLICATE_OPERATION');
    if (existing.status === 'STARTED') throw new AssistantApiError(409, 'ASSISTANT_TURN_IN_PROGRESS', { replayed: true });
    if (existing.status === 'FAILED') throw turnError(existing.failureStage, existing.errorCategory, true);
    // A replay is a saved result, so it gets the same trace-time scope check as a read.
    const { response, withheld } = visibleAnswer(principal, existing.actorScope, existing.finalResponse as AssistantMessagesResponse);
    return {
      value: {
        ...response,
        conversationId,
        traceId: existing.id,
        previousTraceId: existing.previousTraceId,
        userMessageSequence: existing.userMessageSequence ?? 0,
        assistantMessageSequence: existing.finalMessageSequence ?? 0,
        withheld,
      },
      replayed: true,
    };
  }

  async function failTrace(traceId: string, requestId: string, started: number, stage: FailureStage | null, category: TurnFailureCategory | 'internal_error'): Promise<void> {
    logger({ event: 'assistant_trace_failure', requestId, traceId, stage: stage ?? 'UNKNOWN', category });
    try {
      await store.finishTrace(traceId, {
        status: 'FAILED',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        completedAt: dbTime(clock()),
        ...(stage === null ? {} : { failureStage: stage }),
        errorCategory: category,
      });
    } catch {
      // The trace stays STARTED; nothing is returned to the user either way.
      logger({ event: 'assistant_trace_finalize_failed', requestId, traceId, stage: stage ?? 'UNKNOWN' });
    }
  }

  async function submit(principal: Principal, conversationId: string, { content, retryOfTraceId }: { content: string; retryOfTraceId?: string | undefined }, idempotencyKey: string, requestId: string) {
    const conversation = await owned(principal, conversationId, requestId);
    if (retryOfTraceId !== undefined && !conversation.turns.some((t) => t.id === retryOfTraceId)) {
      throw new AssistantApiError(400, 'VALIDATION_ERROR', { message: 'The retried message is not part of this conversation.' });
    }
    const commandHash = messageCommandHash(conversationId, content, retryOfTraceId ?? null);
    const existing = await storage(requestId, 'TRACE_CREATE', () => store.findTraceByIdempotency(conversationId, idempotencyKey));
    if (existing !== null) return replay(principal, conversationId, existing, commandHash);
    // Task 03a: with no model configured the turn is still recorded (user
    // message and trace), then fails at MODEL_CALL / not_configured inside
    // runTurn before any provider or tool call.
    const model = assistant.model ?? UNCONFIGURED_MODEL;

    const now = clock();
    const prompt = assistant.prompt(now.toISOString().slice(0, 10));
    const messages: ModelMessage[] = [...selectHistory(conversation, { excludeTraceId: retryOfTraceId, principal }), { role: 'user', content }];
    const previousTraceId = retryOfTraceId ?? conversation.turns.at(-1)?.id;
    const started = performance.now();

    // The trace and user message exist before any provider call.
    let created;
    try {
      created = await store.createTrace({
        conversationId,
        actorId: principal.hrUserId,
        requestId,
        ...(previousTraceId === undefined ? {} : { previousTraceId }),
        idempotencyKey,
        commandHash,
        promptVersion: prompt.version,
        promptHash: prompt.hash,
        model: model.name,
        actorScope: actorScopeOf(principal),
        userContent: { text: content, retryOfTraceId: retryOfTraceId ?? null },
        modelMessages: messages,
        startedAt: dbTime(now),
      });
    } catch (error) {
      if (error instanceof ConflictError && /idempotency/.test(error.message)) throw new AssistantApiError(409, 'DUPLICATE_OPERATION');
      logger({ event: 'assistant_trace_failure', requestId, traceId: null, stage: 'TRACE_CREATE', category: 'persistence_unavailable' });
      throw unavailable('TRACE_UNAVAILABLE');
    }
    if (created.reused) {
      // A concurrent submission with the same key won the conversation lock.
      const winner = await storage(requestId, 'TRACE_CREATE', () => store.findTraceByIdempotency(conversationId, idempotencyKey));
      if (winner === null) throw unavailable('TRACE_UNAVAILABLE');
      return replay(principal, conversationId, winner, commandHash);
    }

    const traceId = created.id;
    const recorder: TurnRecorder = {
      startModelCall: (input) => store.startModelCall({ ...input, traceId }),
      finishModelCall: (callId, input) => store.finishModelCall(callId, input),
      startToolCall: (input) => store.startToolCall({ ...input, traceId }),
      finishToolCall: (callId, input) => store.finishToolCall(callId, input),
    };
    let response: AssistantMessagesResponse;
    try {
      response = await assistant.runTurn({ principal, messages, prompt, requestId, traceId, recorder });
    } catch (error) {
      if (error instanceof TurnFailure) {
        await failTrace(traceId, requestId, started, error.stage, error.category);
        throw turnError(error.stage, error.category);
      }
      await failTrace(traceId, requestId, started, null, 'internal_error');
      throw error;
    }

    // The answer is returned only after the final message and trace are saved.
    let finished;
    try {
      finished = await store.finishTrace(traceId, {
        status: 'COMPLETED',
        finalResponse: response,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        completedAt: dbTime(clock()),
      });
    } catch {
      await failTrace(traceId, requestId, started, 'FINAL_TRACE_WRITE', 'persistence_unavailable');
      throw unavailable('TRACE_UNAVAILABLE');
    }
    return {
      value: {
        ...response,
        conversationId,
        traceId,
        previousTraceId: previousTraceId ?? null,
        userMessageSequence: created.userMessageSequence ?? 0,
        assistantMessageSequence: finished.finalMessageSequence ?? 0,
        withheld: false,
      },
      replayed: false,
    };
  }

  async function legacy(principal: Principal, content: string, requestId: string): Promise<AssistantMessagesResponse> {
    // Recorded like any other turn, including when no model is configured.
    const conversation = await create(principal);
    const { value } = await submit(principal, conversation.conversationId, { content }, randomUUID(), requestId);
    const { answer, toolCalls, cards, limitations, generatedAt } = value;
    return { answer, toolCalls, cards, limitations, generatedAt };
  }

  return { create, list, read, submit, legacy };
}
