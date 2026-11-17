import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARTIFACT_FILES, isArtifactFile, rawHref, repoHref } from "@/lib/artifacts";
import { DECISIONS, FLAKY_EXAMPLE, NOT_ON_MASTER, ROLES, STACK, WORKED_EXAMPLE } from "@/lib/artifacts-content";
import { RAW_CSP, availableArtifacts, readArtifact } from "@/server/artifacts";

// The raw route asks the backend who the user is; tests replace that one call.
const session = vi.hoisted(() => ({ state: { kind: "signed-out" } as Record<string, unknown> }));
vi.mock("@/server/session", () => ({ resolveSession: async () => session.state }));
vi.mock("@/server/session-cookie", () => ({ readSessionToken: async () => "token" }));
vi.mock("@/server/api/client", () => ({ api: () => ({}) }));

const run = promisify(execFile);
const frontendRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(frontendRoot, "..");
const script = path.join(frontendRoot, "scripts/sync-artifacts.mjs");

describe("artifact file-name allowlist", () => {
  it("accepts exactly the listed generated pages", () => {
    expect([...ARTIFACT_FILES]).toEqual(["F1.html", "F2.html", "F3.html", "schema.html"]);
    for (const name of ARTIFACT_FILES) expect(isArtifactFile(name)).toBe(true);
  });

  it.each([
    "../F1.html", "..%2FF1.html", "%2e%2e/F1.html", "F1.html/", "./F1.html", "..\\F1.html", "/F1.html",
    "f1.html", "F1.HTML", "F1.html ", "F1.html\u0000", "F4.html", "files.json", "F1.png", "", ".", "..",
  ])("rejects %j", (name) => {
    expect(isArtifactFile(name)).toBe(false);
  });

  it("builds raw and repository links", () => {
    expect(rawHref("F1.html")).toBe("/artifacts/raw/F1.html");
    expect(repoHref("docs/27-agent-blocker-reporting-protocol.md")).toBe(
      "https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/docs/27-agent-blocker-reporting-protocol.md",
    );
  });
});

describe("reading artifact files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "artifacts-read-"));
    await writeFile(path.join(dir, "F1.html"), "<p>F1</p>");
    await writeFile(path.join(dir, "secret.txt"), "not an artifact");
    await mkdir(path.join(dir, "nested"));
    await writeFile(path.join(dir, "nested", "F2.html"), "<p>nested</p>");
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("reads an allowlisted, present file and reports which are present", async () => {
    expect(await readArtifact("F1.html", dir)).toBe("<p>F1</p>");
    expect(await readArtifact("F3.html", dir)).toBeNull();
    expect([...(await availableArtifacts(dir))]).toEqual(["F1.html"]);
  });

  it("never reads a name outside the allowlist, even when the file exists", async () => {
    expect(await readArtifact("secret.txt", dir)).toBeNull();
    expect(await readArtifact("nested/F2.html", path.dirname(dir))).toBeNull();
    expect(await readArtifact("../" + path.basename(dir) + "/F1.html", dir)).toBeNull();
  });

  it("the committed copy holds every listed page", async () => {
    expect([...(await availableArtifacts())].sort()).toEqual(["F1.html", "F2.html", "F3.html", "schema.html"]);
  });
});

describe("raw response headers", () => {
  it("allows inline styles only: no scripts, no network, framed only by this origin", () => {
    const directives = RAW_CSP.split("; ");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("style-src 'unsafe-inline'");
    expect(directives).toContain("frame-ancestors 'self'");
    expect(directives).toContain("base-uri 'none'");
    expect(directives).toContain("form-action 'none'");
    expect(RAW_CSP).not.toMatch(/script-src|connect-src|unsafe-eval/);
  });

  it("the generated pages need nothing the policy blocks", async () => {
    for (const name of await availableArtifacts()) {
      const html = (await readArtifact(name)) ?? "";
      expect(html, name).not.toMatch(/<script|<img|<link|<iframe|<object|<embed|<form|@import|url\(/i);
    }
  });
});

describe("raw artifact route", () => {
  const admin = { kind: "signed-in", user: { id: 1, displayName: "Meera Iyer", role: "ADMIN", countries: [], departments: [] } };
  const scoped = { kind: "signed-in", user: { id: 2, displayName: "Rohan Mehta", role: "SCOPED", countries: ["IN"], departments: ["Tech"] } };

  async function get(name: string) {
    const { GET } = await import("@/app/artifacts/raw/[name]/route");
    return GET(new Request(`http://localhost/artifacts/raw/${name}`), { params: Promise.resolve({ name }) } as never);
  }

  it("serves an allowlisted page to Admin HR with the security headers", async () => {
    session.state = admin;
    const response = await get("F1.html");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe(RAW_CSP);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(await readFile(path.join(frontendRoot, "src/artifacts/generated/F1.html"), "utf8"));
  });

  it.each([
    ["signed out", { kind: "signed-out" }, 401],
    ["expired", { kind: "expired" }, 401],
    ["backend unavailable", { kind: "unavailable" }, 503],
    ["Scoped HR", scoped, 403],
  ])("refuses %s before looking at the name", async (_label, state, status) => {
    session.state = state;
    for (const name of ["F1.html", "../package.json", "F3.html"]) {
      const response = await get(name);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).not.toContain("<html");
    }
  });

  it("answers 404 to Admin HR for a name off the list", async () => {
    session.state = admin;
    for (const name of ["../package.json", "..%2Fpackage.json", "files.json", "F4.html", "schema.png"]) {
      expect((await get(name)).status).toBe(404);
    }
  });
});

