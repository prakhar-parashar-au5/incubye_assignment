import { beforeEach, describe, expect, it, vi } from "vitest";

import contract from "@/generated/api-openapi.json";
import {
  MAX_REVIEW_NOTE,
  RAW_WARNING,
  buildTimeline,
  formatDuration,
  listHref,
  parseMcpQuery,
  parseTraceQuery,
  pivotCalls,
  safeBackHref,
  stageLabel,
  summaryWindow,
  traceListLink,
  windowDates,
  type TraceDetail,
} from "@/lib/ai-monitoring";
import {
  isAdminMcpDetailResponse,
  isAdminTraceDetailResponse,
  isAdminTraceReviewResponse,
  isAdminTraceSummaryResponse,
} from "@/server/api/contract";

import { SAMPLE_TOKEN, errorResponse, jsonResponse } from "../support/fake-backend";
import { MCP_ID, TRACE_ID, mcpDetail, modelCall, review, summary, toolCall, traceDetail } from "../support/monitoring-fixtures";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {}, redirect: () => { throw new Error("unexpected redirect"); } }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { deleteTrace, loadRawMcpCall, loadRawTrace, saveTraceReview } = await import("@/server/actions/ai-monitoring");

type Route = (init: RequestInit, url: URL) => Response | Promise<Response>;
const requests: { url: URL; method: string; init: RequestInit }[] = [];
function backend(routes: Record<string, Route>) {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push({ url, method, init });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new Error(`unexpected request ${method} ${url.pathname}`);
    return route(init, url);
  });
}

