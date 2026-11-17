// Test-only stand-in for the backend endpoints the assistant pages use, so the browser suite can
// render answers, cards, and failure states without a language model. Answers come from
// tests/support/assistant-fixtures.ts, which a unit test checks against the generated contract.
// Started by playwright.config.ts on 127.0.0.1:3905; never part of the application.
//
// Message markers choose a behaviour: "[slow]" answers after 10 s (the Next.js server times out
// first), "[malformed]" returns a body that breaks the contract, "[html]" returns HTML-looking text,
// "[fail]" records a failed turn (502), "[ratelimit]" returns 429 with Retry-After.
// fake-rohan starts with one saved conversation whose answer is withheld.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { WITHHELD_TEXT, reply } from "../../support/assistant-fixtures.ts";

const USERS: Record<string, unknown> = {
  "fake-meera": {
    user: { id: 1, displayName: "Meera Iyer", email: "meera.iyer@acme.com", role: "ADMIN", status: "ACTIVE" },
    scope: { countries: [], departments: [] },
    session: { expiresAt: "2099-01-01T00:00:00.000Z" },
  },
  "fake-rohan": {
    user: { id: 2, displayName: "Rohan Mehta", email: "rohan.mehta@acme.com", role: "SCOPED", status: "ACTIVE" },
    scope: { countries: ["IN"], departments: ["Support", "Tech"] },
    session: { expiresAt: "2099-01-01T00:00:00.000Z" },
  },
};

type Message = Record<string, unknown> & { sequence: number };
type Turn = Record<string, unknown> & { traceId: string; status: string };
type Conversation = { id: string; owner: string; createdAt: string; messages: Message[]; turns: Turn[] };
type Keyed = { content: string; state: "running" | "done"; status: number; body: unknown };

const conversations = new Map<string, Conversation>();
const keys = new Map<string, Keyed>();
const now = () => new Date().toISOString();

