// Transport-independent registry of the five read-only assistant tools.
//
// The OpenAI tool loop and the MCP endpoint both call `run()`. A tool:
//   1. validates its arguments with the tool's Zod schema;
//   2. calls a permission-aware application operation (the directory service
//      or the compensation insights), which applies scope in SQL;
//   3. re-checks every returned employee with canAccessEmployee (scope in
//      application code as well), failing closed on any mismatch;
//   4. returns model-facing data plus cards built from the same rows.
// Money is formatted here from exact database strings; the model never
// calculates an authoritative amount.
import { canAccessEmployee } from '../access/access-policy.js';
import type { Principal } from '../access/sessions.js';
import type { DirectoryService } from '../directory/directory-repository.js';
import type { ExchangeRateSnapshot } from '../directory/exchange-rate.js';
import type { AssistantCard, DirectoryResponse, EmployeeDetailResponse } from '../http/contract.js';
import { addMoney, averageMoney, convertToUsd, subtractMoney } from '../money/decimal.js';
import type { Currency } from '../source-workbook/constants.js';
import type { ChangeRow, CompensationInsights, InsightEmployeeRow, SummaryRow } from './compensation-insights.js';
import { DEFAULT_LIMITS, TOOL_INPUT_SCHEMAS, TOOL_NAMES } from './tool-schemas.js';
import type { ToolInput, ToolName } from './tool-schemas.js';

export interface ToolContext {
  principal: Principal;
  /** As-of calendar date (YYYY-MM-DD) for compensation selection. */
  asOf: string;
  /** Current time; the end of the recent-changes window. */
  now: Date;
}

export interface ToolResult {
  /** JSON sent to the model (or an MCP client) as the tool output. */
  data: Record<string, unknown>;
  cards: AssistantCard[];
  limitations: string[];
}

export type ToolOutcome =
  | { status: 'completed'; result: ToolResult }
  | { status: 'rejected'; reason: 'UNKNOWN_TOOL' | 'INVALID_ARGUMENTS' }
  | { status: 'failed'; errorName: string };

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
}

export interface ToolRegistry {
  definitions: readonly ToolDefinition[];
  run(name: string, args: unknown, context: ToolContext): Promise<ToolOutcome>;
}

/** A row reached a tool that the caller may not see. Never expected: SQL already filters. */
export class ScopeViolationError extends Error {
  constructor() {
    super('a tool result contained an employee outside the caller scope');
    this.name = 'ScopeViolationError';
  }
}

const DEFINITIONS: Readonly<Record<ToolName, Omit<ToolDefinition, 'name'>>> = Object.freeze({
  search_employees: {
    title: 'Search employees',
    description: 'Find permitted employees by employee ID (exact or prefix), first, last, or full name (partial), or exact email. Returns at most `limit` employees with their selected compensation.',
  },
  get_employee_compensation: {
    title: 'Employee compensation',
    description: 'Selected compensation (CURRENT, UPCOMING, or HISTORICAL) and full compensation history for one permitted employee.',
  },
  get_top_compensated_employees: {
    title: 'Top compensated employees',
    description: 'Highest-paid currently working employees by annual base salary or annual cash compensation (base + bonus). With a currency, ranks within that native currency. Without one, ranks INR and USD employees together by USD equivalent using the saved exchange rate.',
  },
  get_recent_compensation_changes: {
    title: 'Recent compensation changes',
    description: 'New compensation changes that HR recorded in the last `days` days, up to now, newest record first. "Recent" means recently recorded, not recently effective: a change recorded in the window is included even if it takes effect in the future, and an old record is excluded even if its effective date is recent. Each change shows recordedAt and effectiveFrom. The initial import is never counted. Returns an empty list when there are none.',
  },
  get_compensation_summary: {
    title: 'Compensation summary',
    description: 'Count, total, average, minimum, and maximum compensation of currently working employees, grouped by department, country, or currency, with each native currency kept separate.',
  },
});

