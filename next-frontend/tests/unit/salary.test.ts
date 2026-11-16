import { beforeEach, describe, expect, it, vi } from "vitest";

import contract from "@/generated/api-openapi.json";
import { safeReturnPath } from "@/lib/directory-url";
import { NOTE_MAX_LENGTH, PERCENT_LIMITS, requestListHref, sameCommand, validateDraft, type AdjustmentDraft } from "@/lib/salary";
import { failureCopy } from "@/lib/salary-messages";
import { isSalaryAdjustmentPreview, isSalaryAdjustmentResult, isSalaryRequestList, isSalaryRequestResponse } from "@/server/api/contract";
import { parseRequestListQuery } from "@/server/directory-query";

import { SAMPLE_TOKEN, errorResponse, jsonResponse } from "../support/fake-backend";
import { COMMAND, REQUEST_ID, compensationRecord, preview, requestView } from "../support/salary-fixtures";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {}, redirect: () => { throw new Error("unexpected redirect"); } }));

const { previewSalaryAdjustment, confirmSalaryAdjustment, approveSalaryRequest, cancelSalaryRequest } = await import("@/server/actions/salary");

type Call = { method: string; path: string; headers: Headers; body: unknown };
const calls: Call[] = [];
function backend(...responses: Response[]) {
  const queue = [...responses];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", path: url.pathname, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${url.pathname}`);
    return next;
  });
}

const logs: string[] = [];
beforeEach(() => {
  jar.clear();
  calls.length = 0;
  logs.length = 0;
  jar.set("acme_session", SAMPLE_TOKEN);
  vi.stubEnv("API_BASE_URL", "http://backend.test:3000");
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(String(line)));
});

const KEY = "0b7b3a3c-5a5d-4b55-9c1a-2a6e0f6f9d11";

describe("salary contract fixtures", () => {
  it("match the generated schemas", () => {
    expect(isSalaryAdjustmentPreview(preview())).toBe(true);
    expect(isSalaryAdjustmentResult({ employeeCode: "ACME02345", compensation: compensationRecord() })).toBe(true);
    expect(isSalaryRequestResponse({ request: requestView() })).toBe(true);
    expect(isSalaryRequestList({ requests: [requestView()], page: { number: 1, size: 25, totalRows: 1, totalPages: 1 } })).toBe(true);
    expect(isSalaryAdjustmentPreview(preview({ confirmationMode: "AUTO_APPLY" }))).toBe(false);
    expect(isSalaryAdjustmentPreview({ ...preview(), proposed: { annualBaseSalary: 1157970 } })).toBe(false);
  });

  it("form limits equal the contract's published percentage rules", () => {
    const description = contract.components.schemas.SalaryAdjustmentCommand.properties.value.description;
    expect(description).toContain(`increase ${PERCENT_LIMITS.PERCENTAGE_INCREASE.min}..${PERCENT_LIMITS.PERCENTAGE_INCREASE.max}`);
    expect(description).toContain(`decrease ${PERCENT_LIMITS.PERCENTAGE_DECREASE.min}..${PERCENT_LIMITS.PERCENTAGE_DECREASE.max}`);
    expect(contract.components.schemas.SalaryAdjustmentCommand.properties.note.anyOf[0].maxLength).toBe(NOTE_MAX_LENGTH);
  });
});

describe("adjustment form format checks", () => {
  const today = "2026-11-16";
  const base: AdjustmentDraft = { target: "BASE_SALARY", method: "PERCENTAGE_INCREASE", value: "10", effectiveFrom: today, reason: "PERFORMANCE", note: "" };
  const check = (changes: Partial<AdjustmentDraft>, currentBonusIsZero = false) =>
    validateDraft({ ...base, ...changes }, { todayUtc: today, currentBonusIsZero });

  it("builds the exact command, with a blank note sent as null", () => {
    expect(check({}).command).toEqual({ ...COMMAND, note: null });
    expect(check({ note: "  context  " }).command?.note).toBe("context");
  });

  it.each([
    [{ value: "10.5" }, "value"],
    [{ value: "0" }, "value"],
    [{ value: "201" }, "value"],
    [{ method: "PERCENTAGE_DECREASE", value: "51" }, "value"],
    [{ method: "FIXED_INCREASE", value: "100.123" }, "value"],
    [{ method: "FIXED_INCREASE", value: "-5" }, "value"],
    [{ method: "FIXED_DECREASE", value: "0.00" }, "value"],
    [{ effectiveFrom: "2026-11-15" }, "effectiveFrom"],
    [{ effectiveFrom: "" }, "effectiveFrom"],
    [{ reason: "" }, "reason"],
    [{ reason: "CORRECTION", note: "  " }, "note"],
    [{ note: "x".repeat(2001) }, "note"],
    [{ target: "" }, "target"],
    [{ method: "" }, "method"],
  ] as const)("rejects %o on %s without building a command", (changes, field) => {
    const result = check(changes as Partial<AdjustmentDraft>);
    expect(result.errors[field]).toBeTruthy();
    expect(result.command).toBeUndefined();
  });

  it("accepts the percentage boundaries and amounts with two decimals", () => {
    expect(check({ value: "1" }).command).toBeDefined();
    expect(check({ value: "200" }).command).toBeDefined();
    expect(check({ method: "PERCENTAGE_DECREASE", value: "50" }).command).toBeDefined();
    expect(check({ method: "FIXED_INCREASE", value: "1000.05" }).command?.value).toBe("1000.05");
    expect(check({ method: "REPLACEMENT", value: "1500000" }).command).toBeDefined();
  });

  it("blocks a bonus percentage change when the current bonus is zero, but allows fixed and replacement", () => {
    expect(check({ target: "ANNUAL_BONUS" }, true).errors.method).toMatch(/Bonus is zero/);
    expect(check({ target: "ANNUAL_BONUS", method: "FIXED_INCREASE", value: "5000" }, true).command).toBeDefined();
    expect(check({ target: "ANNUAL_BONUS", method: "REPLACEMENT", value: "5000" }, true).command).toBeDefined();
  });

  it("detects any input change after a preview", () => {
    const command = check({}).command!;
    expect(sameCommand(command, { ...command })).toBe(true);
    for (const change of [{ value: "11" }, { effectiveFrom: "2026-12-01" }, { reason: "PROMOTION" as const }, { note: "x" }, { method: "FIXED_INCREASE" as const }]) {
      expect(sameCommand(command, { ...command, ...change })).toBe(false);
    }
  });
});

