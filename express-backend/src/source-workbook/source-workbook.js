import { constants as fsConstants, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { validateEmployeeDataset } from './employee-dataset.js';
import { generateEmployees } from './employee-generator.js';
import { writeEmployeesWorkbook } from './workbook-writer.js';

export class SourceWorkbookError extends Error {
  /**
   * @param {'OUTPUT_EXISTS' | 'INVALID_DATA'} code
   * @param {string} message
   * @param {string[]} [details]  short, value-free validation messages
   */
  constructor(code, message, details = []) {
    super(message);
    this.name = 'SourceWorkbookError';
    this.code = code;
    this.details = details;
  }
}

function assertCanWrite(outputPath, overwrite) {
  if (!overwrite && existsSync(outputPath)) {
    throw new SourceWorkbookError('OUTPUT_EXISTS', `output file already exists: ${outputPath} (use --overwrite)`);
  }
}

/**
 * Validates the complete data set, then writes it. Writes to a temporary file
 * first, so a failed write never leaves a partial workbook at outputPath.
 */
export async function writeValidatedWorkbook(employees, { outputPath, generationDate, overwrite = false }) {
  const errors = validateEmployeeDataset(employees, { generationDate });
  if (errors.length > 0) {
    throw new SourceWorkbookError('INVALID_DATA', `generated data failed ${errors.length} validation checks`, errors);
  }
  assertCanWrite(outputPath, overwrite);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeEmployeesWorkbook(employees, tempPath);
    if (overwrite) {
      await rename(tempPath, outputPath);
    } else {
      // COPYFILE_EXCL fails if the target appeared after the existence check.
      await copyFile(tempPath, outputPath, fsConstants.COPYFILE_EXCL).catch((error) => {
        if (error.code === 'EEXIST') {
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

/**
 * Generates, validates, and writes the source workbook.
 * @param {{ outputPath: string, seed: number, generationDate: string, overwrite?: boolean }} options
 */
export async function createSourceWorkbook({ outputPath, seed, generationDate, overwrite = false }) {
  assertCanWrite(outputPath, overwrite); // fail fast before generating
  const employees = generateEmployees({ seed, generationDate });
  return writeValidatedWorkbook(employees, { outputPath, generationDate, overwrite });
}
