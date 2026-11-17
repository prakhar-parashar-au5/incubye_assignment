// Admin AI observability views (AI Task 04): the formatted and raw trace and
// MCP views, identity placeholders for the formatted view, and the monitoring
// summary. Pure mapping over the admin read model; no SQL here.
import {
  AI_FAILURE_STAGES, AI_KNOWN_CATEGORIES, AI_MODEL_CALL_STATUSES, AI_TOOL_CALL_STATUSES, AI_TOOL_VALIDATION_STATUSES, AI_TRACE_STATUSES,
  FORMATTED_REDACTION_NOTE, RAW_TRACE_WARNING,
} from '../../http/contract.js';
import type {
  AdminMcpDetailResponse, AdminMcpListItem, AdminTraceDetailResponse, AdminTraceListItem, AdminTraceOptionsResponse, AdminTraceReview,
  AdminTraceSummaryResponse, AiSummaryWindow,
} from '../../http/contract.js';
import type { z } from 'zod';
import type { AdminObservabilityRepository } from './admin-repository.js';

type Out<T extends z.ZodType> = z.input<T>;
type Repo = AdminObservabilityRepository;
type StoredTrace = NonNullable<Awaited<ReturnType<Repo['readTrace']>>>;
type StoredMcp = NonNullable<Awaited<ReturnType<Repo['readMcpCall']>>>;
export type TraceView = 'formatted' | 'raw';

/** MySQL DATETIME(3) text (UTC) to an ISO instant. */
export const isoFromDb = (text: string): string => `${text.replace(' ', 'T')}Z`;
const isoOrNull = (text: string | null): string | null => (text === null ? null : isoFromDb(text));
/** ISO instant to MySQL DATETIME(3) text. */
export const dbFromDate = (instant: Date): string => instant.toISOString().replace('T', ' ').replace('Z', '');

const EMPLOYEE_CODE = /ACME\d{5}/gi;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Formatted-view identity placeholders (docs_human/13: the formatted timeline
 * hides employee names and codes; salary values stay visible).
 *
 * Identities are learned from stored structured objects that carry an
 * `employeeCode` (with `name` and `email` when present), plus any ACME code
 * anywhere in the trace. Person n becomes "Employee n", code "EMPLOYEE-n",
 * and email "employee-n@redacted.invalid", stable within one trace or MCP
 * call. Every string in the response is rewritten, including prompts, model
 * text, arguments, and results. Limit: a first name or surname typed alone
 * in free text is not recognised as a person and stays visible.
 */
export function identityRedactor(sources: readonly unknown[]): (value: unknown) => unknown {
  const indexByCode = new Map<string, number>();
  const names = new Map<string, number>();
  const emails = new Map<string, number>();
  const indexFor = (code: string): number => {
    const key = code.toUpperCase();
    let n = indexByCode.get(key);
    if (n === undefined) { n = indexByCode.size + 1; indexByCode.set(key, n); }
    return n;
  };
  const learn = (value: unknown): void => {
    if (typeof value === 'string') { for (const match of value.matchAll(EMPLOYEE_CODE)) indexFor(match[0]); return; }
    if (Array.isArray(value)) { value.forEach(learn); return; }
    if (typeof value !== 'object' || value === null) return;
    const code: unknown = Reflect.get(value, 'employeeCode');
    if (typeof code === 'string' && /^ACME\d{5}$/i.test(code)) {
      const n = indexFor(code);
      const name: unknown = Reflect.get(value, 'name');
      const email: unknown = Reflect.get(value, 'email');
      if (typeof name === 'string' && name.trim().length > 1 && !names.has(name)) names.set(name, n);
      if (typeof email === 'string' && email.includes('@') && !emails.has(email.toLowerCase())) emails.set(email.toLowerCase(), n);
    }
    Object.values(value).forEach(learn);
  };
  sources.forEach(learn);
  const nameList = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  const namePattern = nameList.length === 0 ? null : new RegExp(nameList.map(([name]) => escapeRegExp(name)).join('|'), 'g');
  const emailPattern = emails.size === 0 ? null : new RegExp([...emails.keys()].map(escapeRegExp).join('|'), 'gi');
  const rewrite = (text: string): string => {
    let out = text;
    if (emailPattern !== null) out = out.replace(emailPattern, (m) => `employee-${emails.get(m.toLowerCase()) ?? 0}@redacted.invalid`);
    if (namePattern !== null) out = out.replace(namePattern, (m) => `Employee ${names.get(m) ?? 0}`);
    return out.replace(EMPLOYEE_CODE, (m) => `EMPLOYEE-${indexFor(m)}`);
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return rewrite(value);
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
    return value;
  };
  return visit;
}

