import { describe, expect, it } from "vitest";

import contract from "@/generated/api-openapi.json";
import {
  BREAKDOWN_KEYS,
  BREAKDOWN_TO_API,
  COUNTRIES,
  CURRENCIES,
  DASHBOARD_LIST_SIZE,
  DEFAULT_BREAKDOWN,
  DEFAULT_NO_ADJUSTMENT_MONTHS,
  DEFAULT_RECENT_DAYS,
  DEPARTMENTS,
  LEVELS,
  NO_ADJUSTMENT_MONTHS,
  RECENT_DAYS,
  STATUSES,
  barPercent,
  clearDashboardFilters,
  dashboardApiQueries,
  dashboardHref,
  directoryLinkFor,
  employeeLinkFor,
  hasDashboardFilters,
  requestListLinkFor,
  withDashboardChanges,
} from "@/lib/dashboard-url";
import { safeReturnPath } from "@/lib/directory-url";
import { createApiClient } from "@/server/api/client";
import {
  isDashboardBreakdownResponse,
  isDashboardRecentChangesResponse,
  isDashboardSummaryResponse,
  isDashboardWithoutAdjustmentResponse,
} from "@/server/api/contract";
import { parseDashboardQuery } from "@/server/directory-query";

import { departmentBreakdown, noAccessSummary, recentChanges, statusBreakdown, summary, withoutAdjustment } from "../support/dashboard-fixtures";
import { SAMPLE_TOKEN, errorResponse, fakeFetch, jsonResponse } from "../support/fake-backend";

type Param = { name: string; in: string; schema: { enum?: unknown[]; default?: unknown } };
const paths = contract.paths as unknown as Record<string, { get: { parameters: Param[] } }>;
const param = (path: string, name: string) => paths[path].get.parameters.find((p) => p.name === name)?.schema;

describe("dashboard contract values", () => {
  it("uses the contract's enums and defaults for every URL value", () => {
    const summaryPath = "/api/v1/dashboard/summary";
    expect([...DEPARTMENTS]).toEqual(param(summaryPath, "department")?.enum);
    expect([...COUNTRIES]).toEqual(param(summaryPath, "country")?.enum);
    expect([...CURRENCIES]).toEqual(param(summaryPath, "currency")?.enum);
    expect([...LEVELS]).toEqual(param(summaryPath, "level")?.enum);
    expect([...STATUSES]).toEqual(param(summaryPath, "employmentStatus")?.enum);
    expect([...RECENT_DAYS]).toEqual(param(summaryPath, "periodDays")?.enum);
    expect([...NO_ADJUSTMENT_MONTHS]).toEqual(param(summaryPath, "noAdjustmentMonths")?.enum);
    expect(DEFAULT_RECENT_DAYS).toBe(param(summaryPath, "periodDays")?.default);
    expect(DEFAULT_NO_ADJUSTMENT_MONTHS).toBe(param(summaryPath, "noAdjustmentMonths")?.default);
    expect(BREAKDOWN_KEYS.map((key) => BREAKDOWN_TO_API[key])).toEqual(param("/api/v1/dashboard/breakdowns", "breakdown")?.enum);
    expect(BREAKDOWN_TO_API[DEFAULT_BREAKDOWN]).toBe(param("/api/v1/dashboard/breakdowns", "breakdown")?.default);
  });

  it("test fixtures pass the validators compiled from the contract", () => {
    expect(isDashboardSummaryResponse(summary())).toBe(true);
    expect(isDashboardSummaryResponse(summary({ usd: false, notApplied: true }))).toBe(true);
    expect(isDashboardSummaryResponse(noAccessSummary())).toBe(true);
    expect(isDashboardBreakdownResponse(departmentBreakdown())).toBe(true);
    expect(isDashboardBreakdownResponse(departmentBreakdown({ usd: false }))).toBe(true);
    expect(isDashboardBreakdownResponse(statusBreakdown())).toBe(true);
    expect(isDashboardRecentChangesResponse(recentChanges())).toBe(true);
    expect(isDashboardRecentChangesResponse(recentChanges({ empty: true }))).toBe(true);
    expect(isDashboardWithoutAdjustmentResponse(withoutAdjustment())).toBe(true);
  });

  it("rejects responses that do not match the contract, including extra keys and float money", () => {
    expect(isDashboardSummaryResponse({ ...summary(), internalId: 7 })).toBe(false);
    const floatMoney = summary();
    floatMoney.figures!.currentSpending.byCurrency[0] = { ...floatMoney.figures!.currentSpending.byCurrency[0], annualBaseSalary: 314438700 as never };
    expect(isDashboardSummaryResponse(floatMoney)).toBe(false);
    expect(isDashboardRecentChangesResponse({ ...recentChanges(), emptyMessage: "Nothing here" })).toBe(false);
  });
});

