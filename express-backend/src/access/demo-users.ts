// Synthetic demo HR accounts from docs/10-access-control-design.md.
// Passwords come from the caller (injected environment); only hashes are stored.
import type { Pool, RowDataPacket } from 'mysql2/promise';

import { SEED_APP_ENVS } from '../seed/seed-safety.js';
import { isOneOf } from '../source-workbook/constants.js';
import type { Role } from './access-policy.js';
import { bootstrapHrUser, loadHrUserState } from './hr-users.js';
import { NEW_PASSWORD_MIN_LENGTH } from './passwords.js';

interface DemoUser {
  key: 'meera' | 'rohan';
  email: string;
  displayName: string;
  role: Role;
  countries: readonly string[];
  departments: readonly string[];
}

export const DEMO_USERS: readonly DemoUser[] = Object.freeze([
  { key: 'meera', email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', role: 'ADMIN', countries: [], departments: [] },
  {
    key: 'rohan', email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED',
    countries: ['IN'], departments: ['Support', 'Tech'],
  },
]);

/** Demo passwords from the injected environment: untrusted until checked. */
export type DemoPasswords = Partial<Record<DemoUser['key'], unknown>> | undefined;

export interface DemoUserResult {
  email: string;
  result: 'created' | 'already present';
}

interface ExistingUserRow extends RowDataPacket {
  id: number;
  display_name: string;
}

// Same creation rule as every HR user (04a).
const MIN_DEMO_PASSWORD_LENGTH = NEW_PASSWORD_MIN_LENGTH;

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Creates missing demo users. Existing demo users are verified, never changed:
 * a rerun does not reset passwords. Refuses outside development, test, and demo.
 */
export async function ensureDemoUsers(
  pool: Pool,
  { appEnv, passwords }: { appEnv: unknown; passwords: DemoPasswords },
): Promise<DemoUserResult[]> {
  if (!isOneOf(SEED_APP_ENVS, appEnv)) {
    throw new Error(`refusing to create demo users: APP_ENV must be one of ${SEED_APP_ENVS.join(', ')}`);
  }
  const checked = new Map<DemoUser['key'], string>();
  for (const user of DEMO_USERS) {
    const password = passwords?.[user.key];
    if (typeof password !== 'string' || password.length < MIN_DEMO_PASSWORD_LENGTH) {
      throw new Error(`demo password for ${user.email} must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters`);
    }
    checked.set(user.key, password);
  }

  const results: DemoUserResult[] = [];
  for (const user of DEMO_USERS) {
    const [rows] = await pool.execute<ExistingUserRow[]>('SELECT id, display_name FROM hr_users WHERE email = ?', [user.email]);
    const existing = rows[0];
    if (existing === undefined) {
      await bootstrapHrUser(pool, {
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        countries: user.countries,
        departments: user.departments,
        password: checked.get(user.key),
      });
      results.push({ email: user.email, result: 'created' });
      continue;
    }
    const state = await loadHrUserState(pool, existing.id);
    const matches = existing.display_name === user.displayName
      && state.role === user.role
      && state.status === 'ACTIVE'
      && sameList(state.countries, user.countries)
      && sameList(state.departments, [...user.departments].sort());
    if (!matches) {
      throw new Error(`existing demo user ${user.email} does not match the approved name, role, status, or scopes`);
    }
    results.push({ email: user.email, result: 'already present' });
  }
  return results;
}
