import { vi } from "vitest";

// A fetch stand-in that records requests and answers from a queue. Used at the HTTP boundary
// only; the real API client, contract validators, and Server Actions run unchanged.

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorResponse(status: number, code: string, message = "Public message.") {
  return jsonResponse(status, { error: { code, message } });
}

export const SAMPLE_TOKEN = "eyJhbGciOiJIUzI1NiJ9.synthetic-test-token.signature";

export function loginOk(expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()) {
  return jsonResponse(200, {
    token: SAMPLE_TOKEN,
    expiresAt,
    user: { id: 2, displayName: "Rohan Mehta", email: "rohan.mehta@acme.com", role: "SCOPED" },
  });
}

export function meOk(overrides: { role?: "ADMIN" | "SCOPED"; status?: "ACTIVE" | "INACTIVE" } = {}) {
  const role = overrides.role ?? "SCOPED";
  return jsonResponse(200, {
    user: {
      id: role === "ADMIN" ? 1 : 2,
      displayName: role === "ADMIN" ? "Meera Iyer" : "Rohan Mehta",
      email: role === "ADMIN" ? "meera.iyer@acme.com" : "rohan.mehta@acme.com",
      role,
      status: overrides.status ?? "ACTIVE",
    },
    scope: role === "ADMIN" ? { countries: [], departments: [] } : { countries: ["IN"], departments: ["Support", "Tech"] },
    session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  });
}

export function fakeFetch(...responses: Array<Response | Error | (() => Promise<Response>)>) {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error("fake backend: no response queued");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  return { fetch: fn as unknown as typeof fetch, requests };
}
