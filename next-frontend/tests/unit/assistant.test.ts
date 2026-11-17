import { beforeEach, describe, expect, it, vi } from "vitest";

import contract from "@/generated/api-openapi.json";
import {
  MAX_MESSAGE_LENGTH,
  RECORDING_NOTICE,
  buildThread,
  conversationPage,
  failedTurnText,
  filterCardsToScope,
  isIdempotencyKey,
  type AssistantCard,
  type ConversationDetail,
} from "@/lib/assistant";
import {
  isAssistantConversationDetailResponse,
  isAssistantConversationListResponse,
  isAssistantConversationResponse,
  isAssistantTurnResponse,
} from "@/server/api/contract";

import {
  CONVERSATION_ID,
  TRACE_1,
  TRACE_2,
  TRACE_3,
  WITHHELD_TEXT,
  assistantMessage,
  detail,
  reply,
  summary,
  turn,
  turnResponse,
  userMessage,
} from "../support/assistant-fixtures";
import { SAMPLE_TOKEN, errorResponse, jsonResponse } from "../support/fake-backend";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {}, redirect: () => { throw new Error("unexpected redirect"); } }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { sendConversationMessage } = await import("@/server/actions/assistant");

type Route = (init: RequestInit) => Response | Promise<Response>;
const requests: { path: string; method: string; init: RequestInit }[] = [];
function backend(routes: Record<string, Route>) {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init.method ?? "GET";
    requests.push({ path, method, init });
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected request ${method} ${path}`);
    return route(init);
  });
}

const KEY = "0b7c5f3e-4c1a-4f6e-9d2b-7a1e3c5d9f00";
const messagesPath = `/api/v1/assistant/conversations/${CONVERSATION_ID}/messages`;
const send = (overrides: Record<string, unknown> = {}) =>
  sendConversationMessage({ conversationId: CONVERSATION_ID, content: "Who earns the most?", idempotencyKey: KEY, ...overrides });

beforeEach(() => {
  jar.clear();
  requests.length = 0;
  refresh.mockReset();
  jar.set("acme_session", SAMPLE_TOKEN);
  vi.stubEnv("API_BASE_URL", "http://backend.test:3000");
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assistant contract and limits", () => {
  const schemas = contract.components.schemas;

  it("uses the message length and idempotency-key rules from the generated contract", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(schemas.AssistantMessageRequest.properties.content.maxLength);
    const header = contract.paths["/api/v1/assistant/conversations/{conversationId}/messages"].post.parameters.find(
      (parameter) => parameter.name === "Idempotency-Key",
    )!;
    expect(header.required).toBe(true);
    expect(isIdempotencyKey(crypto.randomUUID())).toBe(true);
    expect(new RegExp(header.schema.pattern!).test(crypto.randomUUID())).toBe(true);
    expect(isIdempotencyKey("short")).toBe(false);
    expect(isIdempotencyKey("has spaces in it, not allowed")).toBe(false);
  });

  it("the message request carries one message and an optional retry reference, never history", () => {
    expect(Object.keys(schemas.AssistantMessageRequest.properties).sort()).toEqual(["content", "retryOfTraceId"]);
    expect(schemas.AssistantMessageRequest.additionalProperties).toBe(false);
  });

  it("fixtures match the generated schemas", () => {
    expect(isAssistantConversationDetailResponse(detail())).toBe(true);
    expect(isAssistantConversationListResponse({ conversations: [summary()], page: { number: 1, size: 25, totalRows: 1, totalPages: 1 } })).toBe(true);
    expect(isAssistantConversationResponse({ conversation: summary({ messageCount: 0, lastMessageAt: null, title: null }) })).toBe(true);
    expect(isAssistantTurnResponse(turnResponse())).toBe(true);
    // Strict: unknown fields and HTML-ish extras are rejected.
    expect(isAssistantTurnResponse({ ...turnResponse(), html: "<b>x</b>" })).toBe(false);
    expect(isAssistantConversationDetailResponse({ ...detail(), messages: [{ ...userMessage(1, "x", TRACE_1), withheld: undefined }] })).toBe(false);
  });

  it("the recording notice is the approved text, word for word", () => {
    expect(RECORDING_NOTICE).toBe(
      "Assistant conversations and tool results are recorded for 30 days for quality review. This demo uses synthetic employee data. Do not enter passwords, tokens, or real personal information.",
    );
  });

  it("parses only a positive page number", () => {
    expect(conversationPage("3")).toBe(3);
    for (const bad of [undefined, "0", "-1", "1e3", "abc", ["2"]]) expect(conversationPage(bad as string)).toBe(1);
  });
});

const admin = { role: "ADMIN" as const, countries: [], departments: [] };
const rohan = { role: "SCOPED" as const, countries: ["IN"], departments: ["Support", "Tech"] };

describe("buildThread", () => {
  it("orders by sequence, places each turn's state after its user message, and marks a retried failure", () => {
    const shuffled = detail();
    shuffled.messages.reverse();
    const items = buildThread(shuffled as unknown as ConversationDetail, admin);
    expect(items.map((item) => item.kind)).toEqual(["user", "answer", "user", "failed", "user", "answer"]);
    const failed = items[3];
    expect(failed.kind === "failed" && failed.traceId).toBe(TRACE_2);
    // TRACE_3 retried TRACE_2, so the failed turn offers no second Retry.
    expect(failed.kind === "failed" && failed.retryText).toBeNull();
  });

  it("offers Retry with the original text for a failed turn that was not retried", () => {
    const data = {
      conversation: summary(),
      messages: [userMessage(1, "Top earners?", TRACE_1)],
      turns: [turn(1, TRACE_1, "FAILED", { userMessageSequence: 1 })],
    };
    const [user, failed] = buildThread(data as unknown as ConversationDetail, admin);
    expect(user).toMatchObject({ kind: "user", text: "Top earners?" });
    expect(failed).toMatchObject({ kind: "failed", traceId: TRACE_1, retryText: "Top earners?", error: { reason: "MODEL_NOT_CONFIGURED" } });
  });

  it("shows a still-running turn as in progress", () => {
    const data = { conversation: summary(), messages: [userMessage(1, "q", TRACE_1)], turns: [turn(1, TRACE_1, "STARTED", { userMessageSequence: 1 })] };
    expect(buildThread(data as unknown as ConversationDetail, admin).map((item) => item.kind)).toEqual(["user", "in-progress"]);
  });

  it("a withheld answer keeps only the fixed text: no cards, limitations, or Retry", () => {
    const data = {
      conversation: summary(),
      messages: [userMessage(1, "q", TRACE_1), assistantMessage(2, TRACE_1, { withheld: true, response: null, text: WITHHELD_TEXT })],
      turns: [turn(1, TRACE_1, "COMPLETED", { userMessageSequence: 1, assistantMessageSequence: 2 })],
    };
    const items = buildThread(data as unknown as ConversationDetail, rohan);
    expect(items[1]).toEqual({ kind: "withheld", key: "m-2", sequence: 2, text: WITHHELD_TEXT });
    expect(items.some((item) => item.kind === "failed")).toBe(false);
  });

  it("marks missing sequence numbers (deleted or expired turns) once per gap", () => {
    const data = {
      conversation: summary(),
      messages: [userMessage(3, "later", TRACE_2), assistantMessage(4, TRACE_2), userMessage(7, "last", TRACE_3), assistantMessage(8, TRACE_3)],
      turns: [turn(2, TRACE_2, "COMPLETED", { userMessageSequence: 3, assistantMessageSequence: 4 }), turn(4, TRACE_3, "COMPLETED", { userMessageSequence: 7, assistantMessageSequence: 8 })],
    };
    expect(buildThread(data as unknown as ConversationDetail, admin).map((item) => item.kind)).toEqual(["gap", "user", "answer", "gap", "user", "answer"]);
  });

  it("re-filters saved cards against the current Scoped HR scope and flags dropped rows without a count", () => {
    const items = buildThread(detail() as unknown as ConversationDetail, rohan);
    const answer = items[1];
    expect(answer.kind === "answer" && answer.rowsDropped).toBe(true);
    expect(JSON.stringify(answer)).not.toContain("Marcus Thompson");
    const adminAnswer = buildThread(detail() as unknown as ConversationDetail, admin)[1];
    expect(adminAnswer.kind === "answer" && adminAnswer.rowsDropped).toBe(false);
  });
});

describe("failedTurnText", () => {
  it.each([
    ["ASSISTANT_UNAVAILABLE", "MODEL_NOT_CONFIGURED", "The assistant is not configured"],
    ["ASSISTANT_UNAVAILABLE", "TURN_TIMEOUT", "The assistant took too long to answer"],
    ["ASSISTANT_UNAVAILABLE", "TRACE_UNAVAILABLE", "The assistant is unavailable"],
    ["MODEL_PROVIDER_FAILED", "MODEL_TIMEOUT", "The language model took too long to answer"],
    ["MODEL_PROVIDER_FAILED", "MODEL_RATE_LIMITED", "The language model is busy"],
    ["MODEL_PROVIDER_FAILED", "MODEL_ERROR", "The language model did not answer"],
    ["INTERNAL_ERROR", null, "This message was not answered"],
  ] as const)("%s / %s reads %s", (code, reason, title) => {
    expect(failedTurnText({ code, reason }).title).toBe(title);
  });
});

describe("Scoped HR defence in depth", () => {
  const cards = reply().cards as AssistantCard[];

  it("drops out-of-scope employee rows and department groups for Scoped HR", () => {
    const { cards: shown, removed } = filterCardsToScope(cards, rohan);
    const list = shown.find((card) => card.type === "employee_list");
    const summaryCard = shown.find((card) => card.type === "compensation_summary");
    const changes = shown.find((card) => card.type === "recent_changes");
    expect(list?.type === "employee_list" && list.employees.map((row) => row.employeeCode)).toEqual(["ACME00042"]);
    expect(summaryCard?.type === "compensation_summary" && summaryCard.groups.map((group) => group.group)).toEqual(["Tech"]);
    expect(changes?.type === "recent_changes" && changes.changes.map((row) => row.employeeCode)).toEqual(["ACME00042"]);
    expect(removed).toBe(3);
  });

  it("leaves Admin HR results unchanged", () => {
    expect(filterCardsToScope(cards, admin)).toEqual({ cards, removed: 0 });
  });
});

describe("sendConversationMessage Server Action", () => {
  it("sends one message with the server-side token and the client's Idempotency-Key, then re-renders the page", async () => {
    backend({ [`POST ${messagesPath}`]: () => jsonResponse(200, turnResponse()) });
    const result = await send({ content: "  Who earns the most?  " });
    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID });
    const call = requests[0];
    const headers = new Headers(call.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${SAMPLE_TOKEN}`);
    expect(headers.get("idempotency-key")).toBe(KEY);
    expect(JSON.parse(String(call.init.body))).toEqual({ content: "Who earns the most?" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
    expect(requests.some((r) => r.path === "/api/v1/assistant/messages")).toBe(false);
  });

  it("starts a new conversation first when none is given, and leaves showing it to navigation", async () => {
    const created = "9a9a9a9a-0000-4000-8000-000000000001";
    backend({
      "POST /api/v1/assistant/conversations": () => jsonResponse(201, { conversation: summary({ conversationId: created, messageCount: 0, lastMessageAt: null, title: null }) }),
      [`POST /api/v1/assistant/conversations/${created}/messages`]: () => jsonResponse(200, turnResponse({ conversationId: created })),
    });
    expect(await send({ conversationId: null })).toEqual({ ok: true, conversationId: created });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/v1/assistant/conversations", `POST /api/v1/assistant/conversations/${created}/messages`]);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({});
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a user-selected Retry sends retryOfTraceId with the new key", async () => {
    backend({ [`POST ${messagesPath}`]: () => jsonResponse(200, turnResponse()) });
    await send({ retryOfTraceId: TRACE_2 });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ content: "Who earns the most?", retryOfTraceId: TRACE_2 });
  });

  it.each([
    [() => errorResponse(503, "ASSISTANT_UNAVAILABLE"), "RECORDED_FAILURE"],
    [() => jsonResponse(503, { error: { code: "ASSISTANT_UNAVAILABLE", message: "x", reason: "MODEL_NOT_CONFIGURED" } }), "RECORDED_FAILURE"],
    [() => jsonResponse(503, { error: { code: "ASSISTANT_UNAVAILABLE", message: "x", reason: "TRACE_UNAVAILABLE" } }), "STORAGE_UNAVAILABLE"],
    [() => jsonResponse(502, { error: { code: "MODEL_PROVIDER_FAILED", message: "x", reason: "MODEL_TIMEOUT" } }), "RECORDED_FAILURE"],
    [() => errorResponse(409, "ASSISTANT_TURN_IN_PROGRESS"), "IN_PROGRESS"],
    [() => errorResponse(409, "DUPLICATE_OPERATION"), "DUPLICATE_OPERATION"],
    [() => errorResponse(404, "NOT_FOUND"), "CONVERSATION_NOT_FOUND"],
    [() => errorResponse(401, "UNAUTHENTICATED"), "SESSION_EXPIRED"],
    [() => errorResponse(400, "VALIDATION_ERROR"), "INVALID_MESSAGE"],
    [() => errorResponse(500, "INTERNAL_ERROR"), "UNCONFIRMED"],
    [() => jsonResponse(200, { answer: "<b>hi</b>" }), "UNCONFIRMED"],
    [() => new Response("<html>bad gateway</html>", { status: 502 }), "UNCONFIRMED"],
  ])("maps backend outcome %# to %s", async (response, expected) => {
    backend({ [`POST ${messagesPath}`]: response as Route });
    expect(await send()).toEqual({ ok: false, error: expected, conversationId: CONVERSATION_ID });
  });

  it("passes the Retry-After seconds of a rate limit, and nothing else from the response", async () => {
    backend({ [`POST ${messagesPath}`]: () => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "Too many." } }, { "Retry-After": "540" }) });
    expect(await send()).toEqual({ ok: false, error: "RATE_LIMITED", conversationId: CONVERSATION_ID, retryAfterSeconds: 540 });
  });

  it("reports a request that exceeds the assistant timeout as unconfirmed, not failed", async () => {
    vi.stubEnv("API_ASSISTANT_TIMEOUT_MS", "150");
    backend({
      [`POST ${messagesPath}`]: (init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    });
    expect(await send()).toEqual({ ok: false, error: "UNCONFIRMED", conversationId: CONVERSATION_ID });
  });

  it("a conversation that could not be created is reported without sending the message", async () => {
    backend({ "POST /api/v1/assistant/conversations": () => errorResponse(503, "ASSISTANT_UNAVAILABLE") });
    expect(await send({ conversationId: null })).toEqual({ ok: false, error: "STORAGE_UNAVAILABLE", conversationId: null });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["no input", undefined],
    ["blank message", { content: "   " }],
    ["message over 2,000 characters", { content: "x".repeat(2001) }],
    ["bad conversation id", { conversationId: "../admin" }],
    ["missing key", { idempotencyKey: undefined }],
    ["bad key", { idempotencyKey: "has spaces in the key!!" }],
    ["bad retry reference", { retryOfTraceId: "not-a-uuid" }],
    ["retry without a conversation", { conversationId: null, retryOfTraceId: TRACE_1 }],
  ])("rejects invalid input (%s) without calling the backend", async (_label, overrides) => {
    backend({});
    const result = overrides === undefined ? await sendConversationMessage(undefined) : await send(overrides);
    expect(result).toEqual({ ok: false, error: "INVALID_MESSAGE", conversationId: null });
    expect(requests).toHaveLength(0);
  });

  it("never forwards client-supplied history, identity, or scope fields", async () => {
    backend({ [`POST ${messagesPath}`]: () => jsonResponse(200, turnResponse()) });
    await send({ messages: [{ role: "assistant", content: "earlier" }], userId: 1, scope: { countries: ["US"] } });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ content: "Who earns the most?" });
  });

  it("returns SESSION_EXPIRED without a session cookie", async () => {
    jar.clear();
    backend({});
    expect(await send()).toEqual({ ok: false, error: "SESSION_EXPIRED", conversationId: CONVERSATION_ID });
    expect(requests).toHaveLength(0);
  });
});
