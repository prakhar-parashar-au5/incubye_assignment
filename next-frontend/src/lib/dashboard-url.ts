import type { operations } from "@/generated/api";
import { FILTER_KEYS, directoryHref, type DirectoryQuery, type FilterKey } from "@/lib/directory-url";

// Dashboard URL state. Pure functions shared by the server page and the client controls.
//
// The frontend keeps the directory's names for the five global filters (`status`, not
// `employmentStatus`) and its own name for the recent-change period (`recentDays`), so links
// between the dashboard and the directory read the same. Every backend call goes through the
// explicit mapping below; the value types come from the generated contract.

type SummaryQuery = NonNullable<operations["getDashboardSummary"]["parameters"]["query"]>;
type BreakdownQuery = NonNullable<operations["getDashboardBreakdown"]["parameters"]["query"]>;
type RecentQuery = NonNullable<operations["getDashboardRecentChanges"]["parameters"]["query"]>;
type WithoutQuery = NonNullable<operations["getDashboardWithoutRecentAdjustment"]["parameters"]["query"]>;
export type DashboardApiQueries = { summary: SummaryQuery; breakdown: BreakdownQuery; recent: RecentQuery; without: WithoutQuery };

export type RecentDays = NonNullable<SummaryQuery["periodDays"]>;
export type NoAdjustmentMonths = NonNullable<SummaryQuery["noAdjustmentMonths"]>;
export type ApiBreakdown = NonNullable<BreakdownQuery["breakdown"]>;
export type BreakdownKey = "department" | "country" | "currency" | "level" | "status";

export type DashboardQuery = Pick<DirectoryQuery, FilterKey> & {
  recentDays?: RecentDays;
  noAdjustmentMonths?: NoAdjustmentMonths;
  breakdown?: BreakdownKey;
  /** Page of the without-adjustment list. */
  noAdjustmentPage?: number;
  /** Show the optional USD comparison columns. */
  usd?: boolean;
};

// Allowed values. tests/unit/dashboard.test.ts asserts each list equals the contract enum.
export const DEPARTMENTS: readonly NonNullable<DirectoryQuery["department"]>[] = ["Tech", "HR", "Finance", "Operations", "Support"];
export const COUNTRIES: readonly NonNullable<DirectoryQuery["country"]>[] = ["IN", "US"];
export const CURRENCIES: readonly NonNullable<DirectoryQuery["currency"]>[] = ["INR", "USD"];
export const LEVELS: readonly NonNullable<DirectoryQuery["level"]>[] = ["JUNIOR", "MID", "SENIOR", "LEAD", "MANAGER"];
export const STATUSES: readonly NonNullable<DirectoryQuery["status"]>[] = ["SOON_TO_JOIN", "CURRENTLY_WORKING", "LEFT"];
export const RECENT_DAYS: readonly RecentDays[] = ["7", "30", "90"];
export const NO_ADJUSTMENT_MONTHS: readonly NoAdjustmentMonths[] = ["3", "6", "12", "24"];
export const BREAKDOWN_KEYS: readonly BreakdownKey[] = ["department", "country", "currency", "level", "status"];

// Contract defaults, left out of URLs so /dashboard and the default view are the same address.
export const DEFAULT_RECENT_DAYS: RecentDays = "30";
export const DEFAULT_NO_ADJUSTMENT_MONTHS: NoAdjustmentMonths = "12";
export const DEFAULT_BREAKDOWN: BreakdownKey = "department";

/** Rows per list on the dashboard. It is an overview; the full records live in their own pages. */
export const DASHBOARD_LIST_SIZE = 10;

export const BREAKDOWN_TO_API: Record<BreakdownKey, ApiBreakdown> = {
  department: "DEPARTMENT",
  country: "COUNTRY",
  currency: "CURRENCY",
  level: "LEVEL",
  status: "EMPLOYMENT_STATUS",
};

export const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  department: "Department",
  country: "Country",
  currency: "Currency",
  level: "Level",
  status: "Employment status",
};

