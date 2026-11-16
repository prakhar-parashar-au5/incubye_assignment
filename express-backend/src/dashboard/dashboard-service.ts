// Permission-aware compensation dashboard analytics (docs_human/10-compensation-dashboard.md).
//
// Every figure is one raw SQL aggregate in MySQL. Scope and filters go into
// each WHERE clause, so counts, totals, medians, and lists never see a hidden
// employee, and nothing is filtered after aggregation or pagination. Node.js
// only formats the small aggregate rows and does exact BigInt arithmetic
// (averages, medians, signed totals, USD equivalents). INR and USD are never
// added together; the USD comparison is a separate, optional block.
//
// Compensation selection reuses the directory's SELECTED_COMPENSATION
// (CURRENT / UPCOMING / HISTORICAL by employment status and the as-of date).
import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../access/sessions.js';
import { FROM_EMPLOYEES, SELECTED_COMPENSATION, isoDate, scopeCondition } from '../directory/directory-repository.js';
import type { Fragment, Params } from '../directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../directory/exchange-rate.js';
import {
  NO_ACCESS_MESSAGE,
  NO_ADJUSTMENT_DEFINITION,
  NO_RECENT_CHANGES_MESSAGE,
} from '../http/contract.js';
import type {
  DashboardBreakdown,
  DashboardBreakdownQuery,
  DashboardBreakdownResponse,
  DashboardFilters,
  DashboardRecentChangesQuery,
  DashboardRecentChangesResponse,
  DashboardSummaryQuery,
  DashboardSummaryResponse,
  DashboardWithoutAdjustmentQuery,
  DashboardWithoutAdjustmentResponse,
} from '../http/contract.js';
import { addMoney, addSignedMoney, averageMoney, convertToUsd } from '../money/decimal.js';
import { APPROVED_COUNTRIES } from '../seed/reference-data.js';
import { CURRENCIES, EMPLOYMENT_STATUSES, LEVELS } from '../source-workbook/constants.js';
import type { ChangeReason, CountryCode, Currency, Department, EmploymentStatus, Level } from '../source-workbook/constants.js';

export interface DashboardService {
  summary(principal: Principal, query: DashboardSummaryQuery): Promise<DashboardSummaryResponse>;
  breakdowns(principal: Principal, query: DashboardBreakdownQuery): Promise<DashboardBreakdownResponse>;
  recentChanges(principal: Principal, query: DashboardRecentChangesQuery): Promise<DashboardRecentChangesResponse>;
  withoutRecentAdjustment(principal: Principal, query: DashboardWithoutAdjustmentQuery): Promise<DashboardWithoutAdjustmentResponse>;
}

const WORKING_ONLY = 'This section includes currently working employees only.';
const USD_NOTE = 'USD equivalents are informational; native amounts are authoritative.';
const USD_UNAVAILABLE = 'USD comparison is unavailable: no saved exchange rate. Native totals are unaffected.';
const COMMITMENT_DEFINITION = 'Annual cash compensation of soon-to-join employees, plus the signed annual cash change of approved future changes for currently working employees (scheduled minus current). Left employees contribute nothing.';
const UPCOMING_LIST_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Allowlisted GROUP BY expressions. Breakdown names never enter SQL text. */
const GROUP_EXPRESSION: Readonly<Record<DashboardBreakdown, string>> = Object.freeze({
  DEPARTMENT: 'd.name',
  COUNTRY: 'e.country_code',
  CURRENCY: 'sc.currency',
  LEVEL: 'jt.level',
  EMPLOYMENT_STATUS: 'e.employment_status',
});

const STATUS_LABEL: Readonly<Record<EmploymentStatus, string>> = Object.freeze({
  SOON_TO_JOIN: 'Soon to join',
  CURRENTLY_WORKING: 'Currently working',
  LEFT: 'Left',
});
const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();
const toIso = (dbTime: string): string => `${dbTime.replace(' ', 'T')}Z`;

