// Static checks on the local MySQL setup (fix 08b): preview uses acme_dev,
// destructive integration tests use acme_test. Behaviour was verified in a
// temporary container; see builder_docs/responses/08b-local-database-isolation.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PACKAGE_ROOT } from '../src/paths.js';
import { requireTestDatabaseUrl } from './support/test-database.js';

const read = (file: string) => readFile(path.join(PACKAGE_ROOT, file), 'utf8');

describe('local database isolation', () => {
  // Detects: a fresh container without the preview database or its grant.
  test('the Docker init script creates acme_dev and grants the local user access', async () => {
    const sql = await read('db/docker-init/01-create-acme-dev.sql');
    assert.match(sql, /CREATE DATABASE IF NOT EXISTS `acme_dev`/);
    assert.match(sql, /GRANT ALL PRIVILEGES ON `acme\\_dev`\.\* TO 'acme'@'%'/);
    // Only acme_dev is created here; acme_test comes from MYSQL_DATABASE. Comments aside,
    // the script drops nothing and creates no schema or data.
    const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    assert.doesNotMatch(statements, /DROP|acme_test|INSERT|CREATE TABLE/i);
  });

  // Detects: the init script not mounted, or acme_test no longer created.
  test('compose mounts the init script read-only and still creates acme_test', async () => {
    const compose = await read('docker-compose.yml');
    assert.match(compose, /- \.\/db\/docker-init:\/docker-entrypoint-initdb\.d:ro/);
    assert.match(compose, /MYSQL_DATABASE: acme_test/);
    assert.match(compose, /"127\.0\.0\.1:3317:3306"/);
    assert.doesNotMatch(compose, /env_file/);
  });

  // Detects: project Compose commands reading a .env file.
  test('project Compose commands still disable .env loading', async () => {
    const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
    const composeScripts = Object.entries(pkg.scripts).filter(([, command]) => command.includes('docker compose'));
    assert.ok(composeScripts.length >= 2);
    for (const [name, command] of composeScripts) assert.match(command, /^COMPOSE_DISABLE_ENV_FILE=1 /, name);
  });

  // Detects: a weakened guard that would let the destructive suite reset the preview database.
  test('the destructive-test guard rejects acme_dev and accepts acme_test', () => {
    assert.throws(() => requireTestDatabaseUrl('mysql://acme:acme_local@127.0.0.1:3317/acme_dev'), /must end with _test/);
    assert.equal(requireTestDatabaseUrl('mysql://acme:acme_local@127.0.0.1:3317/acme_test'), 'acme_test');
  });
});
