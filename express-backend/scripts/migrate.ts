#!/usr/bin/env node
// Thin entry point: applies pending migrations to the database named by the
// injected DATABASE_URL environment variable. Never reads .env files.
import { MigrationError, runMigrations } from '../src/db/migrate.js';
import { errorMessage } from '../src/errors.js';

try {
  const { applied, alreadyApplied } = await runMigrations({ databaseUrl: process.env.DATABASE_URL });
  console.log(`Applied ${applied.length} migration(s); ${alreadyApplied.length} already applied.`);
  for (const name of applied) console.log(`  + ${name}`);
} catch (error) {
  const message = error instanceof MigrationError ? error.message : `migration run failed: ${errorMessage(error)}`;
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
