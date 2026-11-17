import { describe, expect, it } from 'vitest';

import { auditActionLabel, hrAccessSearch, parseHrAccessQuery, roleLabel, scopeCrossProduct, statusLabel } from '@/lib/hr-access';

describe('HR access query and display helpers', () => {
  it('uses active users and newest updated first by default, omitting those defaults from links', () => {
    const parsed = parseHrAccessQuery({});
    expect(parsed.invalid).toEqual([]);
    expect(parsed.query).toMatchObject({ sort: 'updatedAt', direction: 'desc', page: 1, pageSize: 25 });
    expect(hrAccessSearch(parsed.query)).toBe('');
  });

  it('validates copied list URLs and keeps allowed filters', () => {
    const parsed = parseHrAccessQuery({ q: ' Mira ', role: 'SCOPED', status: 'ALL', country: 'IN', department: 'Support', sort: 'email', page: '2' });
    expect(parsed.invalid).toEqual([]);
    expect(parsed.query).toMatchObject({ q: 'Mira', role: 'SCOPED', status: 'ALL', country: 'IN', department: 'Support', sort: 'email', direction: 'asc', page: 2 });
    expect(hrAccessSearch(parsed.query)).toContain('status=ALL');
  });

  it('rejects repeated, unknown, and unsupported filters before a backend request', () => {
    const parsed = parseHrAccessQuery({ role: ['ADMIN', 'SCOPED'], country: 'GB', unexpected: 'yes', page: '0' });
    expect(parsed.invalid).toEqual(['role', 'unexpected', 'country', 'page']);
  });

  it('shows the exact country × department cross product', () => {
    expect(scopeCrossProduct(['IN', 'US'], ['Tech', 'Support'])).toEqual([
      'India + Tech', 'India + Support', 'United States + Tech', 'United States + Support',
    ]);
    expect(scopeCrossProduct([], ['Tech'])).toEqual([]);
  });

  it('labels persisted audit actions in plain language', () => {
    expect(auditActionLabel('TEMPORARY_PASSWORD_REGENERATED')).toBe('Temporary password regenerated');
    expect(auditActionLabel('SCOPES_REPLACED')).toBe('Scopes replaced');
  });

  it('uses text labels for every role and status', () => {
    expect(roleLabel('ADMIN')).toBe('Admin HR');
    expect(roleLabel('SCOPED')).toBe('Scoped HR');
    expect(statusLabel('ACTIVE')).toBe('Active');
    expect(statusLabel('INACTIVE')).toBe('Inactive');
  });
});