describe("request list URL state and return paths", () => {
  it("omits defaults, keeps filters, and validates against the contract", () => {
    expect(requestListHref({})).toBe("/salary-requests");
    expect(requestListHref({ status: "PENDING", direction: "asc", q: " acme ", page: 2 })).toBe("/salary-requests?q=acme&status=PENDING&direction=asc&page=2");
    const parsed = parseRequestListQuery({ status: "REJECTED", department: "Tech", sort: "name", page: "0" });
    expect(parsed.invalid.sort()).toEqual(["page", "sort", "status"]);
    expect(parsed.query).toEqual({ department: "Tech" });
  });

  it("accepts only same-site list paths that the page allows", () => {
    expect(safeReturnPath("/salary-requests?status=PENDING", ["/salary-requests"], "/salary-requests")).toBe("/salary-requests?status=PENDING");
    expect(safeReturnPath("https://evil.example/salary-requests", ["/salary-requests"], "/salary-requests")).toBe("/salary-requests");
    expect(safeReturnPath("/salary-requests/../sign-in", ["/salary-requests"], "/salary-requests")).toBe("/salary-requests");
    expect(safeReturnPath("/salary-requests", ["/employees", "/salary-requests"])).toBe("/salary-requests");
    expect(safeReturnPath("/assistant", ["/employees", "/salary-requests"])).toBe("/employees");
  });
});