const viewMeta = (view: TraceView) => ({
  view,
  warning: view === 'raw' ? RAW_TRACE_WARNING : null,
  redaction: view === 'raw' ? { identities: 'NONE' as const, note: null } : { identities: 'PLACEHOLDERS' as const, note: FORMATTED_REDACTION_NOTE },
});

function reviewView(review: StoredTrace['review']): Out<typeof AdminTraceReview> | null {
  if (review === null) return null;
  return { ...review, createdAt: isoFromDb(review.createdAt), updatedAt: isoFromDb(review.updatedAt) };
}

export function traceListItem(item: Awaited<ReturnType<Repo['listTraces']>>['items'][number]): Out<typeof AdminTraceListItem> {
  const { id, startedAt, completedAt, ...rest } = item;
  return { traceId: id, ...rest, startedAt: isoFromDb(startedAt), completedAt: isoOrNull(completedAt) };
}

export function traceDetail(stored: StoredTrace, view: TraceView): Out<typeof AdminTraceDetailResponse> {
  const { trace, modelCalls, toolCalls, messages } = stored;
  const content = {
    userContent: trace.userContent,
    modelMessages: trace.modelMessages,
    finalResponse: trace.finalResponse,
    modelCalls: modelCalls.map((c) => ({
      sequence: c.sequence, status: c.status as (typeof AI_MODEL_CALL_STATUSES)[number], provider: c.provider, model: c.model, providerRequestId: c.providerRequestId,
      promptVersion: c.promptVersion, promptHash: c.promptHash, input: c.input, tools: c.tools, output: c.output, toolDecisions: c.decisions,
      inputTokens: c.inputTokens, outputTokens: c.outputTokens, totalTokens: c.totalTokens, reasoningTokens: c.reasoningTokens,
      startedAt: isoFromDb(c.startedAt), completedAt: isoOrNull(c.completedAt), latencyMs: c.latencyMs, failureCategory: c.failureCategory, safeError: c.safeError,
    })),
    toolCalls: toolCalls.map((c) => ({
      sequence: c.sequence, modelCallSequence: c.modelCallSequence, providerToolCallId: c.providerToolCallId, toolName: c.toolName,
      requestedArguments: c.arguments, validationStatus: c.validationStatus as (typeof AI_TOOL_VALIDATION_STATUSES)[number], validationErrors: c.validation,
      status: c.status as (typeof AI_TOOL_CALL_STATUSES)[number], result: c.result, errorCategory: c.errorCategory, safeError: c.safeError,
      startedAt: isoFromDb(c.startedAt), completedAt: isoOrNull(c.completedAt), durationMs: c.durationMs,
    })),
  };
  // Identity placeholders cover every content field of the formatted view; the header carries no employee identity.
  const shown = view === 'raw' ? content : identityRedactor([toolCalls.map((c) => c.result), content])(content) as typeof content;
  return {
    ...viewMeta(view),
    trace: {
      traceId: trace.id, conversationId: trace.conversationId, turnSequence: trace.sequence, previousTraceId: trace.previousTraceId, nextTraceId: trace.nextTraceId,
      requestId: trace.requestId, hrUser: { id: trace.actorId, displayName: trace.actorDisplayName }, status: trace.status,
      failureStage: trace.failureStage, errorCategory: trace.errorCategory, model: trace.model, promptVersion: trace.promptVersion, promptHash: trace.promptHash,
      startedAt: isoFromDb(trace.startedAt), completedAt: isoOrNull(trace.completedAt), durationMs: trace.durationMs,
      inputTokens: trace.inputTokens, outputTokens: trace.outputTokens, reasoningTokens: trace.reasoningTokens,
      modelCallCount: trace.modelCallCount, toolCallCount: trace.toolCallCount,
    },
    ...shown,
    messages: messages.map((m) => ({ sequence: m.sequence, role: m.role, createdAt: isoFromDb(m.createdAt) })),
    review: reviewView(stored.review),
  };
}

