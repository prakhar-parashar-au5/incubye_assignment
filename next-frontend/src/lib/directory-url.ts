import type { operations } from "@/generated/api";

// Directory URL state. Pure functions shared by server pages and client controls.
// The value types come from the generated contract; nothing here is a second copy of it.

export type DirectoryQuery = NonNullable<operations["listEmployees"]["parameters"]["query"]>;
export type SortField = NonNullable<DirectoryQuery["sort"]>;
export type FilterKey = "department" | "country" | "currency" | "level" | "status";

export const FILTER_KEYS: readonly FilterKey[] = ["department", "country", "currency", "level", "status"];

// Contract defaults (asserted against the generated contract in tests). Defaults are left out of
// URLs so a plain /employees link and the default view are the same address.
export const DEFAULT_SORT: SortField = "name";
export const DEFAULT_DIRECTION = "asc" as const;
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_CHOICES = [25, 50, 100] as const;

export const SALARY_SORTS: readonly SortField[] = ["annualBaseSalary", "annualCashCompensation"];

export function isSalarySort(sort: SortField | undefined): boolean {
  return sort !== undefined && SALARY_SORTS.includes(sort);
}

/** Query string for a directory state, without defaults or empty values. */
export function directorySearch(query: DirectoryQuery): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.sort && query.sort !== DEFAULT_SORT) params.set("sort", query.sort);
  if (query.direction && query.direction !== DEFAULT_DIRECTION) params.set("direction", query.direction);
  if (query.pageSize && query.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  // Salary sorts compare USD equivalents; the backend requires the comparison currency.
  if (isSalarySort(query.sort)) params.set("comparisonCurrency", "USD");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function directoryHref(query: DirectoryQuery): string {
  return `/employees${directorySearch(query)}`;
}

/**
 * A new state from the current one. Any change other than the page itself returns to page 1,
 * because the old page number means nothing for a different result set.
 */
export function withChanges(query: DirectoryQuery, changes: Partial<DirectoryQuery>): DirectoryQuery {
  const next: DirectoryQuery = { ...query, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "") delete next[key as keyof DirectoryQuery];
  }
  if (!("page" in changes)) delete next.page;
  if (!isSalarySort(next.sort)) delete next.comparisonCurrency;
  return next;
}

export function clearFilters(query: DirectoryQuery): DirectoryQuery {
  return withChanges(query, { q: undefined, department: undefined, country: undefined, currency: undefined, level: undefined, status: undefined });
}

export function hasFilters(query: DirectoryQuery): boolean {
  return Boolean(query.q?.trim()) || FILTER_KEYS.some((key) => query[key]);
}

/**
 * The directory address a detail page may link back to. Only a same-site /employees path is
 * accepted; anything else, including protocol-relative and absolute URLs, becomes /employees.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2000 || !raw.startsWith("/employees") || raw.startsWith("//")) {
    return "/employees";
  }
  let url: URL;
  try {
    url = new URL(raw, "http://return.invalid");
  } catch {
    return "/employees";
  }
  if (url.origin !== "http://return.invalid" || url.pathname !== "/employees") return "/employees";
  return `/employees${url.search}`;
}
