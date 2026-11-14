import { COUNTRY_CODES, DEPARTMENTS, DISTRIBUTIONS, EMPLOYEE_COUNT, ZERO_BONUS_COUNT } from './constants.js';
import type { Column, Distributions } from './constants.js';
import { formatEmployeeId } from './employee-generator.js';
import { validateEmployee } from './employee-validator.js';
import type { UnvalidatedEmployee } from './employee-validator.js';

const MAX_ROW_ERRORS = 20;

function countBy(employees: readonly UnvalidatedEmployee[], field: Column): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const employee of employees) {
    const key = String(employee[field]);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function findDuplicates(values: readonly unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const duplicates = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Validates the complete data set before any workbook is written.
 * Returns a bounded list of short error strings. An empty list means valid.
 * Messages identify rows by employee ID and field only, never by values.
 * Rows are untrusted: each one goes through validateEmployee.
 */
export function validateEmployeeDataset(
  employees: readonly UnvalidatedEmployee[],
  { generationDate }: { generationDate: string },
): string[] {
  const errors: string[] = [];

  if (employees.length !== EMPLOYEE_COUNT) {
    errors.push(`expected ${EMPLOYEE_COUNT} employees, got ${employees.length}`);
  }

  let rowErrorCount = 0;
  employees.forEach((employee, index) => {
    const expectedId = formatEmployeeId(index + 1);
    if (employee.employee_id !== expectedId) {
      rowErrorCount += 1;
      if (rowErrorCount <= MAX_ROW_ERRORS) errors.push(`row ${index + 1}: expected employee_id ${expectedId}`);
    }
    for (const { field, message } of validateEmployee(employee, { generationDate })) {
      rowErrorCount += 1;
      if (rowErrorCount <= MAX_ROW_ERRORS) errors.push(`${String(employee.employee_id)} ${field}: ${message}`);
    }
  });
  if (rowErrorCount > MAX_ROW_ERRORS) errors.push(`... and ${rowErrorCount - MAX_ROW_ERRORS} more row errors`);

  for (const id of findDuplicates(employees.map((e) => e.employee_id)).slice(0, 5)) {
    errors.push(`duplicate employee_id ${String(id)}`);
  }
  const duplicateEmails = findDuplicates(employees.map((e) => e.email));
  if (duplicateEmails.length > 0) errors.push(`duplicate email addresses: ${duplicateEmails.length}`);

  // Object.entries widens keys to string; the keys of Distributions are exactly these columns.
  for (const [field, expectedTotals] of Object.entries(DISTRIBUTIONS) as [keyof Distributions, Record<string, number>][]) {
    const expectedByValue: Readonly<Record<string, number>> = expectedTotals;
    const actual = countBy(employees, field);
    const values = new Set([...Object.keys(expectedByValue), ...Object.keys(actual)]);
    for (const value of values) {
      const expected = expectedByValue[value] ?? 0;
      if ((actual[value] ?? 0) !== expected) {
        errors.push(`${field} ${value}: expected ${expected}, got ${actual[value] ?? 0}`);
      }
    }
  }

  const zeroBonusCount = employees.filter((e) => e.annual_bonus === 0).length;
  if (zeroBonusCount !== ZERO_BONUS_COUNT) {
    errors.push(`zero annual_bonus: expected ${ZERO_BONUS_COUNT}, got ${zeroBonusCount}`);
  }

  for (const department of DEPARTMENTS) {
    const countries = new Set(employees.filter((e) => e.department === department).map((e) => e.country_code));
    for (const country of COUNTRY_CODES) {
      if (!countries.has(country)) errors.push(`department ${department} has no ${country} employees`);
    }
  }

  return errors;
}
