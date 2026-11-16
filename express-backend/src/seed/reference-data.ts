import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { PERCENTAGE_LIMITS } from '../compensation/adjustment.js';
import { BONUS_CAPS, CURRENCY_BY_COUNTRY, DEPARTMENTS, JOB_TITLES, LEVELS, SALARY_RANGES } from '../source-workbook/constants.js';
import type { CountryCode, Currency, Department, Level } from '../source-workbook/constants.js';

interface ApprovedCountry {
  code: CountryCode;
  name: string;
  currency: Currency;
}

// Approved reference data. Country names follow docs/01 and docs/02.
export const APPROVED_COUNTRIES: readonly ApprovedCountry[] = Object.freeze([
  { code: 'IN', name: 'India', currency: CURRENCY_BY_COUNTRY.IN },
  { code: 'US', name: 'United States', currency: CURRENCY_BY_COUNTRY.US },
]);

export class ReferenceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceDataError';
  }
}

interface CountryRow extends RowDataPacket {
  name: string;
  currency: string;
}
interface NamedIdRow extends RowDataPacket {
  id: number;
  name: string;
}

/** job_titles.id by department, title, and level. */
export type JobTitleIds = ReadonlyMap<string, number>;

const titleKey = (department: string, title: string, level: string): string => `${department}\u0000${title}\u0000${level}`;

/**
 * Inserts missing approved countries, departments, and job titles, and
 * verifies existing ones. Never deletes reference data. Runs in its own
 * transaction on the given connection.
 */
export async function ensureReferenceData(connection: Connection): Promise<Map<string, number>> {
  await connection.beginTransaction();
  try {
    for (const country of APPROVED_COUNTRIES) {
      const [rows] = await connection.execute<CountryRow[]>('SELECT name, currency FROM countries WHERE code = ? FOR UPDATE', [country.code]);
      const existing = rows[0];
      if (existing === undefined) {
        await connection.execute('INSERT INTO countries (code, name, currency) VALUES (?, ?, ?)', [
          country.code, country.name, country.currency,
        ]);
      } else if (existing.name !== country.name || existing.currency !== country.currency) {
        throw new ReferenceDataError(`existing country ${country.code} does not match the approved name and currency`);
      }
    }

    const departmentIds = new Map<Department, number>();
    for (const name of DEPARTMENTS) {
      const [rows] = await connection.execute<NamedIdRow[]>('SELECT id, name FROM departments WHERE name = ? FOR UPDATE', [name]);
      const existing = rows[0];
      if (existing === undefined) {
        const [result] = await connection.execute<ResultSetHeader>('INSERT INTO departments (name) VALUES (?)', [name]);
        departmentIds.set(name, result.insertId);
      } else if (existing.name !== name) {
        throw new ReferenceDataError(`existing department "${existing.name}" does not match approved "${name}"`);
      } else {
        departmentIds.set(name, existing.id);
      }
    }

    const titleIds = new Map<string, number>();
    for (const department of DEPARTMENTS) {
      const departmentId = departmentIds.get(department);
      // Unreachable: the loop above stores an id for every approved department.
      if (departmentId === undefined) throw new ReferenceDataError(`department ${department} has no id`);
      for (const level of LEVELS) {
        for (const title of JOB_TITLES[department][level]) {
          const [rows] = await connection.execute<NamedIdRow[]>(
            'SELECT id, name FROM job_titles WHERE department_id = ? AND name = ? AND level = ? FOR UPDATE',
            [departmentId, title, level],
          );
          const existing = rows[0];
          if (existing === undefined) {
            const [result] = await connection.execute<ResultSetHeader>(
              'INSERT INTO job_titles (department_id, name, level) VALUES (?, ?, ?)',
              [departmentId, title, level],
            );
            titleIds.set(titleKey(department, title, level), result.insertId);
          } else if (existing.name !== title) {
            throw new ReferenceDataError(`existing job title "${existing.name}" does not match approved "${title}"`);
          } else {
            titleIds.set(titleKey(department, title, level), existing.id);
          }
        }
      }
    }

    await ensureSalaryBands(connection, titleIds);
    await connection.commit();
    return titleIds;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

/** "1200000" -> "1200000.00" for the whole-unit approved ranges. */
const wholeUnits = (amount: number): string => `${String(amount)}.00`;

/**
 * Inserts a missing salary band for every job title and approved country,
 * from the approved synthetic ranges and bonus caps. An existing band is left
 * unchanged: bands are product policy and may be edited after the first seed.
 * Runs inside ensureReferenceData's transaction.
 */
async function ensureSalaryBands(connection: Connection, titleIds: ReadonlyMap<string, number>): Promise<void> {
  for (const department of DEPARTMENTS) {
    for (const level of LEVELS) {
      for (const title of JOB_TITLES[department][level]) {
        const jobTitleId = titleIds.get(titleKey(department, title, level));
        if (jobTitleId === undefined) throw new ReferenceDataError(`job title ${title} has no id`);
        for (const country of APPROVED_COUNTRIES) {
          const range = SALARY_RANGES[country.code][level];
          const bonusCap = BONUS_CAPS[level === 'JUNIOR' ? 'JUNIOR' : 'OTHER'][country.currency];
          await connection.execute(
            `INSERT INTO salary_bands (job_title_id, country_code, currency, min_annual_base_salary, max_annual_base_salary,
                                       max_annual_bonus, min_percentage_increase, max_percentage_increase,
                                       min_percentage_decrease, max_percentage_decrease)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM DUAL
             WHERE NOT EXISTS (SELECT 1 FROM salary_bands WHERE job_title_id = ? AND country_code = ? AND currency = ?)`,
            [
              jobTitleId, country.code, country.currency, wholeUnits(range.min), wholeUnits(range.max), wholeUnits(bonusCap),
              PERCENTAGE_LIMITS.increase.min, PERCENTAGE_LIMITS.increase.max, PERCENTAGE_LIMITS.decrease.min, PERCENTAGE_LIMITS.decrease.max,
              jobTitleId, country.code, country.currency,
            ],
          );
        }
      }
    }
  }
}

/** The fields needed to resolve a row's job title. */
export interface TitledRow {
  employee_code: string;
  department: string;
  job_title: string;
  level: Level | string;
}

/**
 * Adds job_title_id to every row. Throws before any deletion if a
 * department, title, and level combination has no job title.
 */
export function resolveJobTitleIds<T extends TitledRow>(rows: readonly T[], titleIds: JobTitleIds): (T & { job_title_id: number })[] {
  const unresolved: string[] = [];
  const resolved: (T & { job_title_id: number })[] = [];
  for (const row of rows) {
    const id = titleIds.get(titleKey(row.department, row.job_title, row.level));
    if (id === undefined) {
      unresolved.push(`${row.employee_code}: ${row.department} / ${row.job_title} / ${row.level}`);
    } else {
      resolved.push({ ...row, job_title_id: id });
    }
  }
  if (unresolved.length > 0) {
    throw new ReferenceDataError(
      `${unresolved.length} workbook rows do not resolve to a job title: ${unresolved.slice(0, 5).join('; ')}`,
    );
  }
  return resolved;
}
