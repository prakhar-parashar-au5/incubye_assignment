// Destructive replacement of employee and compensation data in one transaction.

// 1,000 rows per INSERT: 10,000 placeholders for employees (limit 65,535 per
// prepared statement), about 200 KB per statement (well under the 64 MB
// max_allowed_packet default), and 10 round trips per table.
export const DEFAULT_BATCH_SIZE = 1000;

const EMPLOYEE_COLUMNS = [
  'employee_code', 'first_name', 'last_name', 'email', 'job_title_id', 'country_code',
  'employment_status', 'hire_date', 'employment_end_date',
];
const COMPENSATION_COLUMNS = [
  'employee_id', 'version', 'annual_base_salary', 'annual_bonus', 'currency',
  'pay_frequency', 'effective_from', 'change_reason',
];

/** Parameterized multi-row INSERT. Table and column names are constants, never input. */
async function insertInBatches(connection, table, columns, valueRows, batchSize) {
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  for (let start = 0; start < valueRows.length; start += batchSize) {
    const batch = valueRows.slice(start, start + batchSize);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${batch.map(() => rowPlaceholder).join(', ')}`;
    await connection.execute(sql, batch.flat());
  }
}

async function countRows(connection, table) {
  const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(n);
}

/**
 * Deletes all compensation records and employees, then inserts the given rows
 * with one version 1 INITIAL_IMPORT compensation record each. Any failure
 * rolls back everything, including the deletes. Uses DELETE (transactional),
 * never TRUNCATE (implicit commit). Auto-increment values are not reset.
 *
 * @param connection  one dedicated connection; not a pool
 * @param rows        validated rows that already carry job_title_id
 */
export async function replaceEmployeeData(connection, rows, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  await connection.beginTransaction();
  try {
    await connection.query('DELETE FROM compensation_records');
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

    const [idRows] = await connection.query('SELECT id, employee_code FROM employees');
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
          r.pay_frequency, r.salary_effective_date, 'INITIAL_IMPORT',
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
