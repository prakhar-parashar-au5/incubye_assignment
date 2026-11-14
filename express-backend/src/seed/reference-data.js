import { CURRENCY_BY_COUNTRY, DEPARTMENTS, JOB_TITLES } from '../source-workbook/constants.js';

// Approved reference data. Country names follow docs/01 and docs/02.
export const APPROVED_COUNTRIES = Object.freeze([
  { code: 'IN', name: 'India', currency: CURRENCY_BY_COUNTRY.IN },
  { code: 'US', name: 'United States', currency: CURRENCY_BY_COUNTRY.US },
]);

export class ReferenceDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceDataError';
  }
}

const titleKey = (department, title, level) => `${department}\u0000${title}\u0000${level}`;

/**
 * Inserts missing approved countries, departments, and job titles, and
 * verifies existing ones. Never deletes reference data. Runs in its own
 * transaction on the given connection.
 *
 * @returns {Promise<Map<string, number>>} job_titles.id by department, title, level
 */
export async function ensureReferenceData(connection) {
  await connection.beginTransaction();
  try {
    for (const country of APPROVED_COUNTRIES) {
      const [rows] = await connection.execute('SELECT name, currency FROM countries WHERE code = ? FOR UPDATE', [country.code]);
      if (rows.length === 0) {
        await connection.execute('INSERT INTO countries (code, name, currency) VALUES (?, ?, ?)', [
          country.code, country.name, country.currency,
        ]);
      } else if (rows[0].name !== country.name || rows[0].currency !== country.currency) {
        throw new ReferenceDataError(`existing country ${country.code} does not match the approved name and currency`);
      }
    }

    const departmentIds = new Map();
    for (const name of DEPARTMENTS) {
      const [rows] = await connection.execute('SELECT id, name FROM departments WHERE name = ? FOR UPDATE', [name]);
      if (rows.length === 0) {
        const [result] = await connection.execute('INSERT INTO departments (name) VALUES (?)', [name]);
        departmentIds.set(name, result.insertId);
      } else if (rows[0].name !== name) {
        throw new ReferenceDataError(`existing department "${rows[0].name}" does not match approved "${name}"`);
      } else {
        departmentIds.set(name, rows[0].id);
      }
    }

    const titleIds = new Map();
    for (const [department, byLevel] of Object.entries(JOB_TITLES)) {
      for (const [level, titles] of Object.entries(byLevel)) {
        for (const title of titles) {
          const departmentId = departmentIds.get(department);
          const [rows] = await connection.execute(
            'SELECT id, name FROM job_titles WHERE department_id = ? AND name = ? AND level = ? FOR UPDATE',
            [departmentId, title, level],
          );
          if (rows.length === 0) {
            const [result] = await connection.execute(
              'INSERT INTO job_titles (department_id, name, level) VALUES (?, ?, ?)',
              [departmentId, title, level],
            );
            titleIds.set(titleKey(department, title, level), result.insertId);
          } else if (rows[0].name !== title) {
            throw new ReferenceDataError(`existing job title "${rows[0].name}" does not match approved "${title}"`);
          } else {
            titleIds.set(titleKey(department, title, level), rows[0].id);
          }
        }
      }
    }

    await connection.commit();
    return titleIds;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

/**
 * Adds job_title_id to every row. Throws before any deletion if a
 * department, title, and level combination has no job title.
 */
export function resolveJobTitleIds(rows, titleIds) {
  const unresolved = [];
  const resolved = rows.map((row) => {
    const id = titleIds.get(titleKey(row.department, row.job_title, row.level));
    if (id === undefined) unresolved.push(`${row.employee_code}: ${row.department} / ${row.job_title} / ${row.level}`);
    return { ...row, job_title_id: id };
  });
  if (unresolved.length > 0) {
    throw new ReferenceDataError(
      `${unresolved.length} workbook rows do not resolve to a job title: ${unresolved.slice(0, 5).join('; ')}`,
    );
  }
  return resolved;
}
