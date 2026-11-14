import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSourceWorkbook } from '../src/source-workbook/source-workbook.js';
import { assertSeedAllowed } from '../src/seed/seed-safety.js';

const SCRIPT = fileURLToPath(new URL('../scripts/seed-database.ts', import.meta.url));

// Runs the seed command with an explicit, minimal environment (no inherited DATABASE_URL).
function runSeed(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: process.env.PATH, ...env },
  });
}

describe('assertSeedAllowed', () => {
  // Detects: a destructive replace that runs without explicit intent.
  test('refuses to run without --replace', () => {
    assert.throws(() => assertSeedAllowed({ replace: false, appEnv: 'development' }), /--replace/);
  });

  // Detects: the seed deleting production employees and salaries.
  test('refuses APP_ENV=production', () => {
    assert.throws(() => assertSeedAllowed({ replace: true, appEnv: 'production' }), /production/);
  });

  // Detects: a fail-open default when APP_ENV is missing or misspelled.
  test('refuses a missing or unknown APP_ENV', () => {
    for (const appEnv of [undefined, '', 'prod', 'staging', 'Development', 'dev']) {
      assert.throws(() => assertSeedAllowed({ replace: true, appEnv }), /APP_ENV/, String(appEnv));
    }
  });

  test('accepts development, test, and demo', () => {
    for (const appEnv of ['development', 'test', 'demo']) {
      assert.doesNotThrow(() => assertSeedAllowed({ replace: true, appEnv }));
    }
  });
});

describe('seed-database command: refusals before any database work', () => {
  // Port 1 is never a MySQL server: reaching it would fail with ECONNREFUSED,
  // so a refusal message proves the command stopped before connecting.
  const unreachable = 'mysql://seed_user:leak-check-pw@127.0.0.1:1/acme_test';

  test('exits non-zero without --replace', () => {
    const result = runSeed([], { APP_ENV: 'test', DATABASE_URL: unreachable });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--replace/);
  });

  test('exits non-zero for APP_ENV=production', () => {
    const result = runSeed(['--replace'], { APP_ENV: 'production', DATABASE_URL: unreachable });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production/);
  });

  test('exits non-zero for a missing APP_ENV', () => {
    const result = runSeed(['--replace'], { DATABASE_URL: unreachable });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /APP_ENV/);
  });

  // Detects: falling back to a default or file-based connection string.
  test('exits non-zero for a missing DATABASE_URL', () => {
    const result = runSeed(['--replace'], { APP_ENV: 'test' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL/);
  });

  // Detects: unknown flags (e.g. a typo of --replace) being ignored.
  test('exits non-zero for an unknown option', () => {
    const result = runSeed(['--replace', '--force'], { APP_ENV: 'test', DATABASE_URL: unreachable });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown option/);
  });
});

describe('seed-database command: output', () => {
  let dir: string;
  let workbookPath: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'acme-seed-cli-'));
    workbookPath = path.join(dir, 'acme.xlsx');
    await createSourceWorkbook({ outputPath: workbookPath, seed: 20261114, generationDate: '2026-11-14' });
  });
  after(() => rm(dir, { recursive: true, force: true }));

  // Detects: a connection failure message that prints the URL or password.
  // The workbook is valid, so the command reaches the connection step.
  test('does not print the database URL or password when the connection fails', () => {
    const result = runSeed(['--replace', '--workbook', workbookPath], {
      APP_ENV: 'test',
      DATABASE_URL: 'mysql://seed_user:leak-check-pw@127.0.0.1:1/acme_test',
    });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /ECONNREFUSED|connect/i);
    assert.doesNotMatch(output, /leak-check-pw|seed_user|mysql:\/\//);
  });

  // Detects: a bad workbook path producing a stack trace or a 0 exit code.
  test('exits non-zero with a short message for a missing workbook', () => {
    const result = runSeed(['--replace', '--workbook', path.join(dir, 'missing.xlsx')], {
      APP_ENV: 'test',
      DATABASE_URL: 'mysql://seed_user:leak-check-pw@127.0.0.1:1/acme_test',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workbook/);
    assert.ok(result.stderr.length < 500);
  });
});
