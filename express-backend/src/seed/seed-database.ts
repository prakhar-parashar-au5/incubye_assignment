import { performance } from 'node:perf_hooks';

import { openConnection, resolveDatabaseUrl } from '../db/connection.js';
import { DEFAULT_WORKBOOK_PATH as PACKAGE_WORKBOOK_PATH } from '../paths.js';
import { DEFAULT_GENERATION_DATE } from '../source-workbook/constants.js';
import type { EmployeeRecord } from '../source-workbook/constants.js';
import { validateEmployeeDataset } from '../source-workbook/employee-dataset.js';
import { assertSeedAllowed } from './seed-safety.js';
import { ensureReferenceData, resolveJobTitleIds } from './reference-data.js';
import { DEFAULT_BATCH_SIZE, replaceEmployeeData } from './replace-employees.js';
import type { ReplacementCounts } from './replace-employees.js';
import { WorkbookError, readEmployeeWorkbook } from './workbook-reader.js';
import type { SeedEmployeeRow } from './workbook-reader.js';

/** express-backend/generated/acme-employees.xlsx, from source or dist. */
export const DEFAULT_WORKBOOK_PATH = PACKAGE_WORKBOOK_PATH;

export interface SeedOptions {
  databaseUrl?: string | undefined;
  workbookPath?: string | undefined;
  replace: unknown;
  appEnv: unknown;
  generationDate?: string | undefined;
  batchSize?: number;
}

export interface SeedResult extends ReplacementCounts {
  replaceMs: number;
}

/** Converts a database row back to the validator's employee shape. */
function toValidatorShape({ employee_code: employeeCode, annual_base_salary: salary, annual_bonus: bonus, ...rest }: SeedEmployeeRow): EmployeeRecord {
  return { employee_id: employeeCode, ...rest, annual_base_salary: Number(salary), annual_bonus: Number(bonus) };
}

/**
 * Replaces all employee and compensation data with the workbook contents.
 * Order: safety checks, workbook validation, reference data, one replacement
 * transaction. Nothing is deleted unless every earlier step succeeds.
 */
export async function seedDatabase({
  databaseUrl,
  workbookPath = DEFAULT_WORKBOOK_PATH,
  replace,
  appEnv,
  generationDate = DEFAULT_GENERATION_DATE,
  batchSize = DEFAULT_BATCH_SIZE,
}: SeedOptions): Promise<SeedResult> {
  assertSeedAllowed({ replace, appEnv });
  const url = resolveDatabaseUrl(databaseUrl);

  const rows = await readEmployeeWorkbook(workbookPath, { generationDate });
  const datasetErrors = validateEmployeeDataset(rows.map(toValidatorShape), { generationDate });
  if (datasetErrors.length > 0) {
    throw new WorkbookError(`workbook failed ${datasetErrors.length} data set checks`, datasetErrors);
  }

  const connection = await openConnection(url);
  try {
    const titleIds = await ensureReferenceData(connection);
    const resolved = resolveJobTitleIds(rows, titleIds); // throws before any deletion
    const started = performance.now();
    const counts = await replaceEmployeeData(connection, resolved, { batchSize });
    return { ...counts, replaceMs: Math.round(performance.now() - started) };
  } finally {
    await connection.end();
  }
}
