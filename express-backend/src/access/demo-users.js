// Synthetic demo HR accounts from docs/10-access-control-design.md.
// Passwords come from the caller (injected environment); only hashes are stored.
import { SEED_APP_ENVS } from '../seed/seed-safety.js';
import { bootstrapHrUser, loadHrUserState } from './hr-users.js';
import { NEW_PASSWORD_MIN_LENGTH } from './passwords.js';

export const DEMO_USERS = Object.freeze([
  { key: 'meera', email: 'meera.iyer@acme.com', displayName: 'Meera Iyer', role: 'ADMIN', countries: [], departments: [] },
  {
    key: 'rohan', email: 'rohan.mehta@acme.com', displayName: 'Rohan Mehta', role: 'SCOPED',
    countries: ['IN'], departments: ['Support', 'Tech'],
  },
]);

// Same creation rule as every HR user (04a).
const MIN_DEMO_PASSWORD_LENGTH = NEW_PASSWORD_MIN_LENGTH;

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Creates missing demo users. Existing demo users are verified, never changed:
 * a rerun does not reset passwords. Refuses outside development, test, and demo.
 *
 * @param {{ appEnv: string, passwords: { meera: string, rohan: string } }} options
 * @returns {Promise<{ email: string, result: 'created' | 'already present' }[]>}
 */
export async function ensureDemoUsers(pool, { appEnv, passwords }) {
  if (!SEED_APP_ENVS.includes(appEnv)) {
    throw new Error(`refusing to create demo users: APP_ENV must be one of ${SEED_APP_ENVS.join(', ')}`);
  }
  for (const user of DEMO_USERS) {
    const password = passwords?.[user.key];
    if (typeof password !== 'string' || password.length < MIN_DEMO_PASSWORD_LENGTH) {
      throw new Error(`demo password for ${user.email} must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters`);
    }
  }

  const results = [];
  for (const user of DEMO_USERS) {
    const [rows] = await pool.execute('SELECT id, display_name FROM hr_users WHERE email = ?', [user.email]);
    if (rows.length === 0) {
      await bootstrapHrUser(pool, { ...user, password: passwords[user.key] });
      results.push({ email: user.email, result: 'created' });
      continue;
    }
    const state = await loadHrUserState(pool, rows[0].id);
    const matches = rows[0].display_name === user.displayName
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
