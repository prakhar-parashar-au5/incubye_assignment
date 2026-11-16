// Presentation of HR roles and access scopes. Shared by the sign-in page (approved demo account
// descriptions) and the application shell (the scope the backend returns for the current user).

export type HrRole = 'ADMIN' | 'SCOPED';

export const ROLE_LABELS: Record<HrRole, string> = {
  ADMIN: 'Admin HR',
  SCOPED: 'Scoped HR',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * One-line scope summary.
 *
 * - Admin HR: "All employees".
 * - Scoped HR: country names, then departments, each sorted alphabetically, for example
 *   "India, Support and Tech". Sorting makes the sign-in description and the signed-in shell
 *   read identically whatever order the backend returns.
 * - Scoped HR with an empty list in either dimension has no employee access, because the
 *   backend combines the two dimensions with AND.
 */
export function scopeSummary(role: HrRole, countries: readonly string[], departments: readonly string[]): string {
  if (role === 'ADMIN') return 'All employees';
  if (countries.length === 0 || departments.length === 0) return 'No employee access';
  const byName = (a: string, b: string) => a.localeCompare(b, 'en');
  return joinWithAnd([...countries.map(countryName).sort(byName), ...[...departments].sort(byName)]);
}
