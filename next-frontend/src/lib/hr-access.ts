import type { operations } from '@/generated/api';
import type { HrUserDetail, HrUserView } from '@/server/api/contract';

export type HrAccessQuery = NonNullable<operations['listHrUsers']['parameters']['query']>;
type SearchParams = Record<string, string | string[] | undefined>;
type HrSort = NonNullable<HrAccessQuery['sort']>;
type HrDirection = NonNullable<HrAccessQuery['direction']>;
const countries = ['IN', 'US'] as const;
const departments = ['Tech', 'HR', 'Finance', 'Operations', 'Support'] as const;
const sorts = ['updatedAt', 'name', 'email'] as const;
const roles = ['ADMIN', 'SCOPED'] as const;
const statuses = ['ACTIVE', 'INACTIVE', 'ALL'] as const;
const QUERY_KEYS = ['q', 'role', 'status', 'country', 'department', 'sort', 'direction', 'page', 'pageSize'] as const;

/**
 * The one default-direction rule, used by both the parser and the serializer: newest first for
 * Last updated, A to Z for name and email. (The backend uses the same defaults.)
 */
export function defaultHrDirection(sort: HrSort | undefined): HrDirection {
  return (sort ?? 'updatedAt') === 'updatedAt' ? 'desc' : 'asc';
}

/**
 * Reads list URL state. An empty value (`role=`) means "not set", as in the employee directory,
 * so a submitted form with blank filters is a normal unfiltered query. Unknown names, repeated
 * names, and values outside the contract enums are reported as invalid, and the page then makes
 * no backend request.
 */
export function parseHrAccessQuery(raw: SearchParams): { query: HrAccessQuery; invalid: string[] } {
  const invalid: string[] = [];
  const values: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(QUERY_KEYS as readonly string[]).includes(key)) {
      invalid.push(key);
      continue;
    }
    if (Array.isArray(value)) invalid.push(key);
    else if (value !== undefined && value.trim() !== '') values[key] = value;
  }
  const query: HrAccessQuery = { page: 1, pageSize: 25, sort: 'updatedAt' };
  // The contract allows at most 100 characters; a longer search is an invalid link, not an outage.
  if (values.q !== undefined) { if (values.q.trim().length <= 100) query.q = values.q.trim(); else invalid.push('q'); }
  if (values.role !== undefined) { if (roles.includes(values.role as (typeof roles)[number])) query.role = values.role as HrAccessQuery['role']; else invalid.push('role'); }
  if (values.status !== undefined) { if (statuses.includes(values.status as (typeof statuses)[number])) query.status = values.status as HrAccessQuery['status']; else invalid.push('status'); }
  if (values.country !== undefined) { if (countries.includes(values.country as (typeof countries)[number])) query.country = values.country as HrAccessQuery['country']; else invalid.push('country'); }
  if (values.department !== undefined) { if (departments.includes(values.department as (typeof departments)[number])) query.department = values.department as HrAccessQuery['department']; else invalid.push('department'); }
  if (values.sort !== undefined) { if (sorts.includes(values.sort as (typeof sorts)[number])) query.sort = values.sort as HrAccessQuery['sort']; else invalid.push('sort'); }
  if (values.direction !== undefined) { if (values.direction === 'asc' || values.direction === 'desc') query.direction = values.direction; else invalid.push('direction'); }
  if (query.direction === undefined) query.direction = defaultHrDirection(query.sort);
  for (const key of ['page', 'pageSize'] as const) {
    const value = values[key];
    if (value !== undefined) {
      const number = Number(value);
      const max = key === 'page' ? Number.MAX_SAFE_INTEGER : 100;
      if (!/^\d+$/.test(value) || number < 1 || number > max) invalid.push(key);
      else query[key] = number;
    }
  }
  return { query, invalid: [...new Set(invalid)] };
}

/** Query string for a list state: each key once, only set values, defaults left out. */
export function hrAccessSearch(query: HrAccessQuery): string {
  const params = new URLSearchParams();
  const defaults: Partial<Record<(typeof QUERY_KEYS)[number], string | number>> = {
    status: 'ACTIVE',
    sort: 'updatedAt',
    direction: defaultHrDirection(query.sort),
    page: 1,
    pageSize: 25,
  };
  for (const key of QUERY_KEYS) {
    const value = key === 'q' ? query.q?.trim() : query[key];
    if (value !== undefined && value !== '' && value !== defaults[key]) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * The list state a submitted search or filter form asks for: the current state with the form's
 * fields applied, blank fields cleared, and the page reset. Sort, direction, and page size stay
 * as they were. Used by the list's form so it never sends empty or repeated keys.
 */
export function hrAccessFormQuery(current: HrAccessQuery, form: { get(name: string): FormDataEntryValue | null; has(name: string): boolean }): HrAccessQuery {
  const next: HrAccessQuery = { ...current, page: 1 };
  for (const key of ['q', 'role', 'status', 'country', 'department'] as const) {
    if (!form.has(key)) continue;
    const raw = form.get(key);
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) Object.assign(next, { [key]: value });
    else delete next[key];
  }
  return next;
}

export function hrUserHref(id: number, query?: HrAccessQuery): string {
  return `/hr-access/${id}${query ? `?from=${encodeURIComponent(`/hr-access${hrAccessSearch(query)}`)}` : ''}`;
}
export function countryName(code: string): string { return code === 'IN' ? 'India' : code === 'US' ? 'United States' : code; }
export function roleLabel(role: 'ADMIN' | 'SCOPED'): string { return role === 'ADMIN' ? 'Admin HR' : 'Scoped HR'; }
export function statusLabel(status: 'ACTIVE' | 'INACTIVE'): string { return status === 'ACTIVE' ? 'Active' : 'Inactive'; }
export function accessText(user: Pick<HrUserView, 'role' | 'countries' | 'departments' | 'accessSummary'> | Pick<HrUserDetail, 'role' | 'countries' | 'departments' | 'accessSummary'>): string {
  if (user.role === 'ADMIN') return 'All employees';
  return user.accessSummary.text;
}
export function scopeCrossProduct(selectedCountries: readonly string[], selectedDepartments: readonly string[]): string[] {
  return selectedCountries.flatMap((country) => selectedDepartments.map((department) => `${countryName(country)} + ${department}`));
}
export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    HR_USER_CREATED: 'Created', COUNTRY_SCOPES_CHANGED: 'Country scopes changed', DEPARTMENT_SCOPES_CHANGED: 'Department scopes changed',
    HR_USER_ACTIVATED: 'Reactivated', HR_USER_DEACTIVATED: 'Deactivated', DISPLAY_NAME_CHANGED: 'Display name changed',
    SCOPES_REPLACED: 'Scopes replaced', HR_USER_PROMOTED: 'Promoted to Admin HR', TEMPORARY_PASSWORD_REGENERATED: 'Temporary password regenerated',
  };
  return labels[action] ?? action;
}

/** The service name used in the unavailable state on every HR Access page (QA run 03, D3). */
export const HR_ACCESS_SERVICE = 'HR Access';
