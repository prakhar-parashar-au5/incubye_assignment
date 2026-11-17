import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CreateDatabaseError, targetDatabase } from '../src/db/create-database.js';

const SCRIPT = fileURLToPath(new URL('../scripts/create-database.ts', import.meta.url));

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, ...env } });
}

describe('targetDatabase', () => {
  test('splits the database name from the server URL and keeps query options', () => {
    const { name, serverUrl } = targetDatabase('mysql://user:pw@mysql.railway.internal:3306/acme_demo?ssl=false');
    assert.equal(name, 'acme_demo');
    assert.equal(serverUrl, 'mysql://user:pw@mysql.railway.internal:3306/?ssl=false');
  });

  // Detects: SQL injection through the interpolated CREATE DATABASE name.
  for (const bad of ['mysql://u:p@h:3306/acme`; DROP DATABASE x; --', 'mysql://u:p@h:3306/Acme_Demo', 'mysql://u:p@h:3306/', 'mysql://u:p@h:3306/a/b', 'mysql://u:p@h:3306/acme%60demo']) {
    test(`refuses database path in ${JSON.stringify(bad)}`, () => {
      assert.throws(() => targetDatabase(bad), CreateDatabaseError);
    });
  }

  test('refuses a non-mysql URL and a missing URL', () => {
    assert.throws(() => targetDatabase('postgres://u:p@h:5432/acme_demo'), CreateDatabaseError);
    assert.throws(() => targetDatabase('not a url'), CreateDatabaseError);
    assert.throws(() => targetDatabase(undefined), /DATABASE_URL is not set/);
  });
});

describe('create-database command', () => {
  // Detects: credentials printed in error output. Port 1 is never a MySQL server.
  test('fails without printing the URL or password', () => {
    const result = run({ DATABASE_URL: 'mysql://demo_user:leak-check-pw@127.0.0.1:1/acme_demo' });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /ECONNREFUSED/);
    for (const secret of ['leak-check-pw', 'demo_user', 'mysql://']) assert.ok(!output.includes(secret), 'output contains a secret value');
  });

  test('refuses an unsafe database name before connecting', () => {
    const result = run({ DATABASE_URL: 'mysql://u:p@127.0.0.1:1/bad-name' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /lowercase letters, digits, and underscores/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  });
});
