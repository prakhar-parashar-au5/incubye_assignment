#!/usr/bin/env node
// Thin entry point for the destructive development/test/demo seed.
// Reads APP_ENV and DATABASE_URL from the injected environment only.
import path from 'node:path';
import { parseArgs } from 'node:util';

import { errorCode, errorMessage } from '../src/errors.js';
import { SeedRefusedError } from '../src/seed/seed-safety.js';
import { seedDatabase } from '../src/seed/seed-database.js';
import { WorkbookError } from '../src/seed/workbook-reader.js';

const USAGE = `Usage: APP_ENV=<development|test|demo> DATABASE_URL=<mysql url> npm run db:seed -- --replace [options]

  --replace                   required; deletes all employees and compensation records first
  --workbook <path>           .xlsx file to load (default: generated/acme-employees.xlsx)
  --generation-date <date>    YYYY-MM-DD date the workbook was generated for (default: 2026-11-14)`;

const OPTIONS = {
  replace: { type: 'boolean', default: false },
  workbook: { type: 'string' },
  'generation-date': { type: 'string' },
} as const;

function parseOptions() {
  try {
    return parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: OPTIONS }).values;
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}\n\n${USAGE}`);
    process.exit(2);
  }
}

const options = parseOptions();

try {
  const result = await seedDatabase({
    databaseUrl: process.env.DATABASE_URL,
    appEnv: process.env.APP_ENV,
    replace: options.replace,
    workbookPath: options.workbook === undefined ? undefined : path.resolve(options.workbook),
    generationDate: options['generation-date'],
  });
  console.log(`Seeded ${result.employees} employees and ${result.compensationRecords} compensation records.`);
} catch (error) {
  if (error instanceof SeedRefusedError) {
    console.error(`Error: ${error.message}`);
  } else if (error instanceof WorkbookError) {
    console.error(`Error: ${error.message}`);
    for (const detail of error.details.slice(0, 10)) console.error(`  - ${detail}`);
  } else {
    // mysql2 messages name the host and port, never the password.
    const code = errorCode(error);
    console.error(`Error: seed failed: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  }
  process.exitCode = 1;
}
