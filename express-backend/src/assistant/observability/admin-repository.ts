// Admin read model for AI observability (AI Task 04): trace list, filter
// options, detail, review, deletion, MCP list and detail, and the monitoring
// summary. Same MySQL tables and persistence model as repository.ts; every
// filter and aggregate uses typed, indexed columns, never JSON scans.
//
// The callers (admin routes) enforce active Admin HR on every request.
import type { Pool } from 'mysql2/promise';

import { ConflictError, sqlHelpers } from './repository.js';
import { PersistenceValidationError, validateReview } from './validation.js';
import type { ReviewVerdict, TraceStatus } from './validation.js';

const { rows, write, transaction, parse, id, number, traceRow, callRow, toolRow } = sqlHelpers;
type Row = Awaited<ReturnType<typeof rows>>[number];

const nullableId = (value: unknown): string | null => (value === null || value === undefined ? null : id(value));
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : number(value));

export interface AdminPage { limit: number; offset: number }
/** Times are DATETIME(3) text in UTC. `toExclusive` is the first instant after the range. */
export interface AdminTraceFilters { from?: string; toExclusive?: string; actorId?: number; status?: TraceStatus; model?: string; toolName?: string; errorCategory?: string }
export interface AdminMcpFilters { from?: string; toExclusive?: string; actorId?: number; toolName?: string; status?: 'STARTED' | 'REJECTED' | 'SUCCEEDED' | 'FAILED' }

function checkPage({ limit, offset }: AdminPage): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new PersistenceValidationError('invalid pagination');
}

function traceWhere(filters: AdminTraceFilters): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value !== undefined) { where.push(sql); params.push(value); }
  };
  add('t.started_at >= ?', filters.from);
  add('t.started_at < ?', filters.toExclusive);
  add('t.hr_user_id = ?', filters.actorId);
  add('t.status = ?', filters.status);
  add('t.model = ?', filters.model);
  add('t.error_category = ?', filters.errorCategory);
  add('EXISTS (SELECT 1 FROM ai_tool_calls tc WHERE tc.trace_id = t.id AND tc.tool_name = ?)', filters.toolName);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function mcpWhere(filters: AdminMcpFilters): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value !== undefined) { where.push(sql); params.push(value); }
  };
  add('m.started_at >= ?', filters.from);
  add('m.started_at < ?', filters.toExclusive);
  add('m.hr_user_id = ?', filters.actorId);
  add('m.tool_name = ?', filters.toolName);
  add('m.status = ?', filters.status);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const hrUser = (row: Row, idKey: string, nameKey: string) => ({ id: number(row[idKey]), displayName: id(row[nameKey]) });

function reviewRow(row: Row | undefined) {
  if (!row) return null;
  return {
    verdict: id(row.verdict) as ReviewVerdict, note: id(row.note), nominated: Boolean(number(row.nominated)), version: number(row.version),
    reviewer: hrUser(row, 'reviewer_hr_user_id', 'reviewer_display_name'), createdAt: id(row.created_at), updatedAt: id(row.updated_at),
  };
}

function mcpRow(row: Row) {
  return {
    id: id(row.id), requestId: id(row.request_id), hrUser: hrUser(row, 'hr_user_id', 'display_name'), toolName: id(row.tool_name),
    validationStatus: id(row.validation_status), status: id(row.status), startedAt: id(row.started_at), completedAt: nullableId(row.completed_at),
    durationMs: nullableNumber(row.duration_ms), errorCategory: nullableId(row.error_category),
  };
}

export type SummaryWindow = { from: string; to: string; bucket: 'HOUR' | 'DAY' };