interface CountRow extends RowDataPacket { n: string }
interface StatusCountRow extends RowDataPacket { status: string; n: string }
interface CurrencyTotalRow extends RowDataPacket { currency: Currency; n: string; base: string; cash: string }
interface CurrencyCashRow extends RowDataPacket { currency: Currency; n: string; cash: string }
interface ImpactRow extends RowDataPacket { currency: Currency; n: string; impact: string }
interface GroupRow extends RowDataPacket {
  grp: string;
  currency: Currency;
  employee_count: string;
  total_base: string;
  total_cash: string;
  min_cash: string;
  max_cash: string;
  median_sum: string;
  median_count: string;
}
interface ChangeRow extends RowDataPacket {
  employee_code: string;
  first_name: string;
  last_name: string;
  department: Department;
  country_code: CountryCode;
  employment_status: EmploymentStatus;
  currency: Currency;
  annual_base_salary: string;
  annual_bonus: string;
  change_reason: ChangeReason;
  created_at: string;
  effective_from: string;
  changed_by_name: string | null;
  request_public_id: string | null;
  prev_base: string | null;
  prev_bonus: string | null;
  prev_currency: Currency | null;
  total?: string;
}
interface WithoutRow extends RowDataPacket {
  employee_code: string;
  first_name: string;
  last_name: string;
  department: Department;
  country_code: CountryCode;
  level: Level;
  currency: Currency;
  annual_base_salary: string;
  annual_bonus: string;
  last_adjustment: string | null;
}

const snapshot = (base: string, bonus: string) => ({ annualBaseSalary: base, annualBonus: bonus, annualCashCompensation: addMoney(base, bonus) });

