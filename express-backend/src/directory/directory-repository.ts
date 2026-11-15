// Employee directory queries: raw SQL over mysql2.
//
// Every query applies the caller's scope in its WHERE clause, so rows, counts,
// search, options, detail, and history never see a hidden employee. Sorting,
// LIMIT, and OFFSET run in MySQL; Node.js only maps the page it receives.
//
// All values are placeholders. The only SQL text that varies is chosen from
// fixed allowlists (sort columns, direction, which conditions are present).
import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../access/sessions.js';
import type {
  CompensationState,
  DirectoryOptionsResponse,
  DirectoryQuery,
  DirectoryResponse,
  EmployeeDetailResponse,
  SortField,
} from '../http/contract.js';
import { SALARY_SORT_FIELDS, SORT_FIELDS } from '../http/contract.js';
import { addMoney, convertToUsd } from '../money/decimal.js';
import {
  CURRENCIES,
  DEPARTMENTS,
  EMPLOYMENT_STATUSES,
  LEVELS,
} from '../source-workbook/constants.js';
import type {
  ChangeReason,
  CountryCode,
  Currency,
  Department,
  EmploymentStatus,
  Level,
  PayFrequency,
} from '../source-workbook/constants.js';
import type { ExchangeRateSnapshot } from './exchange-rate.js';

/**
 * LIKE-escapes user text so "%", "_" and "\" match themselves.
 * MySQL's default LIKE escape character is "\"; it is escaped first.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** A salary sort was requested but INR rows cannot be converted. */
export class SalarySortUnavailableError extends Error {
  readonly code = 'SALARY_SORT_UNAVAILABLE';

  constructor() {
    super('Salary sorting is unavailable: no saved INR exchange rate.');
    this.name = 'SalarySortUnavailableError';
  }
}

export interface DirectoryService {
  list(principal: Principal, query: DirectoryQuery): Promise<DirectoryResponse>;
  /** Null for an unknown, malformed, or out-of-scope code: callers cannot tell which. */
  detail(principal: Principal, employeeCode: string): Promise<EmployeeDetailResponse | null>;
  options(principal: Principal): Promise<DirectoryOptionsResponse>;
}

export type Params = unknown[];
export interface Fragment {
  sql: string;
  params: Params;
}

const EMPLOYEE_CODE = /^ACME[0-9]{5}$/;
const CODE_SEARCH = /^[A-Za-z0-9]+$/;

const STATE_BY_STATUS: Readonly<Record<EmploymentStatus, CompensationState>> = Object.freeze({
  CURRENTLY_WORKING: 'CURRENT',
  SOON_TO_JOIN: 'UPCOMING',
  LEFT: 'HISTORICAL',
});

export const FROM_EMPLOYEES = `FROM employees e
  JOIN job_titles jt ON jt.id = e.job_title_id
  JOIN departments d ON d.id = jt.department_id`;

/**
 * The one selected compensation record per employee (params: asOf, asOf).
 *   CURRENTLY_WORKING: latest effective_from <= as-of date.
 *   SOON_TO_JOIN:      earliest effective_from > as-of date.
 *   LEFT:              latest effective_from <= employment_end_date.
 * Same effective date: the higher version wins. Served by
 * idx_compensation_employee_effective (employee_id, effective_from, version).
 */
export const SELECTED_COMPENSATION = `LEFT JOIN LATERAL (
    SELECT c.version, c.annual_base_salary, c.annual_bonus, c.currency, c.pay_frequency, c.effective_from
    FROM compensation_records c
    WHERE c.employee_id = e.id
      AND CASE e.employment_status
            WHEN 'CURRENTLY_WORKING' THEN c.effective_from <= ?
            WHEN 'SOON_TO_JOIN' THEN c.effective_from > ?
            WHEN 'LEFT' THEN c.effective_from <= e.employment_end_date
          END
    ORDER BY CASE WHEN e.employment_status = 'SOON_TO_JOIN' THEN c.effective_from END ASC,
             c.effective_from DESC,
             c.version DESC
    LIMIT 1
  ) sc ON TRUE`;

/**
 * Exact USD value for sorting (param: the INR-per-USD rate as a decimal
 * string). DECIMAL division keeps only div_precision_increment (default 4)
 * extra digits, so each query that uses it raises that to 30 with SET_VAR.
 */
