import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { parseActorScope } from '../actor-scope.js';
import type { ActorScope } from '../actor-scope.js';
import { boundedJson, PAYLOAD_LIMITS, PersistenceValidationError, validateReview, validateTraceTransition } from './validation.js';
import type { ReviewVerdict, TraceStatus } from './validation.js';

type Row = RowDataPacket & Record<string, unknown>;
type QueryParams = readonly (string | number | null)[];
type TerminalCallStatus = 'SUCCEEDED' | 'FAILED';
type TerminalToolStatus = TerminalCallStatus | 'REJECTED';
type ToolOutcomeInput = { status: TerminalToolStatus; validation?: unknown; result?: unknown; durationMs: number; completedAt: string; errorCategory?: string; safeError?: unknown };

export class ConflictError extends Error {
  constructor(message = 'observability record has changed') { super(message); this.name = 'ConflictError'; }
}

const nonnegative = (name: string, value: number | undefined): void => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new PersistenceValidationError(`${name} must be a non-negative integer`);
};
const json = (value: unknown, limit: number): string => boundedJson(value, limit);
const maybeJson = (value: unknown, limit: number): string | null => value === undefined ? null : json(value, limit);
function validateToolOutcome(input: ToolOutcomeInput): void {
  if (!['REJECTED', 'SUCCEEDED', 'FAILED'].includes(input.status)) throw new PersistenceValidationError('invalid tool status');
  if (input.status !== 'SUCCEEDED' && Object.hasOwn(input, 'result')) throw new PersistenceValidationError('only a successful tool call can have a result');
  if (input.status === 'SUCCEEDED' && !Object.hasOwn(input, 'result')) throw new PersistenceValidationError('successful tool call needs a complete result');
  if (input.status === 'FAILED' && (!input.errorCategory || input.errorCategory.trim() === '')) throw new PersistenceValidationError('failed tool call needs an error category');
}
const id = (value: unknown): string => String(value);
const number = (value: unknown): number => Number(value);
const parse = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) as unknown : value;

