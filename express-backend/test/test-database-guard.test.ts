import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { requireTestDatabaseUrl } from './support/test-database.js';
import { thrown } from './support/thrown.js';

describe('requireTestDatabaseUrl', () => {
  // Detects: destructive test setup running against a non-test database.
  test('accepts a mysql URL whose database name ends with _test', () => {
    assert.equal(requireTestDatabaseUrl('mysql://u:p@127.0.0.1:3317/acme_test'), 'acme_test');
  });

  // Detects: a guard that only checks for "_test" somewhere in the name or URL.
  for (const url of [
    'mysql://u:p@127.0.0.1:3317/acme',
    'mysql://u:p@127.0.0.1:3317/acme_test_copy',
    'mysql://u:p@127.0.0.1:3317/test',
    'mysql://u:p@127.0.0.1:3317/acme_TEST',
    'mysql://acme_test:p@127.0.0.1:3317/acme',
    'mysql://u:p@127.0.0.1:3317/',
  ]) {
    test(`rejects ${url}`, () => {
      assert.throws(() => requireTestDatabaseUrl(url), /_test/);
    });
  }

  // Detects: tests silently connecting to some default database.
  test('rejects a missing or non-mysql URL', () => {
    assert.throws(() => requireTestDatabaseUrl(undefined), /DATABASE_URL/);
    assert.throws(() => requireTestDatabaseUrl(''), /DATABASE_URL/);
    assert.throws(() => requireTestDatabaseUrl('postgres://u:p@h/acme_test'), /mysql:/);
  });

  // Detects: a password leaking into an error message.
  test('does not include the password in error messages', () => {
    assert.throws(
      () => requireTestDatabaseUrl('mysql://u:s3cret-value@127.0.0.1:3317/prod'),
      (error: unknown) => !thrown(error).message.includes('s3cret-value'),
    );
  });
});