export const usdExpression = (amount: string): string =>
  `CASE sc.currency WHEN 'USD' THEN ${amount} WHEN 'INR' THEN ${amount} / CAST(? AS DECIMAL(20, 10)) END`;
const SALARY_AMOUNT: Readonly<Record<(typeof SALARY_SORT_FIELDS)[number], string>> = Object.freeze({
  annualBaseSalary: 'sc.annual_base_salary',
  annualCashCompensation: '(sc.annual_base_salary + sc.annual_bonus)',
});

/** Allowlisted ORDER BY columns for non-salary sorts. */
const SORT_COLUMNS: Readonly<Record<Exclude<SortField, (typeof SALARY_SORT_FIELDS)[number]>, readonly string[]>> = Object.freeze({
  name: ['e.first_name', 'e.last_name'],
  employeeCode: ['e.employee_code'],
  department: ['d.name'],
  country: ['e.country_code'],
  // ENUM columns sort by declaration order: JUNIOR < MID < SENIOR < LEAD < MANAGER.
  level: ['jt.level'],
  hireDate: ['e.hire_date'],
});

const isSalarySort = (sort: SortField): sort is (typeof SALARY_SORT_FIELDS)[number] =>
  (SALARY_SORT_FIELDS as readonly string[]).includes(sort);

/** Scope as a WHERE fragment. Fails closed for anything but an ACTIVE Admin or Scoped user. */
export function scopeCondition(principal: Pick<Principal, 'role' | 'status' | 'countries' | 'departments'>): Fragment {
  if (principal.status !== 'ACTIVE') return { sql: 'FALSE', params: [] };
  if (principal.role === 'ADMIN') return { sql: 'TRUE', params: [] };
  if (principal.role !== 'SCOPED' || principal.countries.length === 0 || principal.departments.length === 0) {
    return { sql: 'FALSE', params: [] };
  }
  // mysql2 expands an array placeholder to a quoted, comma-separated list.
  return { sql: 'e.country_code IN (?) AND d.name IN (?)', params: [[...principal.countries], [...principal.departments]] };
}

function searchCondition(q: string): Fragment {
  const contains = `%${escapeLike(q)}%`;
  const conditions = [
    'e.first_name LIKE ?',
    'e.last_name LIKE ?',
    "CONCAT(e.first_name, ' ', e.last_name) LIKE ?",
    // utf8mb4_0900_ai_ci: case-insensitive exact match.
    'e.email = ?',
  ];
  const params: Params = [contains, contains, contains, q];
  // employee_code is ASCII with a binary collation: match codes in upper case,
  // and only for text that could be part of a code.
  if (CODE_SEARCH.test(q)) {
    conditions.unshift('e.employee_code LIKE ?');
    params.unshift(`${escapeLike(q.toUpperCase())}%`);
  }
  return { sql: `(${conditions.join(' OR ')})`, params };
}

interface Where extends Fragment {
  needsCompensation: boolean;
}

function whereClause(principal: Principal, query: DirectoryQuery): Where {
  const parts: Fragment[] = [scopeCondition(principal)];
  if (query.q !== undefined) parts.push(searchCondition(query.q));
  if (query.department !== undefined) parts.push({ sql: 'd.name = ?', params: [query.department] });
  if (query.country !== undefined) parts.push({ sql: 'e.country_code = ?', params: [query.country] });
  if (query.level !== undefined) parts.push({ sql: 'jt.level = ?', params: [query.level] });
  if (query.status !== undefined) parts.push({ sql: 'e.employment_status = ?', params: [query.status] });
  if (query.currency !== undefined) parts.push({ sql: 'sc.currency = ?', params: [query.currency] });
  return {
    sql: parts.map((p) => p.sql).join(' AND '),
    params: parts.flatMap((p) => p.params),
    needsCompensation: query.currency !== undefined,
  };
}

interface EmployeeRow extends RowDataPacket {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: Department;
  job_title: string;
  level: Level;
  country_code: CountryCode;
  employment_status: EmploymentStatus;
  hire_date: string;
  employment_end_date: string | null;
  employee_version: number;
  comp_version: number | null;
  annual_base_salary: string | null;
  annual_bonus: string | null;
  currency: Currency | null;
  pay_frequency: PayFrequency | null;
  effective_from: string | null;
}
interface CountRow extends RowDataPacket {
  n: string;
}
interface HistoryRow extends RowDataPacket {
  version: number;
  annual_base_salary: string;
  annual_bonus: string;
  currency: Currency;
  pay_frequency: PayFrequency;
  effective_from: string;
  change_reason: ChangeReason;
}
interface OptionRow extends RowDataPacket {
  department: Department;
  country_code: CountryCode;
  country_name: string;
  level: Level;
  employment_status: EmploymentStatus;
  currency: Currency | null;
}

