import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/seed-demo-users.ts', import.meta.url));

// Explicit minimal environment; port 1 is never a MySQL server.
function run(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, ...env } });
}
const URL_WITH_SECRET = 'mysql://demo_user:leak-check-pw@127.0.0.1:1/acme_test';
const PASSWORDS = { DEMO_MEERA_PASSWORD: 'synthetic-demo-meera-pw', DEMO_ROHAN_PASSWORD: 'synthetic-demo-rohan-pw' };

describe('seed-demo-users command', () => {
  // Detects: demo accounts with published passwords created in production.
  test('refuses APP_ENV=production before connecting', () => {
    const result = run({ APP_ENV: 'production', DATABASE_URL: URL_WITH_SECRET, ...PASSWORDS });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /APP_ENV/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  });

  // Detects: a hard-coded fallback password when the environment value is missing.
  test('refuses a missing demo password', () => {
    const result = run({ APP_ENV: 'demo', DATABASE_URL: URL_WITH_SECRET, DEMO_MEERA_PASSWORD: PASSWORDS.DEMO_MEERA_PASSWORD });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rohan\.mehta@acme\.com must be at least 12/);
  });

  test('refuses a missing DATABASE_URL', () => {
    const result = run({ APP_ENV: 'demo', ...PASSWORDS });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL/);
  });

  // Detects: passwords or the database URL printed in error output.
  test('never prints passwords or the database URL', () => {
    const result = run({ APP_ENV: 'demo', DATABASE_URL: URL_WITH_SECRET, ...PASSWORDS });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /ECONNREFUSED/);
    for (const secret of ['leak-check-pw', 'demo_user', 'mysql://', PASSWORDS.DEMO_MEERA_PASSWORD, PASSWORDS.DEMO_ROHAN_PASSWORD]) {
      assert.ok(!output.includes(secret), 'output contains a secret value');
    }
  });
});
