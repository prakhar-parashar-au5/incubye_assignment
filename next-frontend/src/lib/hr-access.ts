import type { operations } from '@/generated/api';
import type { HrUserDetail, HrUserView } from '@/server/api/contract';

export type HrAccessQuery = NonNullable<operations['listHrUsers']['parameters']['query']>;
type SearchParams = Record<string, string | string[] | undefined>;
const countries = ['IN', 'US'] as const;
const departments = ['Tech', 'HR', 'Finance', 'Operations', 'Support'] as const;
const sorts = ['updatedAt', 'name', 'email'] as const;
const roles = ['ADMIN', 'SCOPED'] as const;
const statuses = ['ACTIVE', 'INACTIVE', 'ALL'] as const;

export function parseHrAccessQuery(raw: SearchParams): { query: HrAccessQuery; invalid: string[] } {
  const invalid: string[] = [];
  const values: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!['q', 'role', 'status', 'country', 'department', 'sort', 'direction', 'page', 'pageSize'].includes(key)) {
      invalid.push(key);
      continue;
    }
    if (Array.isArray(value)) invalid.push(key);
    else if (value !== undefined) values[key] = value;
  }
  const query: HrAccessQuery = { page: 1, pageSize: 25, sort: 'updatedAt', direction: 'desc' };
  if (values.q !== undefined && values.q.trim().length <= 254) query.q = values.q.trim(); else if (values.q) invalid.push('q');
  if (values.role !== undefined) { if (roles.includes(values.role as (typeof roles)[number])) query.role = values.role as HrAccessQuery['role']; else invalid.push('role'); }
  if (values.status !== undefined) { if (statuses.includes(values.status as (typeof statuses)[number])) query.status = values.status as HrAccessQuery['status']; else invalid.push('status'); }
  if (values.country !== undefined) { if (countries.includes(values.country as (typeof countries)[number])) query.country = values.country as HrAccessQuery['country']; else invalid.push('country'); }
  if (values.department !== undefined) { if (departments.includes(values.department as (typeof departments)[number])) query.department = values.department as HrAccessQuery['department']; else invalid.push('department'); }
  if (values.sort !== undefined) { if (sorts.includes(values.sort as (typeof sorts)[number])) query.sort = values.sort as HrAccessQuery['sort']; else invalid.push('sort'); }
  if (values.direction !== undefined) { if (values.direction === 'asc' || values.direction === 'desc') query.direction = values.direction; else invalid.push('direction'); }
  else if (query.sort !== 'updatedAt') query.direction = 'asc';
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

export function hrAccessSearch(query: HrAccessQuery): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'role', 'status', 'country', 'department', 'sort', 'direction', 'page', 'pageSize'] as const) {
    const value = query[key];
    const defaultValue = key === 'page' ? 1 : key === 'pageSize' ? 25 : key === 'sort' ? 'updatedAt' : key === 'direction' ? 'desc' : undefined;
    if (value !== undefined && value !== '' && value !== defaultValue) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
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
