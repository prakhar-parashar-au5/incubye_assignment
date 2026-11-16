import { describe, expect, it } from "vitest";

import contract from "@/generated/api-openapi.json";
import { buildFilterChoices } from "@/lib/directory-choices";
import {
  DEFAULT_DIRECTION,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  clearFilters,
  directoryHref,
  hasFilters,
  safeReturnPath,
  withChanges,
} from "@/lib/directory-url";
import { formatDate, formatMoney } from "@/lib/format";
import { createApiClient } from "@/server/api/client";
import { isDirectoryOptionsResponse, isDirectoryResponse, isEmployeeDetailResponse } from "@/server/api/contract";
import { parseDirectoryQuery } from "@/server/directory-query";

import { SAMPLE_TOKEN, fakeFetch, jsonResponse } from "../support/fake-backend";

type Param = { name: string; schema: { default?: unknown } };
const params = contract.paths["/api/v1/employees"].get.parameters as Param[];
const contractDefault = (name: string) => params.find((p) => p.name === name)?.schema.default;

const rate = {
  baseCurrency: "USD",
  quoteCurrency: "INR",
  rate: "93.9100",
  sourceName: "Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates",
  sourceUrl: "https://www.federalreserve.gov/releases/h10/20261109/",
  effectiveDate: "2026-11-06",
  retrievedAt: "2026-11-14T18:47:36Z",
};
const compensation = {
  state: "CURRENT",
  version: 1,
  annualBaseSalary: "1600000.00",
  annualBonus: "100000.00",
  annualCashCompensation: "1700000.00",
  currency: "INR",
  payFrequency: "MONTHLY",
  effectiveFrom: "2026-04-01",
  usdEquivalent: { annualBaseSalary: "17037.59", annualCashCompensation: "18102.44" },
};
const row = {
  employeeCode: "ACME00042",
  firstName: "Sneha",
  lastName: "Singh",
  email: "sneha.singh@acme.com",
  department: "Tech",
  jobTitle: "Senior Software Engineer",
  level: "SENIOR",
  country: "IN",
  employmentStatus: "CURRENTLY_WORKING",
  hireDate: "2022-01-10",
  compensation,
};
const listResponse = {
  employees: [row],
  page: { number: 1, size: 25, totalRows: 1, totalPages: 1 },
  sort: { field: "name", direction: "asc", comparison: null },
  exchangeRate: rate,
};

describe("directory URL state", () => {
  it("uses the contract's defaults and leaves them out of URLs", () => {
    expect(DEFAULT_SORT).toBe(contractDefault("sort"));
    expect(DEFAULT_DIRECTION).toBe(contractDefault("direction"));
    expect(DEFAULT_PAGE_SIZE).toBe(contractDefault("pageSize"));
    expect(directoryHref({})).toBe("/employees");
    expect(directoryHref({ q: "  ", sort: "name", direction: "asc", page: 1, pageSize: 25 })).toBe("/employees");
  });

  it("round-trips search, filters, sort, direction, page, page size, and comparison currency", () => {
    const href = directoryHref({
      q: "sneha",
      department: "Tech",
      country: "IN",
      currency: "INR",
      level: "SENIOR",
      status: "CURRENTLY_WORKING",
      sort: "annualCashCompensation",
      direction: "desc",
      page: 3,
      pageSize: 50,
    });
    expect(href).toBe(
      "/employees?q=sneha&department=Tech&country=IN&currency=INR&level=SENIOR&status=CURRENTLY_WORKING&sort=annualCashCompensation&direction=desc&pageSize=50&page=3&comparisonCurrency=USD",
    );
    const parsed = parseDirectoryQuery(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed.invalid).toEqual([]);
    expect(directoryHref(parsed.query)).toBe(href);
  });

  it("returns to page 1 on any change except paging, and drops the comparison currency off salary sorts", () => {
    const start = { department: "Tech" as const, page: 4, sort: "annualBaseSalary" as const, comparisonCurrency: "USD" as const };
    expect(withChanges(start, { country: "IN" }).page).toBeUndefined();
    expect(withChanges(start, { page: 5 }).page).toBe(5);
    expect(withChanges(start, { sort: "name" }).comparisonCurrency).toBeUndefined();
    expect(directoryHref(withChanges(start, { department: undefined }))).toBe("/employees?sort=annualBaseSalary&comparisonCurrency=USD");
  });

  it("clears every filter and the search, keeping sort and page size", () => {
    const cleared = clearFilters({ q: "a", department: "Tech", country: "IN", currency: "INR", level: "MID", status: "LEFT", sort: "level", pageSize: 50, page: 2 });
    expect(cleared).toEqual({ sort: "level", pageSize: 50 });
    expect(hasFilters(cleared)).toBe(false);
    expect(hasFilters({ q: "x" })).toBe(true);
  });

  it("flags invalid and repeated values instead of sending them", () => {
    const parsed = parseDirectoryQuery({ department: "Legal", page: "0", pageSize: "500", sort: "salary; DROP", country: ["IN", "US"], q: "ok" });
    expect(parsed.invalid.sort()).toEqual(["country", "department", "page", "pageSize", "sort"]);
    expect(parsed.query).toEqual({ q: "ok" });
    expect(parseDirectoryQuery({ page: "1.5" }).invalid).toEqual(["page"]);
    expect(parseDirectoryQuery({ q: "x".repeat(101) }).invalid).toEqual(["q"]);
  });

  it("adds the required comparison currency to a salary sort from a hand-written URL", () => {
    expect(parseDirectoryQuery({ sort: "annualBaseSalary" }).query).toEqual({ sort: "annualBaseSalary", comparisonCurrency: "USD" });
    expect(parseDirectoryQuery({ sort: "name", comparisonCurrency: "USD" }).query).toEqual({ sort: "name" });
  });

  it.each([
    ["/employees?department=Tech&page=2", "/employees?department=Tech&page=2"],
    ["/employees", "/employees"],
    ["https://evil.example/employees", "/employees"],
    ["//evil.example/employees", "/employees"],
    ["/employees/../sign-in", "/employees"],
    ["/employeesX", "/employees"],
    ["javascript:alert(1)", "/employees"],
    [["/employees?a=1", "/x"], "/employees"],
    [undefined, "/employees"],
  ])("accepts only an internal directory return path: %s", (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });
});

