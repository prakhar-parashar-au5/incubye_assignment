#!/usr/bin/env node
// Guarded trace fixtures for the AI-traces UI (AI Task 04a).
//
//   APP_ENV=test DATABASE_URL=mysql://…/acme_ai_traces_e2e_test \
//     npm run eval:trace-fixtures -- --database acme_ai_traces_e2e_test [--apply]
//
// Dry run by default. --apply writes every trace and MCP shape through the
// observability repository; a re-run finds them and writes nothing. Run after
// migrations and `npm run db:seed-demo-users`. Reads APP_ENV and DATABASE_URL
// from the injected environment only; never reads .env files. The manifest
// (stdout) maps shapes to IDs and holds no credentials or connection details.
import { parseArgs } from 'node:util';
import type { Pool } from 'mysql2/promise';

import { createPool, resolveDatabaseUrl } from '../src/db/connection.js';
import { errorCode, errorMessage } from '../src/errors.js';
import { databaseNameOf } from '../src/evaluation/fixture-guard.js';
import { prepareTraceFixtures } from '../src/evaluation/trace-fixtures.js';

let pool: Pool | undefined;
try {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, database: { type: 'string' } }, strict: true });
  const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
  pool = createPool(databaseUrl, { connectionLimit: 2 });
  const manifest = await prepareTraceFixtures({ pool, apply: values.apply, appEnv: process.env.APP_ENV, databaseName: databaseNameOf(databaseUrl) ?? '', confirmDatabase: values.database });
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  const code = errorCode(error);
  console.error(`Error: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