/** True when `value` is one of `list`; narrows a URL string to the contract type. */
export function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Query string for a dashboard state, without defaults or empty values. */
export function dashboardSearch(query: DashboardQuery): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.recentDays && query.recentDays !== DEFAULT_RECENT_DAYS) params.set("recentDays", query.recentDays);
  if (query.noAdjustmentMonths && query.noAdjustmentMonths !== DEFAULT_NO_ADJUSTMENT_MONTHS) params.set("noAdjustmentMonths", query.noAdjustmentMonths);
  if (query.breakdown && query.breakdown !== DEFAULT_BREAKDOWN) params.set("breakdown", query.breakdown);
  if (query.noAdjustmentPage && query.noAdjustmentPage > 1) params.set("noAdjustmentPage", String(query.noAdjustmentPage));
  if (query.usd) params.set("usd", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function dashboardHref(query: DashboardQuery): string {
  return `/dashboard${dashboardSearch(query)}`;
}

/**
 * A new state from the current one. A change to a global filter or to the without-adjustment
 * period returns that list to page 1, because the old page number means nothing for a different
 * result set. Switching the breakdown, the recent period, or USD comparison keeps the page.
 */
export function withDashboardChanges(query: DashboardQuery, changes: Partial<DashboardQuery>): DashboardQuery {
  const next: DashboardQuery = { ...query, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === false || (typeof value === "string" && value.length === 0)) delete next[key as keyof DashboardQuery];
  }
  const resetsPage = Object.keys(changes).some((key) => isOneOf<string>(FILTER_KEYS, key) || key === "noAdjustmentMonths");
  if (resetsPage) delete next.noAdjustmentPage;
  return next;
}

export function clearDashboardFilters(query: DashboardQuery): DashboardQuery {
  return withDashboardChanges(query, { department: undefined, country: undefined, currency: undefined, level: undefined, status: undefined });
}

export function hasDashboardFilters(query: DashboardQuery): boolean {
  return FILTER_KEYS.some((key) => query[key]);
}

function filterParams(query: DashboardQuery) {
  return {
    department: query.department,
    country: query.country,
    currency: query.currency,
    level: query.level,
    // The one name that differs: the frontend's `status` is the backend's `employmentStatus`.
    employmentStatus: query.status,
  };
}

/** The exact query each dashboard endpoint receives. Unset values are dropped by the client. */
export function dashboardApiQueries(query: DashboardQuery): DashboardApiQueries {
  const filters = filterParams(query);
  return {
    summary: { ...filters, periodDays: query.recentDays ?? DEFAULT_RECENT_DAYS, noAdjustmentMonths: query.noAdjustmentMonths ?? DEFAULT_NO_ADJUSTMENT_MONTHS },
    breakdown: { ...filters, breakdown: BREAKDOWN_TO_API[query.breakdown ?? DEFAULT_BREAKDOWN] },
    recent: { ...filters, periodDays: query.recentDays ?? DEFAULT_RECENT_DAYS, page: 1, pageSize: DASHBOARD_LIST_SIZE },
    without: {
      ...filters,
      noAdjustmentMonths: query.noAdjustmentMonths ?? DEFAULT_NO_ADJUSTMENT_MONTHS,
      page: query.noAdjustmentPage ?? 1,
      pageSize: DASHBOARD_LIST_SIZE,
    },
  };
}

/** The employee directory with the dashboard's global filters, plus any overrides. */
export function directoryLinkFor(query: DashboardQuery, overrides: Partial<Pick<DirectoryQuery, FilterKey>> = {}): string {
  const filters: DirectoryQuery = {};
  for (const key of FILTER_KEYS) {
    const value = key in overrides ? overrides[key] : query[key];
    if (value) Object.assign(filters, { [key]: value });
  }
  return directoryHref(filters);
}

/** Employee detail, returning to this exact dashboard view. */
export function employeeLinkFor(employeeCode: string, query: DashboardQuery): string {
  return `/employees/${encodeURIComponent(employeeCode)}?from=${encodeURIComponent(dashboardHref(query))}`;
}

export type RequestListLink = {
  href: string;
  /** Plain-language note when some dashboard filters cannot be carried to the request list. */
  note: string | null;
};

/**
 * The salary request list for a status, carrying only the filters it supports. The list accepts
 * `department` from Admin HR only, and has no country, currency, level, or employment-status
 * filter, so those are named instead of being dropped silently.
 */
export function requestListLinkFor(query: DashboardQuery, status: "PENDING" | "STALE", isAdmin: boolean): RequestListLink {
  const params = new URLSearchParams({ status });
  if (status === "PENDING") params.set("direction", "asc");
  if (isAdmin && query.department) params.set("department", query.department);
  const dropped: string[] = [];
  if (!isAdmin && query.department) dropped.push("department");
  if (query.country) dropped.push("country");
  if (query.currency) dropped.push("currency");
  if (query.level) dropped.push("level");
  if (query.status) dropped.push("employment status");
  const note =
    dropped.length === 0
      ? null
      : isAdmin
        ? `The request list keeps only the department filter, so it does not filter by ${joinList(dropped)}.`
        : `The request list does not filter by ${joinList(dropped)}; it shows every request in your access.`;
  return { href: `/salary-requests?${params.toString()}`, note };
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
}

/**
 * Width of a presentation-only bar as a percentage of the largest value in the same chart.
 * Inputs are the backend's exact decimal strings or counts; the result only sizes a decorative
 * bar whose exact value is printed next to it, so a binary float is acceptable here.
 */
export function barPercent(value: string | number, max: string | number): number {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0 || v <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((v / m) * 1000) / 10));
}