export function mcpListItem(item: Awaited<ReturnType<Repo['listMcpCalls']>>['items'][number]): Out<typeof AdminMcpListItem> {
  const { id, startedAt, completedAt, validationStatus, status, ...rest } = item;
  return {
    mcpCallId: id, ...rest, validationStatus: validationStatus as (typeof AI_TOOL_VALIDATION_STATUSES)[number],
    status: status as (typeof AI_TOOL_CALL_STATUSES)[number], startedAt: isoFromDb(startedAt), completedAt: isoOrNull(completedAt),
  };
}

export function mcpDetail(stored: StoredMcp, view: TraceView): Out<typeof AdminMcpDetailResponse> {
  const { requestedArguments, validationErrors, result, safeError, ...summary } = stored;
  const content = { requestedArguments, validationErrors, result, safeError };
  const shown = view === 'raw' ? content : identityRedactor([result, content])(content) as typeof content;
  return { ...viewMeta(view), call: { ...mcpListItem(summary), ...shown } };
}

export function traceOptions(found: Awaited<ReturnType<Repo['filterOptions']>>): Out<typeof AdminTraceOptionsResponse> {
  return {
    ...found,
    statuses: [...AI_TRACE_STATUSES],
    enums: {
      failureStages: [...AI_FAILURE_STAGES],
      modelCallStatuses: [...AI_MODEL_CALL_STATUSES],
      toolValidationStatuses: [...AI_TOOL_VALIDATION_STATUSES],
      toolCallStatuses: [...AI_TOOL_CALL_STATUSES],
      knownCategories: Object.fromEntries(Object.entries(AI_KNOWN_CATEGORIES).map(([k, v]) => [k, [...v]])) as Record<keyof typeof AI_KNOWN_CATEGORIES, string[]>,
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const SUMMARY_WINDOWS: Readonly<Record<AiSummaryWindow, { ms: number; bucket: 'HOUR' | 'DAY' }>> = Object.freeze({
  '24h': { ms: DAY_MS, bucket: 'HOUR' },
  '7d': { ms: 7 * DAY_MS, bucket: 'DAY' },
  '30d': { ms: 30 * DAY_MS, bucket: 'DAY' },
});

/** The window [now - length, now] and its UTC-aligned bucket starts. */
export function summaryWindow(window: AiSummaryWindow, now: Date): { from: Date; to: Date; bucket: 'HOUR' | 'DAY'; buckets: Date[] } {
  const { ms, bucket } = SUMMARY_WINDOWS[window];
  const from = new Date(now.getTime() - ms);
  const size = bucket === 'HOUR' ? HOUR_MS : DAY_MS;
  const buckets: Date[] = [];
  for (let start = Math.floor(from.getTime() / size) * size; start <= now.getTime(); start += size) buckets.push(new Date(start));
  return { from, to: now, bucket, buckets };
}

export async function buildSummary(repo: Pick<Repo, 'summary'>, window: AiSummaryWindow, now: Date): Promise<Out<typeof AdminTraceSummaryResponse>> {
  const range = summaryWindow(window, now);
  const stats = await repo.summary({ from: dbFromDate(range.from), to: dbFromDate(range.to), bucket: range.bucket });
  const byStatus = (status: string) => stats.statuses.find((s) => s.status === status)?.count ?? 0;
  const counts = new Map(stats.series.map((p) => [isoFromDb(p.bucket), p]));
  const total = stats.statuses.reduce((sum, s) => sum + s.count, 0);
  return {
    window,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    generatedAt: now.toISOString(),
    traces: { total, completed: byStatus('COMPLETED'), failed: byStatus('FAILED'), started: byStatus('STARTED') },
    failures: stats.failures,
    durationMs: { completedCount: stats.durations.count, p50: stats.durations.p50, p95: stats.durations.p95, max: stats.durations.max },
    tokens: { ...stats.tokens, total: stats.tokens.input + stats.tokens.output },
    modelCalls: stats.modelCalls,
    toolCalls: stats.toolCalls.map((t) => ({ ...t, status: t.status as (typeof AI_TOOL_CALL_STATUSES)[number] })),
    mcpCalls: stats.mcpCalls.map((t) => ({ ...t, status: t.status as (typeof AI_TOOL_CALL_STATUSES)[number] })),
    reviews: stats.reviews,
    series: {
      bucket: range.bucket,
      points: range.buckets.map((start) => {
        const point = counts.get(start.toISOString());
        return { start: start.toISOString(), traces: point?.traces ?? 0, failures: point?.failures ?? 0 };
      }),
    },
  };
}
