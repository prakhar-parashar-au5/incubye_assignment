// Small hand-written .xlsx files for parser tests.
import ExcelJS from 'exceljs';

export const APPROVED_HEADERS: readonly string[] = Object.freeze([
  'employee_id', 'first_name', 'last_name', 'email', 'department', 'job_title', 'level',
  'country_code', 'currency', 'employment_status', 'hire_date', 'employment_end_date',
  'annual_base_salary', 'pay_frequency', 'annual_bonus', 'salary_effective_date',
]);

/** A workbook row as cells: tests put deliberately wrong values in it. */
export type FixtureRow = Record<string, unknown>;

/** One valid India employee as written in a workbook row. */
export function validRow(overrides: FixtureRow = {}): FixtureRow {
  return {
    employee_id: 'ACME00001',
    first_name: 'Aditi',
    last_name: 'Sharma',
    email: 'aditi.sharma.acme00001@acme.com',
    department: 'Tech',
    job_title: 'Senior Software Engineer',
    level: 'SENIOR',
    country_code: 'IN',
    currency: 'INR',
    employment_status: 'CURRENTLY_WORKING',
    hire_date: '2022-08-14',
    employment_end_date: null,
    annual_base_salary: 2500000,
    pay_frequency: 'MONTHLY',
    annual_bonus: 250000,
    salary_effective_date: '2025-04-01',
    ...overrides,
  };
}

export interface TestWorkbookOptions {
  sheetName?: string;
  headers?: readonly string[];
  rows?: readonly FixtureRow[];
  extraSheet?: string;
  cell?: (sheet: ExcelJS.Worksheet) => void;
}

/** Writes a small workbook. */
export async function writeTestWorkbook(filePath: string, {
  sheetName = 'Employees',
  headers = APPROVED_HEADERS,
  rows = [validRow()],
  extraSheet,
  cell,
}: TestWorkbookOptions = {}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (headers.length > 0) sheet.addRow([...headers]);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  if (extraSheet) workbook.addWorksheet(extraSheet).addRow(['note']);
  if (cell) cell(sheet);
  await workbook.xlsx.writeFile(filePath);
}
