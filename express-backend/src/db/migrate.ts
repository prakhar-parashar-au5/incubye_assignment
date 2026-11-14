import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';

import { errorMessage } from '../errors.js';
import { MIGRATIONS_DIR } from '../paths.js';
import { openConnection } from './connection.js';

/** Real SQL migrations: express-backend/db/migrations, from source or dist. */
export const DEFAULT_MIGRATIONS_DIR = MIGRATIONS_DIR;

const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_NAME = 'acme_schema_migrations';
const LOCK_TIMEOUT_SECONDS = 30;

export class MigrationError extends Error {
  readonly migration: string;

  constructor(migration: string, cause: unknown) {
    super(`migration ${migration} failed: ${errorMessage(cause)}`, { cause });
    this.name = 'MigrationError';
    this.migration = migration;
  }
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

// GET_LOCK returns BIGINT: a string because the connection uses bigNumberStrings.
interface LockRow extends RowDataPacket {
  locked: string | number | null;
}
interface MigrationNameRow extends RowDataPacket {
  name: string;
}

/** Ordered migration file names. Rejects .sql files with unexpected names. */
export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const sqlFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  const invalid = sqlFiles.filter((name) => !MIGRATION_FILE.test(name));
  if (invalid.length > 0) {
    throw new Error(`migration file names must match NNN_name.sql: ${invalid.join(', ')}`);
  }
  return sqlFiles.sort();
}

/**
 * Applies pending forward-only migrations in file-name order.
 * A migration is recorded only after all of its SQL succeeds. MySQL commits
 * DDL implicitly, so a failed migration can leave earlier statements applied;
 * fix it with a new corrective migration or by repairing the database.
 */
export async function runMigrations({
  databaseUrl,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
}: { databaseUrl?: string; migrationsDir?: string } = {}): Promise<MigrationResult> {
  const files = await listMigrationFiles(migrationsDir);
  // Migration files are trusted repository content and may hold many statements.
  const connection = await openConnection(databaseUrl, { multipleStatements: true });
  try {
    const [lockRows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, ?) AS locked', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
    if (Number(lockRows[0]?.locked) !== 1) throw new Error('another migration run holds the migration lock');
    try {
      await connection.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
           applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           PRIMARY KEY (name)
         ) ENGINE=InnoDB`,
      );
      const [rows] = await connection.query<MigrationNameRow[]>('SELECT name FROM schema_migrations');
      const recorded = new Set(rows.map((row) => row.name));

      const applied: string[] = [];
      const alreadyApplied = files.filter((name) => recorded.has(name));
      for (const name of files.filter((file) => !recorded.has(file))) {
        const sql = await readFile(path.join(migrationsDir, name), 'utf8');
        try {
          await connection.query(sql);
        } catch (error) {
          throw new MigrationError(name, error);
        }
        await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
        applied.push(name);
      }
      return { applied, alreadyApplied };
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    await connection.end();
  }
}
