import { describe, expect, it } from "vitest";

import { createApiClient } from "@/server/api/client";

import { SAMPLE_TOKEN, errorResponse, fakeFetch, jsonResponse, loginOk, meOk } from "../support/fake-backend";

const env = { API_BASE_URL: "http://backend.test:3000", API_TIMEOUT_MS: "200" };

function client(fetchImpl: typeof fetch, logs: unknown[] = []) {
  return createApiClient({ fetch: fetchImpl, env, logger: (entry) => logs.push(entry) });
}

describe("server-only API client", () => {
  it("posts login JSON to the versioned path without an Authorization header", async () => {
    const backend = fakeFetch(loginOk());
    const result = await client(backend.fetch).login({ email: "rohan.mehta@acme.com", password: "synthetic-pass" });
    expect(result.ok).toBe(true);
    expect(backend.requests[0]).toMatchObject({
      url: "http://backend.test:3000/api/v1/auth/login",
      method: "POST",
      body: { email: "rohan.mehta@acme.com", password: "synthetic-pass" },
    });
    expect(backend.requests[0].headers.authorization).toBeUndefined();
  });

  it("adds the Bearer token on protected calls", async () => {
    const backend = fakeFetch(meOk(), new Response(null, { status: 204 }));
    const api = client(backend.fetch);
    expect((await api.getCurrentUser(SAMPLE_TOKEN)).ok).toBe(true);
    expect(await api.logout(SAMPLE_TOKEN)).toEqual({ ok: true, data: undefined });
    expect(backend.requests.map((r) => r.headers.authorization)).toEqual([`Bearer ${SAMPLE_TOKEN}`, `Bearer ${SAMPLE_TOKEN}`]);
    expect(backend.requests[1]).toMatchObject({ url: "http://backend.test:3000/api/v1/auth/logout", method: "POST" });
  });

  it("uses the OpenAPI HR-access paths, validates list responses, and keeps idempotency keys in headers", async () => {
    const backend = fakeFetch(
      jsonResponse(200, { users: [], page: { number: 1, size: 25, totalRows: 0, totalPages: 0 }, emptyMessage: "No HR users match these filters." }),
      jsonResponse(201, {}),
    );
    const api = client(backend.fetch);
    expect((await api.listHrUsers(SAMPLE_TOKEN, { status: "ALL", page: 1, pageSize: 25 })).ok).toBe(true);
    expect(await api.createHrUser(SAMPLE_TOKEN, {
      email: "qa.hr@example.com", displayName: "QA HR", role: "SCOPED", countries: ["IN"], departments: ["Tech"], previewToken: "opaque-preview",
    }, "idempotency-key-123456")).toMatchObject({ ok: false, kind: "INVALID_RESPONSE" });
    expect(backend.requests[0].url).toBe("http://backend.test:3000/api/v1/hr-users?status=ALL&page=1&pageSize=25");
    expect(backend.requests[1]).toMatchObject({
      url: "http://backend.test:3000/api/v1/hr-users", method: "POST",
      headers: { authorization: `Bearer ${SAMPLE_TOKEN}`, "idempotency-key": "idempotency-key-123456" },
      body: { email: "qa.hr@example.com", displayName: "QA HR", role: "SCOPED", countries: ["IN"], departments: ["Tech"], previewToken: "opaque-preview" },
    });
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "INVALID_CREDENTIALS"],
    [401, "UNAUTHENTICATED"],
    [429, "RATE_LIMITED"],
    [404, "NOT_FOUND"],
    [500, "INTERNAL_ERROR"],
  ])("maps HTTP %i %s to the public error code", async (status, code) => {
    const result = await client(fakeFetch(errorResponse(status, code)).fetch).getCurrentUser(SAMPLE_TOKEN);
    expect(result).toEqual({ ok: false, kind: code, status });
  });

  it("treats refused connections as UNAVAILABLE and its own timeout as TIMEOUT", async () => {
    const refused = await client(fakeFetch(new TypeError("fetch failed")).fetch).getCurrentUser(SAMPLE_TOKEN);
    expect(refused).toEqual({ ok: false, kind: "UNAVAILABLE" });

    // A backend that never answers: the client's own 200 ms timeout must abort it.
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const started = Date.now();
    const timedOut = await client(hanging).getCurrentUser(SAMPLE_TOKEN);
    expect(timedOut).toEqual({ ok: false, kind: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("maps invalid JSON and contract mismatches without throwing", async () => {
    const html502 = new Response("<html>Bad gateway</html>", { status: 502 });
    expect(await client(fakeFetch(html502).fetch).getCurrentUser(SAMPLE_TOKEN)).toEqual({
      ok: false,
      kind: "UNAVAILABLE",
      status: 502,
    });
    const garbage200 = new Response("{not json", { status: 200 });
    expect(await client(fakeFetch(garbage200).fetch).getCurrentUser(SAMPLE_TOKEN)).toEqual({
      ok: false,
      kind: "INVALID_RESPONSE",
      status: 200,
    });
    const wrongShape = jsonResponse(200, { user: { id: 1 } });
    expect(await client(fakeFetch(wrongShape).fetch).getCurrentUser(SAMPLE_TOKEN)).toEqual({
      ok: false,
      kind: "INVALID_RESPONSE",
      status: 200,
    });
    const unknownError = jsonResponse(418, { error: { code: "TEAPOT", message: "x" } });
    expect(await client(fakeFetch(unknownError).fetch).getCurrentUser(SAMPLE_TOKEN)).toEqual({
      ok: false,
      kind: "INVALID_RESPONSE",
      status: 418,
    });
  });

  it("reports missing configuration as CONFIGURATION without calling the backend", async () => {
    const backend = fakeFetch();
    const logs: unknown[] = [];
    const api = createApiClient({ fetch: backend.fetch, env: {}, logger: (entry) => logs.push(entry) });
    expect(await api.login({ email: "meera.iyer@acme.com", password: "x" })).toEqual({ ok: false, kind: "CONFIGURATION" });
    expect(backend.requests).toHaveLength(0);
    expect(logs).toEqual([{ event: "api_configuration_error", operation: "login", variables: ["API_BASE_URL"] }]);
  });

  it("never logs tokens, passwords, or bodies", async () => {
    const logs: unknown[] = [];
    const backend = fakeFetch(
      errorResponse(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
      new TypeError("connect ECONNREFUSED 10.0.0.5:3000"),
      new Response("<html>secret stack</html>", { status: 500 }),
    );
    const api = client(backend.fetch, logs);
    await api.login({ email: "rohan.mehta@acme.com", password: "synthetic-wrong-password" });
    await api.getCurrentUser(SAMPLE_TOKEN);
    await api.logout(SAMPLE_TOKEN);
    const text = JSON.stringify(logs);
    for (const forbidden of ["synthetic-wrong-password", SAMPLE_TOKEN, "Bearer", "rohan.mehta", "incorrect", "10.0.0.5", "secret stack"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(logs).toEqual([
      { event: "api_request_failed", operation: "login", kind: "INVALID_CREDENTIALS", status: 401 },
      { event: "api_request_failed", operation: "getCurrentUser", kind: "UNAVAILABLE" },
      { event: "api_request_failed", operation: "logout", kind: "UNAVAILABLE", status: 500 },
    ]);
  });
});
