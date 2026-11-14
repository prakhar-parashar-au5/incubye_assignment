import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { runMigrations } from '../../src/db/migrate.js';
import { resetTestDatabase, testDatabaseUrl } from '../support/test-database.js';
import { selectRows } from '../support/db.js';
import { must } from '../support/must.js';
import { thrown } from '../support/thrown.js';
import type { Connection } from 'mysql2/promise';

// Refuses to run unless DATABASE_URL names a database ending in _test.
const DATABASE_URL = testDatabaseUrl();

// The runner is tested with tiny hand-written migrations, not the real schema.
describe('runMigrations', () => {
  let connection: Connection;
  let dir: string;

  before(async () => {
    connection = await mysql.createConnection({ uri: DATABASE_URL });
  });
  after(async () => {
    await connection.end();
  });
  beforeEach(async () => {
    await resetTestDatabase(DATABASE_URL);
    dir = await mkdtemp(path.join(tmpdir(), 'acme-migrations-'));
  });

  const writeMigration = (name: string, sql: string): Promise<void> => writeFile(path.join(dir, name), sql);
  const recorded = async (): Promise<unknown[]> => {
    const rows = await selectRows(connection, 'SELECT name FROM schema_migrations ORDER BY name');
    return rows.map((r) => r.name);
  };
  const tableExists = async (name: string): Promise<boolean> => {
    const rows = await selectRows(
      connection,
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [name],
    );
    return must(rows[0], 'a count row').n === 1;
  };

  // Detects: directory-order or numeric-parse ordering (010 before 002), and
  // migrations applied without a record.
  test('applies pending files in file-name order and records each one', async () => {
    await writeMigration('010_add_third.sql', "INSERT INTO widgets (id, label) VALUES (3, 'third');");
    await writeMigration('001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY, label VARCHAR(20) NOT NULL);');
    await writeMigration('002_add_first.sql', "INSERT INTO widgets (id, label) VALUES (1, 'first');");

    const result = await runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir });

    assert.deepEqual(result.applied, ['001_create_widgets.sql', '002_add_first.sql', '010_add_third.sql']);
    assert.deepEqual(await recorded(), ['001_create_widgets.sql', '002_add_first.sql', '010_add_third.sql']);
    const rows = await selectRows(connection, 'SELECT id FROM widgets ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), [1, 3]);
  });

  // Detects: a runner that re-applies recorded migrations (duplicate rows, or
  // "table already exists" failures on every deploy).
  test('does not apply an already recorded migration again', async () => {
    await writeMigration('001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY, label VARCHAR(20) NOT NULL);');
    await writeMigration('002_add_first.sql', "INSERT INTO widgets (id, label) VALUES (1, 'first');");
    await runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir });

    const second = await runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir });

    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.alreadyApplied, ['001_create_widgets.sql', '002_add_first.sql']);
    const rows = await selectRows(connection, 'SELECT COUNT(*) AS n FROM widgets');
    assert.equal(must(rows[0], 'a count row').n, 1);
  });

  // Detects: a runner that skips new files once any migration is recorded.
  test('applies only the new file on a later run', async () => {
    await writeMigration('001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY, label VARCHAR(20) NOT NULL);');
    await runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir });
    await writeMigration('002_add_first.sql', "INSERT INTO widgets (id, label) VALUES (1, 'first');");

    const result = await runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir });

    assert.deepEqual(result.applied, ['002_add_first.sql']);
    assert.deepEqual(await recorded(), ['001_create_widgets.sql', '002_add_first.sql']);
  });

  // Detects: a failed migration recorded as applied (it would never be retried),
  // or later migrations applied on top of a failure.
  test('stops at a failing migration and does not record it', async () => {
    await writeMigration('001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY);');
    await writeMigration('002_broken.sql', 'CREATE TABLE partial_one (id INT PRIMARY KEY);\nTHIS IS NOT SQL;');
    await writeMigration('003_after.sql', 'CREATE TABLE after_failure (id INT PRIMARY KEY);');

    await assert.rejects(
      runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir }),
      (error: unknown) => thrown(error).migration === '002_broken.sql' && /002_broken\.sql/.test(thrown(error).message),
    );

    assert.deepEqual(await recorded(), ['001_create_widgets.sql']);
    assert.equal(await tableExists('after_failure'), false);
    // MySQL auto-commits DDL: the statement before the error persists.
    // This is why migrations are forward-only and must be fixed forward.
    assert.equal(await tableExists('partial_one'), true);
  });

  // Detects: a mistyped file name (e.g. "1_x.sql") being skipped silently.
  test('rejects a .sql file that does not follow the NNN_name.sql pattern', async () => {
    await writeMigration('001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY);');
    await writeMigration('2_bad_name.sql', 'SELECT 1;');
    await assert.rejects(runMigrations({ databaseUrl: DATABASE_URL, migrationsDir: dir }), /2_bad_name\.sql/);
    assert.equal(await tableExists('widgets'), false);
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
});
