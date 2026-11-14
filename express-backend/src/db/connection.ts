import mysql from 'mysql2/promise';
import type { Connection, ConnectionOptions, Pool, PoolConnection, PoolOptions } from 'mysql2/promise';

// Session settings applied to every connection, so behaviour does not depend
// on server defaults: strict value checks and UTC timestamps.
export const SESSION_SQL_MODE =
  'ONLY_FULL_GROUP_BY,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

/** Anything that can run a query: a pool, a pooled connection, or a single connection. */
export type Queryable = Pool | PoolConnection | Connection;

/**
 * Resolves the connection URL. Only an explicit argument or the injected
 * process environment is used; .env files are never read.
 */
export function resolveDatabaseUrl(databaseUrl: unknown = process.env.DATABASE_URL): string {
  if (typeof databaseUrl !== 'string' || databaseUrl === '') {
    throw new Error('DATABASE_URL is not set');
  }
  return databaseUrl;
}

function connectionOptions(databaseUrl: unknown) {
  return {
    uri: resolveDatabaseUrl(databaseUrl),
    // DECIMAL stays an exact string; DATE stays 'YYYY-MM-DD'.
    decimalNumbers: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  } satisfies ConnectionOptions;
}

async function applySessionSettings(connection: Connection): Promise<void> {
  await connection.query("SET SESSION time_zone = '+00:00', SESSION sql_mode = ?", [SESSION_SQL_MODE]);
}

/** One connection. Callers must call end(). */
export async function openConnection(databaseUrl: unknown, extra: ConnectionOptions = {}): Promise<Connection> {
  const connection = await mysql.createConnection({ ...connectionOptions(databaseUrl), ...extra });
  try {
    await applySessionSettings(connection);
  } catch (error) {
    await connection.end();
    throw error;
  }
  return connection;
}

/** A pool whose connections all use the session settings. Callers must call end(). */
export function createPool(databaseUrl: unknown, extra: PoolOptions = {}): Pool {
  const pool = mysql.createPool({ ...connectionOptions(databaseUrl), ...extra });
  pool.pool.on('connection', (connection) => {
    // Queued on the connection before any caller query.
    connection.query("SET SESSION time_zone = '+00:00', SESSION sql_mode = ?", [SESSION_SQL_MODE]);
  });
  return pool;
}
