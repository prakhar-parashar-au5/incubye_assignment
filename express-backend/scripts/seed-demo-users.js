#!/usr/bin/env node
// Creates the synthetic demo HR users (Meera Iyer, ADMIN; Rohan Mehta, SCOPED).
// Reads APP_ENV, DATABASE_URL, DEMO_MEERA_PASSWORD, and DEMO_ROHAN_PASSWORD from
// the injected environment only. Never reads .env files. Never prints passwords.
// Run after `npm run db:seed`, which creates the departments the scopes need.
import { ensureDemoUsers } from '../src/access/demo-users.js';
import { createPool, resolveDatabaseUrl } from '../src/db/connection.js';

let pool;
try {
  const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
  const passwords = { meera: process.env.DEMO_MEERA_PASSWORD, rohan: process.env.DEMO_ROHAN_PASSWORD };
  pool = createPool(databaseUrl, { connectionLimit: 1 });
  const results = await ensureDemoUsers(pool, { appEnv: process.env.APP_ENV, passwords });
  for (const { email, result } of results) console.log(`${email}: ${result}`);
} catch (error) {
  console.error(`Error: ${error.code ? `${error.code} ` : ''}${error.message}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