describe("salary Server Actions", () => {
  it("preview forwards only contract fields to the backend with the server-side Bearer token", async () => {
    backend(jsonResponse(200, preview()));
    const outcome = await previewSalaryAdjustment("ACME02345", { ...COMMAND, hrUserId: 1, role: "ADMIN" });
    expect(outcome.ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/v1/employees/ACME02345/salary-adjustments/preview", body: { ...COMMAND } });
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${SAMPLE_TOKEN}`);
  });

  it("rejects a malformed employee code or command without calling the backend", async () => {
    backend();
    expect(await previewSalaryAdjustment("../auth/me", COMMAND)).toEqual({ ok: false, kind: "INVALID_INPUT" });
    expect(await previewSalaryAdjustment("ACME02345", { ...COMMAND, value: 10 })).toEqual({ ok: false, kind: "INVALID_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("passes the backend's reason through for field-level messages", async () => {
    backend(errorResponse(400, "VALIDATION_ERROR"));
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "x", reason: "SALARY_BAND" } }));
    expect(await previewSalaryAdjustment("ACME02345", COMMAND)).toEqual({ ok: false, kind: "VALIDATION_ERROR", reason: "SALARY_BAND" });
    expect(failureCopy("VALIDATION_ERROR", "SALARY_BAND").body).toMatch(/outside the salary band/);
    expect(failureCopy("VALIDATION_ERROR", "FUTURE_CHANGE_EXISTS").field).toBe("effectiveFrom");
  });

  it("direct apply sends the token, the exact command, and the Idempotency-Key header", async () => {
    backend(jsonResponse(201, { employeeCode: "ACME02345", compensation: compensationRecord(2) }));
    const outcome = await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "DIRECT_APPLY", previewToken: "tok", adjustment: COMMAND, idempotencyKey: KEY });
    expect(outcome).toMatchObject({ ok: true, mode: "DIRECT_APPLY", compensation: { version: 2 } });
    expect(calls[0]).toMatchObject({ path: "/api/v1/employees/ACME02345/salary-adjustments", body: { previewToken: "tok", adjustment: { ...COMMAND } } });
    expect(calls[0].headers.get("idempotency-key")).toBe(KEY);
  });

  it("submit for approval uses the request endpoint", async () => {
    backend(jsonResponse(201, { request: requestView() }));
    const outcome = await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "SUBMIT_REQUEST", previewToken: "tok", adjustment: COMMAND, idempotencyKey: KEY });
    expect(outcome).toMatchObject({ ok: true, mode: "SUBMIT_REQUEST", request: { status: "PENDING" } });
    expect(calls[0].path).toBe("/api/v1/employees/ACME02345/salary-adjustment-requests");
  });

  it("on a stale conflict returns a fresh preview and never confirms again by itself", async () => {
    backend(errorResponse(409, "STALE_VERSION"), jsonResponse(200, preview({ expectedCompensationVersion: 2 })));
    const outcome = await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "DIRECT_APPLY", previewToken: "tok", adjustment: COMMAND, idempotencyKey: KEY });
    expect(outcome).toMatchObject({ ok: false, kind: "STALE_VERSION", fresh: { ok: true, preview: { expectedCompensationVersion: 2 } } });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/employees/ACME02345/salary-adjustments",
      "/api/v1/employees/ACME02345/salary-adjustments/preview",
    ]);
  });

  it("rejects a missing or malformed idempotency key and an unknown mode", async () => {
    backend();
    for (const idempotencyKey of [undefined, "short", "has spaces in it at all", "x".repeat(129)]) {
      expect(await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "DIRECT_APPLY", previewToken: "tok", adjustment: COMMAND, idempotencyKey })).toEqual({
        ok: false,
        kind: "INVALID_INPUT",
      });
    }
    expect(await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "AUTO", previewToken: "tok", adjustment: COMMAND, idempotencyKey: KEY })).toEqual({
      ok: false,
      kind: "INVALID_INPUT",
    });
    expect(calls).toHaveLength(0);
  });

  it("maps 403, 409, 422, and 503 to public kinds", async () => {
    for (const [status, code] of [[403, "FORBIDDEN"], [409, "PENDING_REQUEST_EXISTS"], [409, "DUPLICATE_OPERATION"], [422, "EMPLOYEE_INELIGIBLE"], [503, "SERVICE_UNAVAILABLE"]] as const) {
      backend(errorResponse(status, code));
      expect(await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "SUBMIT_REQUEST", previewToken: "tok", adjustment: COMMAND, idempotencyKey: KEY })).toEqual({
        ok: false,
        kind: code,
      });
    }
  });

  it("approve and cancel send the key; cancel requires a note and sends it trimmed", async () => {
    backend(jsonResponse(200, { request: requestView({ status: "APPROVED", resultingCompensationVersion: 2, decidedAt: "2026-11-16T14:00:00.000Z", decidedBy: { displayName: "Meera Iyer", email: "meera.iyer@acme.com" } }), compensation: compensationRecord(2) }));
    expect(await approveSalaryRequest(REQUEST_ID, KEY)).toMatchObject({ ok: true, request: { status: "APPROVED" } });
    expect(calls[0]).toMatchObject({ path: `/api/v1/salary-adjustment-requests/${REQUEST_ID}/approve`, method: "POST" });
    expect(calls[0].headers.get("idempotency-key")).toBe(KEY);

    calls.length = 0;
    backend();
    expect(await cancelSalaryRequest(REQUEST_ID, "   ", KEY)).toEqual({ ok: false, kind: "VALIDATION_ERROR", reason: "NOTE_REQUIRED" });
    expect(await approveSalaryRequest("not-a-uuid", KEY)).toEqual({ ok: false, kind: "INVALID_INPUT" });
    expect(calls).toHaveLength(0);

    backend(jsonResponse(200, { request: requestView({ status: "CANCELLED", decisionNote: "Budget freeze", decidedAt: "2026-11-16T14:00:00.000Z", decidedBy: { displayName: "Meera Iyer", email: "meera.iyer@acme.com" } }) }));
    expect(await cancelSalaryRequest(REQUEST_ID, "  Budget freeze  ", KEY)).toMatchObject({ ok: true, request: { status: "CANCELLED" } });
    expect(calls[0].body).toEqual({ note: "Budget freeze" });
  });

  it("returns UNAUTHENTICATED without a session cookie and logs no salary, note, token, or key", async () => {
    jar.clear();
    backend();
    expect(await previewSalaryAdjustment("ACME02345", COMMAND)).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    jar.set("acme_session", SAMPLE_TOKEN);
    backend(jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "x", reason: "NOTE_REQUIRED" } }));
    await confirmSalaryAdjustment({ employeeCode: "ACME02345", mode: "DIRECT_APPLY", previewToken: "secret-preview-token", adjustment: { ...COMMAND, note: "private note" }, idempotencyKey: KEY });
    const text = logs.join("\n");
    for (const forbidden of ["secret-preview-token", "private note", KEY, SAMPLE_TOKEN, "1052700", "ACME02345"]) expect(text).not.toContain(forbidden);
    expect(text).toContain('"reason":"NOTE_REQUIRED"');
  });
});
