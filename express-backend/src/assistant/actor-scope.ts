// Trace-time authorization snapshot and the rule for showing a saved answer
// again (AI Task 03a, Option C). docs_human/13: observability must not become
// a path around employee access control, and HR Access can narrow a Scoped HR
// user's scope after a turn was answered.
//
// A saved assistant answer was produced under the actor's scope at that time.
// Its prose, cards, aggregate populations, and limitations cannot be re-checked
// field by field, so it is shown again only while the current scope covers the
// recorded one; otherwise the whole answer is withheld and the turn leaves the
// model history. Stored evidence is never modified.
import type { AccessSubject } from '../access/access-policy.js';

export const ACTOR_ROLES = Object.freeze(['ADMIN', 'SCOPED'] as const);
export type ActorRole = (typeof ACTOR_ROLES)[number];

/** Role plus sorted, de-duplicated country codes and department names. No session or user ID. */
export interface ActorScope {
  role: ActorRole;
  countries: string[];
  departments: string[];
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** The snapshot recorded on a new trace. Admin HR has no scope rows, so its lists are empty. */
export function actorScopeOf(principal: Pick<AccessSubject, 'role' | 'countries' | 'departments'>): ActorScope {
  if (principal.role !== 'ADMIN' && principal.role !== 'SCOPED') throw new Error('unknown actor role');
  return principal.role === 'ADMIN'
    ? { role: 'ADMIN', countries: [], departments: [] }
    : { role: 'SCOPED', countries: sortedSet(principal.countries), departments: sortedSet(principal.departments) };
}

/** A stored snapshot, or null when the value is missing or malformed (both fail closed for Scoped HR). */
export function parseActorScope(role: unknown, countries: unknown, departments: unknown): ActorScope | null {
  const list = (value: unknown): string[] | null => (Array.isArray(value) && value.every((v) => typeof v === 'string') ? sortedSet(value as string[]) : null);
  const c = list(countries);
  const d = list(departments);
  if ((role !== 'ADMIN' && role !== 'SCOPED') || c === null || d === null) return null;
  return { role, countries: c, departments: d };
}

/**
 * True when the current actor may see an answer recorded under `recorded`.
 * - Active Admin HR: always (existing Admin authority covers every employee).
 * - Active Scoped HR: only when the recorded actor was Scoped HR and the
 *   current countries AND departments are each a superset of the recorded
 *   ones. An Admin-recorded answer, a missing snapshot (traces before
 *   migration 007), or a narrower or sideways scope is not covered.
 * - Anything else: never.
 */
export function coversRecordedScope(current: Pick<AccessSubject, 'role' | 'status' | 'countries' | 'departments'>, recorded: ActorScope | null): boolean {
  if (current.status !== 'ACTIVE') return false;
  if (current.role === 'ADMIN') return true;
  if (current.role !== 'SCOPED' || recorded === null || recorded.role !== 'SCOPED') return false;
  return recorded.countries.every((c) => current.countries.includes(c)) && recorded.departments.every((d) => current.departments.includes(d));
}
