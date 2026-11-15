// Read-only compensation operations behind the assistant tools.
//
// Each query applies the caller's scope with the directory's scopeCondition
// and selects compensation with the directory's SELECTED_COMPENSATION, so the
// assistant and the directory cannot disagree on who is visible or which
// record is current. All values are placeholders; only allowlisted SQL text
// varies.
import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { Principal } from '../access/sessions.js';
import {
  FROM_EMPLOYEES,
  SELECTED_COMPENSATION,
  scopeCondition,
  usdExpression,
} from '../directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../directory/exchange-rate.js';
import type {
  ChangeReason,
  CountryCode,
  Currency,
  Department,
  EmploymentStatus,
  Level,
} from '../source-workbook/constants.js';
import type { CompensationMetric, SummaryGroup } from './tool-schemas.js';

const AMOUNT: Readonly<Record<CompensationMetric, string>> = Object.freeze({
  ANNUAL_BASE: 'sc.annual_base_salary',
  ANNUAL_CASH: '(sc.annual_base_salary + sc.annual_bonus)',
});

const GROUP_COLUMN: Readonly<Record<SummaryGroup, string>> = Object.freeze({
  DEPARTMENT: 'd.name',
  COUNTRY: 'e.country_code',
  CURRENCY: 'sc.currency',
});

/** Only current employees with a CURRENT record count as compensation spend or ranking. */
const CURRENT_ONLY = "e.employment_status = 'CURRENTLY_WORKING' AND sc.version IS NOT NULL";

export interface InsightEmployeeRow extends RowDataPacket {
  employee_code: string;
  first_name: string;
  last_name: string;
  department: Department;
  job_title: string;
  level: Level;
  country_code: CountryCode;
  employment_status: EmploymentStatus;
  comp_version: number;
  annual_base_salary: string;
  annual_bonus: string;
  currency: Currency;
  effective_from: string;
}

export interface ChangeRow extends RowDataPacket {
  employee_code: string;
  first_name: string;
  last_name: string;
  department: Department;
  job_title: string;
  level: Level;
  country_code: CountryCode;
  employment_status: EmploymentStatus;
  version: number;
  annual_base_salary: string;
  annual_bonus: string;
  currency: Currency;
  effective_from: string;
  change_reason: ChangeReason;
  /** DATETIME(3) in UTC, as text ('YYYY-MM-DD HH:MM:SS.mmm'). */
  created_at: string;
  previous_base_salary: string | null;
  previous_bonus: string | null;
  previous_currency: Currency | null;
  previous_effective_from: string | null;
}

export interface SummaryRow extends RowDataPacket {
  grp: string;
  currency: Currency;
  employee_count: string;
  total: string;
  minimum: string;
  maximum: string;
}

interface CountRow extends RowDataPacket {
  n: string;
}

export type TopResult =
  | { status: 'ok'; rows: InsightEmployeeRow[]; comparedInUsd: boolean }
  | { status: 'insufficient'; reason: 'NO_EXCHANGE_RATE' };

export interface CompensationInsights {
  topCompensated(principal: Principal, input: { metric: CompensationMetric; currency: Currency | null; limit: number }, asOf: string): Promise<TopResult>;
  recentChanges(principal: Principal, input: { days: number; limit: number }, now: Date): Promise<{ rows: ChangeRow[]; totalMatching: number }>;
  summary(principal: Principal, input: { groupBy: SummaryGroup; metric: CompensationMetric }, asOf: string): Promise<SummaryRow[]>;
}

const EMPLOYEE_COLUMNS = `e.employee_code, e.first_name, e.last_name, d.name AS department, jt.name AS job_title, jt.level,
  e.country_code, e.employment_status, sc.version AS comp_version, sc.annual_base_salary, sc.annual_bonus, sc.currency, sc.effective_from`;