const WITHHELD_ID = "7e7e7e7e-0000-4000-8000-00000000000a";
const seededTrace = "7e7e7e7e-0000-4000-8000-0000000000aa";
conversations.set(WITHHELD_ID, {
  id: WITHHELD_ID,
  owner: "fake-rohan",
  createdAt: "2026-11-17T08:00:00.000Z",
  messages: [
    { sequence: 1, role: "user", traceId: seededTrace, createdAt: "2026-11-17T08:00:00.000Z", text: "Saved question before my access changed", response: null, withheld: false },
    { sequence: 2, role: "assistant", traceId: seededTrace, createdAt: "2026-11-17T08:00:05.000Z", text: WITHHELD_TEXT, response: null, withheld: true },
  ],
  turns: [{ traceId: seededTrace, sequence: 1, previousTraceId: null, retryOfTraceId: null, status: "COMPLETED", userMessageSequence: 1, assistantMessageSequence: 2, error: null }],
});

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function summary(c: Conversation) {
  const firstUser = c.messages.find((m) => m.role === "user");
  return {
    conversationId: c.id,
    createdAt: c.createdAt,
    lastMessageAt: c.messages.at(-1)?.createdAt ?? null,
    messageCount: c.messages.length,
    title: firstUser ? String(firstUser.text).slice(0, 80) : null,
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const notFound = { error: { code: "NOT_FOUND", message: "Not found." } };

function runTurn(c: Conversation, content: string, retryOf: string | null): { status: number; body: unknown; delayMs: number } {
  const traceId = randomUUID();
  const userSequence = (c.messages.at(-1)?.sequence ?? 0) + 1;
  const previous = c.turns.at(-1)?.traceId ?? null;
  c.messages.push({ sequence: userSequence, role: "user", traceId, createdAt: now(), text: content, response: null, withheld: false });
  const turn: Turn = { traceId, sequence: c.turns.length + 1, previousTraceId: previous, retryOfTraceId: retryOf, status: "STARTED", userMessageSequence: userSequence, assistantMessageSequence: null, error: null };
  c.turns.push(turn);
  if (content.includes("[fail]")) {
    const error = { code: "MODEL_PROVIDER_FAILED", message: "The language model did not answer.", reason: "MODEL_ERROR" };
    Object.assign(turn, { status: "FAILED", error });
    return { status: 502, body: { error }, delayMs: 0 };
  }
  const answer = content.includes("[html]")
    ? reply({ answer: '<img src=x onerror="document.title=\'pwned\'"><script>document.title="pwned"</script> plain', cards: [] })
    : reply();
  const complete = () => {
    const assistantSequence = userSequence + 1;
    c.messages.push({
      sequence: assistantSequence,
      role: "assistant",
      traceId,
      createdAt: now(),
      text: answer.answer,
      response: { toolCalls: answer.toolCalls, cards: answer.cards, limitations: answer.limitations, generatedAt: answer.generatedAt },
      withheld: false,
    });
    Object.assign(turn, { status: "COMPLETED", assistantMessageSequence: assistantSequence });
  };
  const body = { ...answer, conversationId: c.id, traceId, previousTraceId: previous, userMessageSequence: userSequence, assistantMessageSequence: userSequence + 1, withheld: false };
  if (content.includes("[malformed]")) {
    complete();
    return { status: 200, body: '{"answer": 42', delayMs: 0 };
  }
  if (content.includes("[slow]")) {
    setTimeout(complete, 10_000);
    return { status: 200, body, delayMs: 10_000 };
  }
  complete();
  return { status: 200, body, delayMs: 0 };
}

createServer(async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const me = USERS[token];
  if (!me) return send(res, 401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
  const url = new URL(req.url ?? "/", "http://fake");
  if (req.method === "GET" && url.pathname === "/api/v1/auth/me") return send(res, 200, me);

  if (url.pathname === "/api/v1/assistant/conversations") {
    if (req.method === "POST") {
      await readBody(req);
      const c: Conversation = { id: randomUUID(), owner: token, createdAt: now(), messages: [], turns: [] };
      conversations.set(c.id, c);
      return send(res, 201, { conversation: summary(c) });
    }
    const own = [...conversations.values()].filter((c) => c.owner === token).reverse();
    return send(res, 200, { conversations: own.map(summary), page: { number: 1, size: 25, totalRows: own.length, totalPages: own.length ? 1 : 0 } });
  }

  const match = /^\/api\/v1\/assistant\/conversations\/([0-9a-f-]{36})(\/messages)?$/.exec(url.pathname);
  const c = match ? conversations.get(match[1]) : undefined;
  if (match && (!c || c.owner !== token)) return send(res, 404, notFound);
  if (c && req.method === "GET" && !match![2]) return send(res, 200, { conversation: summary(c), messages: c.messages, turns: c.turns });
  if (c && req.method === "POST" && match![2]) {
    const body = await readBody(req);
    const content = String(body.content ?? "");
    const key = String(req.headers["idempotency-key"] ?? "");
    const known = keys.get(key);
    if (known) {
      if (known.content !== content) return send(res, 409, { error: { code: "DUPLICATE_OPERATION", message: "Key reused." } });
      if (known.state === "running") return send(res, 409, { error: { code: "ASSISTANT_TURN_IN_PROGRESS", message: "Still running." } });
      return send(res, known.status, known.body, { "Idempotency-Replayed": "true" });
    }
    if (content.includes("[ratelimit]")) {
      return send(res, 429, { error: { code: "RATE_LIMITED", message: "Too many requests." } }, { "Retry-After": "540" });
    }
    const entry: Keyed = { content, state: "running", status: 0, body: null };
    keys.set(key, entry);
    const outcome = runTurn(c, content, typeof body.retryOfTraceId === "string" ? body.retryOfTraceId : null);
    const finish = () => {
      Object.assign(entry, { state: "done", status: outcome.status, body: outcome.body });
      if (!res.writableEnded && !res.destroyed) send(res, outcome.status, outcome.body);
    };
    if (outcome.delayMs) setTimeout(finish, outcome.delayMs);
    else finish();
    return;
  }
  send(res, 404, notFound);
}).listen(3905, "127.0.0.1");
