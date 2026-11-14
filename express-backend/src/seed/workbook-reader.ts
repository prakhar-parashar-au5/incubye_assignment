import ExcelJS from 'exceljs';

import { COLUMNS, WORKSHEET_NAME } from '../source-workbook/constants.js';
import type {
  Column,
  CountryCode,
  Currency,
  Department,
  EmployeeRecord,
  EmploymentStatus,
  Level,
  PayFrequency,
} from '../source-workbook/constants.js';
import { toMinorUnits, validateEmployee } from '../source-workbook/employee-validator.js';

const MONEY_FIELDS = new Set<Column>(['annual_base_salary', 'annual_bonus']);
const DATE_FIELDS = new Set<Column>(['hire_date', 'employment_end_date', 'salary_effective_date']);
const MAX_REPORTED_ERRORS = 20;

/**
 * An exact money amount with two decimals, e.g. "1000000.10", ready for a
 * MySQL DECIMAL(15,2) column. Only toDecimalString creates one, so a plain
 * number (or an unchecked string) cannot be passed where money is required.
 */
export type DecimalString = string & { readonly __brand: 'DecimalString' };

/** A validated workbook row, shaped for the database seed. */
export interface SeedEmployeeRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: Department;
  job_title: string;
  level: Level;
  country_code: CountryCode;
  currency: Currency;
  employment_status: EmploymentStatus;
  hire_date: string;
  employment_end_date: string | null;
  annual_base_salary: DecimalString;
  pay_frequency: PayFrequency;
  annual_bonus: DecimalString;
  salary_effective_date: string;
}

export class WorkbookError extends Error {
  readonly code = 'INVALID_WORKBOOK';
  /** Short, value-free messages. */
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'WorkbookError';
    this.details = details;
  }
}

/** Exact two-decimal string for a money number. Never rounds. */
export function toDecimalString(amount: unknown): DecimalString {
  const minor = toMinorUnits(amount);
  if (minor === null) throw new RangeError('money must be a number with at most two decimal places');
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  // The only place a DecimalString is created: the format is fixed above.
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}` as DecimalString;
}

function isFormula(cell: ExcelJS.Cell): boolean {
  // Library-type gap: ExcelJS sets cell.sharedFormula at runtime for shared
  // formulas, but its Cell type does not declare the property.
  return cell.type === ExcelJS.ValueType.Formula || cell.formula !== undefined || Reflect.get(cell, 'sharedFormula') !== undefined;
}

function checkHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= Math.max(headerRow.cellCount, COLUMNS.length); c += 1) {
    const value = headerRow.getCell(c).value;
    if (value !== null && value !== undefined) headers.push(String(value));
  }
  const columnNames: readonly string[] = COLUMNS;
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) errors.push(`repeated header: ${header}`);
    seen.add(header);
    if (!columnNames.includes(header)) errors.push(`unexpected header: ${header}`);
  }
  for (const column of COLUMNS) {
    if (!seen.has(column)) errors.push(`missing header: ${column}`);
  }
  if (errors.length === 0 && headers.some((header, i) => header !== COLUMNS[i])) {
    errors.push(`header order must be: ${COLUMNS.join(', ')}`);
  }
  return errors;
}

/** Converts one cell to the validator's employee shape. Returns [value, error]. */
function readCell(cell: ExcelJS.Cell, field: Column): [unknown, string | null] {
  if (isFormula(cell)) return [null, 'formula cells are not allowed'];
  const value: unknown = cell.value;
  if (value === null || value === undefined) return [null, null];
  if (MONEY_FIELDS.has(field)) {
    return typeof value === 'number' ? [value, null] : [null, 'must be a numeric cell'];
  }
  if (DATE_FIELDS.has(field) && typeof value !== 'string') return [null, 'must be YYYY-MM-DD text'];
  return typeof value === 'string' ? [value, null] : [null, 'must be a text cell'];
}

function isEmptyRow(row: ExcelJS.Row): boolean {
  for (let c = 1; c <= Math.max(row.cellCount, COLUMNS.length); c += 1) {
    const value = row.getCell(c).value;
    if (value !== null && value !== undefined && value !== '') return false;
  }
  return true;
}

function toDatabaseRow(employee: EmployeeRecord): SeedEmployeeRow {
  return {
    employee_code: employee.employee_id,
    first_name: employee.first_name,
    last_name: employee.last_name,
    email: employee.email,
    department: employee.department,
    job_title: employee.job_title,
    level: employee.level,
    country_code: employee.country_code,
    currency: employee.currency,
    employment_status: employee.employment_status,
    hire_date: employee.hire_date,
    employment_end_date: employee.employment_end_date,
    annual_base_salary: toDecimalString(employee.annual_base_salary),
    pay_frequency: employee.pay_frequency,
    annual_bonus: toDecimalString(employee.annual_bonus),
    salary_effective_date: employee.salary_effective_date,
  };
}

/**
 * Reads and validates the Employees worksheet. Returns rows ready for the
 * database: stable employee_code, ISO date text, and money as exact strings.
 * Throws WorkbookError with value-free messages. Does not check data-set
 * totals; the seed does that with validateEmployeeDataset.
 *
 * @param options.generationDate  date rules depend on it
 */
export async function readEmployeeWorkbook(
  filePath: string,
  { generationDate }: { generationDate: string },
): Promise<SeedEmployeeRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    throw new WorkbookError('workbook cannot be read as an .xlsx file');
  }

  const sheet = workbook.getWorksheet(WORKSHEET_NAME);
  if (!sheet) throw new WorkbookError(`worksheet ${WORKSHEET_NAME} not found`);
  if (workbook.worksheets.length !== 1) {
    throw new WorkbookError(`workbook must contain exactly one worksheet (${WORKSHEET_NAME}); found ${workbook.worksheets.length}`);
  }
  if (sheet.actualRowCount === 0) throw new WorkbookError('workbook is empty');

  const headerErrors = checkHeaders(sheet);
  if (headerErrors.length > 0) throw new WorkbookError('workbook headers do not match the template', headerErrors);

  const errors: string[] = [];
  let errorCount = 0;
  const report = (message: string): void => {
    errorCount += 1;
    if (errorCount <= MAX_REPORTED_ERRORS) errors.push(message);
  };

  const employees: Partial<Record<Column, unknown>>[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (isEmptyRow(row)) continue;

    for (let c = COLUMNS.length + 1; c <= row.cellCount; c += 1) {
      const extra = row.getCell(c);
      if (isFormula(extra) || (extra.value !== null && extra.value !== undefined)) {
        report(`row ${r}: value outside the ${COLUMNS.length} template columns`);
      }
    }

    const employee: Partial<Record<Column, unknown>> = {};
    let rowHasCellError = false;
    COLUMNS.forEach((field, i) => {
      const [value, error] = readCell(row.getCell(i + 1), field);
      if (error) {
        report(`row ${r} ${field}: ${error}`);
        rowHasCellError = true;
      }
      employee[field] = value;
    });
    if (rowHasCellError) continue;

    for (const { field, message } of validateEmployee(employee, { generationDate })) {
      report(`row ${r} ${field}: ${message}`);
    }
    employees.push(employee);
  }

  if (errorCount > MAX_REPORTED_ERRORS) errors.push(`... and ${errorCount - MAX_REPORTED_ERRORS} more errors`);
  if (errors.length > 0) throw new WorkbookError(`workbook has ${errorCount} invalid cells or rows`, errors);
  if (employees.length === 0) throw new WorkbookError('workbook has no employee rows');

  // Every row reached here passed readCell and validateEmployee with no errors.
  return (employees as EmployeeRecord[]).map(toDatabaseRow);
}