export function createCompensationInsights({ pool, exchangeRate }: {
  pool: Pool;
  exchangeRate: ExchangeRateSnapshot | null;
}): CompensationInsights {
  async function topCompensated(
    principal: Principal,
    { metric, currency, limit }: { metric: CompensationMetric; currency: Currency | null; limit: number },
    asOf: string,
  ): Promise<TopResult> {
    const scope = scopeCondition(principal);
    const amount = AMOUNT[metric];
    // One native currency: rank natively. Mixed currencies: rank by the
    // unrounded USD value, which needs the saved INR rate.
    const comparedInUsd = currency === null;
    if (comparedInUsd && exchangeRate === null) return { status: 'insufficient', reason: 'NO_EXCHANGE_RATE' };
    const rankExpression = comparedInUsd ? usdExpression(amount) : amount;
    const rankParams = comparedInUsd ? [exchangeRate?.rate] : [];
    const [rows] = await pool.query<InsightEmployeeRow[]>(
      `SELECT /*+ SET_VAR(div_precision_increment = 30) */ ${EMPLOYEE_COLUMNS}, ${rankExpression} AS rank_value
       ${FROM_EMPLOYEES}
       ${SELECTED_COMPENSATION}
       WHERE ${scope.sql} AND ${CURRENT_ONLY} ${currency === null ? '' : 'AND sc.currency = ?'}
       ORDER BY rank_value DESC, e.employee_code ASC
       LIMIT ?`,
      [...rankParams, asOf, asOf, ...scope.params, ...(currency === null ? [] : [currency]), limit],
    );
    return { status: 'ok', rows, comparedInUsd };
  }

  async function recentChanges(
    principal: Principal,
    { days, limit }: { days: number; limit: number },
    now: Date,
  ): Promise<{ rows: ChangeRow[]; totalMatching: number }> {
    const scope = scopeCondition(principal);
    // "Recent" means recorded recently: created_at in (now - days, now].
    // A future-effective change recorded in the window is included; an old
    // record with a recent effective date is not. INITIAL_IMPORT is the
    // starting point, never a change.
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const where = `${scope.sql} AND c.change_reason <> 'INITIAL_IMPORT'
      AND c.created_at > ? AND c.created_at <= ?`;
    const whereParams = [...scope.params, windowStart, now];
    const [rows] = await pool.query<ChangeRow[]>(
      `SELECT e.employee_code, e.first_name, e.last_name, d.name AS department, jt.name AS job_title, jt.level,
              e.country_code, e.employment_status, c.version, c.annual_base_salary, c.annual_bonus, c.currency,
              c.effective_from, c.change_reason, c.created_at,
              p.annual_base_salary AS previous_base_salary, p.annual_bonus AS previous_bonus,
              p.currency AS previous_currency, p.effective_from AS previous_effective_from
       ${FROM_EMPLOYEES}
       JOIN compensation_records c ON c.employee_id = e.id
       LEFT JOIN LATERAL (
         SELECT p.annual_base_salary, p.annual_bonus, p.currency, p.effective_from
         FROM compensation_records p
         WHERE p.employee_id = e.id
           AND (p.effective_from < c.effective_from OR (p.effective_from = c.effective_from AND p.version < c.version))
         ORDER BY p.effective_from DESC, p.version DESC
         LIMIT 1
       ) p ON TRUE
       WHERE ${where}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ?`,
      [...whereParams, limit],
    );
    const [count] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS n ${FROM_EMPLOYEES} JOIN compensation_records c ON c.employee_id = e.id WHERE ${where}`,
      whereParams,
    );
    return { rows, totalMatching: Number(count[0]?.n ?? 0) };
  }

  async function summary(
    principal: Principal,
    { groupBy, metric }: { groupBy: SummaryGroup; metric: CompensationMetric },
    asOf: string,
  ): Promise<SummaryRow[]> {
    const scope = scopeCondition(principal);
    const amount = AMOUNT[metric];
    const group = GROUP_COLUMN[groupBy];
    // Grouped by native currency as well: INR and USD are never added together.
    const [rows] = await pool.query<SummaryRow[]>(
      `SELECT ${group} AS grp, sc.currency, COUNT(*) AS employee_count,
              SUM(${amount}) AS total, MIN(${amount}) AS minimum, MAX(${amount}) AS maximum
       ${FROM_EMPLOYEES}
       ${SELECTED_COMPENSATION}
       WHERE ${scope.sql} AND ${CURRENT_ONLY}
       GROUP BY ${group}, sc.currency
       ORDER BY ${group}, sc.currency`,
      [asOf, asOf, ...scope.params],
    );
    return rows;
  }

  return { topCompensated, recentChanges, summary };
}
