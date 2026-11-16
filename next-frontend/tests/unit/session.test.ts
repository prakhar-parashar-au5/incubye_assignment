import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";
import { createApiClient } from "@/server/api/client";
import { resolveSession } from "@/server/session";
import { ROLE_LABELS, scopeSummary } from "@/lib/hr-scope";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

import { SAMPLE_TOKEN, errorResponse, fakeFetch, meOk } from "../support/fake-backend";

const env = { API_BASE_URL: "http://backend.test:3000" };
const client = (fetchImpl: typeof fetch) => createApiClient({ fetch: fetchImpl, env, logger: () => {} });

describe("protected-route proxy", () => {
  it("redirects a request without a session cookie to sign-in", () => {
    const response = proxy(new NextRequest("http://localhost:3000/employees?page=2"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it("lets a request with a session cookie through to server verification", () => {
    const request = new NextRequest("http://localhost:3000/employees", { headers: { cookie: `acme_session=${SAMPLE_TOKEN}` } });
    expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("resolveSession", () => {
  it("is signed out without a token and does not call the backend", async () => {
    const backend = fakeFetch();
    expect(await resolveSession(undefined, client(backend.fetch))).toEqual({ kind: "signed-out" });
    expect(backend.requests).toHaveLength(0);
  });

  it("returns only display fields for the signed-in user", async () => {
    const state = await resolveSession(SAMPLE_TOKEN, client(fakeFetch(meOk()).fetch));
    expect(state).toEqual({
      kind: "signed-in",
      user: { displayName: "Rohan Mehta", role: "SCOPED", countries: ["IN"], departments: ["Support", "Tech"] },
    });
    expect(JSON.stringify(state)).not.toContain("@acme.com");
  });

  it("treats UNAUTHENTICATED and an inactive user as an expired session", async () => {
    expect(await resolveSession(SAMPLE_TOKEN, client(fakeFetch(errorResponse(401, "UNAUTHENTICATED")).fetch))).toEqual({
      kind: "expired",
    });
    expect(await resolveSession(SAMPLE_TOKEN, client(fakeFetch(meOk({ status: "INACTIVE" })).fetch))).toEqual({
      kind: "expired",
    });
  });

  it("treats backend failure as unavailable, not as sign-out", async () => {
    for (const response of [new TypeError("fetch failed"), errorResponse(500, "INTERNAL_ERROR"), new Response("x", { status: 503 })]) {
      expect(await resolveSession(SAMPLE_TOKEN, client(fakeFetch(response).fetch))).toEqual({ kind: "unavailable" });
    }
  });
});

describe("role and scope presentation", () => {
  it("shows All employees for Admin HR and the scope for Scoped HR", () => {
    expect(ROLE_LABELS.ADMIN).toBe("Admin HR");
    expect(scopeSummary("ADMIN", [], [])).toBe("All employees");
    expect(scopeSummary("SCOPED", ["IN"], ["Support", "Tech"])).toBe("India, Support and Tech");
    expect(scopeSummary("SCOPED", ["IN"], ["Tech", "Support"])).toBe("India, Support and Tech");
    expect(scopeSummary("SCOPED", ["IN", "GB"], ["Tech"])).toBe("India, United Kingdom and Tech");
    expect(scopeSummary("SCOPED", ["IN"], [])).toBe("No employee access");
  });

  it("describes the two approved demo accounts", () => {
    expect(DEMO_ACCOUNTS.map(({ displayName, email, roleLabel, scope }) => ({ displayName, email, roleLabel, scope }))).toEqual([
      { displayName: "Meera Iyer", email: "meera.iyer@acme.com", roleLabel: "Admin HR", scope: "All employees" },
      { displayName: "Rohan Mehta", email: "rohan.mehta@acme.com", roleLabel: "Scoped HR", scope: "India, Support and Tech" },
    ]);
  });
});
