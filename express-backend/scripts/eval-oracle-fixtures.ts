#!/usr/bin/env node
// Evaluator-only oracle fixtures for the Checkpoint C AI evaluation.
//
//   APP_ENV=test DATABASE_URL=mysql://…/acme_ai_eval_test \
//     npm run eval:oracle-fixtures -- --database acme_ai_eval_test [--apply] > manifest.json
//
// Dry run by default: validates the guards, previews each change, and prints
// the planned manifest. --apply writes the changes through the salary
// adjustment service and prints the applied manifest. Re-running finds the
// existing fixtures and writes nothing new. Reads APP_ENV and DATABASE_URL
// from the injected environment only; never reads .env files. The manifest
// (stdout) holds no credentials, connection details, or internal IDs.
import { parseArgs } from 'node:util';
import type { Pool } from 'mysql2/promise';

import { createPool, resolveDatabaseUrl } from '../src/db/connection.js';
import { errorCode, errorMessage } from '../src/errors.js';
import { databaseNameOf, prepareOracleFixtures } from '../src/evaluation/oracle-fixtures.js';

let pool: Pool | undefined;
try {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, database: { type: 'string' } }, strict: true });
  const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
  const databaseName = databaseNameOf(databaseUrl) ?? '';
  pool = createPool(databaseUrl, { connectionLimit: 2 });
  const manifest = await prepareOracleFixtures({ pool, apply: values.apply, appEnv: process.env.APP_ENV, databaseName, confirmDatabase: values.database });
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  const code = errorCode(error);
  console.error(`Error: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
