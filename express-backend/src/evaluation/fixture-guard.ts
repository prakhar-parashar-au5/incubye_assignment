// Guards shared by the evaluator-only fixture commands (eval:oracle-fixtures,
// eval:trace-fixtures). Checked before any write. Never part of the server:
// nothing under src/ outside src/evaluation/ imports this directory.
import type { Pool, RowDataPacket } from 'mysql2/promise';

export const FIXTURE_APP_ENVS = Object.freeze(['development', 'test', 'demo'] as const);
export const SAFE_DATABASE_NAME = /^[a-z0-9_]+_(test|demo)$/;

export class FixtureRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureRefusedError';
  }
}

/** Pure guard. Inputs are untrusted. */
export function assertFixtureTargetAllowed({ appEnv, databaseName, confirmDatabase }: { appEnv: unknown; databaseName: unknown; confirmDatabase: unknown }): void {
  if (appEnv === 'production') throw new FixtureRefusedError('refusing: APP_ENV=production. Fixtures are for an isolated test or demo database only');
  if (typeof appEnv !== 'string' || !(FIXTURE_APP_ENVS as readonly string[]).includes(appEnv)) {
    throw new FixtureRefusedError(`refusing: APP_ENV must be one of ${FIXTURE_APP_ENVS.join(', ')}`);
  }
  if (typeof databaseName !== 'string' || !SAFE_DATABASE_NAME.test(databaseName)) {
    throw new FixtureRefusedError('refusing: the database name must end with _test or _demo');
  }
  if (confirmDatabase !== databaseName) {
    throw new FixtureRefusedError('refusing: --database must repeat the target database name exactly');
  }
}

/** The connection must be to the named database, not merely to a URL that claims it. */
export async function assertConnectedDatabase(pool: Pool, databaseName: string): Promise<void> {
  const [[connected]] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (connected?.name !== databaseName) throw new FixtureRefusedError('refusing: the connection is not to the named database');
}

/** Both guards, in order. */
export async function assertFixtureTarget(pool: Pool, target: { appEnv: unknown; databaseName: string; confirmDatabase: unknown }): Promise<void> {
  assertFixtureTargetAllowed(target);
  await assertConnectedDatabase(pool, target.databaseName);
}

/** The database name in a mysql:// URL, or null. Never returns credentials. */
export function databaseNameOf(databaseUrl: string): string | null {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    return name === '' ? null : name;
  } catch {
    return null;
  }
}
