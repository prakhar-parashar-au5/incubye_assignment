// Pure access rules from docs/10-access-control-design.md. No I/O.
//
// A principal is the current state loaded for one request:
//   { role: 'ADMIN' | 'SCOPED', status: 'ACTIVE' | 'INACTIVE',
//     countries: string[], departments: string[] }
// An employee needs { country_code, department } (department name).

export const ROLES = Object.freeze(['ADMIN', 'SCOPED']);
export const HR_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

function isActive(principal) {
  return principal?.status === 'ACTIVE';
}

/**
 * ADMIN: every employee. SCOPED: country IN countries AND department IN
 * departments (OR within each list). An empty list grants nothing.
 * Anything else, including INACTIVE or an unknown role, is denied.
 */
export function canAccessEmployee(principal, employee) {
  if (!isActive(principal)) return false;
  if (principal.role === 'ADMIN') return true;
  if (principal.role !== 'SCOPED') return false;
  return principal.countries.includes(employee.country_code) && principal.departments.includes(employee.department);
}

/** Only an ACTIVE ADMIN can create HR users, change scopes, or change HR status. */
export function canManageHrUsers(principal) {
  return isActive(principal) && principal.role === 'ADMIN';
}
