import type { components, operations } from "@/generated/api";

// Admin AI monitoring: URL state for the trace and MCP lists, plain-language labels for the
// contract's closed enums, the ordered turn timeline, and the Overview's links into the list.
// Pure functions only, shared by Server Components, Client Components, and Server Actions.

type Schemas = components["schemas"];
export type TraceSummary = Schemas["AdminTraceSummaryResponse"];
export type SummaryWindow = TraceSummary["window"];
export type TraceDetail = Schemas["AdminTraceDetailResponse"];
export type TraceListItem = Schemas["AdminTraceListItem"];
export type TraceOptions = Schemas["AdminTraceOptionsResponse"];
export type ModelCall = Schemas["AdminModelCall"];
export type ToolCall = Schemas["AdminToolCall"];
export type TraceReview = Schemas["AdminTraceReview"];
export type McpDetail = Schemas["AdminMcpDetailResponse"];
export type McpListItem = Schemas["AdminMcpListItem"];
export type TraceStatus = TraceListItem["status"];
export type CallStatus = ToolCall["status"];
export type Verdict = TraceReview["verdict"];

export const MAX_REVIEW_NOTE = 2000;
export const PAGE_SIZES = [25, 50, 100] as const;
export const SUMMARY_WINDOWS: readonly SummaryWindow[] = ["24h", "7d", "30d"];
export const WINDOW_LABELS: Record<SummaryWindow, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };

/** The specification's sentence, also the only value of the contract's `warning` field. */
export const RAW_WARNING = "Raw trace data contains complete synthetic employee identities and compensation values.";

export const MONITORING_HREF = "/admin/ai-monitoring";
export const TRACES_HREF = "/admin/ai-traces";
export const MCP_HREF = "/admin/mcp-calls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function summaryWindow(value: string | string[] | undefined): SummaryWindow {
  return typeof value === "string" && (SUMMARY_WINDOWS as readonly string[]).includes(value) ? (value as SummaryWindow) : "24h";
}

// ---------------------------------------------------------------- list URL state

type SearchParams = Record<string, string | string[] | undefined>;
export type TraceQuery = NonNullable<operations["listAdminAiTraces"]["parameters"]["query"]>;
export type McpQuery = NonNullable<operations["listAdminMcpToolCalls"]["parameters"]["query"]>;

const TRACE_STATUSES: readonly TraceStatus[] = ["STARTED", "COMPLETED", "FAILED"];
const CALL_STATUSES: readonly CallStatus[] = ["STARTED", "REJECTED", "SUCCEEDED", "FAILED"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

type Parsed<T> = { ok: true; query: T } | { ok: false };

/**
 * The URL keys are the backend's query names, so a link can be read against the API contract. A
 * repeated, malformed, or out-of-range value makes the whole URL invalid: the page shows the
 * invalid-filter state instead of silently dropping a filter.
 */
function parseCommon(params: SearchParams, allowed: readonly string[]): Parsed<Record<string, string | number>> {
  const query: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined) continue;
    if (!allowed.includes(key) || Array.isArray(raw)) return { ok: false };
    const value = raw.trim();
    if (value === "") continue;
    if (key === "from" || key === "to") {
      if (!validDate(value)) return { ok: false };
      query[key] = value;
    } else if (key === "hrUserId" || key === "page" || key === "pageSize") {
      if (!/^[1-9][0-9]{0,6}$/.test(value)) return { ok: false };
      const n = Number(value);
      if (key === "pageSize" && n > 100) return { ok: false };
      query[key] = n;
    } else {
      if (value.length > 120) return { ok: false };
      query[key] = value;
    }
  }
  if (typeof query.from === "string" && typeof query.to === "string" && query.to < query.from) return { ok: false };
  return { ok: true, query };
}

export function parseTraceQuery(params: SearchParams): Parsed<TraceQuery> {
  const parsed = parseCommon(params, ["from", "to", "hrUserId", "status", "model", "tool", "errorCategory", "page", "pageSize"]);
  if (!parsed.ok) return parsed;
  const { status, errorCategory } = parsed.query;
  if (status !== undefined && !(TRACE_STATUSES as readonly unknown[]).includes(status)) return { ok: false };
  if (typeof errorCategory === "string" && errorCategory.length > 80) return { ok: false };
  return { ok: true, query: parsed.query as TraceQuery };
}

export function parseMcpQuery(params: SearchParams): Parsed<McpQuery> {
  const parsed = parseCommon(params, ["from", "to", "hrUserId", "tool", "status", "page", "pageSize"]);
  if (!parsed.ok) return parsed;
  if (parsed.query.status !== undefined && !(CALL_STATUSES as readonly unknown[]).includes(parsed.query.status)) return { ok: false };
  return { ok: true, query: parsed.query as McpQuery };
}

