import { COUNTRY_CODES, DEPARTMENTS, DISTRIBUTIONS, EMPLOYEE_COUNT, ZERO_BONUS_COUNT } from './constants.js';
import { formatEmployeeId } from './employee-generator.js';
import { validateEmployee } from './employee-validator.js';

const MAX_ROW_ERRORS = 20;

function countBy(employees, field) {
  const counts = {};
  for (const employee of employees) counts[employee[field]] = (counts[employee[field]] ?? 0) + 1;
  return counts;
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
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
 *
 * @param {object[]} employees
 * @param {{ generationDate: string }} options
 */
export function validateEmployeeDataset(employees, { generationDate }) {
  const errors = [];

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
      if (rowErrorCount <= MAX_ROW_ERRORS) errors.push(`${employee.employee_id} ${field}: ${message}`);
    }
  });
  if (rowErrorCount > MAX_ROW_ERRORS) errors.push(`... and ${rowErrorCount - MAX_ROW_ERRORS} more row errors`);

  for (const id of findDuplicates(employees.map((e) => e.employee_id)).slice(0, 5)) {
    errors.push(`duplicate employee_id ${id}`);
  }
  const duplicateEmails = findDuplicates(employees.map((e) => e.email));
  if (duplicateEmails.length > 0) errors.push(`duplicate email addresses: ${duplicateEmails.length}`);

  for (const [field, expectedTotals] of Object.entries(DISTRIBUTIONS)) {
    const actual = countBy(employees, field);
    const values = new Set([...Object.keys(expectedTotals), ...Object.keys(actual)]);
    for (const value of values) {
      const expected = expectedTotals[value] ?? 0;
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