describe("parseDashboardQuery", () => {
  it("treats an empty URL as the defaults", () => {
    expect(parseDashboardQuery({})).toEqual({ query: {}, invalid: [] });
  });

  it("accepts every valid value under the frontend names", () => {
    expect(
      parseDashboardQuery({
        department: "Tech",
        country: "IN",
        currency: "INR",
        level: "SENIOR",
        status: "CURRENTLY_WORKING",
        recentDays: "7",
        noAdjustmentMonths: "24",
        breakdown: "status",
        noAdjustmentPage: "3",
        usd: "1",
      }),
    ).toEqual({
      query: {
        department: "Tech",
        country: "IN",
        currency: "INR",
        level: "SENIOR",
        status: "CURRENTLY_WORKING",
        recentDays: "7",
        noAdjustmentMonths: "24",
        breakdown: "status",
        noAdjustmentPage: 3,
        usd: true,
      },
      invalid: [],
    });
  });

  it("reports invalid, repeated, and backend-named values instead of passing them on", () => {
    const parsed = parseDashboardQuery({
      level: "CEO",
      recentDays: "14",
      noAdjustmentMonths: "1",
      breakdown: "DEPARTMENT",
      noAdjustmentPage: "0",
      usd: "yes",
      department: ["Tech", "HR"],
      country: "in",
    });
    expect(parsed.invalid.sort()).toEqual(["breakdown", "country", "department", "level", "noAdjustmentMonths", "noAdjustmentPage", "recentDays", "usd"]);
    expect(parsed.query).toEqual({});
    expect(parseDashboardQuery({ noAdjustmentPage: "1.5" }).invalid).toEqual(["noAdjustmentPage"]);
    expect(parseDashboardQuery({ noAdjustmentPage: "99999999" }).invalid).toEqual(["noAdjustmentPage"]);
  });

  it("ignores unknown names, including the backend's own parameter names", () => {
    // `employmentStatus` and `periodDays` are backend names; the dashboard URL uses `status`
    // and `recentDays`, so these are simply not dashboard parameters.
    expect(parseDashboardQuery({ employmentStatus: "LEFT", periodDays: "7", from: "/x" })).toEqual({ query: {}, invalid: [] });
  });
});

