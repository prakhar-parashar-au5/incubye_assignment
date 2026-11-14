import path from 'node:path';
import { parseArgs } from 'node:util';

import { errorMessage } from '../errors.js';
import { DEFAULT_GENERATION_DATE, DEFAULT_SEED, EARLIEST_HIRE_DATE } from './constants.js';
import { isIsoDate } from './iso-date.js';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `Usage: npm run generate:workbook -- [options]

  --output <path>             .xlsx file to create (default: generated/acme-employees.xlsx)
  --seed <integer>            random seed, 0..4294967295 (default: ${DEFAULT_SEED})
  --generation-date <date>    fixed YYYY-MM-DD date (default: ${DEFAULT_GENERATION_DATE})
  --overwrite                 replace the output file if it already exists
  --help                      show this message`;

export interface GeneratorCliOptions {
  help: boolean;
  outputPath: string;
  seed: number;
  generationDate: string;
  overwrite: boolean;
}

function parseSeed(text: string): number {
  if (!/^\d+$/.test(text) || Number(text) > 0xffffffff) {
    throw new UsageError('--seed must be an integer from 0 to 4294967295');
  }
  return Number(text);
}

const OPTIONS = {
  output: { type: 'string' },
  seed: { type: 'string' },
  'generation-date': { type: 'string' },
  overwrite: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} as const;

/**
 * Turns command-line arguments into generator options. No side effects.
 * @param argv  arguments after the script name
 */
export function parseCliArgs(argv: string[], { defaultOutputPath }: { defaultOutputPath: string }): GeneratorCliOptions {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: OPTIONS }));
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }

  const outputPath = values.output === undefined ? defaultOutputPath : path.resolve(values.output);
  if (path.extname(outputPath).toLowerCase() !== '.xlsx') {
    throw new UsageError('--output must end with .xlsx');
  }

  const generationDate = values['generation-date'] ?? DEFAULT_GENERATION_DATE;
  if (!isIsoDate(generationDate) || generationDate <= EARLIEST_HIRE_DATE) {
    throw new UsageError(`--generation-date must be a real YYYY-MM-DD date after ${EARLIEST_HIRE_DATE}`);
  }

  return {
    help: values.help,
    outputPath,
    seed: values.seed === undefined ? DEFAULT_SEED : parseSeed(values.seed),
    generationDate,
    overwrite: values.overwrite,
  };
}
