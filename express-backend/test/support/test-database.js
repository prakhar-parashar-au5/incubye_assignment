import mysql from 'mysql2/promise';

// Safety guard for destructive integration-test setup.
// Uses only the URL passed in; never reads .env files.

const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;

/**
 * Returns the database name when the URL names a dedicated test database.
 * Throws otherwise. Error messages never contain the URL or its password.
 */
export function requireTestDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl === '') {
    throw new Error('DATABASE_URL must be set to a MySQL database whose name ends with _test');
  }
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL; expected mysql://user:password@host:port/name_test');
  }
  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use mysql: and name a database ending with _test');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!TEST_DATABASE_NAME.test(name) || name === '_test') {
    throw new Error('refusing to run: the DATABASE_URL database name must end with _test (lowercase)');
  }
  return name;
}

/**
 * Drops every table in the dedicated test database. Refuses any database
 * whose name does not end with _test.
 */
export async function resetTestDatabase(databaseUrl) {
  const name = requireTestDatabaseUrl(databaseUrl);
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const [[{ current }]] = await connection.query('SELECT DATABASE() AS current');
    if (current !== name) throw new Error('connected database does not match the guarded test database');
    const [tables] = await connection.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
      [name],
    );
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name: table } of tables) await connection.query('DROP TABLE ??', [table]);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
}
