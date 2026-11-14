// Compile-time contract checks. This file is type-checked by `npm run
// typecheck` and never executed. Each `@ts-expect-error` line must fail to
// compile: if a type is loosened (for example DecimalString becomes plain
// string), the directive becomes unused and the type check fails.
import type { AccessSubject, Role } from '../../src/access/access-policy.js';
import { canAccessEmployee } from '../../src/access/access-policy.js';
import { AccessError } from '../../src/access/hr-users.js';
import type { AuditAction } from '../../src/access/hr-users.js';
import { AuthenticationError } from '../../src/access/sessions.js';
import type { VerifiedSessionToken } from '../../src/access/session-tokens.js';
import type { ReplacementRow } from '../../src/seed/replace-employees.js';
import { toDecimalString } from '../../src/seed/workbook-reader.js';
import type { DecimalString, SeedEmployeeRow } from '../../src/seed/workbook-reader.js';
import type {
  ChangeReason,
  CountryCode,
  Currency,
  EmploymentStatus,
  Level,
  PayFrequency,
} from '../../src/source-workbook/constants.js';
import type { UnvalidatedEmployee } from '../../src/source-workbook/employee-validator.js';
import { SourceWorkbookError } from '../../src/source-workbook/source-workbook.js';

export function typeContracts(raw: UnvalidatedEmployee, row: SeedEmployeeRow): unknown[] {
  // Workbook values stay unknown until narrowed.
  // @ts-expect-error a workbook cell is unknown and must be narrowed before use
  const upper: string = raw.first_name.toUpperCase();
  const narrowed = typeof raw.first_name === 'string' ? raw.first_name.toUpperCase() : ''; // control

  // Money for MySQL is a DecimalString, never a number or an unchecked string.
  // @ts-expect-error a salary number is not a database decimal string
  const fromNumber: DecimalString = 2500000;
  // @ts-expect-error an unchecked string is not a DecimalString either
  const fromString: DecimalString = '2500000.00';
  const fromHelper: DecimalString = toDecimalString(2500000); // control
  // @ts-expect-error a seed row cannot carry a numeric salary
  const numericSalaryRow: SeedEmployeeRow = { ...row, annual_base_salary: 2500000 };

  // Closed unions reject unsupported values.
  // @ts-expect-error GB is not an approved country
  const country: CountryCode = 'GB';
  // @ts-expect-error EUR is not an approved currency
  const currency: Currency = 'EUR';
  // @ts-expect-error L3 is not an approved level
  const level: Level = 'L3';
  // @ts-expect-error ACTIVE is an HR status, not an employment status
  const status: EmploymentStatus = 'ACTIVE';
  // @ts-expect-error WEEKLY is not an approved pay frequency
  const frequency: PayFrequency = 'WEEKLY';
  // @ts-expect-error SUPERUSER is not an approved role
  const role: Role = 'SUPERUSER';
  // @ts-expect-error PASSWORD_VIEWED is not an audit action
  const action: AuditAction = 'PASSWORD_VIEWED';
  // @ts-expect-error BONUS is not a compensation change reason
  const reason: ChangeReason = 'BONUS';

  // Database rows need their required fields.
  const { job_title_id: _omitted, ...withoutTitle }: ReplacementRow = { ...row, job_title_id: 1 };
  // @ts-expect-error a replacement row without job_title_id cannot be inserted
  const missingTitle: ReplacementRow = withoutTitle;
  const { email: _email, ...withoutEmail } = row;
  // @ts-expect-error a seed row without email is incomplete
  const missingEmail: SeedEmployeeRow = withoutEmail;

  // A principal must carry both scope lists.
  // @ts-expect-error a scoped principal without country and department arrays
  const noScopes: AccessSubject = { role: 'SCOPED', status: 'ACTIVE' };
  // @ts-expect-error the policy cannot be called without scope lists
  const decided = canAccessEmployee({ role: 'SCOPED', status: 'ACTIVE', countries: ['IN'] }, { country_code: 'IN', department: 'Tech' });

  // A verified session token always has both IDs and the expiry.
  // @ts-expect-error a verified token without expiresAt
  const noExpiry: VerifiedSessionToken = { hrUserId: 1, sessionId: '0b7e7a3c-6f1d-4c55-9d7e-2f4b8a1c9e10' };
  // @ts-expect-error a verified token without sessionId
  const noSession: VerifiedSessionToken = { hrUserId: 1, expiresAt: new Date(0) };

  // Error codes are closed unions.
  // @ts-expect-error NOPE is not an access error code
  const accessError = new AccessError('NOPE', 'x');
  // @ts-expect-error TOKEN_STOLEN is not an authentication failure reason
  const authError = new AuthenticationError('TOKEN_STOLEN');
  // @ts-expect-error DISK_FULL is not a source workbook error code
  const workbookError = new SourceWorkbookError('DISK_FULL', 'x');

  return [
    upper, narrowed, fromNumber, fromString, fromHelper, numericSalaryRow, country, currency, level, status,
    frequency, role, action, reason, missingTitle, missingEmail, noScopes, decided, noExpiry, noSession,
    accessError, authError, workbookError,
  ];
}