/** A list URL from a query; defaults (page 1, 25 per page) are left out. `#results` moves focus. */
export function listHref(base: string, query: Readonly<Record<string, string | number | undefined>>, hash = true): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    if (key === "page" && Number(value) === 1) continue;
    if (key === "pageSize" && Number(value) === 25) continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${base}${search ? `?${search}` : ""}${hash ? "#results" : ""}`;
}

/** `?back=` for a detail page's back link: only our own list path with known keys survives. */
export function safeBackHref(value: string | string[] | undefined, base: string, parse: (p: SearchParams) => Parsed<Record<string, unknown>>): string {
  if (typeof value !== "string" || !value.startsWith(`${base}?`) || value.includes("#")) return base;
  const params = Object.fromEntries(new URLSearchParams(value.slice(base.length + 1)));
  const parsed = parse(params);
  return parsed.ok ? listHref(base, parsed.query as Record<string, string | number>, false) : base;
}

// ---------------------------------------------------------------- labels

export const TRACE_STATUS_LABELS: Record<TraceStatus, string> = { STARTED: "In progress", COMPLETED: "Completed", FAILED: "Failed" };
export const MODEL_STATUS_LABELS: Record<ModelCall["status"], string> = { STARTED: "Running", SUCCEEDED: "Succeeded", FAILED: "Failed" };
export const VALIDATION_LABELS: Record<ToolCall["validationStatus"], string> = { PENDING: "Not validated", VALID: "Valid", REJECTED: "Rejected" };
export const CALL_STATUS_LABELS: Record<CallStatus, string> = { STARTED: "Running", REJECTED: "Rejected (not run)", SUCCEEDED: "Succeeded", FAILED: "Failed" };
export const VERDICT_LABELS: Record<Verdict, string> = { CORRECT: "Correct", PARTIAL: "Partially correct", INCORRECT: "Incorrect" };
export const VERDICTS: readonly Verdict[] = ["CORRECT", "PARTIAL", "INCORRECT"];

/** Status tone for the dot: green, red, amber, or grey. The words are always shown beside it. */
export type Tone = "ok" | "error" | "warn" | "muted";
export function traceTone(status: TraceStatus): Tone {
  return status === "COMPLETED" ? "ok" : status === "FAILED" ? "error" : "muted";
}
export function callTone(status: CallStatus | ModelCall["status"]): Tone {
  return status === "SUCCEEDED" ? "ok" : status === "FAILED" ? "error" : status === "REJECTED" ? "warn" : "muted";
}

const STAGES: Record<string, { group: "Recording" | "Model" | "Validation" | "Tool"; label: string }> = {
  TRACE_CREATE: { group: "Recording", label: "Recording failed before the model was called" },
  MODEL_CALL: { group: "Model", label: "Model call failed" },
  MODEL_TRACE_WRITE: { group: "Recording", label: "Recording the model result failed" },
  TOOL_VALIDATION: { group: "Validation", label: "Tool request failed validation" },
  TOOL_EXECUTION: { group: "Tool", label: "Tool failed while running" },
  TOOL_TRACE_WRITE: { group: "Recording", label: "Recording the tool result failed" },
  FINAL_TRACE_WRITE: { group: "Recording", label: "Recording the final answer failed" },
};

/** "Recording · Recording the tool result failed". Unknown stages are printed verbatim. */
export function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  const known = STAGES[stage];
  return known ? `${known.group} · ${known.label}` : stage;
}

const counts = new Intl.NumberFormat("en-US");
export function formatNumber(value: number): string {
  return counts.format(value);
}

/** "640 ms", "1.42 s", "2 min 05 s". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The text of a recorded user prompt, `{ text }` in the stored JSON, or null for another shape. */
export function promptText(userContent: unknown): string | null {
  if (typeof userContent === "string") return userContent;
  if (userContent && typeof userContent === "object" && typeof (userContent as { text?: unknown }).text === "string") return (userContent as { text: string }).text;
  return null;
}

/** The answer text of a recorded final response, or null for another shape. */
export function answerText(finalResponse: unknown): string | null {
  if (finalResponse && typeof finalResponse === "object" && typeof (finalResponse as { answer?: unknown }).answer === "string") return (finalResponse as { answer: string }).answer;
  return null;
}

/** Model output text when the stored output is `{ text }`. */
export function outputText(output: unknown): string | null {
  if (output && typeof output === "object" && typeof (output as { text?: unknown }).text === "string") return (output as { text: string }).text;
  return null;
}

// ---------------------------------------------------------------- timeline

export type TimelineStep =
  | { kind: "prompt"; key: string }
  | { kind: "model"; key: string; call: ModelCall; tools: ToolCall[] }
  | { kind: "tool"; key: string; call: ToolCall }
  | { kind: "final"; key: string }
  | { kind: "stopped"; key: string }
  | { kind: "running"; key: string };

/**
 * The ordered turn: the prompt, each model call by its sequence followed by the tool calls it
 * requested (by their trace-wide sequence), then the final response. A failed turn ends with one
 * "Stopped here" step at the point where recording stopped; a running turn ends "In progress".
 * Order comes only from sequence numbers, never from timestamps.
 */
export function buildTimeline(detail: Pick<TraceDetail, "trace" | "modelCalls" | "toolCalls" | "finalResponse">): TimelineStep[] {
  const steps: TimelineStep[] = [{ kind: "prompt", key: "prompt" }];
  const models = [...detail.modelCalls].sort((a, b) => a.sequence - b.sequence);
  const tools = [...detail.toolCalls].sort((a, b) => a.sequence - b.sequence);
  const placed = new Set<number>();
  for (const call of models) {
    const children = tools.filter((tool) => tool.modelCallSequence === call.sequence);
    steps.push({ kind: "model", key: `model-${call.sequence}`, call, tools: children });
    for (const tool of children) {
      placed.add(tool.sequence);
      steps.push({ kind: "tool", key: `tool-${tool.sequence}`, call: tool });
    }
  }
  // A tool call whose model call is missing from the response is still shown, never dropped.
  for (const tool of tools) if (!placed.has(tool.sequence)) steps.push({ kind: "tool", key: `tool-${tool.sequence}`, call: tool });
  if (detail.finalResponse !== null) steps.push({ kind: "final", key: "final" });
  if (detail.trace.status === "FAILED") steps.push({ kind: "stopped", key: "stopped" });
  if (detail.trace.status === "STARTED") steps.push({ kind: "running", key: "running" });
  return steps;
}

export function outcomeNotRecorded(category: string | null): boolean {
  return category === "OUTCOME_NOT_RECORDED";
}

// ---------------------------------------------------------------- overview links

/** The UTC calendar dates the list filter needs to cover a summary window (it can include more). */
export function windowDates(summary: Pick<TraceSummary, "from" | "to">): { from: string; to: string } {
  return { from: summary.from.slice(0, 10), to: summary.to.slice(0, 10) };
}

export function traceListLink(summary: Pick<TraceSummary, "from" | "to">, filters: Partial<Record<"status" | "model" | "tool" | "errorCategory", string>> = {}): string {
  return listHref(TRACES_HREF, { ...windowDates(summary), ...filters }, false);
}

export function mcpListLink(summary: Pick<TraceSummary, "from" | "to">, filters: Partial<Record<"status" | "tool", string>> = {}): string {
  return listHref(MCP_HREF, { ...windowDates(summary), ...filters }, false);
}

/** Pivot of per-tool, per-status counts: one row per tool, statuses as columns. */
export function pivotCalls(rows: readonly { toolName: string; status: CallStatus; count: number }[]): { toolName: string; counts: Record<CallStatus, number>; total: number }[] {
  const byTool = new Map<string, Record<CallStatus, number>>();
  for (const row of rows) {
    const entry = byTool.get(row.toolName) ?? { STARTED: 0, REJECTED: 0, SUCCEEDED: 0, FAILED: 0 };
    entry[row.status] += row.count;
    byTool.set(row.toolName, entry);
  }
  return [...byTool.entries()]
    .map(([toolName, c]) => ({ toolName, counts: c, total: c.STARTED + c.REJECTED + c.SUCCEEDED + c.FAILED }))
    .sort((a, b) => b.total - a.total || a.toolName.localeCompare(b.toolName));
}

/** "16 Nov, 14:00" for hourly buckets, "16 Nov" for daily, both UTC. */
export function bucketLabel(start: string, bucket: TraceSummary["series"]["bucket"]): string {
  const time = Date.parse(start);
  if (Number.isNaN(time)) return start;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(time);
  if (bucket === "DAY") return day;
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" }).format(time);
  return `${day}, ${hour}`;
}

// ---------------------------------------------------------------- JSON display

/** Stable pretty JSON text and its size, for display only. `undefined` and functions never occur in contract data. */
export function jsonText(value: unknown): { text: string; bytes: number; lines: number } {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return { text, bytes: new TextEncoder().encode(text).length, lines: text.split("\n").length };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Large values start collapsed. */
export function startsOpen(size: { bytes: number; lines: number }): boolean {
  return size.bytes <= 2048 && size.lines <= 40;
}