export function createAdminObservabilityRepository(pool: Pool) {
  return {
    /** Newest first (start time, then ID), with the total for the same filters. */
    async listTraces(filters: AdminTraceFilters, page: AdminPage) {
      checkPage(page);
      const { sql, params } = traceWhere(filters);
      const [found, total] = await Promise.all([
        rows(pool, `SELECT t.id, t.conversation_id, t.sequence, t.hr_user_id, u.display_name, t.status, t.model, t.error_category, t.failure_stage,
            t.started_at, t.completed_at, t.duration_ms, t.input_tokens, t.output_tokens, t.reasoning_tokens, t.model_call_count, t.tool_call_count
          FROM ai_traces t JOIN hr_users u ON u.id = t.hr_user_id ${sql}
          ORDER BY t.started_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]),
        rows(pool, `SELECT COUNT(*) AS n FROM ai_traces t ${sql}`, params),
      ]);
      const toolsByTrace = new Map<string, string[]>();
      if (found.length > 0) {
        const names = await rows(pool, `SELECT trace_id, tool_name FROM ai_tool_calls WHERE trace_id IN (${found.map(() => '?').join(',')}) ORDER BY trace_id, sequence`, found.map((r) => id(r.id)));
        for (const item of names) {
          const list = toolsByTrace.get(id(item.trace_id)) ?? [];
          if (!list.includes(id(item.tool_name))) list.push(id(item.tool_name));
          toolsByTrace.set(id(item.trace_id), list);
        }
      }
      return {
        total: number(total[0]?.n),
        items: found.map((r) => ({
          id: id(r.id), conversationId: id(r.conversation_id), turnSequence: number(r.sequence), hrUser: hrUser(r, 'hr_user_id', 'display_name'),
          status: id(r.status) as TraceStatus, model: id(r.model), toolNames: toolsByTrace.get(id(r.id)) ?? [],
          startedAt: id(r.started_at), completedAt: nullableId(r.completed_at), durationMs: nullableNumber(r.duration_ms),
          inputTokens: number(r.input_tokens), outputTokens: number(r.output_tokens), reasoningTokens: number(r.reasoning_tokens),
          modelCallCount: number(r.model_call_count), toolCallCount: number(r.tool_call_count),
          errorCategory: nullableId(r.error_category), failureStage: nullableId(r.failure_stage),
        })),
      };
    },

    /** Distinct values present in stored traces and MCP calls, for the list filters. */
    async filterOptions() {
      const [users, models, tools, errors, stages] = await Promise.all([
        rows(pool, `SELECT u.id, u.display_name FROM hr_users u
          WHERE EXISTS (SELECT 1 FROM ai_traces t WHERE t.hr_user_id = u.id) OR EXISTS (SELECT 1 FROM mcp_tool_calls m WHERE m.hr_user_id = u.id)
          ORDER BY u.display_name, u.id`),
        rows(pool, 'SELECT DISTINCT model FROM ai_traces ORDER BY model'),
        rows(pool, 'SELECT DISTINCT tool_name FROM ai_tool_calls UNION SELECT DISTINCT tool_name FROM mcp_tool_calls ORDER BY tool_name'),
        rows(pool, 'SELECT DISTINCT error_category FROM ai_traces WHERE error_category IS NOT NULL ORDER BY error_category'),
        rows(pool, 'SELECT DISTINCT failure_stage FROM ai_traces WHERE failure_stage IS NOT NULL ORDER BY failure_stage'),
      ]);
      return {
        hrUsers: users.map((r) => ({ id: number(r.id), displayName: id(r.display_name) })),
        models: models.map((r) => id(r.model)),
        toolNames: tools.map((r) => id(r.tool_name)),
        errorCategories: errors.map((r) => id(r.error_category)),
        failureStages: stages.map((r) => id(r.failure_stage)),
      };
    },

    /** One complete trace with its ordered children, actor, review, and next trace; null when unknown or deleted. */
    async readTrace(traceId: string) {
      const found = await rows(pool, 'SELECT t.*, u.display_name AS actor_display_name FROM ai_traces t JOIN hr_users u ON u.id = t.hr_user_id WHERE t.id = ?', [traceId]);
      const row = found[0];
      if (!row) return null;
      const [modelCalls, toolCalls, messages, reviews, next] = await Promise.all([
        rows(pool, 'SELECT * FROM ai_model_calls WHERE trace_id = ? ORDER BY sequence', [traceId]),
        rows(pool, 'SELECT tc.*, mc.sequence AS model_call_sequence FROM ai_tool_calls tc JOIN ai_model_calls mc ON mc.id = tc.model_call_id WHERE tc.trace_id = ? ORDER BY tc.sequence', [traceId]),
        rows(pool, 'SELECT sequence, role, created_at FROM ai_messages WHERE trace_id = ? ORDER BY sequence', [traceId]),
        rows(pool, 'SELECT r.*, u.display_name AS reviewer_display_name FROM ai_trace_reviews r JOIN hr_users u ON u.id = r.reviewer_hr_user_id WHERE r.trace_id = ?', [traceId]),
        rows(pool, 'SELECT id FROM ai_traces WHERE previous_trace_id = ? ORDER BY sequence LIMIT 1', [traceId]),
      ]);
      return {
        trace: { ...traceRow(row), actorDisplayName: id(row.actor_display_name), nextTraceId: next[0] ? id(next[0].id) : null },
        modelCalls: modelCalls.map(callRow),
        toolCalls: toolCalls.map((r) => ({ ...toolRow(r), modelCallSequence: number(r.model_call_sequence) })),
        messages: messages.map((r) => ({ sequence: number(r.sequence), role: id(r.role) as 'USER' | 'ASSISTANT', createdAt: id(r.created_at) })),
        review: reviewRow(reviews[0]),
      };
    },

    /**
     * Compare-and-set review. Locks the trace first, so a review cannot land on
     * a trace being deleted. Throws ConflictError('trace unavailable'),
     * ('trace in progress'), or ('stale review version').
     */
    async reviewTrace(input: { traceId: string; reviewerId: number; verdict: ReviewVerdict; note: string; nominated: boolean; expectedVersion: number; now: string }) {
      validateReview(input.verdict, input.note);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new PersistenceValidationError('invalid expected version');
      await transaction(pool, async (db) => {
        const trace = await rows(db, 'SELECT status FROM ai_traces WHERE id = ? FOR UPDATE', [input.traceId]);
        if (!trace[0]) throw new ConflictError('trace unavailable');
        if (trace[0].status === 'STARTED') throw new ConflictError('trace in progress');
        const current = await rows(db, 'SELECT version FROM ai_trace_reviews WHERE trace_id = ? FOR UPDATE', [input.traceId]);
        const version = current[0] ? number(current[0].version) : 0;
        if (version !== input.expectedVersion) throw new ConflictError('stale review version');
        if (version === 0) {
          await write(db, 'INSERT INTO ai_trace_reviews (trace_id, reviewer_hr_user_id, verdict, note, nominated, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
            [input.traceId, input.reviewerId, input.verdict, input.note, Number(input.nominated), input.now, input.now]);
        } else {
          await write(db, 'UPDATE ai_trace_reviews SET reviewer_hr_user_id = ?, verdict = ?, note = ?, nominated = ?, version = version + 1, updated_at = ? WHERE trace_id = ? AND version = ?',
            [input.reviewerId, input.verdict, input.note, Number(input.nominated), input.now, input.traceId, version]);
        }
      });
      const saved = await rows(pool, 'SELECT r.*, u.display_name AS reviewer_display_name FROM ai_trace_reviews r JOIN hr_users u ON u.id = r.reviewer_hr_user_id WHERE r.trace_id = ?', [input.traceId]);
      const review = reviewRow(saved[0]);
      if (review === null) throw new ConflictError('trace unavailable');
      return review;
    },

    /**
     * Hard-deletes one trace aggregate: the trace, its model and tool calls,
     * its review, and the user/assistant messages of that turn (foreign-key
     * cascades). Other turns stay; a later trace's previous_trace_id becomes
     * NULL. Returns the removed counts, or null when the trace is unknown.
     */
    async deleteTrace(traceId: string) {
      return transaction(pool, async (db) => {
        const found = await rows(db, 'SELECT id FROM ai_traces WHERE id = ? FOR UPDATE', [traceId]);
        if (!found[0]) return null;
        const [counts] = await rows(db, `SELECT
            (SELECT COUNT(*) FROM ai_model_calls WHERE trace_id = ?) AS model_calls,
            (SELECT COUNT(*) FROM ai_tool_calls WHERE trace_id = ?) AS tool_calls,
            (SELECT COUNT(*) FROM ai_messages WHERE trace_id = ?) AS messages,
            (SELECT COUNT(*) FROM ai_trace_reviews WHERE trace_id = ?) AS reviews`, [traceId, traceId, traceId, traceId]);
        await write(db, 'DELETE FROM ai_traces WHERE id = ?', [traceId]);
        return { modelCalls: number(counts?.model_calls), toolCalls: number(counts?.tool_calls), messages: number(counts?.messages), review: number(counts?.reviews) > 0 };
      });
    },

    async listMcpCalls(filters: AdminMcpFilters, page: AdminPage) {
      checkPage(page);
      const { sql, params } = mcpWhere(filters);
      const [found, total] = await Promise.all([
        rows(pool, `SELECT m.id, m.request_id, m.hr_user_id, u.display_name, m.tool_name, m.validation_status, m.status, m.started_at, m.completed_at, m.duration_ms, m.error_category
          FROM mcp_tool_calls m JOIN hr_users u ON u.id = m.hr_user_id ${sql} ORDER BY m.started_at DESC, m.id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]),
        rows(pool, `SELECT COUNT(*) AS n FROM mcp_tool_calls m ${sql}`, params),
      ]);
      return { total: number(total[0]?.n), items: found.map(mcpRow) };
    },

    async readMcpCall(callId: string) {
      const found = await rows(pool, 'SELECT m.*, u.display_name FROM mcp_tool_calls m JOIN hr_users u ON u.id = m.hr_user_id WHERE m.id = ?', [callId]);
      const row = found[0];
      if (!row) return null;
      return {
        ...mcpRow(row),
        requestedArguments: parse(row.requested_arguments),
        validationErrors: row.validation_errors === null ? null : parse(row.validation_errors),
        result: row.result === null ? null : parse(row.result),
        safeError: row.safe_error === null ? null : parse(row.safe_error),
      };
    },

    /**
     * Monitoring aggregates for traces started in [from, to] (both inclusive).
     * Uses idx_ai_traces_started for the window, the trace-ID keys of the
     * child tables, and idx_mcp_started.
     */
    async summary({ from, to, bucket }: SummaryWindow) {
      const inWindow = 't.started_at >= ? AND t.started_at <= ?';
      const w = [from, to];
      const bucketSql = bucket === 'HOUR' ? "DATE_FORMAT(t.started_at, '%Y-%m-%d %H:00:00.000')" : "DATE_FORMAT(t.started_at, '%Y-%m-%d 00:00:00.000')";
      const [statuses, failures, durations, tokens, models, tools, mcp, reviews, unreviewed, series] = await Promise.all([
        rows(pool, `SELECT t.status, COUNT(*) AS n FROM ai_traces t WHERE ${inWindow} GROUP BY t.status`, w),
        rows(pool, `SELECT t.failure_stage, t.error_category, COUNT(*) AS n FROM ai_traces t WHERE ${inWindow} AND t.status = 'FAILED'
          GROUP BY t.failure_stage, t.error_category ORDER BY n DESC, t.failure_stage, t.error_category`, w),
        // Exact nearest-rank percentiles: the smallest duration whose rank is at least ceil(p * n).
        rows(pool, `SELECT MAX(d.n) AS n,
            MIN(CASE WHEN d.rn >= CEIL(0.50 * d.n) THEN d.duration_ms END) AS p50,
            MIN(CASE WHEN d.rn >= CEIL(0.95 * d.n) THEN d.duration_ms END) AS p95,
            MAX(d.duration_ms) AS max_ms
          FROM (SELECT t.duration_ms, ROW_NUMBER() OVER (ORDER BY t.duration_ms, t.id) AS rn, COUNT(*) OVER () AS n
                FROM ai_traces t WHERE ${inWindow} AND t.status = 'COMPLETED' AND t.duration_ms IS NOT NULL) d`, w),
        rows(pool, `SELECT COALESCE(SUM(t.input_tokens), 0) AS input_tokens, COALESCE(SUM(t.output_tokens), 0) AS output_tokens,
            COALESCE(SUM(t.reasoning_tokens), 0) AS reasoning_tokens
          FROM ai_traces t WHERE ${inWindow}`, w),
        rows(pool, `SELECT mc.model, COUNT(*) AS n FROM ai_traces t JOIN ai_model_calls mc ON mc.trace_id = t.id WHERE ${inWindow} GROUP BY mc.model ORDER BY n DESC, mc.model`, w),
        rows(pool, `SELECT tc.tool_name, tc.status, COUNT(*) AS n FROM ai_traces t JOIN ai_tool_calls tc ON tc.trace_id = t.id WHERE ${inWindow}
          GROUP BY tc.tool_name, tc.status ORDER BY tc.tool_name, tc.status`, w),
        rows(pool, `SELECT m.tool_name, m.status, COUNT(*) AS n FROM mcp_tool_calls m WHERE m.started_at >= ? AND m.started_at <= ?
          GROUP BY m.tool_name, m.status ORDER BY m.tool_name, m.status`, w),
        rows(pool, `SELECT r.verdict, COUNT(*) AS n FROM ai_traces t JOIN ai_trace_reviews r ON r.trace_id = t.id WHERE ${inWindow} GROUP BY r.verdict`, w),
        rows(pool, `SELECT COUNT(*) AS n FROM ai_traces t LEFT JOIN ai_trace_reviews r ON r.trace_id = t.id WHERE ${inWindow} AND t.status <> 'STARTED' AND r.trace_id IS NULL`, w),
        rows(pool, `SELECT ${bucketSql} AS bucket, COUNT(*) AS traces, SUM(t.status = 'FAILED') AS failures FROM ai_traces t WHERE ${inWindow} GROUP BY bucket ORDER BY bucket`, w),
      ]);
      const d = durations[0];
      return {
        statuses: statuses.map((r) => ({ status: id(r.status) as TraceStatus, count: number(r.n) })),
        failures: failures.map((r) => ({ failureStage: nullableId(r.failure_stage), errorCategory: nullableId(r.error_category), count: number(r.n) })),
        durations: {
          count: d?.n === null || d?.n === undefined ? 0 : number(d.n),
          p50: nullableNumber(d?.p50), p95: nullableNumber(d?.p95), max: nullableNumber(d?.max_ms),
        },
        tokens: { input: number(tokens[0]?.input_tokens), output: number(tokens[0]?.output_tokens), reasoning: number(tokens[0]?.reasoning_tokens) },
        // Counted from the child rows, so open (STARTED) traces are included too.
        modelCalls: { total: models.reduce((sum, r) => sum + number(r.n), 0), byModel: models.map((r) => ({ model: id(r.model), count: number(r.n) })) },
        toolCalls: tools.map((r) => ({ toolName: id(r.tool_name), status: id(r.status), count: number(r.n) })),
        mcpCalls: mcp.map((r) => ({ toolName: id(r.tool_name), status: id(r.status), count: number(r.n) })),
        reviews: { byVerdict: reviews.map((r) => ({ verdict: id(r.verdict) as ReviewVerdict, count: number(r.n) })), unreviewed: number(unreviewed[0]?.n) },
        series: series.map((r) => ({ bucket: id(r.bucket), traces: number(r.traces), failures: number(r.failures) })),
      };
    },
  };
}
export type AdminObservabilityRepository = ReturnType<typeof createAdminObservabilityRepository>;