const dayLabel = (days: number): string => (days === 1 ? '1 day' : `${days} days`);
/** DATETIME(3) text from mysql2 (UTC session, dateStrings) to an ISO instant. */
const dbTimeToIso = (text: string): string => `${text.replace(' ', 'T')}Z`;

const fullName = (row: { first_name: string; last_name: string }): string => `${row.first_name} ${row.last_name}`;
const money = (amount: string, currency: Currency) => ({ amount, currency });

function rateContext(rate: ExchangeRateSnapshot) {
  return `USD equivalents use ${rate.rate} INR per USD (${rate.sourceName}, effective ${rate.effectiveDate}).`;
}

export function createToolRegistry({ directory, insights, exchangeRate }: {
  directory: DirectoryService;
  insights: CompensationInsights;
  exchangeRate: ExchangeRateSnapshot | null;
}): ToolRegistry {
  /** Scope check in application code, on top of the SQL condition. */
  function assertPermitted(principal: Principal, rows: readonly { country: string; department: string }[]): void {
    for (const row of rows) {
      if (!canAccessEmployee(principal, { country_code: row.country, department: row.department })) throw new ScopeViolationError();
    }
  }

  function usdPair(base: string, cash: string, currency: Currency) {
    const usdBase = convertToUsd(base, currency, exchangeRate);
    const usdCash = convertToUsd(cash, currency, exchangeRate);
    return usdBase === null || usdCash === null ? null : { annualBaseSalary: usdBase, annualCashCompensation: usdCash };
  }

  type DirectoryRowLike = DirectoryResponse['employees'][number] | EmployeeDetailResponse['employee'] & { compensation: EmployeeDetailResponse['compensation'] };
  function cardEmployeeFromDirectory(row: DirectoryRowLike) {
    const c = row.compensation;
    return {
      employeeCode: row.employeeCode,
      name: `${row.firstName} ${row.lastName}`,
      department: row.department,
      jobTitle: row.jobTitle,
      level: row.level,
      country: row.country,
      employmentStatus: row.employmentStatus,
      compensation: c === null ? null : {
        state: c.state,
        effectiveFrom: c.effectiveFrom,
        annualBaseSalary: money(c.annualBaseSalary, c.currency),
        annualBonus: money(c.annualBonus, c.currency),
        annualCashCompensation: money(c.annualCashCompensation, c.currency),
        usdEquivalent: c.usdEquivalent,
      },
    };
  }

  function cardEmployeeFromInsight(row: InsightEmployeeRow) {
    const cash = addMoney(row.annual_base_salary, row.annual_bonus);
    return {
      employeeCode: row.employee_code,
      name: fullName(row),
      department: row.department,
      jobTitle: row.job_title,
      level: row.level,
      country: row.country_code,
      employmentStatus: row.employment_status,
      compensation: {
        state: 'CURRENT' as const,
        effectiveFrom: row.effective_from,
        annualBaseSalary: money(row.annual_base_salary, row.currency),
        annualBonus: money(row.annual_bonus, row.currency),
        annualCashCompensation: money(cash, row.currency),
        usdEquivalent: usdPair(row.annual_base_salary, cash, row.currency),
      },
    };
  }

  const notice = (level: 'info' | 'warning', message: string): AssistantCard => ({ type: 'notice', level, message });

  const handlers: { [N in ToolName]: (input: ToolInput<N>, context: ToolContext) => Promise<ToolResult> } = {
    async search_employees({ query, limit }, { principal }) {
      const page = await directory.list(principal, { q: query, page: 1, pageSize: limit ?? DEFAULT_LIMITS.search, sort: 'name', direction: 'asc' });
      const employees = page.employees.map(cardEmployeeFromDirectory);
      assertPermitted(principal, employees);
      return {
        data: { totalMatching: page.page.totalRows, returned: employees.length, employees },
        cards: employees.length === 0
          ? [notice('info', 'No permitted employee matches that search.')]
          : [{ type: 'employee_list', title: 'Search results', employees, exchangeRate }],
        limitations: page.page.totalRows > employees.length ? [`Showing ${employees.length} of ${page.page.totalRows} matching employees.`] : [],
      };
    },

    async get_employee_compensation({ employeeCode }, { principal }) {
      const found = await directory.detail(principal, employeeCode);
      // Unknown and out-of-scope employees produce the same result.
      if (found === null) {
        const message = 'No permitted employee has that employee ID.';
        return { data: { found: false, message }, cards: [notice('info', message)], limitations: [] };
      }
      const employee = cardEmployeeFromDirectory({ ...found.employee, compensation: found.compensation });
      assertPermitted(principal, [employee]);
      const history = found.compensationHistory.map((h) => ({
        version: h.version,
        effectiveFrom: h.effectiveFrom,
        changeReason: h.changeReason,
        annualBaseSalary: money(h.annualBaseSalary, h.currency),
        annualBonus: money(h.annualBonus, h.currency),
        annualCashCompensation: money(h.annualCashCompensation, h.currency),
      }));
      const limitations = found.compensation?.state === 'HISTORICAL'
        ? ['This employee has left; the compensation shown is historical, not current spending.']
        : found.compensation?.state === 'UPCOMING' ? ['This employee has not joined yet; the compensation shown starts in the future.'] : [];
      return {
        data: { found: true, employee, employmentEndDate: found.employee.employmentEndDate, compensationHistory: history },
        cards: [{ type: 'employee_list', title: `${employee.name} (${employee.employeeCode})`, employees: [employee], exchangeRate }],
        limitations,
      };
    },

    async get_top_compensated_employees({ metric, currency, limit }, { principal, asOf }) {
      const result = await insights.topCompensated(principal, { metric, currency: currency ?? null, limit: limit ?? DEFAULT_LIMITS.top }, asOf);
      if (result.status === 'insufficient') {
        const message = 'Cannot compare INR and USD compensation: no saved INR exchange rate is available. Ask for one currency instead.';
        return {
          data: { status: 'insufficient', reason: result.reason, message },
          cards: [notice('warning', message)],
          limitations: ['Raw INR and USD amounts are never compared.'],
        };
      }
      const employees = result.rows.map(cardEmployeeFromInsight);
      assertPermitted(principal, employees);
      const metricLabel = metric === 'ANNUAL_BASE' ? 'annual base salary' : 'annual cash compensation';
      const basis = result.comparedInUsd ? `${metricLabel}, compared in USD` : `${metricLabel} in ${String(currency)}`;
      const limitations = ['Ranks currently working employees only.'];
      if (result.comparedInUsd && exchangeRate !== null) limitations.push(`INR and USD were compared by USD equivalent. ${rateContext(exchangeRate)}`);
      return {
        data: {
          rankedBy: basis,
          comparison: result.comparedInUsd && exchangeRate !== null ? { currency: 'USD', ...exchangeRate } : null,
          employees,
        },
        cards: employees.length === 0
          ? [notice('info', 'No permitted currently working employee matches.')]
          : [{ type: 'employee_list', title: `Top ${employees.length} by ${basis}`, employees, exchangeRate: result.comparedInUsd ? exchangeRate : null }],
        limitations,
      };
    },

    async get_recent_compensation_changes({ days, limit }, { principal, now }) {
      const { rows, totalMatching } = await insights.recentChanges(principal, { days, limit: limit ?? DEFAULT_LIMITS.recent }, now);
      const changes = rows.map((row: ChangeRow) => {
        const previous = row.previous_base_salary !== null && row.previous_bonus !== null && row.previous_currency !== null && row.previous_effective_from !== null
          ? {
            annualBaseSalary: money(row.previous_base_salary, row.previous_currency),
            annualBonus: money(row.previous_bonus, row.previous_currency),
            effectiveFrom: row.previous_effective_from,
          }
          : null;
        return {
          employeeCode: row.employee_code,
          name: fullName(row),
          department: row.department,
          country: row.country_code,
          version: row.version,
          recordedAt: dbTimeToIso(row.created_at),
          effectiveFrom: row.effective_from,
          changeReason: row.change_reason,
          annualBaseSalary: money(row.annual_base_salary, row.currency),
          annualBonus: money(row.annual_bonus, row.currency),
          previous,
          annualBaseSalaryChange: previous !== null && row.previous_currency === row.currency && row.previous_base_salary !== null
            ? money(subtractMoney(row.annual_base_salary, row.previous_base_salary), row.currency)
            : null,
        };
      });
      assertPermitted(principal, changes);
      const limitations = ['The initial import is not counted as a salary change.'];
      if (totalMatching > changes.length) limitations.push(`Showing ${changes.length} of ${totalMatching} changes.`);
      if (changes.length === 0) {
        const message = `No compensation changes were recorded in the last ${dayLabel(days)} for employees you can access. The initial import is not counted as a change.`;
        return { data: { totalMatching: 0, changes: [], message }, cards: [notice('info', message)], limitations };
      }
      return {
        data: { days, totalMatching, changes },
        cards: [{ type: 'recent_changes', title: `Compensation changes recorded in the last ${dayLabel(days)}`, days, totalMatching, changes }],
        limitations,
      };
    },

    async get_compensation_summary({ groupBy, metric }, { principal, asOf }) {
      const rows = await insights.summary(principal, { groupBy, metric }, asOf);
      const groups = rows.map((row: SummaryRow) => {
        const count = Number(row.employee_count);
        const average = averageMoney(row.total, count);
        const usdTotal = convertToUsd(row.total, row.currency, exchangeRate);
        const usdAverage = convertToUsd(average, row.currency, exchangeRate);
        return {
          group: row.grp,
          currency: row.currency,
          employeeCount: count,
          total: money(row.total, row.currency),
          average: money(average, row.currency),
          minimum: money(row.minimum, row.currency),
          maximum: money(row.maximum, row.currency),
          usdEquivalent: usdTotal === null || usdAverage === null ? null : { total: usdTotal, average: usdAverage },
        };
      });
      const limitations = [
        'Covers currently working employees only.',
        'Each native currency is totalled separately; INR and USD are never added together.',
      ];
      if (exchangeRate !== null) limitations.push(`USD equivalents are context, not authoritative totals. ${rateContext(exchangeRate)}`);
      if (groups.length === 0) {
        const message = 'No permitted currently working employees to summarise.';
        return { data: { groups: [], message }, cards: [notice('info', message)], limitations };
      }
      return {
        data: { groupBy, metric, population: 'CURRENTLY_WORKING', groups, exchangeRate },
        cards: [{ type: 'compensation_summary', title: 'Compensation summary', groupBy, metric, population: 'CURRENTLY_WORKING', groups, exchangeRate }],
        limitations,
      };
    },
  };

  const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

  async function runTyped<N extends ToolName>(name: N, args: unknown, context: ToolContext): Promise<ToolOutcome> {
    const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(args);
    if (!parsed.success) return { status: 'rejected', reason: 'INVALID_ARGUMENTS' };
    try {
      // The schema for N produces ToolInput<N>; TypeScript cannot correlate the indexed lookups.
      const handler = handlers[name] as (input: ToolInput<N>, context: ToolContext) => Promise<ToolResult>;
      return { status: 'completed', result: await handler(parsed.data as ToolInput<N>, context) };
    } catch (error) {
      return { status: 'failed', errorName: error instanceof Error ? error.name : typeof error };
    }
  }

  return {
    definitions: TOOL_NAMES.map((name) => ({ name, ...DEFINITIONS[name] })),
    run(name, args, context) {
      if (!isToolName(name)) return Promise.resolve({ status: 'rejected', reason: 'UNKNOWN_TOOL' });
      return runTyped(name, args, context);
    },
  };
}