async function rows(db: Pool | PoolConnection, sql: string, params: QueryParams = []): Promise<Row[]> {
  const [result] = await db.query<Row[]>(sql, [...params]);
  return result;
}
async function write(db: Pool | PoolConnection, sql: string, params: QueryParams = []): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, [...params]);
  return result;
}
async function transaction<T>(pool: Pool, operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    // READ COMMITTED (Task 03): every read after a row lock sees the latest
    // committed rows. Under REPEATABLE READ, finishTrace's first read fixed an
    // older snapshot before it waited for the conversation lock, so a
    // concurrent turn's message sequence was invisible and the next sequence
    // collided (ER_DUP_ENTRY) when several turns finished at once.
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
async function lockedNext(db: PoolConnection, table: 'ai_messages' | 'ai_traces', conversationId: string): Promise<number> {
  const owner = await rows(db, 'SELECT id FROM ai_conversations WHERE id = ? FOR UPDATE', [conversationId]);
  if (!owner.length) throw new ConflictError('conversation unavailable');
  const found = await rows(db, `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM ${table} WHERE conversation_id = ?`, [conversationId]);
  return number(found[0]?.next_sequence);
}
function conversationRow(row: Row): { id: string; actorId: number; createdAt: string } {
  return { id: id(row.id), actorId: number(row.hr_user_id), createdAt: id(row.created_at) };
}
function messageRow(row: Row): { id: string; traceId: string | null; sequence: number; role: string; content: unknown; createdAt: string } {
  return { id: id(row.id), traceId: row.trace_id === null ? null : id(row.trace_id), sequence: number(row.sequence), role: id(row.role), content: parse(row.content), createdAt: id(row.created_at) };
}
function traceRow(row: Row) {
  return {
    id: id(row.id), conversationId: id(row.conversation_id), previousTraceId: row.previous_trace_id === null ? null : id(row.previous_trace_id),
    actorId: number(row.hr_user_id), sequence: number(row.sequence), requestId: id(row.request_id), status: id(row.status) as TraceStatus,
    model: id(row.model), promptVersion: id(row.prompt_version), promptHash: id(row.prompt_hash),
    errorCategory: row.error_category === null ? null : id(row.error_category), failureStage: row.failure_stage === null ? null : id(row.failure_stage),
    startedAt: id(row.started_at), completedAt: row.completed_at === null ? null : id(row.completed_at), durationMs: row.duration_ms === null ? null : number(row.duration_ms),
    inputTokens: number(row.input_tokens), outputTokens: number(row.output_tokens), reasoningTokens: number(row.reasoning_tokens),
    modelCallCount: number(row.model_call_count), toolCallCount: number(row.tool_call_count),
    userContent: parse(row.user_content), modelMessages: parse(row.model_messages), finalResponse: row.final_response === null ? null : parse(row.final_response),
    userMessageId: row.user_message_id === null ? null : id(row.user_message_id), finalMessageId: row.final_message_id === null ? null : id(row.final_message_id),
  };
}
function callRow(row: Row) {
  return {
    id: id(row.id), traceId: id(row.trace_id), sequence: number(row.sequence), status: id(row.status),
    providerRequestId: row.provider_request_id === null ? null : id(row.provider_request_id), provider: id(row.provider), model: id(row.model),
    promptVersion: id(row.prompt_version), promptHash: id(row.prompt_hash), input: parse(row.input_messages), tools: parse(row.tool_schemas),
    output: row.output_content === null ? null : parse(row.output_content), decisions: row.tool_decisions === null ? null : parse(row.tool_decisions),
    inputTokens: row.input_tokens === null ? null : number(row.input_tokens), outputTokens: row.output_tokens === null ? null : number(row.output_tokens),
    totalTokens: row.total_tokens === null ? null : number(row.total_tokens), reasoningTokens: row.reasoning_tokens === null ? null : number(row.reasoning_tokens),
    startedAt: id(row.started_at), completedAt: row.completed_at === null ? null : id(row.completed_at), latencyMs: row.latency_ms === null ? null : number(row.latency_ms),
    failureCategory: row.failure_category === null ? null : id(row.failure_category), safeError: row.safe_error === null ? null : parse(row.safe_error),
  };
}
function toolRow(row: Row) {
  return {
    id: id(row.id), traceId: id(row.trace_id), modelCallId: id(row.model_call_id), providerToolCallId: row.provider_tool_call_id === null ? null : id(row.provider_tool_call_id),
    sequence: number(row.sequence), status: id(row.status), toolName: id(row.tool_name), arguments: parse(row.requested_arguments),
    validationStatus: id(row.validation_status), validation: row.validation_errors === null ? null : parse(row.validation_errors), result: row.result === null ? null : parse(row.result),
    startedAt: id(row.started_at), completedAt: row.completed_at === null ? null : id(row.completed_at), durationMs: row.duration_ms === null ? null : number(row.duration_ms),
    errorCategory: row.error_category === null ? null : id(row.error_category), safeError: row.safe_error === null ? null : parse(row.safe_error),
  };
}

function turnRow(row: Row) {
  return {
    id: id(row.id), sequence: number(row.sequence), previousTraceId: row.previous_trace_id === null ? null : id(row.previous_trace_id),
    status: id(row.status) as TraceStatus, failureStage: row.failure_stage === null ? null : id(row.failure_stage),
    errorCategory: row.error_category === null ? null : id(row.error_category), startedAt: id(row.started_at),
    userMessageSequence: row.user_message_sequence === null ? null : number(row.user_message_sequence),
    finalMessageSequence: row.final_message_sequence === null ? null : number(row.final_message_sequence),
    // Task 03a: null for traces recorded before migration 007.
    actorScope: parseActorScope(row.actor_role, row.actor_countries === null ? null : parse(row.actor_countries), row.actor_departments === null ? null : parse(row.actor_departments)),
  };
}

/** The validated snapshot columns for createTrace; all null when no snapshot is given. */
function actorScopeColumns(scope: ActorScope | undefined): [string | null, string | null, string | null] {
  if (scope === undefined) return [null, null, null];
  const parsed = parseActorScope(scope.role, scope.countries, scope.departments);
  if (parsed === null) throw new PersistenceValidationError('invalid actor scope snapshot');
  if (parsed.role === 'ADMIN' && (parsed.countries.length > 0 || parsed.departments.length > 0)) throw new PersistenceValidationError('admin snapshot has no scope rows');
  return [parsed.role, JSON.stringify(parsed.countries), JSON.stringify(parsed.departments)];
}

/** Low-level helpers shared with the Admin read model (admin-repository.ts). Not for other callers. */
export const sqlHelpers = Object.freeze({ rows, write, transaction, parse, id, number, traceRow, callRow, toolRow });

export interface TraceFilters { from?: string; to?: string; actorId?: number; status?: TraceStatus; model?: string; toolName?: string; errorCategory?: string; limit?: number; offset?: number }
export interface TraceSummary {
  id: string;
  startedAt: string;
  actorId: number;
  status: TraceStatus;
  model: string;
  toolNames: string[];
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  modelCallCount: number;
  toolCallCount: number;
  errorCategory: string | null;
  failureStage: string | null;
}

export function createObservabilityRepository(pool: Pool) {
  return {
    async createConversation(actorId: number, createdAt: string) {
      const conversationId = randomUUID();
      await write(pool, 'INSERT INTO ai_conversations (id, hr_user_id, created_at) VALUES (?, ?, ?)', [conversationId, actorId, createdAt]);
      return { id: conversationId, actorId, createdAt };
    },
    async listConversations(actorId: number, limit = 25, offset = 0) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new PersistenceValidationError('invalid pagination');
      const found = await rows(pool, 'SELECT id, hr_user_id, created_at FROM ai_conversations WHERE hr_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [actorId, limit, offset]);
      return found.map(conversationRow);
    },
    async readOwnedConversation(conversationId: string, actorId: number) {
      const found = await rows(pool, 'SELECT id, hr_user_id, created_at FROM ai_conversations WHERE id = ? AND hr_user_id = ?', [conversationId, actorId]);
      if (!found[0]) return null;
      const messages = await rows(pool, 'SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [conversationId]);
      return { ...conversationRow(found[0]), messages: messages.map(messageRow) };
    },
    async appendMessage(input: { conversationId: string; actorId: number; traceId?: string; role: 'USER' | 'ASSISTANT'; content: unknown; createdAt: string }) {
      const content = json(input.content, PAYLOAD_LIMITS.message);
      return transaction(pool, async (db) => {
        const sequence = await lockedNext(db, 'ai_messages', input.conversationId);
        const owner = await rows(db, 'SELECT hr_user_id FROM ai_conversations WHERE id = ?', [input.conversationId]);
        if (number(owner[0]?.hr_user_id) !== input.actorId) throw new ConflictError('conversation unavailable');
        if (input.traceId) {
          const target = await rows(db, 'SELECT id FROM ai_traces WHERE id = ? AND conversation_id = ?', [input.traceId, input.conversationId]);
          if (!target.length) throw new ConflictError('trace does not belong to conversation');
        }
        const result = await write(db, 'INSERT INTO ai_messages (conversation_id, trace_id, sequence, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [input.conversationId, input.traceId ?? null, sequence, input.role, content, input.createdAt]);
        return { id: String(result.insertId), sequence };
      });
    },
    async createTrace(input: { conversationId: string; actorId: number; requestId: string; previousTraceId?: string; idempotencyKey?: string; commandHash?: string; promptVersion: string; promptHash: string; model: string; userContent: unknown; modelMessages: unknown; startedAt: string; actorScope?: ActorScope }) {
      const scope = actorScopeColumns(input.actorScope);
      if (input.idempotencyKey !== undefined || input.commandHash !== undefined) {
        if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim() === '' ||
          typeof input.commandHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.commandHash)) {
          throw new PersistenceValidationError('idempotency key and lowercase SHA-256 command hash are required together');
        }
      }
      const user = json(input.userContent, PAYLOAD_LIMITS.message);
      const messages = json(input.modelMessages, PAYLOAD_LIMITS.modelInput);
      return transaction(pool, async (db) => {
        const sequence = await lockedNext(db, 'ai_traces', input.conversationId);
        const owner = await rows(db, 'SELECT hr_user_id FROM ai_conversations WHERE id = ?', [input.conversationId]);
        if (number(owner[0]?.hr_user_id) !== input.actorId) throw new ConflictError('conversation unavailable');
        if (input.previousTraceId) {
          const previous = await rows(db, 'SELECT id FROM ai_traces WHERE id = ? AND conversation_id = ?', [input.previousTraceId, input.conversationId]);
          if (!previous.length) throw new ConflictError('previous trace is outside conversation');
        }
        if (input.idempotencyKey !== undefined) {
          const existing = await rows(db, 'SELECT id, sequence, command_hash FROM ai_traces WHERE conversation_id = ? AND idempotency_key = ?', [input.conversationId, input.idempotencyKey]);
          if (existing[0]) {
            if (existing[0].command_hash !== input.commandHash) throw new ConflictError('idempotency key reused with different command');
            return { id: id(existing[0].id), sequence: number(existing[0].sequence), reused: true, userMessageSequence: null };
          }
        }
        const traceId = randomUUID();
        await write(db, `INSERT INTO ai_traces (id, conversation_id, previous_trace_id, hr_user_id, actor_role, actor_countries, actor_departments, sequence, request_id, idempotency_key, command_hash, model, prompt_version, prompt_hash, user_content, model_messages, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [traceId, input.conversationId, input.previousTraceId ?? null, input.actorId, ...scope, sequence, input.requestId, input.idempotencyKey ?? null, input.commandHash ?? null, input.model, input.promptVersion, input.promptHash, user, messages, input.startedAt]);
        const messageSequence = await lockedNext(db, 'ai_messages', input.conversationId);
        const inserted = await write(db, 'INSERT INTO ai_messages (conversation_id, trace_id, sequence, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [input.conversationId, traceId, messageSequence, 'USER', user, input.startedAt]);
        await write(db, 'UPDATE ai_traces SET user_message_id = ? WHERE id = ?', [inserted.insertId, traceId]);
        return { id: traceId, sequence, reused: false, userMessageSequence: messageSequence as number | null };
      });
    },
    async startModelCall(input: { traceId: string; provider: string; model: string; input: unknown; tools: unknown; promptVersion: string; promptHash: string; startedAt: string; providerRequestId?: string }) {
      const messages = json(input.input, PAYLOAD_LIMITS.modelInput);
      const tools = json(input.tools, PAYLOAD_LIMITS.modelInput);
      return transaction(pool, async (db) => {
        const trace = await rows(db, 'SELECT status FROM ai_traces WHERE id = ? FOR UPDATE', [input.traceId]);
        if (trace[0]?.status !== 'STARTED') throw new ConflictError('trace is not active');
        const next = await rows(db, 'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM ai_model_calls WHERE trace_id = ?', [input.traceId]);
        const result = await write(db, `INSERT INTO ai_model_calls (trace_id, sequence, provider_request_id, provider, model, input_messages, tool_schemas, prompt_version, prompt_hash, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.traceId, number(next[0]?.sequence), input.providerRequestId ?? null, input.provider, input.model, messages, tools, input.promptVersion, input.promptHash, input.startedAt]);
        return { id: String(result.insertId), sequence: number(next[0]?.sequence) };
      });
    },
    async finishModelCall(callId: string, input: { status: TerminalCallStatus; output?: unknown; decisions?: unknown; inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; latencyMs: number; completedAt: string; failureCategory?: string; safeError?: unknown; providerRequestId?: string }) {
      for (const [name, value] of [['inputTokens', input.inputTokens], ['outputTokens', input.outputTokens], ['totalTokens', input.totalTokens], ['reasoningTokens', input.reasoningTokens], ['latencyMs', input.latencyMs]] as const) nonnegative(name, value);
      // A provider-reported total wins; otherwise the sum when both parts are known.
      const totalTokens = input.totalTokens ?? (input.inputTokens !== undefined && input.outputTokens !== undefined ? input.inputTokens + input.outputTokens : undefined);
      if (input.status !== 'SUCCEEDED' && input.status !== 'FAILED') throw new PersistenceValidationError('invalid model status');
      const output = maybeJson(input.output, PAYLOAD_LIMITS.modelOutput);
      const decisions = maybeJson(input.decisions, PAYLOAD_LIMITS.modelOutput);
      const safeError = maybeJson(input.safeError, PAYLOAD_LIMITS.safeError);
      const result = await write(pool, `UPDATE ai_model_calls SET status = ?, output_content = ?, tool_decisions = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, reasoning_tokens = ?, latency_ms = ?, completed_at = ?, failure_category = ?, safe_error = ?, provider_request_id = COALESCE(?, provider_request_id) WHERE id = ? AND status = 'STARTED'`,
        [input.status, output, decisions, input.inputTokens ?? null, input.outputTokens ?? null, totalTokens ?? null, input.reasoningTokens ?? null, input.latencyMs, input.completedAt, input.failureCategory ?? null, safeError, input.providerRequestId ?? null, callId]);
      if (result.affectedRows !== 1) throw new ConflictError('model call is not active');
    },
    async startToolCall(input: { traceId: string; modelCallId: string; toolName: string; arguments: unknown; startedAt: string; providerToolCallId?: string }) {
      const args = json(input.arguments, PAYLOAD_LIMITS.toolArguments);
      return transaction(pool, async (db) => {
        const trace = await rows(db, 'SELECT status FROM ai_traces WHERE id = ? FOR UPDATE', [input.traceId]);
        if (trace[0]?.status !== 'STARTED') throw new ConflictError('trace is not active');
        const model = await rows(db, 'SELECT status FROM ai_model_calls WHERE id = ? AND trace_id = ?', [input.modelCallId, input.traceId]);
        if (model[0]?.status !== 'SUCCEEDED') throw new ConflictError('successful model outcome must be recorded before tool execution');
        const next = await rows(db, 'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM ai_tool_calls WHERE trace_id = ?', [input.traceId]);
        const result = await write(db, `INSERT INTO ai_tool_calls (trace_id, model_call_id, provider_tool_call_id, sequence, tool_name, requested_arguments, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [input.traceId, input.modelCallId, input.providerToolCallId ?? null, number(next[0]?.sequence), input.toolName, args, input.startedAt]);
        return { id: String(result.insertId), sequence: number(next[0]?.sequence) };
      });
    },
    async finishToolCall(callId: string, input: ToolOutcomeInput) {
      validateToolOutcome(input);
      nonnegative('durationMs', input.durationMs);
      const validation = maybeJson(input.validation, PAYLOAD_LIMITS.validation);
      const resultJson = maybeJson(input.result, PAYLOAD_LIMITS.toolResult);
      const safeError = maybeJson(input.safeError, PAYLOAD_LIMITS.safeError);
      const result = await write(pool, `UPDATE ai_tool_calls SET status = ?, validation_status = ?, validation_errors = ?, result = ?, duration_ms = ?, completed_at = ?, error_category = ?, safe_error = ? WHERE id = ? AND status = 'STARTED'`,
        [input.status, input.status === 'REJECTED' ? 'REJECTED' : 'VALID', validation, resultJson, input.durationMs, input.completedAt, input.errorCategory ?? null, safeError, callId]);
      if (result.affectedRows !== 1) throw new ConflictError('tool call is not active');
    },
    async finishTrace(traceId: string, input: { status: 'COMPLETED' | 'FAILED'; finalResponse?: unknown; durationMs: number; completedAt: string; failureStage?: string; errorCategory?: string }) {
      validateTraceTransition('STARTED', input.status);
      nonnegative('durationMs', input.durationMs);
      if (input.status === 'FAILED' && input.finalResponse !== undefined) throw new PersistenceValidationError('failed trace cannot have a final response');
      const response = maybeJson(input.finalResponse, PAYLOAD_LIMITS.assistantResponse);
      return transaction(pool, async (db): Promise<{ finalMessageSequence: number | null }> => {
        // Match createTrace's lock order: conversation first, then trace.
        const target = await rows(db, 'SELECT conversation_id FROM ai_traces WHERE id = ?', [traceId]);
        if (!target[0]) throw new ConflictError('trace unavailable');
        const messageSequence = await lockedNext(db, 'ai_messages', id(target[0].conversation_id));
        const found = await rows(db, 'SELECT status, conversation_id, hr_user_id FROM ai_traces WHERE id = ? FOR UPDATE', [traceId]);
        if (!found[0] || found[0].status !== 'STARTED') throw new ConflictError('trace is already terminal');
        if (input.status === 'FAILED') {
          // Task 03: a failed turn may stop between an attempt and its outcome
          // (the outcome write itself failed). Close those attempts as FAILED
          // with a fixed category, in this transaction, so the trace reaches
          // one terminal state. Their recorded inputs are left untouched.
          await write(db, `UPDATE ai_model_calls SET status = 'FAILED', failure_category = 'OUTCOME_NOT_RECORDED', completed_at = ? WHERE trace_id = ? AND status = 'STARTED'`, [input.completedAt, traceId]);
          await write(db, `UPDATE ai_tool_calls SET status = 'FAILED', error_category = 'OUTCOME_NOT_RECORDED', completed_at = ? WHERE trace_id = ? AND status = 'STARTED'`, [input.completedAt, traceId]);
        }
        const active = await rows(db, `SELECT (SELECT COUNT(*) FROM ai_model_calls WHERE trace_id = ? AND status = 'STARTED') + (SELECT COUNT(*) FROM ai_tool_calls WHERE trace_id = ? AND status = 'STARTED') AS count`, [traceId, traceId]);
        if (number(active[0]?.count) !== 0) throw new ConflictError('trace has unfinished calls');
        const model = await rows(db, 'SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens FROM ai_model_calls WHERE trace_id = ?', [traceId]);
        const tool = await rows(db, 'SELECT COUNT(*) AS calls FROM ai_tool_calls WHERE trace_id = ?', [traceId]);
        let messageId: number | null = null;
        if (input.status === 'COMPLETED') {
          if (response === null) throw new PersistenceValidationError('completed trace needs final response');
          const inserted = await write(db, 'INSERT INTO ai_messages (conversation_id, trace_id, sequence, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id(found[0].conversation_id), traceId, messageSequence, 'ASSISTANT', response, input.completedAt]);
          messageId = inserted.insertId;
        }
        await write(db, `UPDATE ai_traces SET status = ?, final_response = ?, final_message_id = ?, duration_ms = ?, completed_at = ?, failure_stage = ?, error_category = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, model_call_count = ?, tool_call_count = ? WHERE id = ? AND status = 'STARTED'`,
          [input.status, response, messageId, input.durationMs, input.completedAt, input.failureStage ?? null, input.errorCategory ?? null, number(model[0]?.input_tokens), number(model[0]?.output_tokens), number(model[0]?.reasoning_tokens), number(model[0]?.calls), number(tool[0]?.calls), traceId]);
        return { finalMessageSequence: messageId === null ? null : messageSequence };
      });
    },
    /** Owned conversations, most recently active first, with a total for pagination. */
    async listConversationSummaries(actorId: number, limit = 25, offset = 0) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new PersistenceValidationError('invalid pagination');
      const found = await rows(pool, `SELECT c.id, c.created_at,
          (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count,
          (SELECT MAX(m.created_at) FROM ai_messages m WHERE m.conversation_id = c.id) AS last_message_at,
          (SELECT JSON_UNQUOTE(JSON_EXTRACT(m.content, '$.text')) FROM ai_messages m
            WHERE m.conversation_id = c.id AND m.role = 'USER' ORDER BY m.sequence LIMIT 1) AS first_text
        FROM ai_conversations c WHERE c.hr_user_id = ?
        ORDER BY COALESCE((SELECT MAX(m.created_at) FROM ai_messages m WHERE m.conversation_id = c.id), c.created_at) DESC, c.id DESC
        LIMIT ? OFFSET ?`, [actorId, limit, offset]);
      const total = await rows(pool, 'SELECT COUNT(*) AS n FROM ai_conversations WHERE hr_user_id = ?', [actorId]);
      return {
        total: number(total[0]?.n),
        items: found.map((row) => ({
          id: id(row.id), createdAt: id(row.created_at), messageCount: number(row.message_count),
          lastMessageAt: row.last_message_at === null ? null : id(row.last_message_at),
          firstUserText: row.first_text === null ? null : id(row.first_text),
        })),
      };
    },
    /** One owned conversation with ordered messages and turn states; null when unknown or unowned. */
    async readConversation(conversationId: string, actorId: number) {
      const found = await rows(pool, 'SELECT id, hr_user_id, created_at FROM ai_conversations WHERE id = ? AND hr_user_id = ?', [conversationId, actorId]);
      if (!found[0]) return null;
      const [messages, turns] = await Promise.all([
        rows(pool, 'SELECT id, trace_id, sequence, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY sequence', [conversationId]),
        rows(pool, `SELECT t.id, t.sequence, t.previous_trace_id, t.status, t.failure_stage, t.error_category, t.started_at,
            t.actor_role, t.actor_countries, t.actor_departments,
            um.sequence AS user_message_sequence, fm.sequence AS final_message_sequence
          FROM ai_traces t
          LEFT JOIN ai_messages um ON um.id = t.user_message_id
          LEFT JOIN ai_messages fm ON fm.id = t.final_message_id
          WHERE t.conversation_id = ? ORDER BY t.sequence`, [conversationId]),
      ]);
      return {
        id: id(found[0].id), createdAt: id(found[0].created_at),
        messages: messages.map((row) => ({
          traceId: row.trace_id === null ? null : id(row.trace_id), sequence: number(row.sequence),
          role: id(row.role) as 'USER' | 'ASSISTANT', content: parse(row.content), createdAt: id(row.created_at),
        })),
        turns: turns.map(turnRow),
      };
    },
    /** The trace stored under an idempotency key in one conversation, with its command hash and outcome. */
    async findTraceByIdempotency(conversationId: string, idempotencyKey: string) {
      const found = await rows(pool, `SELECT t.id, t.sequence, t.previous_trace_id, t.status, t.failure_stage, t.error_category, t.started_at,
          t.actor_role, t.actor_countries, t.actor_departments, t.command_hash, t.final_response, um.sequence AS user_message_sequence, fm.sequence AS final_message_sequence
        FROM ai_traces t
        LEFT JOIN ai_messages um ON um.id = t.user_message_id
        LEFT JOIN ai_messages fm ON fm.id = t.final_message_id
        WHERE t.conversation_id = ? AND t.idempotency_key = ?`, [conversationId, idempotencyKey]);
      const row = found[0];
      if (!row) return null;
      return { ...turnRow(row), commandHash: id(row.command_hash), finalResponse: row.final_response === null ? null : parse(row.final_response) };
    },
    async startMcpCall(input: { actorId: number; requestId: string; toolName: string; arguments: unknown; startedAt: string }) {
      const callId = randomUUID();
      const args = json(input.arguments, PAYLOAD_LIMITS.toolArguments);
      await write(pool, 'INSERT INTO mcp_tool_calls (id, request_id, hr_user_id, tool_name, requested_arguments, started_at) VALUES (?, ?, ?, ?, ?, ?)', [callId, input.requestId, input.actorId, input.toolName, args, input.startedAt]);
      return { id: callId as string };
    },
    async finishMcpCall(callId: string, input: ToolOutcomeInput) {
      validateToolOutcome(input);
      nonnegative('durationMs', input.durationMs);
      const validation = maybeJson(input.validation, PAYLOAD_LIMITS.validation);
      const resultJson = maybeJson(input.result, PAYLOAD_LIMITS.toolResult);
      const safeError = maybeJson(input.safeError, PAYLOAD_LIMITS.safeError);
      const result = await write(pool, `UPDATE mcp_tool_calls SET status = ?, validation_status = ?, validation_errors = ?, result = ?, duration_ms = ?, completed_at = ?, error_category = ?, safe_error = ? WHERE id = ? AND status = 'STARTED'`,
        [input.status, input.status === 'REJECTED' ? 'REJECTED' : 'VALID', validation, resultJson, input.durationMs, input.completedAt, input.errorCategory ?? null, safeError, callId]);
      if (result.affectedRows !== 1) throw new ConflictError('MCP call is not active');
    },
    async readMcpCall(callId: string) {
      const found = await rows(pool, 'SELECT * FROM mcp_tool_calls WHERE id = ?', [callId]);
      return found[0] ? { id: id(found[0].id), status: id(found[0].status), arguments: parse(found[0].requested_arguments), result: found[0].result === null ? null : parse(found[0].result) } : null;
    },
    async listTraces(filters: TraceFilters = {}): Promise<TraceSummary[]> {
      const limit = filters.limit ?? 25;
      const offset = filters.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new PersistenceValidationError('invalid pagination');
      const where: string[] = [];
      const params: (string | number)[] = [];
      for (const [sql, value] of [['t.started_at >= ?', filters.from], ['t.started_at < ?', filters.to], ['t.hr_user_id = ?', filters.actorId], ['t.status = ?', filters.status], ['t.model = ?', filters.model], ['t.error_category = ?', filters.errorCategory]] as const) {
        if (value !== undefined) { where.push(sql); params.push(value); }
      }
      if (filters.toolName !== undefined) { where.push('EXISTS (SELECT 1 FROM ai_tool_calls tc WHERE tc.trace_id = t.id AND tc.tool_name = ?)'); params.push(filters.toolName); }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const found = await rows(pool, `SELECT t.id, t.conversation_id, t.previous_trace_id, t.hr_user_id, t.sequence, t.status, t.model, t.error_category, t.failure_stage, t.started_at, t.completed_at, t.duration_ms, t.input_tokens, t.output_tokens, t.reasoning_tokens, t.model_call_count, t.tool_call_count FROM ai_traces t ${condition} ORDER BY t.started_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      if (found.length === 0) return [];
      const names = await rows(pool, `SELECT trace_id, tool_name FROM ai_tool_calls WHERE trace_id IN (${found.map(() => '?').join(',')}) ORDER BY trace_id, sequence`, found.map((row) => id(row.id)));
      const toolsByTrace = new Map<string, string[]>();
      for (const item of names) {
        const traceId = id(item.trace_id);
        const toolNames = toolsByTrace.get(traceId) ?? [];
        const toolName = id(item.tool_name);
        if (!toolNames.includes(toolName)) toolNames.push(toolName);
        toolsByTrace.set(traceId, toolNames);
      }
      return found.map((row) => ({
        id: id(row.id), startedAt: id(row.started_at), actorId: number(row.hr_user_id), status: id(row.status) as TraceStatus,
        model: id(row.model), toolNames: toolsByTrace.get(id(row.id)) ?? [], durationMs: row.duration_ms === null ? null : number(row.duration_ms),
        inputTokens: number(row.input_tokens), outputTokens: number(row.output_tokens), reasoningTokens: number(row.reasoning_tokens),
        modelCallCount: number(row.model_call_count), toolCallCount: number(row.tool_call_count),
        errorCategory: row.error_category === null ? null : id(row.error_category), failureStage: row.failure_stage === null ? null : id(row.failure_stage),
      }));
    },
    async readTrace(traceId: string) {
      const found = await rows(pool, 'SELECT * FROM ai_traces WHERE id = ?', [traceId]);
      if (!found[0]) return null;
      const [modelCalls, toolCalls, messages, reviews] = await Promise.all([
        rows(pool, 'SELECT * FROM ai_model_calls WHERE trace_id = ? ORDER BY sequence', [traceId]),
        rows(pool, 'SELECT * FROM ai_tool_calls WHERE trace_id = ? ORDER BY sequence', [traceId]),
        rows(pool, 'SELECT * FROM ai_messages WHERE trace_id = ? ORDER BY sequence', [traceId]),
        rows(pool, 'SELECT * FROM ai_trace_reviews WHERE trace_id = ?', [traceId]),
      ]);
      return { trace: traceRow(found[0]), modelCalls: modelCalls.map(callRow), toolCalls: toolCalls.map(toolRow), messages: messages.map(messageRow), review: reviews[0] ?? null };
    },
    async upsertReview(input: { traceId: string; reviewerId: number; verdict: ReviewVerdict; note: string; nominated: boolean; expectedVersion: number; now: string }) {
      validateReview(input.verdict, input.note);
      nonnegative('expectedVersion', input.expectedVersion);
      return transaction(pool, async (db) => {
        const trace = await rows(db, 'SELECT id FROM ai_traces WHERE id = ? FOR UPDATE', [input.traceId]);
        if (!trace.length) throw new ConflictError('trace unavailable');
        const current = await rows(db, 'SELECT version FROM ai_trace_reviews WHERE trace_id = ?', [input.traceId]);
        const version = current[0] ? number(current[0].version) : 0;
        if (version !== input.expectedVersion) throw new ConflictError('stale review version');
        if (version === 0) {
          await write(db, 'INSERT INTO ai_trace_reviews (trace_id, reviewer_hr_user_id, verdict, note, nominated, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', [input.traceId, input.reviewerId, input.verdict, input.note, Number(input.nominated), input.now, input.now]);
        } else {
          await write(db, 'UPDATE ai_trace_reviews SET reviewer_hr_user_id = ?, verdict = ?, note = ?, nominated = ?, version = version + 1, updated_at = ? WHERE trace_id = ? AND version = ?', [input.reviewerId, input.verdict, input.note, Number(input.nominated), input.now, input.traceId, version]);
        }
        return { version: version + 1 };
      });
    },
    async deleteTrace(traceId: string) {
      return transaction(pool, async (db) => {
        const found = await rows(db, 'SELECT id FROM ai_traces WHERE id = ? FOR UPDATE', [traceId]);
        if (!found.length) return false;
        await write(db, 'DELETE FROM ai_traces WHERE id = ?', [traceId]);
        return true;
      });
    },
    async retentionCounts(cutoff: string) {
      const counts = await rows(pool, `SELECT (SELECT COUNT(*) FROM ai_traces WHERE started_at < ?) AS traces, (SELECT COUNT(*) FROM ai_messages WHERE created_at < ? AND trace_id IS NULL) AS unownedMessages, (SELECT COUNT(*) FROM mcp_tool_calls WHERE started_at < ?) AS mcpCalls`, [cutoff, cutoff, cutoff]);
      return { traces: number(counts[0]?.traces), unownedMessages: number(counts[0]?.unownedMessages), mcpCalls: number(counts[0]?.mcpCalls) };
    },
    async deleteExpired(cutoff: string) {
      let traces = 0;
      let unownedMessages = 0;
      let mcpCalls = 0;
      let conversations = 0;
      for (;;) {
        const batch = await transaction(pool, async (db) => {
          const expired = await rows(db, 'SELECT id FROM ai_traces WHERE started_at < ? ORDER BY started_at, id LIMIT 100 FOR UPDATE', [cutoff]);
          if (!expired.length) return 0;
          for (const trace of expired) await write(db, 'DELETE FROM ai_traces WHERE id = ?', [id(trace.id)]);
          return expired.length;
        });
        traces += batch;
        if (batch < 100) break;
      }
      for (;;) {
        const batch = await transaction(pool, async (db) => {
          const expired = await rows(db, 'SELECT id FROM mcp_tool_calls WHERE started_at < ? ORDER BY started_at, id LIMIT 100 FOR UPDATE', [cutoff]);
          if (!expired.length) return 0;
          for (const call of expired) await write(db, 'DELETE FROM mcp_tool_calls WHERE id = ?', [id(call.id)]);
          return expired.length;
        });
        mcpCalls += batch;
        if (batch < 100) break;
      }
      for (;;) {
        const batch = await transaction(pool, async (db) => {
          const expired = await rows(db, 'SELECT id FROM ai_messages WHERE created_at < ? AND trace_id IS NULL ORDER BY created_at, id LIMIT 100 FOR UPDATE', [cutoff]);
          if (!expired.length) return 0;
          for (const message of expired) await write(db, 'DELETE FROM ai_messages WHERE id = ?', [id(message.id)]);
          return expired.length;
        });
        unownedMessages += batch;
        if (batch < 100) break;
      }
      for (;;) {
        const batch = await transaction(pool, async (db) => {
          const empty = await rows(db, 'SELECT c.id FROM ai_conversations c WHERE c.created_at < ? AND NOT EXISTS (SELECT 1 FROM ai_traces t WHERE t.conversation_id = c.id) AND NOT EXISTS (SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id) ORDER BY c.created_at, c.id LIMIT 100 FOR UPDATE', [cutoff]);
          if (!empty.length) return 0;
          for (const conversation of empty) await write(db, 'DELETE FROM ai_conversations WHERE id = ?', [id(conversation.id)]);
          return empty.length;
        });
        conversations += batch;
        if (batch < 100) break;
      }
      return { traces, unownedMessages, mcpCalls, conversations };
    },
  };
}
