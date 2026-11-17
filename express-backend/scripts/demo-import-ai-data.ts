#!/usr/bin/env node
// Copies recorded AI data from an evaluation lane into the demo database (AI Task 06).
//
//   SOURCE_DATABASE_URL=… DATABASE_URL=… APP_ENV=demo \
//     npm run demo:import-ai-data -- --source-database acme_ai_eval_test --target-database acme_demo [--apply]
//
// Dry run by default. Reads SOURCE_DATABASE_URL, DATABASE_URL (the target), and
// APP_ENV from the injected environment only; never reads .env files. Prints
// counts, created HR users, and warnings only: no content, no connection strings.
import { parseArgs } from 'node:util';
import type { Pool } from 'mysql2/promise';

import { createPool, resolveDatabaseUrl } from '../src/db/connection.js';
import { errorCode, errorMessage } from '../src/errors.js';
import { importDemoAiData } from '../src/evaluation/demo-import.js';
import { databaseNameOf } from '../src/evaluation/fixture-guard.js';

let source: Pool | undefined;
let target: Pool | undefined;
try {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false }, 'source-database': { type: 'string' }, 'target-database': { type: 'string' } },
    strict: true,
  });
  const sourceUrl = resolveDatabaseUrl(process.env.SOURCE_DATABASE_URL);
  const targetUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
  source = createPool(sourceUrl, { connectionLimit: 2 });
  target = createPool(targetUrl, { connectionLimit: 2 });
  const report = await importDemoAiData({
    source, target, apply: values.apply, appEnv: process.env.APP_ENV,
    sourceDatabase: databaseNameOf(sourceUrl) ?? '', targetDatabase: databaseNameOf(targetUrl) ?? '',
    confirmSourceDatabase: values['source-database'], confirmTargetDatabase: values['target-database'],
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // mysql2 messages name the host and port, never the password.
  const code = errorCode(error);
  console.error(`Error: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await source?.end();
  await target?.end();
}
