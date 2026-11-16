import 'server-only';

import Ajv2020 from 'ajv/dist/2020';

import contract from '@/generated/api-openapi.json';
import {
  BREAKDOWN_KEYS,
  BREAKDOWN_TO_API,
  COUNTRIES,
  CURRENCIES,
  DEPARTMENTS,
  LEVELS,
  NO_ADJUSTMENT_MONTHS,
  RECENT_DAYS,
  STATUSES,
  isOneOf,
  type DashboardQuery,
} from '@/lib/dashboard-url';
import { FILTER_KEYS, isSalarySort, type DirectoryQuery } from '@/lib/directory-url';
import type { RequestListQuery } from '@/lib/salary';

// Reads page URL state using the query-parameter schemas in the generated contract, so the
// accepted names, enums, and bounds are the backend's own.

type ParameterSpec = { name: string; in: string; schema: Record<string, unknown> };
type SearchParams = Record<string, string | string[] | undefined>;

const ajv = new Ajv2020({ strict: false });
const paths = contract.paths as unknown as Record<string, { get?: { parameters?: ParameterSpec[] } }>;

function validatorsFor(path: string) {
  const parameters = (paths[path]?.get?.parameters ?? []).filter((p) => p.in === 'query');
  return new Map(parameters.map((p) => [p.name, { schema: p.schema, validate: ajv.compile(p.schema) }]));
}

const directoryValidators = validatorsFor('/api/v1/employees');
const requestListValidators = validatorsFor('/api/v1/salary-adjustment-requests');

export const DIRECTORY_PARAMETER_NAMES: readonly string[] = [...directoryValidators.keys()];

export type ParsedQuery<T> = {
  query: T;
  /** Names of known parameters whose values the backend would reject. */
  invalid: string[];
};

function parseWith(validators: ReturnType<typeof validatorsFor>, searchParams: SearchParams): ParsedQuery<Record<string, string | number>> {
  const query: Record<string, string | number> = {};
  const invalid: string[] = [];

  for (const [name, { schema, validate }] of validators) {
    const raw = searchParams[name];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      invalid.push(name);
      continue;
    }
    const text = name === 'q' ? raw.trim() : raw;
    if (text === '') continue;
    let value: string | number = text;
    if (schema.type === 'integer') {
      if (!/^[1-9][0-9]{0,6}$/.test(text)) {
        invalid.push(name);
        continue;
      }
      value = Number(text);
    }
    if (!validate(value)) {
      invalid.push(name);
      continue;
    }
    query[name] = value;
  }
  return { query, invalid };
}

export type ParsedDirectoryQuery = ParsedQuery<DirectoryQuery>;

export function parseDirectoryQuery(searchParams: SearchParams): ParsedDirectoryQuery {
  const { query, invalid } = parseWith(directoryValidators, searchParams);
  const parsed = query as DirectoryQuery;
  if (isSalarySort(parsed.sort)) parsed.comparisonCurrency = 'USD';
  else delete parsed.comparisonCurrency;
  return { query: parsed, invalid };
}

export function parseRequestListQuery(searchParams: SearchParams): ParsedQuery<RequestListQuery> {
  const { query, invalid } = parseWith(requestListValidators, searchParams);
  return { query: query as RequestListQuery, invalid };
}

// Dashboard URL state. Each frontend name maps to one backend parameter, and each value is
// checked with that parameter's schema from the contract before any analytics call is made.
const dashboardSummaryValidators = validatorsFor('/api/v1/dashboard/summary');
const dashboardBreakdownValidators = validatorsFor('/api/v1/dashboard/breakdowns');
const dashboardWithoutValidators = validatorsFor('/api/v1/dashboard/without-recent-adjustment');

function validatesAs(validators: ReturnType<typeof validatorsFor>, apiName: string, value: string | number): boolean {
  const entry = validators.get(apiName);
  return entry !== undefined && entry.validate(value) === true;
}

/** Frontend dashboard parameter names; anything else in the URL is ignored, as in the directory. */
export const DASHBOARD_PARAMETER_NAMES = [
  ...FILTER_KEYS,
  'recentDays',
  'noAdjustmentMonths',
  'breakdown',
  'noAdjustmentPage',
  'usd',
] as const;

export function parseDashboardQuery(searchParams: SearchParams): ParsedQuery<DashboardQuery> {
  const query: DashboardQuery = {};
  const invalid: string[] = [];

  for (const name of DASHBOARD_PARAMETER_NAMES) {
    const raw = searchParams[name];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      invalid.push(name);
      continue;
    }
    if (raw === '') continue;
    let ok = false;
    switch (name) {
      case 'department':
        ok = validatesAs(dashboardSummaryValidators, 'department', raw) && isOneOf(DEPARTMENTS, raw);
        if (ok && isOneOf(DEPARTMENTS, raw)) query.department = raw;
        break;
      case 'country':
        ok = validatesAs(dashboardSummaryValidators, 'country', raw) && isOneOf(COUNTRIES, raw);
        if (ok && isOneOf(COUNTRIES, raw)) query.country = raw;
        break;
      case 'currency':
        ok = validatesAs(dashboardSummaryValidators, 'currency', raw) && isOneOf(CURRENCIES, raw);
        if (ok && isOneOf(CURRENCIES, raw)) query.currency = raw;
        break;
      case 'level':
        ok = validatesAs(dashboardSummaryValidators, 'level', raw) && isOneOf(LEVELS, raw);
        if (ok && isOneOf(LEVELS, raw)) query.level = raw;
        break;
      case 'status':
        ok = validatesAs(dashboardSummaryValidators, 'employmentStatus', raw) && isOneOf(STATUSES, raw);
        if (ok && isOneOf(STATUSES, raw)) query.status = raw;
        break;
      case 'recentDays':
        ok = validatesAs(dashboardSummaryValidators, 'periodDays', raw) && isOneOf(RECENT_DAYS, raw);
        if (ok && isOneOf(RECENT_DAYS, raw)) query.recentDays = raw;
        break;
      case 'noAdjustmentMonths':
        ok = validatesAs(dashboardSummaryValidators, 'noAdjustmentMonths', raw) && isOneOf(NO_ADJUSTMENT_MONTHS, raw);
        if (ok && isOneOf(NO_ADJUSTMENT_MONTHS, raw)) query.noAdjustmentMonths = raw;
        break;
      case 'breakdown':
        ok = isOneOf(BREAKDOWN_KEYS, raw) && validatesAs(dashboardBreakdownValidators, 'breakdown', BREAKDOWN_TO_API[raw]);
        if (ok && isOneOf(BREAKDOWN_KEYS, raw)) query.breakdown = raw;
        break;
      case 'noAdjustmentPage':
        ok = /^[1-9][0-9]{0,6}$/.test(raw) && validatesAs(dashboardWithoutValidators, 'page', Number(raw));
        if (ok) query.noAdjustmentPage = Number(raw);
        break;
      case 'usd':
        ok = raw === '1';
        if (ok) query.usd = true;
        break;
    }
    if (!ok) invalid.push(name);
  }
  return { query, invalid };
}
