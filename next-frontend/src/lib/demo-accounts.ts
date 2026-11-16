import { ROLE_LABELS, scopeSummary, type HrRole } from '@/lib/hr-scope';

// The two approved synthetic demo accounts (docs_human/09-frontend-directory.md and
// express-backend/src/access/demo-users.ts). The sign-in form submits only the account key; the
// server action maps it to the approved email, so a client cannot submit an arbitrary address.

export type DemoAccountKey = 'meera' | 'rohan';

export type DemoAccount = {
  key: DemoAccountKey;
  displayName: string;
  email: string;
  role: HrRole;
  roleLabel: string;
  scope: string;
};

function account(
  key: DemoAccountKey,
  displayName: string,
  email: string,
  role: HrRole,
  countries: string[],
  departments: string[],
): DemoAccount {
  return { key, displayName, email, role, roleLabel: ROLE_LABELS[role], scope: scopeSummary(role, countries, departments) };
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  account('meera', 'Meera Iyer', 'meera.iyer@acme.com', 'ADMIN', [], []),
  account('rohan', 'Rohan Mehta', 'rohan.mehta@acme.com', 'SCOPED', ['IN'], ['Tech', 'Support']),
];

export function findDemoAccount(key: unknown): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((candidate) => candidate.key === key);
}
