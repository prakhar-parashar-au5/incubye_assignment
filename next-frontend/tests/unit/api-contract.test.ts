import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { components, operations, paths } from "@/generated/api";
import contract from "@/generated/api-openapi.json";
import { isCurrentUserResponse, isErrorResponse, isLoginResponse } from "@/server/api/contract";

const run = promisify(execFile);
const root = path.resolve(__dirname, "../..");

describe("generated frontend contract", () => {
  it("is current with express-backend/openapi/openapi.json (drift check)", async () => {
    const { stdout } = await run(process.execPath, ["scripts/generate-api-contract.mjs", "--check"], { cwd: root });
    expect(stdout).toContain("Generated API contract is current.");
  });

  it("contains exactly the allowlisted authentication and directory operations", () => {
    const operationIds = Object.values(contract.paths).flatMap((item) =>
      Object.values(item).map((operation) => (operation as { operationId: string }).operationId),
    );
    expect(operationIds.sort()).toEqual([
      "getCurrentUser",
      "getDirectoryOptions",
      "getEmployee",
      "listEmployees",
      "login",
      "logout",
      "sendAssistantMessages",
    ]);
    expect(Object.keys(contract.components.schemas).sort()).toEqual([
      "AssistantCard",
      "AssistantMessagesRequest",
      "AssistantMessagesResponse",
      "AssistantMoney",
      "CompensationHistoryEntry",
      "CompensationSummaryCard",
      "CurrentUserResponse",
      "DirectoryOptionsResponse",
      "DirectoryResponse",
      "DirectoryRow",
      "EmployeeDetailResponse",
      "EmployeeListCard",
      "ErrorResponse",
      "ExchangeRateContext",
      "LoginRequest",
      "LoginResponse",
      "NoticeCard",
      "RecentChangesCard",
      "SelectedCompensation",
    ]);
  });

  it("generates the login, current-user, and error types the client relies on", () => {
    type Login = components["schemas"]["LoginResponse"];
    type Me = components["schemas"]["CurrentUserResponse"];
    expectTypeOf<Login["token"]>().toEqualTypeOf<string>();
    expectTypeOf<Login["user"]["role"]>().toEqualTypeOf<"ADMIN" | "SCOPED">();
    expectTypeOf<Me["scope"]["countries"]>().toEqualTypeOf<string[]>();
    expectTypeOf<components["schemas"]["ErrorResponse"]["error"]["code"]>().toEqualTypeOf<
      | "VALIDATION_ERROR"
      | "INVALID_CREDENTIALS"
      | "UNAUTHENTICATED"
      | "RATE_LIMITED"
      | "NOT_FOUND"
      | "INTERNAL_ERROR"
      | "ASSISTANT_UNAVAILABLE"
    >();
    expectTypeOf<paths["/api/v1/auth/login"]["post"]>().toEqualTypeOf<operations["login"]>();
    expectTypeOf<keyof paths>().toEqualTypeOf<
      | "/api/v1/auth/login"
      | "/api/v1/auth/me"
      | "/api/v1/auth/logout"
      | "/api/v1/employees"
      | "/api/v1/employees/{employeeCode}"
      | "/api/v1/employee-directory/options"
      | "/api/v1/assistant/messages"
    >();
    type Money = components["schemas"]["SelectedCompensation"]["annualBaseSalary"];
    expectTypeOf<Money>().toEqualTypeOf<string>();
  });

  it("validates responses at runtime from the same contract file", () => {
    const login = {
      token: "t",
      expiresAt: "2026-11-14T12:00:00.000Z",
      user: { id: 1, displayName: "Meera Iyer", email: "meera.iyer@acme.com", role: "ADMIN" },
    };
    expect(isLoginResponse(login)).toBe(true);
    expect(isLoginResponse({ ...login, sessionId: "leak" })).toBe(false);
    expect(isLoginResponse({ ...login, expiresAt: "tomorrow" })).toBe(false);
    expect(isLoginResponse({ ...login, user: { ...login.user, role: "ROOT" } })).toBe(false);

    const me = {
      user: { id: 1, displayName: "Meera Iyer", email: "meera.iyer@acme.com", role: "ADMIN", status: "ACTIVE" },
      scope: { countries: [], departments: [] },
      session: { expiresAt: "2026-11-14T12:00:00.000Z" },
    };
    expect(isCurrentUserResponse(me)).toBe(true);
    expect(isCurrentUserResponse({ ...me, scope: { countries: [] } })).toBe(false);

    expect(isErrorResponse({ error: { code: "RATE_LIMITED", message: "x" } })).toBe(true);
    expect(isErrorResponse({ error: { code: "SESSION_REVOKED", message: "x" } })).toBe(false);
  });
});
