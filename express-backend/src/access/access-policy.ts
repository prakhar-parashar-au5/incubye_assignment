// Pure access rules from docs/10-access-control-design.md. No I/O.

export const ROLES = Object.freeze(['ADMIN', 'SCOPED'] as const);
export const HR_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE'] as const);
export type Role = (typeof ROLES)[number];
export type HrStatus = (typeof HR_STATUSES)[number];

/**
 * The state the policy needs. role and status are plain strings on purpose:
 * the policy is the last line of defence and fails closed on any value
 * outside the approved unions (an unknown role or status gets no access).
 * Scope lists are required: a principal without them is a type error.
 */
export interface AccessSubject {
  role: string;
  status: string;
  countries: readonly string[];
  departments: readonly string[];
}

/** An employee's placement: country code and department name. */
export interface EmployeePlacement {
  country_code: string;
  department: string;
}

function isActive(subject: Pick<AccessSubject, 'status'>): boolean {
  return subject.status === 'ACTIVE';
}

/**
 * ADMIN: every employee. SCOPED: country IN countries AND department IN
 * departments (OR within each list). An empty list grants nothing.
 * Anything else, including INACTIVE or an unknown role, is denied.
 */
export function canAccessEmployee(principal: AccessSubject, employee: EmployeePlacement): boolean {
  if (!isActive(principal)) return false;
  if (principal.role === 'ADMIN') return true;
  if (principal.role !== 'SCOPED') return false;
  return principal.countries.includes(employee.country_code) && principal.departments.includes(employee.department);
}

/** Only an ACTIVE ADMIN can create HR users, change scopes, or change HR status. */
export function canManageHrUsers(principal: Pick<AccessSubject, 'role' | 'status'>): boolean {
  return isActive(principal) && principal.role === 'ADMIN';
}
