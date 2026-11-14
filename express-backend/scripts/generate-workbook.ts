#!/usr/bin/env node
// Thin entry point: parse arguments, call the generator, print a short summary.
import { errorMessage } from '../src/errors.js';
import { DEFAULT_WORKBOOK_PATH } from '../src/paths.js';
import { USAGE, UsageError, parseCliArgs } from '../src/source-workbook/cli-options.js';
import { SourceWorkbookError, createSourceWorkbook } from '../src/source-workbook/source-workbook.js';

// express-backend/generated/acme-employees.xlsx from source or dist.
const defaultOutputPath = DEFAULT_WORKBOOK_PATH;

try {
  const options = parseCliArgs(process.argv.slice(2), { defaultOutputPath });
  if (options.help) {
    console.log(USAGE);
  } else {
    const { outputPath, rowCount } = await createSourceWorkbook(options);
    console.log(`Wrote ${rowCount} employee rows to ${outputPath}`);
    console.log(`seed=${options.seed} generation-date=${options.generationDate}`);
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`Error: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (error instanceof SourceWorkbookError) {
    console.error(`Error: ${error.message}`);
    for (const detail of error.details.slice(0, 10)) console.error(`  - ${detail}`);
    process.exitCode = 1;
  } else {
    console.error(`Error: workbook generation failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
