import ExcelJS from 'exceljs';

import {
  COLUMNS,
  COUNTRY_CODES,
  CURRENCIES,
  DEPARTMENTS,
  EMPLOYMENT_STATUSES,
  LEVELS,
  PAY_FREQUENCIES,
  WORKSHEET_NAME,
} from './constants.js';
import type { Column, EmployeeRecord } from './constants.js';

const MONEY_COLUMNS = new Set<Column>(['annual_base_salary', 'annual_bonus']);
const MONEY_FORMAT = '#,##0.00';

const VALIDATION_LISTS: readonly (readonly [Column, readonly string[]])[] = [
  ['department', DEPARTMENTS],
  ['level', LEVELS],
  ['country_code', COUNTRY_CODES],
  ['currency', CURRENCIES],
  ['employment_status', EMPLOYMENT_STATUSES],
  ['pay_frequency', PAY_FREQUENCIES],
];

const COLUMN_WIDTHS: Readonly<Record<Column, number>> = {
  employee_id: 12,
  first_name: 14,
  last_name: 14,
  email: 38,
  department: 12,
  job_title: 28,
  level: 10,
  country_code: 13,
  currency: 10,
  employment_status: 20,
  hire_date: 12,
  employment_end_date: 20,
  annual_base_salary: 19,
  pay_frequency: 14,
  annual_bonus: 14,
  salary_effective_date: 21,
};

/**
 * Library-type gap: ExcelJS 4.4.0 implements worksheet.dataValidations.add
 * (lib/doc/data-validations.js) but its index.d.ts does not declare it.
 * This adapter checks the method exists at runtime before calling it.
 */
interface RangeDataValidations {
  add(address: string, validation: ExcelJS.DataValidation): void;
}

function rangeDataValidations(sheet: ExcelJS.Worksheet): RangeDataValidations {
  const candidate: unknown = Reflect.get(sheet, 'dataValidations');
  if (typeof candidate === 'object' && candidate !== null && typeof Reflect.get(candidate, 'add') === 'function') {
    return candidate as RangeDataValidations;
  }
  throw new Error('this ExcelJS version does not provide worksheet.dataValidations.add');
}

/**
 * Writes employees to an .xlsx file. Does not validate: callers must use
 * writeValidatedWorkbook in source-workbook.ts.
 */
export async function writeEmployeesWorkbook(employees: readonly EmployeeRecord[], filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  // Fixed metadata so file properties do not depend on the computer clock.
  workbook.creator = 'ACME synthetic data generator';
  workbook.created = new Date(Date.UTC(2026, 0, 1));
  workbook.modified = workbook.created;

  const sheet = workbook.addWorksheet(WORKSHEET_NAME, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((key) => ({
    header: key,
    key,
    width: COLUMN_WIDTHS[key],
    style: MONEY_COLUMNS.has(key) ? { numFmt: MONEY_FORMAT } : {},
  }));
  sheet.getRow(1).font = { bold: true };

  for (const employee of employees) {
    // Explicit column order; null end dates become empty cells.
    sheet.addRow(COLUMNS.map((key) => employee[key] ?? null));
  }

  const lastRow = employees.length + 1;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: COLUMNS.length } };

  const validations = rangeDataValidations(sheet);
  for (const [key, values] of VALIDATION_LISTS) {
    const letter = String.fromCharCode('A'.charCodeAt(0) + COLUMNS.indexOf(key));
    // One range per column. Setting cell.dataValidation per cell makes
    // ExcelJS 4.4.0 emit overlapping ranges (e.g. E2:E10001 and E10:E10001).
    validations.add(`${letter}2:${letter}${lastRow}`, {
      type: 'list',
      allowBlank: false,
      formulae: [`"${values.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid value',
      error: `Choose one of: ${values.join(', ')}`,
    });
  }

  await workbook.xlsx.writeFile(filePath);
}
