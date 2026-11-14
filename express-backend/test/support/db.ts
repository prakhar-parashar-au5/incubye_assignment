// Typed SQL helpers for integration tests. Rows are untyped on purpose:
// tests assert their values with literals, so `unknown` fields are enough.
import type { Connection, ResultSetHeader } from 'mysql2/promise';

export type Row = Record<string, unknown>;
type QueryParams = Parameters<Connection['query']>[1];

/** Runs a SELECT and returns its rows. Throws if the statement returned no row set. */
export async function selectRows(db: Connection, sql: string, params?: QueryParams): Promise<Row[]> {
  const [result] = await db.query(sql, params);
  if (!Array.isArray(result)) throw new Error('expected a row set; use execStatement for writes');
  // mysql2 returns RowDataPacket objects for a single SELECT: plain column-to-value records.
  return result as Row[];
}

/** Runs a write or DDL statement and returns mysql2's result header. */
export async function execStatement(db: Connection, sql: string, params?: QueryParams): Promise<ResultSetHeader> {
  const [result] = await db.query(sql, params);
  if (Array.isArray(result)) throw new Error('expected a write result; use selectRows for SELECT');
  // mysql2 types a write result as OkPacket | ResultSetHeader; OkPacket is the
  // deprecated name for the same header shape (affectedRows, insertId).
  return result as ResultSetHeader;
}
