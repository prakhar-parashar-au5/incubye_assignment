import { describe, expect, it } from "vitest";

import { ConfigurationError, DEFAULT_API_TIMEOUT_MS, readDemoPassword, readServerConfig } from "@/server/config";

describe("server configuration", () => {
  it("accepts an http(s) base URL and applies the default timeout", () => {
    const config = readServerConfig({ API_BASE_URL: "http://backend.railway.internal:3000" });
    expect(config.apiBaseUrl.href).toBe("http://backend.railway.internal:3000/");
    expect(config.apiTimeoutMs).toBe(DEFAULT_API_TIMEOUT_MS);
    expect(readServerConfig({ API_BASE_URL: "https://api.example.com/base", API_TIMEOUT_MS: "2500" }).apiTimeoutMs).toBe(2500);
  });

  it.each([
    ["missing", {}],
    ["empty", { API_BASE_URL: "" }],
    ["not a URL", { API_BASE_URL: "backend:3000" }],
    ["wrong scheme", { API_BASE_URL: "ftp://backend" }],
    ["embedded credentials", { API_BASE_URL: "https://user:synthetic-secret-value@backend" }],
    ["query string", { API_BASE_URL: "https://backend/?token=synthetic-secret-value" }],
  ])("rejects API_BASE_URL that is %s without printing the value", (_label, env) => {
    let thrown: unknown;
    try {
      readServerConfig(env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).variables).toEqual(["API_BASE_URL"]);
    expect(String((thrown as Error).message)).not.toContain("synthetic-secret-value");
    expect(String((thrown as Error).message)).not.toContain("backend");
  });

  it.each(["abc", "-1", "50", "60000", "1.5"])("rejects API_TIMEOUT_MS=%s", (value) => {
    expect(() => readServerConfig({ API_BASE_URL: "http://localhost:3000", API_TIMEOUT_MS: value })).toThrow(
      /API_TIMEOUT_MS/,
    );
  });

  it("reads the public demo password from the server environment only", () => {
    expect(readDemoPassword({ DEMO_SHARED_PASSWORD: "synthetic-demo" })).toBe("synthetic-demo");
    expect(readDemoPassword({})).toBeUndefined();
    expect(readDemoPassword({ NEXT_PUBLIC_DEMO_SHARED_PASSWORD: "synthetic-demo" })).toBeUndefined();
  });
});
