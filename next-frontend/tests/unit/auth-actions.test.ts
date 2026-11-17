import { beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_SIGN_IN_STATE } from "@/lib/sign-in-state";

import { SAMPLE_TOKEN, errorResponse, fakeFetch, loginOk } from "../support/fake-backend";

// The real Server Actions run against a fake cookie store (next/headers) and a fake backend
// (global fetch). redirect() throws, as it does in Next.js.

type CookieRecord = { value: string; options?: Record<string, unknown> };
const jar = new Map<string, CookieRecord>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`NEXT_REDIRECT ${location}`);
  }
}
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

const { signIn, signOut } = await import("@/server/actions/auth");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  jar.clear();
  vi.stubEnv("API_BASE_URL", "http://backend.test:3000");
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signIn Server Action", () => {
  it("logs in with the selected account's approved email, sets the session cookie, and redirects", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expiresAt.setMilliseconds(0);
    const backend = fakeFetch(loginOk(expiresAt.toISOString()));
    vi.stubGlobal("fetch", backend.fetch);

    const location = await redirectOf(signIn(INITIAL_SIGN_IN_STATE, form({ account: "rohan", password: "synthetic-pass" })));

    expect(location).toBe("/employees");
    expect(backend.requests[0].body).toEqual({ email: "rohan.mehta@acme.com", password: "synthetic-pass" });
    expect(jar.get("acme_session")).toEqual({
      value: SAMPLE_TOKEN,
      options: { httpOnly: true, sameSite: "lax", secure: false, path: "/", expires: expiresAt },
    });
  });

  it("accepts an HR account email through the same login endpoint without reflecting credentials", async () => {
    const backend = fakeFetch(loginOk());
    vi.stubGlobal("fetch", backend.fetch);
    const location = await redirectOf(signIn(INITIAL_SIGN_IN_STATE, form({ account: "another", email: "new.hr@acme.com", password: "temporary-secret" })));
    expect(location).toBe("/employees");
    expect(backend.requests[0].body).toEqual({ email: "new.hr@acme.com", password: "temporary-secret" });
    expect(jar.get("acme_session")?.options?.httpOnly).toBe(true);
  });

  it("does not send malformed Other HR account credentials to the backend", async () => {
    const backend = fakeFetch();
    vi.stubGlobal("fetch", backend.fetch);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form({ account: "another", email: "not-an-email", password: "temporary-secret" }));
    expect(state).toEqual({ account: "another", error: "INVALID_CREDENTIALS" });
    expect(JSON.stringify(state)).not.toContain("temporary-secret");
    expect(backend.requests).toHaveLength(0);
  });

  it("uses a Secure __Host- cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", fakeFetch(loginOk()).fetch);
    await redirectOf(signIn(INITIAL_SIGN_IN_STATE, form({ account: "meera", password: "synthetic-pass" })));
    expect(jar.has("acme_session")).toBe(false);
    expect(jar.get("__Host-acme_session")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  });

  it("ignores a client-supplied email and accepts only the two demo account keys", async () => {
    const backend = fakeFetch();
    vi.stubGlobal("fetch", backend.fetch);
    const state = await signIn(
      { account: "rohan" },
      form({ account: "attacker", email: "attacker@example.com", password: "synthetic-pass" }),
    );
    expect(state).toEqual({ account: "rohan", error: "ACCOUNT_REQUIRED" });
    expect(backend.requests).toHaveLength(0);
  });

  it("rejects an empty password before calling the backend", async () => {
    const backend = fakeFetch();
    vi.stubGlobal("fetch", backend.fetch);
    expect(await signIn(INITIAL_SIGN_IN_STATE, form({ account: "rohan", password: "" }))).toEqual({
      account: "rohan",
      error: "PASSWORD_REQUIRED",
    });
    expect(backend.requests).toHaveLength(0);
  });

  it("returns a public error for invalid credentials, preserves the account, and sets no cookie", async () => {
    vi.stubGlobal("fetch", fakeFetch(errorResponse(401, "INVALID_CREDENTIALS")).fetch);
    const state = await signIn(INITIAL_SIGN_IN_STATE, form({ account: "rohan", password: "synthetic-wrong" }));
    expect(state).toEqual({ account: "rohan", error: "INVALID_CREDENTIALS" });
    expect(JSON.stringify(state)).not.toContain("synthetic-wrong");
    expect(jar.size).toBe(0);
  });

  it("reports HTTP 429 as RATE_LIMITED and preserves the account", async () => {
    vi.stubGlobal("fetch", fakeFetch(errorResponse(429, "RATE_LIMITED")).fetch);
    expect(await signIn(INITIAL_SIGN_IN_STATE, form({ account: "rohan", password: "synthetic-pass" }))).toEqual({
      account: "rohan",
      error: "RATE_LIMITED",
    });
    expect(jar.size).toBe(0);
  });

  it("reports an unreachable backend as UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", fakeFetch(new TypeError("fetch failed")).fetch);
    expect(await signIn(INITIAL_SIGN_IN_STATE, form({ account: "meera", password: "synthetic-pass" }))).toEqual({
      account: "meera",
      error: "UNAVAILABLE",
    });
  });

  it("refuses an already expired session from the backend", async () => {
    vi.stubGlobal("fetch", fakeFetch(loginOk(new Date(Date.now() - 1000).toISOString())).fetch);
    expect(await signIn(INITIAL_SIGN_IN_STATE, form({ account: "meera", password: "synthetic-pass" }))).toEqual({
      account: "meera",
      error: "SERVICE_ERROR",
    });
    expect(jar.size).toBe(0);
  });
});

describe("signOut Server Action", () => {
  it("revokes the backend session with the cookie token, clears the cookie, and redirects", async () => {
    jar.set("acme_session", { value: SAMPLE_TOKEN });
    const backend = fakeFetch(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", backend.fetch);

    expect(await redirectOf(signOut())).toBe("/sign-in?reason=signed-out");
    expect(backend.requests[0]).toMatchObject({
      url: "http://backend.test:3000/api/v1/auth/logout",
      method: "POST",
      headers: { authorization: `Bearer ${SAMPLE_TOKEN}` },
    });
    expect(jar.get("acme_session")).toMatchObject({ value: "", options: { maxAge: 0, httpOnly: true, path: "/" } });
  });

  it("clears the cookie even when the backend is unavailable", async () => {
    jar.set("acme_session", { value: SAMPLE_TOKEN });
    vi.stubGlobal("fetch", fakeFetch(new TypeError("fetch failed")).fetch);
    expect(await redirectOf(signOut())).toBe("/sign-in?reason=signed-out");
    expect(jar.get("acme_session")?.value).toBe("");
  });

  it("is safe to repeat without a cookie and does not call the backend", async () => {
    const backend = fakeFetch();
    vi.stubGlobal("fetch", backend.fetch);
    expect(await redirectOf(signOut())).toBe("/sign-in?reason=signed-out");
    expect(await redirectOf(signOut())).toBe("/sign-in?reason=signed-out");
    expect(backend.requests).toHaveLength(0);
  });
});
