// Destructive replacement of employee and compensation data in one transaction.
import type { Connection, RowDataPacket } from 'mysql2/promise';

import type { ChangeReason } from '../source-workbook/constants.js';
import type { SeedEmployeeRow } from './workbook-reader.js';

const INITIAL_IMPORT: ChangeReason = 'INITIAL_IMPORT';

// 1,000 rows per INSERT: 10,000 placeholders for employees (limit 65,535 per
// prepared statement), about 200 KB per statement (well under the 64 MB
// max_allowed_packet default), and 10 round trips per table.
export const DEFAULT_BATCH_SIZE = 1000;

/** A validated seed row with its resolved job title. */
export type ReplacementRow = SeedEmployeeRow & { job_title_id: number };

export interface ReplacementCounts {
  employees: number;
  compensationRecords: number;
}

type SqlValue = string | number | null;

const EMPLOYEE_COLUMNS = [
  'employee_code', 'first_name', 'last_name', 'email', 'job_title_id', 'country_code',
  'employment_status', 'hire_date', 'employment_end_date',
] as const;
const COMPENSATION_COLUMNS = [
  'employee_id', 'version', 'annual_base_salary', 'annual_bonus', 'currency',
  'pay_frequency', 'effective_from', 'change_reason',
] as const;

interface CountRow extends RowDataPacket {
  n: string | number;
}
interface EmployeeIdRow extends RowDataPacket {
  id: number;
  employee_code: string;
}

/** Parameterized multi-row INSERT. Table and column names are constants, never input. */
async function insertInBatches(
  connection: Connection,
  table: 'employees' | 'compensation_records',
  columns: readonly string[],
  valueRows: readonly SqlValue[][],
  batchSize: number,
): Promise<void> {
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  for (let start = 0; start < valueRows.length; start += batchSize) {
    const batch = valueRows.slice(start, start + batchSize);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${batch.map(() => rowPlaceholder).join(', ')}`;
    await connection.execute(sql, batch.flat());
  }
}

async function countRows(connection: Connection, table: 'employees' | 'compensation_records'): Promise<number> {
  const [rows] = await connection.query<CountRow[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

/**
 * Deletes all compensation records, change requests, and employees, then inserts the given rows
 * with one version 1 INITIAL_IMPORT compensation record each. Any failure
 * rolls back everything, including the deletes. Uses DELETE (transactional),
 * never TRUNCATE (implicit commit). Auto-increment values are not reset.
 *
 * @param connection  one dedicated connection; not a pool
 * @param rows        validated rows that already carry job_title_id
 */
export async function replaceEmployeeData(
  connection: Connection,
  rows: readonly ReplacementRow[],
  { batchSize = DEFAULT_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<ReplacementCounts> {
  await connection.beginTransaction();
  try {
    // Salary-adjustment history references compensation records (previous
    // record, source request) and employees. Delete newest records first so a
    // record is never deleted before the record that references it.
    await connection.query('DELETE FROM compensation_records ORDER BY id DESC');
    await connection.query('DELETE FROM compensation_change_requests');
    await connection.query('DELETE FROM employees');

    await insertInBatches(
      connection,
      'employees',
      EMPLOYEE_COLUMNS,
      rows.map((r) => [
        r.employee_code, r.first_name, r.last_name, r.email, r.job_title_id, r.country_code,
        r.employment_status, r.hire_date, r.employment_end_date,
      ]),
      batchSize,
    );

    const [idRows] = await connection.query<EmployeeIdRow[]>('SELECT id, employee_code FROM employees');
    const idByCode = new Map(idRows.map((r) => [r.employee_code, r.id]));

    await insertInBatches(
      connection,
      'compensation_records',
      COMPENSATION_COLUMNS,
      rows.map((r) => {
        const employeeId = idByCode.get(r.employee_code);
        if (employeeId === undefined) throw new Error(`inserted employee ${r.employee_code} not found`);
        return [
          employeeId, 1, r.annual_base_salary, r.annual_bonus, r.currency,
          r.pay_frequency, r.salary_effective_date, INITIAL_IMPORT,
        ];
      }),
      batchSize,
    );

    const employees = await countRows(connection, 'employees');
    const compensationRecords = await countRows(connection, 'compensation_records');
    if (employees !== rows.length || compensationRecords !== rows.length) {
      throw new Error(`count check failed: expected ${rows.length}, got ${employees} employees and ${compensationRecords} compensation records`);
    }

    await connection.commit();
    return { employees, compensationRecords };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Keep the original error; the connection is closed by the caller.
    }
    throw error;
  }
}