describe("dashboard URL state", () => {
  it("leaves defaults out of the address", () => {
    expect(dashboardHref({})).toBe("/dashboard");
    expect(dashboardHref({ recentDays: "30", noAdjustmentMonths: "12", breakdown: "department", noAdjustmentPage: 1, usd: false })).toBe("/dashboard");
    expect(dashboardHref({ status: "LEFT", recentDays: "90", breakdown: "level", noAdjustmentPage: 2, usd: true })).toBe(
      "/dashboard?status=LEFT&recentDays=90&breakdown=level&noAdjustmentPage=2&usd=1",
    );
  });

  it("maps frontend names to each endpoint's backend names explicitly", () => {
    const queries = dashboardApiQueries({ status: "SOON_TO_JOIN", department: "Tech", recentDays: "7", noAdjustmentMonths: "6", breakdown: "status", noAdjustmentPage: 4 });
    expect(queries.summary).toEqual({
      department: "Tech",
      country: undefined,
      currency: undefined,
      level: undefined,
      employmentStatus: "SOON_TO_JOIN",
      periodDays: "7",
      noAdjustmentMonths: "6",
    });
    expect(queries.breakdown).toMatchObject({ employmentStatus: "SOON_TO_JOIN", breakdown: "EMPLOYMENT_STATUS" });
    expect(queries.breakdown).not.toHaveProperty("periodDays");
    expect(queries.recent).toMatchObject({ employmentStatus: "SOON_TO_JOIN", periodDays: "7", page: 1, pageSize: DASHBOARD_LIST_SIZE });
    expect(queries.recent).not.toHaveProperty("noAdjustmentMonths");
    expect(queries.without).toMatchObject({ employmentStatus: "SOON_TO_JOIN", noAdjustmentMonths: "6", page: 4, pageSize: DASHBOARD_LIST_SIZE });
    expect(queries.without).not.toHaveProperty("periodDays");
    expect(dashboardApiQueries({}).summary).toMatchObject({ periodDays: "30", noAdjustmentMonths: "12" });
    expect(dashboardApiQueries({}).breakdown.breakdown).toBe("DEPARTMENT");
  });

  it("resets list pagination when a global filter or the list period changes", () => {
    const query = { department: "Tech" as const, noAdjustmentPage: 5, breakdown: "level" as const, usd: true };
    expect(withDashboardChanges(query, { country: "IN" }).noAdjustmentPage).toBeUndefined();
    expect(withDashboardChanges(query, { department: undefined })).toEqual({ breakdown: "level", usd: true });
    expect(withDashboardChanges(query, { noAdjustmentMonths: "3" }).noAdjustmentPage).toBeUndefined();
    expect(clearDashboardFilters(query)).toEqual({ breakdown: "level", usd: true });
    // Switching what is displayed keeps the list page.
    expect(withDashboardChanges(query, { breakdown: "country" }).noAdjustmentPage).toBe(5);
    expect(withDashboardChanges(query, { recentDays: "90" }).noAdjustmentPage).toBe(5);
    expect(withDashboardChanges(query, { usd: false })).toEqual({ department: "Tech", noAdjustmentPage: 5, breakdown: "level" });
    expect(hasDashboardFilters({ breakdown: "level", usd: true })).toBe(false);
    expect(hasDashboardFilters({ level: "MID" })).toBe(true);
  });

  it("links into the directory with the same filter names and to detail with a dashboard return path", () => {
    expect(directoryLinkFor({ department: "Tech", recentDays: "7" }, { status: "LEFT" })).toBe("/employees?department=Tech&status=LEFT");
    expect(directoryLinkFor({ status: "LEFT" }, { status: undefined })).toBe("/employees");
    const detail = employeeLinkFor("ACME00002", { level: "LEAD", breakdown: "country" });
    expect(detail).toBe(`/employees/ACME00002?from=${encodeURIComponent("/dashboard?level=LEAD&breakdown=country")}`);
  });

  it("accepts the exact dashboard URL as a return path and nothing that only looks like it", () => {
    const allowed = ["/employees", "/salary-requests", "/dashboard"];
    expect(safeReturnPath("/dashboard?level=LEAD&breakdown=country", allowed)).toBe("/dashboard?level=LEAD&breakdown=country");
    expect(safeReturnPath("/dashboard", allowed)).toBe("/dashboard");
    expect(safeReturnPath("/dashboardevil", allowed)).toBe("/employees");
    expect(safeReturnPath("//evil.example/dashboard", allowed)).toBe("/employees");
    expect(safeReturnPath("https://evil.example/dashboard", allowed)).toBe("/employees");
    expect(safeReturnPath("/dashboard/../admin", allowed)).toBe("/employees");
  });

  it("carries only supported filters to the request list, and says which were not carried", () => {
    expect(requestListLinkFor({}, "PENDING", true)).toEqual({ href: "/salary-requests?status=PENDING&direction=asc", note: null });
    expect(requestListLinkFor({ department: "Tech" }, "PENDING", true)).toEqual({ href: "/salary-requests?status=PENDING&direction=asc&department=Tech", note: null });
    const admin = requestListLinkFor({ department: "Tech", country: "IN", level: "MID" }, "STALE", true);
    expect(admin.href).toBe("/salary-requests?status=STALE&department=Tech");
    expect(admin.note).toBe("The request list keeps only the department filter, so it does not filter by country or level.");
    // Scoped HR cannot filter the request list by department at all.
    const scoped = requestListLinkFor({ department: "Tech", status: "LEFT" }, "PENDING", false);
    expect(scoped.href).toBe("/salary-requests?status=PENDING&direction=asc");
    expect(scoped.note).toBe("The request list does not filter by department or employment status; it shows every request in your access.");
  });
});