describe("money and dates", () => {
  it("formats exact decimal strings with the currency code and native grouping", () => {
    expect(formatMoney("2500000.00", "INR")).toBe("INR\u00a025,00,000.00");
    expect(formatMoney("120000.50", "USD")).toBe("USD\u00a0120,000.50");
    // Beyond float precision: no digits are lost or rounded.
    expect(formatMoney("90071992547409.99", "USD")).toBe("USD\u00a090,071,992,547,409.99");
  });

  it("formats calendar dates without a timezone shift", () => {
    expect(formatDate("2026-11-06")).toBe("6 Nov 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });
});

describe("directory API calls", () => {
  const env = { API_BASE_URL: "http://backend.test:3000" };

  it("sends the validated query and Bearer token, and validates the response", async () => {
    const backend = fakeFetch(jsonResponse(200, listResponse));
    const api = createApiClient({ fetch: backend.fetch, env, logger: () => {} });
    const result = await api.listEmployees(SAMPLE_TOKEN, { q: "a&b=c", department: "Tech", sort: "annualBaseSalary", comparisonCurrency: "USD", page: 2 });
    expect(result.ok).toBe(true);
    const url = new URL(backend.requests[0].url);
    expect(url.pathname).toBe("/api/v1/employees");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "a&b=c", department: "Tech", sort: "annualBaseSalary", comparisonCurrency: "USD", page: "2" });
    expect(backend.requests[0].headers.authorization).toBe(`Bearer ${SAMPLE_TOKEN}`);
  });

  it("encodes the employee code as one path segment", async () => {
    const backend = fakeFetch(jsonResponse(404, { error: { code: "NOT_FOUND", message: "Employee not found." } }));
    const api = createApiClient({ fetch: backend.fetch, env, logger: () => {} });
    expect(await api.getEmployee(SAMPLE_TOKEN, "../auth/me?x=1")).toEqual({ ok: false, kind: "NOT_FOUND", status: 404 });
    expect(new URL(backend.requests[0].url).pathname).toBe("/api/v1/employees/..%2Fauth%2Fme%3Fx%3D1");
  });

  it("rejects directory responses that do not match the contract", async () => {
    expect(isDirectoryResponse(listResponse)).toBe(true);
    expect(isDirectoryResponse({ ...listResponse, employees: [{ ...row, compensation: { ...compensation, annualBaseSalary: 1600000 } }] })).toBe(false);
    expect(isDirectoryResponse({ ...listResponse, employees: [{ ...row, salaryUsd: "1" }] })).toBe(false);
    expect(isEmployeeDetailResponse({ employee: row, compensation, compensationHistory: [], exchangeRate: rate })).toBe(false);
    const options = { departments: ["Tech"], countries: [{ code: "IN", name: "India" }], currencies: ["INR"], levels: ["MID"], statuses: ["LEFT"], sortFields: ["name"], comparisonCurrencies: [] };
    expect(isDirectoryOptionsResponse(options)).toBe(true);
    expect(buildFilterChoices(options as never).country).toEqual([{ value: "IN", label: "India" }]);
  });
});