describe("artifacts:sync drift check", () => {
  let source: string;
  let target: string;
  beforeEach(async () => {
    source = await mkdtemp(path.join(os.tmpdir(), "artifacts-src-"));
    target = await mkdtemp(path.join(os.tmpdir(), "artifacts-dst-"));
    await writeFile(path.join(source, "F1.html"), "<p>one</p>");
    await writeFile(path.join(source, "F2.html"), "<p>two</p>");
    await writeFile(path.join(source, "notes.html"), "<p>not listed</p>");
  });
  afterEach(async () => {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  const sync = (...args: string[]) => run(process.execPath, [script, "--from", source, "--to", target, ...args]);

  it("copies only listed files, then reports the copy current", async () => {
    await sync();
    expect(existsSync(path.join(target, "F1.html"))).toBe(true);
    expect(existsSync(path.join(target, "notes.html"))).toBe(false);
    expect((await sync("--check")).stdout).toContain("Artifact copy is current.");
  });

  it("fails when the copy differs, is missing, or keeps a file the source dropped", async () => {
    await sync();
    await writeFile(path.join(target, "F1.html"), "<p>edited</p>");
    await expect(sync("--check")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("F1.html: copy differs from the source") });

    await sync();
    await rm(path.join(target, "F2.html"));
    await expect(sync("--check")).rejects.toMatchObject({ stderr: expect.stringContaining("F2.html: missing from the copy") });

    await sync();
    await rm(path.join(source, "F2.html"));
    await expect(sync("--check")).rejects.toMatchObject({ stderr: expect.stringContaining("F2.html: not in the source but still copied") });
    await sync();
    expect(existsSync(path.join(target, "F2.html"))).toBe(false);
  });

  it("skips when the source is absent (a standalone next-frontend build)", async () => {
    const { stdout } = await run(process.execPath, [script, "--check", "--from", path.join(source, "missing"), "--to", target]);
    expect(stdout).toContain("is not present");
  });

  const realSource = path.join(repoRoot, "architecture-viz/out");
  it.skipIf(!existsSync(realSource))("the committed copy matches architecture-viz/out", async () => {
    const { stdout } = await run(process.execPath, [script, "--check"], { cwd: frontendRoot });
    expect(stdout).toContain("Artifact copy is current.");
  });
});

describe("written artifact content", () => {
  const cited = [
    ...STACK.flatMap((row) => row.sources),
    ...DECISIONS.map((item) => item.source),
    ...ROLES.map((item) => item.source),
    ...WORKED_EXAMPLE.flatMap((step) => step.sources),
    ...FLAKY_EXAMPLE.flatMap((step) => step.sources),
  ].map((source) => source.path);

  it("every cited file exists in the repository, except the ones marked not on master", async () => {
    const page = await readFile(path.join(frontendRoot, "src/app/artifacts/how-it-was-built/page.tsx"), "utf8");
    const inline = [...page.matchAll(/<RepoPath path="([^"]+)"/g)].map((match) => match[1]);
    expect(inline.length).toBeGreaterThan(5);
    const missing = [...new Set([...cited, ...inline])].filter((p) => !NOT_ON_MASTER.has(p) && !existsSync(path.join(repoRoot, p)));
    expect(missing).toEqual([]);
  });

  it("a path marked not on master is really absent, so the mark is removed once it lands", () => {
    for (const p of NOT_ON_MASTER) expect(existsSync(path.join(repoRoot, p)), p).toBe(false);
  });

  it("each stack version appears in the package.json it names", async () => {
    const frontend = await readFile(path.join(frontendRoot, "package.json"), "utf8");
    const backend = await readFile(path.join(repoRoot, "express-backend/package.json"), "utf8");
    const pins: [string, string][] = [
      ["next", "16.4.6"], ["react", "19.3.1"], ["@base-ui/react", "1.9.0"], ["shadcn", "4.23.0"], ["tailwindcss", "4.3.5"],
      ["lucide-react", "1.73.0"], ["openapi-typescript", "7.13.0"], ["ajv", "8.20.0"], ["vitest", "5.1.0"],
      ["@testing-library/react", "16.3.3"], ["@playwright/test", "1.65.1"], ["@axe-core/playwright", "4.14.0"], ["typescript", "5.9.3"],
    ];
    const backendPins: [string, string][] = [
      ["express", "5.3.0"], ["zod", "4.6.7"], ["mysql2", "3.24.6"], ["openai", "7.57.0"], ["@modelcontextprotocol/server", "2.4.0"],
      ["@modelcontextprotocol/node", "2.1.2"], ["@modelcontextprotocol/client", "2.4.0"], ["argon2", "0.45.2"], ["jose", "6.2.17"],
      ["supertest", "7.3.2"], ["tsx", "4.23.15"], ["typescript", "6.0.3"],
    ];
    for (const [name, version] of pins) expect(frontend, name).toContain(`"${name}": "${version}"`);
    for (const [name, version] of backendPins) expect(backend, name).toContain(`"${name}": "${version}"`);
    const versions = STACK.map((row) => row.version).join(" ");
    for (const [name, version] of [...pins, ...backendPins]) {
      if (["@testing-library/react", "supertest", "tsx"].includes(name) || versions.includes(version)) continue;
      throw new Error(`${name} ${version} is pinned but not shown`);
    }
  });
});
