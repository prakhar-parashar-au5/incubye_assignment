// Test-only stand-in for the two backend endpoints the assistant page uses, so the browser suite
// can render real answers and cards without a language model. Responses come from
// tests/support/assistant-fixtures.ts, which a unit test checks against the generated contract.
// Started by playwright.config.ts on 127.0.0.1:3905; never part of the application.
import { createServer } from "node:http";

import { reply } from "../../support/assistant-fixtures.ts";

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

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

createServer((req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const me = USERS[token];
  if (!me) return send(res, 401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
  if (req.method === "GET" && req.url === "/api/v1/auth/me") return send(res, 200, me);
  if (req.method === "POST" && req.url === "/api/v1/assistant/messages") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const last: string = JSON.parse(raw).messages.at(-1).content;
      if (last.includes("[slow]")) return void setTimeout(() => send(res, 200, reply()), 10_000);
      if (last.includes("[malformed]")) return send(res, 200, '{"answer": 42');
      if (last.includes("[html]")) {
        return send(res, 200, reply({ answer: '<img src=x onerror="document.title=\'pwned\'"><script>document.title="pwned"</script> plain', cards: [] }));
      }
      return send(res, 200, reply());
    });
    return;
  }
  send(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
}).listen(3905, "127.0.0.1");