export function createDashboardService({ pool, exchangeRate, clock = () => new Date() }: {
  pool: Pool;
  exchangeRate: ExchangeRateSnapshot | null;
  clock?: () => Date;
}): DashboardService {
  async function rows<T extends RowDataPacket>(sql: string, params: Params): Promise<T[]> {
    const [result] = await pool.query<T[]>(sql, params);
    return result;
  }

  /** Scope plus filters. `currencyColumn` is where the filtered currency lives for this metric. */
  function conditions(principal: Principal, filters: DashboardFilters, { applyStatus, currencyColumn }: { applyStatus: boolean; currencyColumn: string }): Fragment {
    const parts: Fragment[] = [scopeCondition(principal)];
    if (filters.department !== undefined) parts.push({ sql: 'd.name = ?', params: [filters.department] });
    if (filters.country !== undefined) parts.push({ sql: 'e.country_code = ?', params: [filters.country] });
    if (filters.level !== undefined) parts.push({ sql: 'jt.level = ?', params: [filters.level] });
    if (applyStatus && filters.employmentStatus !== undefined) parts.push({ sql: 'e.employment_status = ?', params: [filters.employmentStatus] });
    if (filters.currency !== undefined) parts.push({ sql: `${currencyColumn} = ?`, params: [filters.currency] });
    return { sql: parts.map((p) => p.sql).join(' AND '), params: parts.flatMap((p) => p.params) };
  }

  /** Working-only sections cannot apply a non-working status filter, and say so. */
  const workingOnlyNotes = (filters: DashboardFilters) =>
    filters.employmentStatus !== undefined && filters.employmentStatus !== 'CURRENTLY_WORKING'
      ? [{ filter: 'employmentStatus' as const, reason: WORKING_ONLY }]
      : [];

  function hasAccess(principal: Principal): boolean {
    if (principal.status !== 'ACTIVE') return false;
    if (principal.role === 'ADMIN') return true;
    return principal.role === 'SCOPED' && principal.countries.length > 0 && principal.departments.length > 0;
  }

  function envelope(principal: Principal, filters: DashboardFilters) {
    const now = clock();
    const access = hasAccess(principal);
    return {
      asOf: isoDate(now),
      generatedAt: now.toISOString(),
      access: {
        hasEmployeeAccess: access,
        message: access ? null : NO_ACCESS_MESSAGE,
        scope: principal.role === 'ADMIN'
          ? { kind: 'ALL' as const, countries: [], departments: [] }
          : { kind: 'SCOPED' as const, countries: [...principal.countries], departments: [...principal.departments] },
      },
      filters: {
        department: filters.department ?? null,
        country: filters.country ?? null,
        currency: filters.currency ?? null,
        level: filters.level ?? null,
        employmentStatus: filters.employmentStatus ?? null,
      },
    };
  }

  function usdComparison() {
    return exchangeRate === null
      ? { available: false, unavailableReason: USD_UNAVAILABLE, exchangeRate: null, quoteDescription: null, disclaimer: USD_NOTE }
      : { available: true, unavailableReason: null, exchangeRate, quoteDescription: `1 USD = ${exchangeRate.rate} INR (INR per one US dollar)`, disclaimer: USD_NOTE };
  }

  function usdPair(base: string, cash: string, currency: Currency) {
    const usdBase = convertToUsd(base, currency, exchangeRate);
    const usdCash = convertToUsd(cash, currency, exchangeRate);
    return usdBase === null || usdCash === null ? null : { annualBaseSalary: usdBase, annualCashCompensation: usdCash };
  }

  const pickFilters = (query: DashboardFilters): DashboardFilters => ({
    ...(query.department === undefined ? {} : { department: query.department }),
    ...(query.country === undefined ? {} : { country: query.country }),
    ...(query.currency === undefined ? {} : { currency: query.currency }),
    ...(query.level === undefined ? {} : { level: query.level }),
    ...(query.employmentStatus === undefined ? {} : { employmentStatus: query.employmentStatus }),
  });

  // ---------------------------------------------------------------------------

  async function summary(principal: Principal, query: DashboardSummaryQuery): Promise<DashboardSummaryResponse> {
    const filters = pickFilters(query);
    const base = envelope(principal, filters);
    if (!base.access.hasEmployeeAccess) return { ...base, figures: null };
    const now = clock();
    const asOf = isoDate(now);
    const recentStart = new Date(now.getTime() - query.periodDays * DAY_MS);

    const withStatus = conditions(principal, filters, { applyStatus: true, currencyColumn: 'sc.currency' });
    const workingOnly = conditions(principal, filters, { applyStatus: false, currencyColumn: 'sc.currency' });
    const requestCond = conditions(principal, filters, { applyStatus: true, currencyColumn: 'r.currency' });
    const recordCond = conditions(principal, filters, { applyStatus: true, currencyColumn: 'c.currency' });
    const futureCond = conditions(principal, filters, { applyStatus: true, currencyColumn: 'f.currency' });

    const [headcount, spending, joiners, impacts, upcoming, requests, recent, without] = await Promise.all([
      rows<StatusCountRow>(
        `SELECT e.employment_status AS status, COUNT(*) AS n ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
         WHERE ${withStatus.sql} GROUP BY e.employment_status`,
        [asOf, asOf, ...withStatus.params],
      ),
      rows<CurrencyTotalRow>(
        `SELECT sc.currency, COUNT(*) AS n, SUM(sc.annual_base_salary) AS base, SUM(sc.annual_base_salary + sc.annual_bonus) AS cash
         ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
         WHERE ${workingOnly.sql} AND e.employment_status = 'CURRENTLY_WORKING' AND sc.version IS NOT NULL
         GROUP BY sc.currency ORDER BY sc.currency`,
        [asOf, asOf, ...workingOnly.params],
      ),
      rows<CurrencyCashRow>(
        `SELECT sc.currency, COUNT(*) AS n, SUM(sc.annual_base_salary + sc.annual_bonus) AS cash
         ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
         WHERE ${withStatus.sql} AND e.employment_status = 'SOON_TO_JOIN' AND sc.version IS NOT NULL
         GROUP BY sc.currency`,
        [asOf, asOf, ...withStatus.params],
      ),
      // Approved future changes of working employees: scheduled minus current annual cash.
      rows<ImpactRow>(
        `SELECT f.currency, COUNT(*) AS n,
                SUM((f.annual_base_salary + f.annual_bonus) - (sc.annual_base_salary + sc.annual_bonus)) AS impact
         ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
         JOIN compensation_records f ON f.employee_id = e.id AND f.effective_from > ? AND f.change_reason <> 'INITIAL_IMPORT'
         WHERE ${withStatus.sql} AND e.employment_status = 'CURRENTLY_WORKING' AND sc.version IS NOT NULL
         GROUP BY f.currency`,
        [asOf, asOf, asOf, ...withStatus.params],
      ),
      rows<ChangeRow>(
        `SELECT e.employee_code, e.first_name, e.last_name, d.name AS department, e.country_code, e.employment_status,
                f.currency, f.annual_base_salary, f.annual_bonus, f.change_reason, f.created_at, f.effective_from,
                hu.display_name AS changed_by_name, sr.public_id AS request_public_id,
                p.annual_base_salary AS prev_base, p.annual_bonus AS prev_bonus, p.currency AS prev_currency,
                COUNT(*) OVER () AS total
         ${FROM_EMPLOYEES}
         JOIN compensation_records f ON f.employee_id = e.id AND f.effective_from > ? AND f.change_reason <> 'INITIAL_IMPORT'
         LEFT JOIN hr_users hu ON hu.id = f.changed_by_hr_user_id
         LEFT JOIN compensation_change_requests sr ON sr.id = f.source_request_id
         LEFT JOIN LATERAL (
           SELECT p.annual_base_salary, p.annual_bonus, p.currency FROM compensation_records p
           WHERE p.employee_id = f.employee_id
             AND (p.effective_from < f.effective_from OR (p.effective_from = f.effective_from AND p.version < f.version))
           ORDER BY p.effective_from DESC, p.version DESC LIMIT 1
         ) p ON TRUE
         WHERE ${futureCond.sql} AND e.employment_status IN ('CURRENTLY_WORKING', 'SOON_TO_JOIN')
         ORDER BY f.effective_from ASC, f.version ASC, e.employee_code ASC
         LIMIT ${UPCOMING_LIST_LIMIT}`,
        [asOf, ...futureCond.params],
      ),
      rows<StatusCountRow>(
        `SELECT r.status, COUNT(*) AS n FROM compensation_change_requests r
         JOIN employees e ON e.id = r.employee_id JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
         WHERE ${requestCond.sql} AND r.status IN ('PENDING', 'STALE') GROUP BY r.status`,
        requestCond.params,
      ),
      rows<CountRow>(
        `SELECT COUNT(*) AS n FROM compensation_records c
         JOIN employees e ON e.id = c.employee_id JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id
         WHERE ${recordCond.sql} AND c.change_reason <> 'INITIAL_IMPORT' AND c.created_at > ? AND c.created_at <= ?`,
        [...recordCond.params, recentStart, now],
      ),
      rows<CountRow>(withoutSql('COUNT(*) AS n', workingOnly), withoutParams(asOf, now, query.noAdjustmentMonths, workingOnly)),
    ]);

    const count = (list: StatusCountRow[], status: string) => Number(list.find((r) => r.status === status)?.n ?? 0);
    const byCurrency = spending.map((r) => ({
      currency: r.currency,
      employeeCount: Number(r.n),
      annualBaseSalary: r.base,
      annualCashCompensation: r.cash,
      usdEquivalent: usdPair(r.base, r.cash, r.currency),
    }));
    const commitmentCurrencies = CURRENCIES.filter((c) => joiners.some((r) => r.currency === c) || impacts.some((r) => r.currency === c));
    const total = Number(upcoming[0]?.total ?? 0);
    const usd = usdComparison();
    const usdSpending = usd.available && byCurrency.every((c) => c.usdEquivalent !== null)
      ? byCurrency.reduce((sum, c) => ({
        annualBaseSalary: addMoney(sum.annualBaseSalary, c.usdEquivalent?.annualBaseSalary ?? '0.00'),
        annualCashCompensation: addMoney(sum.annualCashCompensation, c.usdEquivalent?.annualCashCompensation ?? '0.00'),
      }), { annualBaseSalary: '0.00', annualCashCompensation: '0.00' })
      : null;

    return {
      ...base,
      figures: {
        headcount: {
          currentlyWorking: count(headcount, 'CURRENTLY_WORKING'),
          soonToJoin: count(headcount, 'SOON_TO_JOIN'),
          left: count(headcount, 'LEFT'),
          notApplied: [],
        },
        currentSpending: { population: 'CURRENTLY_WORKING', byCurrency, notApplied: workingOnlyNotes(filters) },
        upcomingCommitment: {
          definition: COMMITMENT_DEFINITION,
          byCurrency: commitmentCurrencies.map((currency) => {
            const joiner = joiners.find((r) => r.currency === currency);
            const impact = impacts.find((r) => r.currency === currency);
            const joinerCash = joiner?.cash ?? '0.00';
            const impactCash = impact?.impact ?? '0.00';
            return {
              currency,
              soonToJoinCount: Number(joiner?.n ?? 0),
              soonToJoinAnnualCashCompensation: joinerCash,
              approvedFutureChangeCount: Number(impact?.n ?? 0),
              approvedFutureChangeAnnualCashImpact: addSignedMoney(impactCash, '0.00'),
              totalAnnualCashCommitment: addSignedMoney(joinerCash, impactCash),
            };
          }),
          upcomingChanges: {
            total,
            items: upcoming.map((r) => ({
              employee: { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`, department: r.department, country: r.country_code, employmentStatus: r.employment_status },
              currency: r.currency,
              previous: r.prev_base !== null && r.prev_bonus !== null && r.prev_currency === r.currency ? snapshot(r.prev_base, r.prev_bonus) : null,
              scheduled: snapshot(r.annual_base_salary, r.annual_bonus),
              effectiveFrom: r.effective_from,
              changeReason: r.change_reason,
              approvedBy: r.changed_by_name === null ? null : { displayName: r.changed_by_name },
              requestId: r.request_public_id,
            })),
          },
          notApplied: [],
        },
        requests: { pending: count(requests, 'PENDING'), stale: count(requests, 'STALE'), notApplied: [] },
        recentChanges: { periodDays: query.periodDays, count: Number(recent[0]?.n ?? 0), notApplied: [] },
        withoutRecentAdjustment: {
          months: query.noAdjustmentMonths,
          definition: NO_ADJUSTMENT_DEFINITION,
          count: Number(without[0]?.n ?? 0),
          notApplied: workingOnlyNotes(filters),
        },
        usdComparison: { ...usd, currentSpending: usdSpending },
      },
    };
  }

  /**
   * Currently working employees with no non-import compensation record
   * created in (now - months, now]. Params: [asOf, asOf, ...where, now, months, now].
   */
  function withoutSql(select: string, where: Fragment, suffix = ''): string {
    return `SELECT ${select} ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
      WHERE ${where.sql} AND e.employment_status = 'CURRENTLY_WORKING' AND sc.version IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM compensation_records a
          WHERE a.employee_id = e.id AND a.change_reason <> 'INITIAL_IMPORT'
            AND a.created_at > DATE_SUB(?, INTERVAL ? MONTH) AND a.created_at <= ?
        ) ${suffix}`;
  }
  const withoutParams = (asOf: string, now: Date, months: number, where: Fragment): Params => [asOf, asOf, ...where.params, now, months, now];

  // ---------------------------------------------------------------------------

  async function breakdowns(principal: Principal, query: DashboardBreakdownQuery): Promise<DashboardBreakdownResponse> {
    const filters = pickFilters(query);
    const base = envelope(principal, filters);
    const statusBreakdown = query.breakdown === 'EMPLOYMENT_STATUS';
    const common = {
      breakdown: query.breakdown,
      population: statusBreakdown ? 'ALL_STATUSES' : 'CURRENTLY_WORKING',
      notApplied: statusBreakdown ? [] : workingOnlyNotes(filters),
      usdComparison: usdComparison(),
    };
    if (!base.access.hasEmployeeAccess) return { ...base, ...common, groups: [] };
    const asOf = isoDate(clock());
    const where = conditions(principal, filters, { applyStatus: statusBreakdown, currencyColumn: 'sc.currency' });
    const population = statusBreakdown ? '' : "AND e.employment_status = 'CURRENTLY_WORKING'";
    // Median: rows ranked by cash within each group and currency; the middle
    // row (odd n) or the two middle rows (even n) are summed in SQL and
    // averaged half-up in BigInt. Ties in cash do not change the median.
    const groups = await rows<GroupRow>(
      `WITH base_rows AS (
         SELECT ${GROUP_EXPRESSION[query.breakdown]} AS grp, sc.currency AS currency,
                sc.annual_base_salary AS base_salary, (sc.annual_base_salary + sc.annual_bonus) AS cash
         ${FROM_EMPLOYEES} ${SELECTED_COMPENSATION}
         WHERE ${where.sql} AND sc.version IS NOT NULL ${population}
       ), ranked AS (
         SELECT grp, currency, base_salary, cash,
                ROW_NUMBER() OVER (PARTITION BY grp, currency ORDER BY cash) AS rn,
                COUNT(*) OVER (PARTITION BY grp, currency) AS n
         FROM base_rows
       )
       SELECT grp, currency, COUNT(*) AS employee_count, SUM(base_salary) AS total_base, SUM(cash) AS total_cash,
              MIN(cash) AS min_cash, MAX(cash) AS max_cash,
              SUM(CASE WHEN rn IN (FLOOR((n + 1) / 2), FLOOR((n + 2) / 2)) THEN cash ELSE 0 END) AS median_sum,
              SUM(CASE WHEN rn IN (FLOOR((n + 1) / 2), FLOOR((n + 2) / 2)) THEN 1 ELSE 0 END) AS median_count
       FROM ranked GROUP BY grp, currency`,
      [asOf, asOf, ...where.params],
    );

    const order = (group: string): string => {
      switch (query.breakdown) {
        case 'LEVEL': return String(LEVELS.indexOf(group as Level)).padStart(2, '0');
        case 'EMPLOYMENT_STATUS': return String(EMPLOYMENT_STATUSES.indexOf(group as EmploymentStatus)).padStart(2, '0');
        default: return group;
      }
    };
    const label = (group: string): string => {
      switch (query.breakdown) {
        case 'COUNTRY': return APPROVED_COUNTRIES.find((c) => c.code === group)?.name ?? group;
        case 'LEVEL': return titleCase(group);
        case 'EMPLOYMENT_STATUS': return STATUS_LABEL[group as EmploymentStatus] ?? group;
        default: return group;
      }
    };
    const sorted = [...groups].sort((a, b) => order(a.grp).localeCompare(order(b.grp)) || CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency));

    return {
      ...base,
      ...common,
      groups: sorted.map((g) => {
        const count = Number(g.employee_count);
        const basis = !statusBreakdown || g.grp === 'CURRENTLY_WORKING'
          ? 'CURRENT_SPENDING' as const
          : g.grp === 'SOON_TO_JOIN' ? 'FUTURE_COMMITMENT' as const : 'COUNT_ONLY' as const;
        // Left employees contribute no current or future spending.
        if (basis === 'COUNT_ONLY') {
          return {
            group: g.grp, label: label(g.grp), currency: g.currency, basis, employeeCount: count,
            annualBaseSalary: null, annualCashCompensation: null, averageAnnualCashCompensation: null, medianAnnualCashCompensation: null,
            minimumAnnualCashCompensation: null, maximumAnnualCashCompensation: null, usdEquivalent: null,
          };
        }
        return {
          group: g.grp,
          label: label(g.grp),
          currency: g.currency,
          basis,
          employeeCount: count,
          annualBaseSalary: g.total_base,
          annualCashCompensation: g.total_cash,
          averageAnnualCashCompensation: averageMoney(g.total_cash, count),
          medianAnnualCashCompensation: averageMoney(g.median_sum, Number(g.median_count)),
          minimumAnnualCashCompensation: g.min_cash,
          maximumAnnualCashCompensation: g.max_cash,
          usdEquivalent: usdPair(g.total_base, g.total_cash, g.currency),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------

  const pageOf = (page: number, size: number, totalRows: number) => ({ number: page, size, totalRows, totalPages: Math.ceil(totalRows / size) });

  async function recentChanges(principal: Principal, query: DashboardRecentChangesQuery): Promise<DashboardRecentChangesResponse> {
    const filters = pickFilters(query);
    const base = envelope(principal, filters);
    const common = { periodDays: query.periodDays, emptyMessage: NO_RECENT_CHANGES_MESSAGE, notApplied: [] };
    if (!base.access.hasEmployeeAccess) return { ...base, ...common, changes: [], page: pageOf(query.page, query.pageSize, 0) };
    const now = clock();
    const asOf = isoDate(now);
    const start = new Date(now.getTime() - query.periodDays * DAY_MS);
    const where = conditions(principal, filters, { applyStatus: true, currencyColumn: 'c.currency' });
    // "Recent" means recorded recently: created_at in (now - days, now]. Imports are never changes.
    const filter = `${where.sql} AND c.change_reason <> 'INITIAL_IMPORT' AND c.created_at > ? AND c.created_at <= ?`;
    const filterParams = [...where.params, start, now];
    const join = `FROM compensation_records c
      JOIN employees e ON e.id = c.employee_id JOIN job_titles jt ON jt.id = e.job_title_id JOIN departments d ON d.id = jt.department_id`;
    const [list, count] = await Promise.all([
      rows<ChangeRow>(
        `SELECT e.employee_code, e.first_name, e.last_name, d.name AS department, e.country_code, e.employment_status,
                c.currency, c.annual_base_salary, c.annual_bonus, c.change_reason, c.created_at, c.effective_from,
                hu.display_name AS changed_by_name, sr.public_id AS request_public_id,
                p.annual_base_salary AS prev_base, p.annual_bonus AS prev_bonus, p.currency AS prev_currency
         ${join}
         LEFT JOIN hr_users hu ON hu.id = c.changed_by_hr_user_id
         LEFT JOIN compensation_change_requests sr ON sr.id = c.source_request_id
         LEFT JOIN LATERAL (
           SELECT p.annual_base_salary, p.annual_bonus, p.currency FROM compensation_records p
           WHERE p.employee_id = c.employee_id
             AND (p.effective_from < c.effective_from OR (p.effective_from = c.effective_from AND p.version < c.version))
           ORDER BY p.effective_from DESC, p.version DESC LIMIT 1
         ) p ON TRUE
         WHERE ${filter}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [...filterParams, query.pageSize, (query.page - 1) * query.pageSize],
      ),
      rows<CountRow>(`SELECT COUNT(*) AS n ${join} WHERE ${filter}`, filterParams),
    ]);
    return {
      ...base,
      ...common,
      changes: list.map((r) => ({
        employee: { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`, department: r.department, country: r.country_code },
        currency: r.currency,
        previous: r.prev_base !== null && r.prev_bonus !== null && r.prev_currency === r.currency ? snapshot(r.prev_base, r.prev_bonus) : null,
        new: snapshot(r.annual_base_salary, r.annual_bonus),
        changeReason: r.change_reason,
        recordedAt: toIso(r.created_at),
        effectiveFrom: r.effective_from,
        effectiveInFuture: r.effective_from > asOf,
        changedBy: r.changed_by_name === null ? null : { displayName: r.changed_by_name },
        requestId: r.request_public_id,
      })),
      page: pageOf(query.page, query.pageSize, Number(count[0]?.n ?? 0)),
    };
  }

  async function withoutRecentAdjustment(principal: Principal, query: DashboardWithoutAdjustmentQuery): Promise<DashboardWithoutAdjustmentResponse> {
    const filters = pickFilters(query);
    const base = envelope(principal, filters);
    const common = { months: query.noAdjustmentMonths, definition: NO_ADJUSTMENT_DEFINITION, notApplied: workingOnlyNotes(filters) };
    if (!base.access.hasEmployeeAccess) return { ...base, ...common, employees: [], page: pageOf(query.page, query.pageSize, 0) };
    const now = clock();
    const asOf = isoDate(now);
    const where = conditions(principal, filters, { applyStatus: false, currencyColumn: 'sc.currency' });
    const [list, count] = await Promise.all([
      rows<WithoutRow>(
        withoutSql(
          `e.employee_code, e.first_name, e.last_name, d.name AS department, e.country_code, jt.level,
           sc.currency, sc.annual_base_salary, sc.annual_bonus,
           (SELECT MAX(l.created_at) FROM compensation_records l
            WHERE l.employee_id = e.id AND l.change_reason <> 'INITIAL_IMPORT' AND l.created_at <= ?) AS last_adjustment`,
          where,
          'ORDER BY e.employee_code ASC LIMIT ? OFFSET ?',
        ),
        [now, ...withoutParams(asOf, now, query.noAdjustmentMonths, where), query.pageSize, (query.page - 1) * query.pageSize],
      ),
      rows<CountRow>(withoutSql('COUNT(*) AS n', where), withoutParams(asOf, now, query.noAdjustmentMonths, where)),
    ]);
    return {
      ...base,
      ...common,
      employees: list.map((r) => ({
        employee: { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`, department: r.department, country: r.country_code, level: r.level },
        currency: r.currency,
        annualBaseSalary: r.annual_base_salary,
        annualCashCompensation: addMoney(r.annual_base_salary, r.annual_bonus),
        lastRecordedAdjustmentAt: r.last_adjustment === null ? null : toIso(r.last_adjustment),
      })),
      page: pageOf(query.page, query.pageSize, Number(count[0]?.n ?? 0)),
    };
  }

  return { summary, breakdowns, recentChanges, withoutRecentAdjustment };
}