const EMPLOYEE_COLUMNS = `e.employee_code, e.first_name, e.last_name, e.email, d.name AS department, jt.name AS job_title,
  jt.level, e.country_code, e.employment_status, e.hire_date, e.employment_end_date, e.version AS employee_version,
  sc.version AS comp_version, sc.annual_base_salary, sc.annual_bonus, sc.currency, sc.pay_frequency, sc.effective_from`;

/** UTC calendar date of the injected clock. */
export const isoDate = (instant: Date): string => instant.toISOString().slice(0, 10);

export interface ListQueries {
  rows: Fragment;
  count: Fragment;
  comparison: DirectoryResponse['sort']['comparison'];
}

/**
 * The page query and the count query for one directory request. Pure, so the
 * measurement script can EXPLAIN exactly what the service runs.
 * Throws SalarySortUnavailableError for a salary sort that would need a missing INR rate.
 */
export function buildListQueries(
  principal: Principal,
  query: DirectoryQuery,
  { asOf, exchangeRate }: { asOf: string; exchangeRate: ExchangeRateSnapshot | null },
): ListQueries {
  const where = whereClause(principal, query);
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC';

  let hint = '';
  let sortSelect = '';
  let sortParams: Params = [];
  let orderBy: string;
  let comparison: ListQueries['comparison'] = null;
  if (isSalarySort(query.sort)) {
    if (exchangeRate === null && query.currency !== 'USD') throw new SalarySortUnavailableError();
    hint = '/*+ SET_VAR(div_precision_increment = 30) */';
    sortSelect = `, ${usdExpression(SALARY_AMOUNT[query.sort])} AS sort_usd`;
    sortParams = [exchangeRate?.rate ?? null];
    // Rows without a selected record sort last in both directions.
    orderBy = `sort_usd IS NULL, sort_usd ${direction}, e.employee_code ASC`;
    comparison = { currency: 'USD', exchangeRate };
  } else {
    orderBy = [...SORT_COLUMNS[query.sort].map((c) => `${c} ${direction}`), 'e.employee_code ASC'].join(', ');
  }

  const offset = (query.page - 1) * query.pageSize;
  return {
    rows: {
      sql: `SELECT ${hint} ${EMPLOYEE_COLUMNS}${sortSelect}
       ${FROM_EMPLOYEES}
       ${SELECTED_COMPENSATION}
       WHERE ${where.sql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      params: [...sortParams, asOf, asOf, ...where.params, query.pageSize, offset],
    },
    count: {
      sql: `SELECT COUNT(*) AS n ${FROM_EMPLOYEES} ${where.needsCompensation ? SELECTED_COMPENSATION : ''} WHERE ${where.sql}`,
      params: [...(where.needsCompensation ? [asOf, asOf] : []), ...where.params],
    },
    comparison,
  };
}

export function createDirectoryService({ pool, exchangeRate, clock = () => new Date() }: {
  pool: Pool;
  /** The saved snapshot, or null when none is loaded (INR has no USD equivalent; salary sort is rejected). */
  exchangeRate: ExchangeRateSnapshot | null;
  clock?: () => Date;
}): DirectoryService {
  function usdEquivalent(base: string, cash: string, currency: Currency) {
    const usdBase = convertToUsd(base, currency, exchangeRate);
    const usdCash = convertToUsd(cash, currency, exchangeRate);
    return usdBase === null || usdCash === null ? null : { annualBaseSalary: usdBase, annualCashCompensation: usdCash };
  }

  function selectedCompensation(row: EmployeeRow) {
    if (row.comp_version === null || row.annual_base_salary === null || row.annual_bonus === null
      || row.currency === null || row.pay_frequency === null || row.effective_from === null) return null;
    const cash = addMoney(row.annual_base_salary, row.annual_bonus);
    return {
      state: STATE_BY_STATUS[row.employment_status],
      version: row.comp_version,
      annualBaseSalary: row.annual_base_salary,
      annualBonus: row.annual_bonus,
      annualCashCompensation: cash,
      currency: row.currency,
      payFrequency: row.pay_frequency,
      effectiveFrom: row.effective_from,
      usdEquivalent: usdEquivalent(row.annual_base_salary, cash, row.currency),
    };
  }

  const summary = (row: EmployeeRow) => ({
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    department: row.department,
    jobTitle: row.job_title,
    level: row.level,
    country: row.country_code,
    employmentStatus: row.employment_status,
    hireDate: row.hire_date,
  });

  async function list(principal: Principal, query: DirectoryQuery): Promise<DirectoryResponse> {
    const built = buildListQueries(principal, query, { asOf: isoDate(clock()), exchangeRate });
    const [rows] = await pool.query<EmployeeRow[]>(built.rows.sql, built.rows.params);
    const [countRows] = await pool.query<CountRow[]>(built.count.sql, built.count.params);
    const totalRows = Number(countRows[0]?.n ?? 0);

    return {
      employees: rows.map((row) => ({ ...summary(row), compensation: selectedCompensation(row) })),
      page: { number: query.page, size: query.pageSize, totalRows, totalPages: Math.ceil(totalRows / query.pageSize) },
      sort: { field: query.sort, direction: query.direction, comparison: built.comparison },
      exchangeRate,
    };
  }

  async function detail(principal: Principal, employeeCode: string): Promise<EmployeeDetailResponse | null> {
    if (!EMPLOYEE_CODE.test(employeeCode)) return null;
    const asOf = isoDate(clock());
    const scope = scopeCondition(principal);
    const [rows] = await pool.query<(EmployeeRow & { id: number })[]>(
      `SELECT e.id, ${EMPLOYEE_COLUMNS}
       ${FROM_EMPLOYEES}
       ${SELECTED_COMPENSATION}
       WHERE e.employee_code = ? AND ${scope.sql}`,
      [asOf, asOf, employeeCode, ...scope.params],
    );
    const row = rows[0];
    if (row === undefined) return null;
    // Scope was checked on the employee row above; history is read by its internal ID only.
    const [history] = await pool.query<HistoryRow[]>(
      `SELECT version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason
       FROM compensation_records WHERE employee_id = ? ORDER BY effective_from ASC, version ASC`,
      [row.id],
    );
    return {
      employee: { ...summary(row), employmentEndDate: row.employment_end_date, version: row.employee_version },
      compensation: selectedCompensation(row),
      compensationHistory: history.map((h) => ({
        version: h.version,
        annualBaseSalary: h.annual_base_salary,
        annualBonus: h.annual_bonus,
        annualCashCompensation: addMoney(h.annual_base_salary, h.annual_bonus),
        currency: h.currency,
        payFrequency: h.pay_frequency,
        effectiveFrom: h.effective_from,
        changeReason: h.change_reason,
      })),
      exchangeRate,
    };
  }

  async function options(principal: Principal): Promise<DirectoryOptionsResponse> {
    const asOf = isoDate(clock());
    const scope = scopeCondition(principal);
    // At most 5 x 2 x 5 x 3 x 2 distinct combinations.
    const [rows] = await pool.query<OptionRow[]>(
      `SELECT DISTINCT d.name AS department, e.country_code, co.name AS country_name, jt.level, e.employment_status, sc.currency
       ${FROM_EMPLOYEES}
       JOIN countries co ON co.code = e.country_code
       ${SELECTED_COMPENSATION}
       WHERE ${scope.sql}`,
      [asOf, asOf, ...scope.params],
    );
    const present = <T>(values: readonly T[], pick: (row: OptionRow) => T | null): T[] => {
      const seen = new Set(rows.map(pick));
      return values.filter((v) => seen.has(v));
    };
    const countries = new Map(rows.map((r) => [r.country_code, r.country_name]));
    const salarySortAvailable = exchangeRate !== null;
    return {
      departments: present([...DEPARTMENTS].sort(), (r) => r.department),
      countries: [...countries].sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name })),
      currencies: present(CURRENCIES, (r) => r.currency),
      levels: present(LEVELS, (r) => r.level),
      statuses: present(EMPLOYMENT_STATUSES, (r) => r.employment_status),
      sortFields: SORT_FIELDS.filter((f) => salarySortAvailable || !isSalarySort(f)),
      comparisonCurrencies: salarySortAvailable ? ['USD'] : [],
    };
  }

  return { list, detail, options };
}
