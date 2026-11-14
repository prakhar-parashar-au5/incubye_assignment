import { constants as fsConstants, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { errorCode } from '../errors.js';
import type { EmployeeRecord } from './constants.js';
import { validateEmployeeDataset } from './employee-dataset.js';
import { generateEmployees } from './employee-generator.js';
import type { UnvalidatedEmployee } from './employee-validator.js';
import { writeEmployeesWorkbook } from './workbook-writer.js';

export type SourceWorkbookErrorCode = 'OUTPUT_EXISTS' | 'INVALID_DATA';

export class SourceWorkbookError extends Error {
  readonly code: SourceWorkbookErrorCode;
  /** Short, value-free validation messages. */
  readonly details: readonly string[];

  constructor(code: SourceWorkbookErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'SourceWorkbookError';
    this.code = code;
    this.details = details;
  }
}

export interface WorkbookResult {
  outputPath: string;
  rowCount: number;
}

function assertCanWrite(outputPath: string, overwrite: boolean): void {
  if (!overwrite && existsSync(outputPath)) {
    throw new SourceWorkbookError('OUTPUT_EXISTS', `output file already exists: ${outputPath} (use --overwrite)`);
  }
}

/**
 * Validates the complete data set, then writes it. Writes to a temporary file
 * first, so a failed write never leaves a partial workbook at outputPath.
 */
export async function writeValidatedWorkbook(
  employees: readonly UnvalidatedEmployee[],
  { outputPath, generationDate, overwrite = false }: { outputPath: string; generationDate: string; overwrite?: boolean },
): Promise<WorkbookResult> {
  const errors = validateEmployeeDataset(employees, { generationDate });
  if (errors.length > 0) {
    throw new SourceWorkbookError('INVALID_DATA', `generated data failed ${errors.length} validation checks`, errors);
  }
  // Runtime validation above proved every row matches EmployeeRecord.
  const validEmployees = employees as readonly EmployeeRecord[];
  assertCanWrite(outputPath, overwrite);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeEmployeesWorkbook(validEmployees, tempPath);
    if (overwrite) {
      await rename(tempPath, outputPath);
    } else {
      // COPYFILE_EXCL fails if the target appeared after the existence check.
      await copyFile(tempPath, outputPath, fsConstants.COPYFILE_EXCL).catch((error: unknown) => {
        if (errorCode(error) === 'EEXIST') {
          throw new SourceWorkbookError('OUTPUT_EXISTS', `output file already exists: ${outputPath} (use --overwrite)`);
        }
        throw error;
      });
    }
  } finally {
    await rm(tempPath, { force: true });
  }
  return { outputPath, rowCount: employees.length };
}

export interface CreateSourceWorkbookOptions {
  outputPath: string;
  seed: number;
  generationDate: string;
  overwrite?: boolean;
}

/** Generates, validates, and writes the source workbook. */
export async function createSourceWorkbook({
  outputPath,
  seed,
  generationDate,
  overwrite = false,
}: CreateSourceWorkbookOptions): Promise<WorkbookResult> {
  assertCanWrite(outputPath, overwrite); // fail fast before generating
  const employees = generateEmployees({ seed, generationDate });
  return writeValidatedWorkbook(employees, { outputPath, generationDate, overwrite });
}