describe("barPercent (presentation only)", () => {
  it("sizes a bar relative to the chart's largest value and never beyond it", () => {
    expect(barPercent("50.00", "100.00")).toBe(50);
    expect(barPercent("100.00", "100.00")).toBe(100);
    expect(barPercent(1, 3)).toBe(33.3);
    expect(barPercent("571694636273.00", "571694636273.00")).toBe(100);
    // Tiny non-zero values stay visible; zero, negative, and invalid inputs draw nothing.
    expect(barPercent("1.00", "1000000.00")).toBe(1);
    expect(barPercent("0.00", "10.00")).toBe(0);
    expect(barPercent("5.00", "0.00")).toBe(0);
    expect(barPercent("abc", "10.00")).toBe(0);
  });
});

describe("dashboard API client", () => {
  const env = { API_BASE_URL: "http://backend.test:3000" };

  it("sends the mapped backend parameters and validates each response", async () => {
    const backend = fakeFetch(
      jsonResponse(200, summary()),
      jsonResponse(200, departmentBreakdown()),
      jsonResponse(200, recentChanges()),
      jsonResponse(200, withoutAdjustment()),
    );
    const api = createApiClient({ fetch: backend.fetch, env, logger: () => {} });
    const queries = dashboardApiQueries({ status: "CURRENTLY_WORKING", recentDays: "90", noAdjustmentPage: 2 });
    expect((await api.getDashboardSummary(SAMPLE_TOKEN, queries.summary)).ok).toBe(true);
    expect((await api.getDashboardBreakdown(SAMPLE_TOKEN, queries.breakdown)).ok).toBe(true);
    expect((await api.getDashboardRecentChanges(SAMPLE_TOKEN, queries.recent)).ok).toBe(true);
    expect((await api.getDashboardWithoutRecentAdjustment(SAMPLE_TOKEN, queries.without)).ok).toBe(true);
    const urls = backend.requests.map((request) => new URL(request.url));
    expect(urls.map((url) => url.pathname)).toEqual([
      "/api/v1/dashboard/summary",
      "/api/v1/dashboard/breakdowns",
      "/api/v1/dashboard/recent-changes",
      "/api/v1/dashboard/without-recent-adjustment",
    ]);
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ employmentStatus: "CURRENTLY_WORKING", periodDays: "90", noAdjustmentMonths: "12" });
    expect(Object.fromEntries(urls[1].searchParams)).toEqual({ employmentStatus: "CURRENTLY_WORKING", breakdown: "DEPARTMENT" });
    expect(Object.fromEntries(urls[2].searchParams)).toEqual({ employmentStatus: "CURRENTLY_WORKING", periodDays: "90", page: "1", pageSize: "10" });
    expect(Object.fromEntries(urls[3].searchParams)).toEqual({ employmentStatus: "CURRENTLY_WORKING", noAdjustmentMonths: "12", page: "2", pageSize: "10" });
    for (const request of backend.requests) expect(request.headers.authorization).toBe(`Bearer ${SAMPLE_TOKEN}`);
  });

  it("maps an off-contract body and a backend outage to distinct failures", async () => {
    const backend = fakeFetch(jsonResponse(200, { figures: "lots" }), errorResponse(503, "SERVICE_UNAVAILABLE"));
    const api = createApiClient({ fetch: backend.fetch, env, logger: () => {} });
    expect(await api.getDashboardSummary(SAMPLE_TOKEN, dashboardApiQueries({}).summary)).toEqual({ ok: false, kind: "INVALID_RESPONSE", status: 200 });
    expect(await api.getDashboardBreakdown(SAMPLE_TOKEN, dashboardApiQueries({}).breakdown)).toEqual({ ok: false, kind: "SERVICE_UNAVAILABLE", status: 503 });
  });
});