beforeEach(() => {
  jar.clear();
  requests.length = 0;
  refresh.mockReset();
  jar.set("acme_session", SAMPLE_TOKEN);
  vi.stubEnv("API_BASE_URL", "http://backend.test:3000");
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("contract", () => {
  it("fixtures match the generated schemas", () => {
    expect(isAdminTraceDetailResponse(traceDetail())).toBe(true);
    expect(isAdminTraceSummaryResponse(summary())).toBe(true);
    expect(isAdminMcpDetailResponse(mcpDetail())).toBe(true);
    expect(isAdminTraceReviewResponse({ review: review() })).toBe(true);
    expect(isAdminTraceDetailResponse({ ...traceDetail(), hiddenReasoning: "x" })).toBe(false);
  });

  it("the raw warning and review note limit come from the contract", () => {
    const schemas = contract.components.schemas;
    expect(schemas.AdminTraceDetailResponse.properties.warning.anyOf.find((s: { const?: string }) => s.const)?.const).toBe(RAW_WARNING);
    expect(schemas.AdminTraceReviewRequest.properties.note.maxLength).toBe(MAX_REVIEW_NOTE);
  });
});

describe("list URL state", () => {
  it("accepts the documented filters and drops empty values", () => {
    expect(parseTraceQuery({ from: "2026-11-01", to: "2026-11-17", status: "FAILED", hrUserId: "2", tool: "search_employees", errorCategory: "timeout", model: "m", page: "2", pageSize: "50", other: undefined })).toEqual({
      ok: true,
      query: { from: "2026-11-01", to: "2026-11-17", status: "FAILED", hrUserId: 2, tool: "search_employees", errorCategory: "timeout", model: "m", page: 2, pageSize: 50 },
    });
    expect(parseTraceQuery({ from: "", status: "" })).toEqual({ ok: true, query: {} });
  });

  it.each([
    ["page size over 100", { pageSize: "500" }],
    ["end before start", { from: "2026-11-10", to: "2026-11-01" }],
    ["impossible date", { from: "2026-02-30" }],
    ["unknown status", { status: "DELETED" }],
    ["unknown key", { q: "x" }],
    ["repeated key", { status: ["FAILED", "COMPLETED"] }],
    ["non-numeric user", { hrUserId: "1;drop" }],
  ])("rejects %s instead of dropping it", (_label, params) => {
    expect(parseTraceQuery(params as Record<string, string>).ok).toBe(false);
  });

  it("MCP accepts call statuses, not trace statuses", () => {
    expect(parseMcpQuery({ status: "REJECTED" })).toEqual({ ok: true, query: { status: "REJECTED" } });
    expect(parseMcpQuery({ status: "COMPLETED" }).ok).toBe(false);
    expect(parseMcpQuery({ model: "x" }).ok).toBe(false);
  });

  it("builds list links without defaults and keeps only safe back links", () => {
    expect(listHref("/admin/ai-traces", { status: "FAILED", page: 1, pageSize: 25 })).toBe("/admin/ai-traces?status=FAILED#results");
    expect(safeBackHref("/admin/ai-traces?status=FAILED&page=2", "/admin/ai-traces", parseTraceQuery)).toBe("/admin/ai-traces?status=FAILED&page=2");
    for (const bad of ["https://evil.example/admin/ai-traces?x=1", "/admin/ai-traces?q=<script>", "//evil", undefined]) {
      expect(safeBackHref(bad, "/admin/ai-traces", parseTraceQuery)).toBe("/admin/ai-traces");
    }
  });

  it("summary window defaults to 24h", () => {
    expect(summaryWindow("7d")).toBe("7d");
    expect(summaryWindow("1y")).toBe("24h");
  });
});

describe("labels and overview links", () => {
  it("names each failure stage with its group, and prints unknown stages verbatim", () => {
    expect(stageLabel("TOOL_TRACE_WRITE")).toBe("Recording · Recording the tool result failed");
    expect(stageLabel("MODEL_CALL")).toBe("Model · Model call failed");
    expect(stageLabel("TOOL_VALIDATION")).toBe("Validation · Tool request failed validation");
    expect(stageLabel("TOOL_EXECUTION")).toBe("Tool · Tool failed while running");
    expect(stageLabel("NEW_STAGE")).toBe("NEW_STAGE");
    expect(stageLabel(null)).toBeNull();
  });

  it("formats durations", () => {
    expect([formatDuration(null), formatDuration(640), formatDuration(1420), formatDuration(125_000)]).toEqual(["—", "640 ms", "1.42 s", "2 min 05 s"]);
  });

  it("overview links use the window's UTC dates and the list filter names", () => {
    const s = summary() as never;
    expect(windowDates(s)).toEqual({ from: "2026-11-16", to: "2026-11-17" });
    expect(traceListLink(s, { status: "FAILED", errorCategory: "timeout" })).toBe("/admin/ai-traces?from=2026-11-16&to=2026-11-17&status=FAILED&errorCategory=timeout");
  });

  it("pivots tool counts by status", () => {
    expect(pivotCalls(summary().toolCalls as never)).toEqual([
      { toolName: "search_employees", counts: { STARTED: 0, REJECTED: 1, SUCCEEDED: 2, FAILED: 0 }, total: 3 },
      { toolName: "get_compensation_summary", counts: { STARTED: 0, REJECTED: 0, SUCCEEDED: 0, FAILED: 1 }, total: 1 },
    ]);
  });
});

describe("buildTimeline", () => {
  const kinds = (detail: unknown) => buildTimeline(detail as TraceDetail).map((step) => step.key);

  it("orders by sequence numbers, placing each tool after its model call", () => {
    const detail = traceDetail();
    detail.modelCalls.reverse();
    detail.toolCalls.reverse();
    expect(kinds(detail)).toEqual(["prompt", "model-1", "tool-1", "tool-2", "model-2", "final"]);
  });

  it("a no-tool turn has model calls without tool children", () => {
    expect(kinds(traceDetail({ modelCalls: [modelCall(1)], toolCalls: [] }))).toEqual(["prompt", "model-1", "final"]);
  });

  it("a failed turn ends with Stopped here and no final response; a running turn ends In progress", () => {
    const failed = traceDetail({ finalResponse: null, modelCalls: [modelCall(1), modelCall(2, { status: "FAILED", failureCategory: "timeout" })], toolCalls: [toolCall(1, 1)] }, { status: "FAILED", failureStage: "MODEL_CALL", errorCategory: "timeout" });
    expect(kinds(failed)).toEqual(["prompt", "model-1", "tool-1", "model-2", "stopped"]);
    expect(kinds(traceDetail({ finalResponse: null, modelCalls: [], toolCalls: [] }, { status: "STARTED" }))).toEqual(["prompt", "running"]);
  });

  it("never drops a tool call whose model call is missing", () => {
    expect(kinds(traceDetail({ modelCalls: [], toolCalls: [toolCall(1, 9)] }))).toEqual(["prompt", "tool-1", "final"]);
  });
});

describe("Admin Server Actions", () => {
  const path = `/api/v1/admin/ai-traces/${TRACE_ID}`;

  it("loads the raw view with view=raw and the server-side token", async () => {
    backend({ [`GET ${path}`]: () => jsonResponse(200, traceDetail({ view: "raw", warning: RAW_WARNING, redaction: { identities: "NONE", note: null } })) });
    const result = await loadRawTrace(TRACE_ID);
    expect(result.ok).toBe(true);
    expect(requests[0].url.searchParams.get("view")).toBe("raw");
    expect(new Headers(requests[0].init.headers).get("authorization")).toBe(`Bearer ${SAMPLE_TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
  });

  it("refuses to present a formatted response as raw", async () => {
    backend({ [`GET ${path}`]: () => jsonResponse(200, traceDetail()) });
    expect(await loadRawTrace(TRACE_ID)).toEqual({ ok: false, error: "UNREADABLE" });
  });

  it("maps 403 to FORBIDDEN for every Admin action", async () => {
    backend({
      [`GET ${path}`]: () => errorResponse(403, "FORBIDDEN"),
      [`POST ${path}/review`]: () => errorResponse(403, "FORBIDDEN"),
      [`DELETE ${path}`]: () => errorResponse(403, "FORBIDDEN"),
      [`GET /api/v1/admin/mcp-tool-calls/${MCP_ID}`]: () => errorResponse(403, "FORBIDDEN"),
    });
    expect(await loadRawTrace(TRACE_ID)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await loadRawMcpCall(MCP_ID)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveTraceReview({ traceId: TRACE_ID, verdict: "CORRECT", note: "", nominated: false, expectedVersion: 0 })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await deleteTrace(TRACE_ID)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("saves a review with the expected version and re-renders the page", async () => {
    backend({ [`POST ${path}/review`]: () => jsonResponse(200, { review: review({ version: 2 }) }) });
    const result = await saveTraceReview({ traceId: TRACE_ID, verdict: "PARTIAL", note: "ok", nominated: true, expectedVersion: 1 });
    expect(result).toEqual({ ok: true, review: review({ version: 2 }) });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ verdict: "PARTIAL", note: "ok", nominated: true, expectedVersion: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a stale review returns the review now saved, and saves nothing", async () => {
    backend({
      [`POST ${path}/review`]: () => errorResponse(409, "STALE_VERSION"),
      [`GET ${path}`]: () => jsonResponse(200, traceDetail({ review: review({ verdict: "INCORRECT", version: 3 }) })),
    });
    const result = await saveTraceReview({ traceId: TRACE_ID, verdict: "CORRECT", note: "", nominated: false, expectedVersion: 1 });
    expect(result).toEqual({ ok: false, error: "STALE", current: review({ verdict: "INCORRECT", version: 3 }) });
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports an in-progress trace and a deleted trace distinctly", async () => {
    backend({ [`POST ${path}/review`]: () => errorResponse(409, "ASSISTANT_TURN_IN_PROGRESS") });
    expect(await saveTraceReview({ traceId: TRACE_ID, verdict: "CORRECT", note: "", nominated: false, expectedVersion: 0 })).toEqual({ ok: false, error: "IN_PROGRESS" });
    backend({ [`POST ${path}/review`]: () => errorResponse(404, "NOT_FOUND") });
    expect(await saveTraceReview({ traceId: TRACE_ID, verdict: "CORRECT", note: "", nominated: false, expectedVersion: 0 })).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it.each([
    ["bad id", { traceId: "x" }],
    ["unknown verdict", { verdict: "GREAT" }],
    ["note over 2,000", { note: "x".repeat(2001) }],
    ["string nominated", { nominated: "yes" }],
    ["negative version", { expectedVersion: -1 }],
    ["fractional version", { expectedVersion: 1.5 }],
  ])("rejects an invalid review (%s) without calling the backend", async (_label, overrides) => {
    backend({});
    expect(await saveTraceReview({ traceId: TRACE_ID, verdict: "CORRECT", note: "", nominated: false, expectedVersion: 0, ...overrides })).toEqual({ ok: false, error: "INVALID" });
    expect(requests).toHaveLength(0);
  });

  it("deletes with ?confirm=<the same id> and no body, and trusts only a matching confirmation", async () => {
    backend({ [`DELETE ${path}`]: () => jsonResponse(200, { deleted: { traceId: TRACE_ID, modelCalls: 2, toolCalls: 2, messages: 2, review: false } }) });
    expect(await deleteTrace(TRACE_ID)).toEqual({ ok: true, deleted: { modelCalls: 2, toolCalls: 2, messages: 2, review: false } });
    expect(requests[0].url.searchParams.get("confirm")).toBe(TRACE_ID);
    expect(requests[0].init.body).toBeUndefined();
    backend({ [`DELETE ${path}`]: () => jsonResponse(200, { deleted: { traceId: "00000000-0000-4000-8000-000000000000", modelCalls: 0, toolCalls: 0, messages: 0, review: false } }) });
    expect(await deleteTrace(TRACE_ID)).toEqual({ ok: false, error: "UNREADABLE" });
  });

  it("a repeated delete is NOT_FOUND; a malformed id never reaches the backend", async () => {
    backend({ [`DELETE ${path}`]: () => errorResponse(404, "NOT_FOUND") });
    expect(await deleteTrace(TRACE_ID)).toEqual({ ok: false, error: "NOT_FOUND" });
    requests.length = 0;
    expect(await deleteTrace("../../employees")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(requests).toHaveLength(0);
  });

  it("returns SESSION_EXPIRED without a session cookie", async () => {
    jar.clear();
    backend({});
    expect(await loadRawTrace(TRACE_ID)).toEqual({ ok: false, error: "SESSION_EXPIRED" });
    expect(await deleteTrace(TRACE_ID)).toEqual({ ok: false, error: "SESSION_EXPIRED" });
  });
});
