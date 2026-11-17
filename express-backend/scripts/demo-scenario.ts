#!/usr/bin/env node
// Demo scenario: salary changes, salary requests, and HR-access events through
// the product's own services (AI Task 06).
//
//   DATABASE_URL=… APP_ENV=demo npm run demo:scenario -- --database acme_demo [--apply]
//
// Dry run by default; a re-run writes nothing. Reads DATABASE_URL and APP_ENV
// from the injected environment only; never reads .env files. Prints what was
// created (employee codes, request IDs, HR-user emails); never passwords or
// connection strings.
import { parseArgs } from 'node:util';
import type { Pool } from 'mysql2/promise';

import { createPool, resolveDatabaseUrl } from '../src/db/connection.js';
import { errorCode, errorMessage } from '../src/errors.js';
import { runDemoScenario } from '../src/evaluation/demo-scenario.js';
import { databaseNameOf } from '../src/evaluation/fixture-guard.js';

let pool: Pool | undefined;
try {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, database: { type: 'string' } }, strict: true });
  const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
  pool = createPool(databaseUrl, { connectionLimit: 2 });
  const report = await runDemoScenario({ pool, apply: values.apply, appEnv: process.env.APP_ENV, databaseName: databaseNameOf(databaseUrl) ?? '', confirmDatabase: values.database });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // mysql2 messages name the host and port, never the password.
  const code = errorCode(error);
  console.error(`Error: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
