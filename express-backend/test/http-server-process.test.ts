import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { readServerConfig } from '../src/http/config.js';

const SERVER = fileURLToPath(new URL('../src/server.ts', import.meta.url));
// Synthetic, test-only values. The pool is lazy: /health never connects, so
// no MySQL is needed for these process tests.
const KEY = 'test-only-signing-key-0123456789abcdef';
const DB_URL = 'mysql://process_user:leak-check-db-pw@127.0.0.1:1/acme_test';

describe('readServerConfig', () => {
  // Detects: startup with missing configuration, or defaults hiding a typo.
  test('requires DATABASE_URL and JWT_SIGNING_KEY and validates the rest', () => {
    assert.deepEqual(readServerConfig({ DATABASE_URL: DB_URL, JWT_SIGNING_KEY: KEY }), {
      databaseUrl: DB_URL, jwtSigningKey: KEY, port: 3000, clientIpSource: 'socket',
    });
    assert.deepEqual(
      readServerConfig({ DATABASE_URL: DB_URL, JWT_SIGNING_KEY: KEY, PORT: '8080', CLIENT_IP_SOURCE: 'railway-x-real-ip' }),
      { databaseUrl: DB_URL, jwtSigningKey: KEY, port: 8080, clientIpSource: 'railway-x-real-ip' },
    );
    for (const env of [
      { JWT_SIGNING_KEY: KEY },
      { DATABASE_URL: DB_URL },
      { DATABASE_URL: 'postgres://x/y', JWT_SIGNING_KEY: KEY },
      { DATABASE_URL: DB_URL, JWT_SIGNING_KEY: 'short' },
      { DATABASE_URL: DB_URL, JWT_SIGNING_KEY: KEY, PORT: 'eighty' },
      { DATABASE_URL: DB_URL, JWT_SIGNING_KEY: KEY, CLIENT_IP_SOURCE: 'x-forwarded-for' },
    ]) {
      assert.throws(() => readServerConfig(env), /invalid server configuration/, JSON.stringify(Object.keys(env)));
    }
  });

  // Detects: secret values echoed in a configuration error.
  test('names the invalid variables without printing their values', () => {
    assert.throws(() => readServerConfig({ DATABASE_URL: 'not-a-url-leak-check', JWT_SIGNING_KEY: 'short-leak-check' }), (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      assert.match(message, /DATABASE_URL/);
      assert.match(message, /JWT_SIGNING_KEY/);
      assert.doesNotMatch(message, /leak-check/);
      return true;
    });
  });
});

describe('server process', () => {
  // Detects: a stack trace or secret value printed when configuration is missing.
  test('missing configuration stops startup with a short error and exit code 1', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', SERVER], {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: process.env.PATH, JWT_SIGNING_KEY: 'short-leak-check' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL/);
    assert.doesNotMatch(result.stderr, /leak-check|at .*\.ts:/);
    assert.ok(result.stderr.length < 400, 'error output should be short');
  });

  // Detects: a server that does not answer, or that does not close cleanly on SIGTERM.
  test('starts, answers /health, and shuts down cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', SERVER], {
      env: { PATH: process.env.PATH, DATABASE_URL: DB_URL, JWT_SIGNING_KEY: KEY, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });

    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 20000);
        child.stdout.on('data', () => {
          const match = /"event":"server_listening","port":(\d+)/.exec(stdout);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
      });
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'ok' });

      child.kill('SIGTERM');
      const [code] = await once(child, 'exit');
      assert.equal(code, 0, stderr);
      assert.match(stdout, /"event":"server_stopped"/);
      assert.match(stdout, /"event":"database_pool_closed"/);
      assert.doesNotMatch(stdout + stderr, /leak-check-db-pw|process_user|test-only-signing-key/);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
});
