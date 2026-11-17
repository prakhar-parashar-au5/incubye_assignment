// Creates the database named in DATABASE_URL when it is missing. Needed on a
// managed MySQL whose default database has another name (Railway creates
// "railway"; this app uses "acme_demo"). Never reads .env files.
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

import { resolveDatabaseUrl } from './connection.js';

// The name is interpolated into CREATE DATABASE, so only plain identifiers pass.
const DATABASE_NAME = /^[a-z0-9_]{1,64}$/;

export class CreateDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateDatabaseError';
  }
}

/** The database name from DATABASE_URL, and the same URL without a database. */
export function targetDatabase(databaseUrl: unknown): { name: string; serverUrl: string } {
  const raw = resolveDatabaseUrl(databaseUrl);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CreateDatabaseError('DATABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'mysql:') throw new CreateDatabaseError('DATABASE_URL must use the mysql: protocol');
  const name = url.pathname.replace(/^\//, '');
  if (!DATABASE_NAME.test(name)) {
    throw new CreateDatabaseError('DATABASE_URL must name one database of lowercase letters, digits, and underscores');
  }
  url.pathname = '/';
  return { name, serverUrl: url.toString() };
}

export async function createDatabaseIfMissing(databaseUrl: unknown): Promise<{ name: string; created: boolean }> {
  const { name, serverUrl } = targetDatabase(databaseUrl);
  const connection = await mysql.createConnection({ uri: serverUrl });
  try {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
    if (rows.length > 0) return { name, created: false };
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    return { name, created: true };
  } finally {
    await connection.end();
  }
}
