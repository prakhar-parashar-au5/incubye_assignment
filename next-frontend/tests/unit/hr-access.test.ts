import { describe, expect, it } from 'vitest';

import { auditActionLabel, defaultHrDirection, hrAccessFormQuery, hrAccessSearch, parseHrAccessQuery, roleLabel, scopeCrossProduct, statusLabel } from '@/lib/hr-access';

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

  // QA run 03, D1: the parser and the serializer share one default-direction rule.
  describe('sort round trip', () => {
    const sorts = ['updatedAt', 'name', 'email'] as const;
    const directions = ['asc', 'desc'] as const;
    for (const sort of sorts) {
      for (const direction of directions) {
        it(`keeps ${sort} ${direction} through serialize then parse, and parse then serialize`, () => {
          const search = hrAccessSearch({ sort, direction, page: 1, pageSize: 25 });
          const parsed = parseHrAccessQuery(Object.fromEntries(new URLSearchParams(search)));
          expect(parsed.invalid).toEqual([]);
          expect(parsed.query.sort).toBe(sort);
          expect(parsed.query.direction).toBe(direction);
          const explicit = parseHrAccessQuery({ sort, direction });
          expect(hrAccessSearch(explicit.query)).toBe(search);
        });
      }
    }

    it('writes the non-default direction for every sort and omits the default one', () => {
      expect(defaultHrDirection('updatedAt')).toBe('desc');
      expect(defaultHrDirection('name')).toBe('asc');
      expect(defaultHrDirection('email')).toBe('asc');
      expect(defaultHrDirection(undefined)).toBe('desc');
      expect(hrAccessSearch({ sort: 'name', direction: 'asc' })).toBe('?sort=name');
      expect(hrAccessSearch({ sort: 'name', direction: 'desc' })).toBe('?sort=name&direction=desc');
      expect(hrAccessSearch({ sort: 'updatedAt', direction: 'desc' })).toBe('');
      expect(hrAccessSearch({ sort: 'updatedAt', direction: 'asc' })).toBe('?direction=asc');
    });
  });

  // QA run 03, D3: a submitted form with blank fields is a normal query, not an invalid one.
  describe('form and blank values', () => {
    it('treats blank values as not set', () => {
      const parsed = parseHrAccessQuery({ q: 'Rohan Mehta', sort: 'updatedAt', direction: 'desc', pageSize: '25', role: '', status: 'ACTIVE', country: '', department: '' });
      expect(parsed.invalid).toEqual([]);
      expect(parsed.query).toEqual({ q: 'Rohan Mehta', status: 'ACTIVE', sort: 'updatedAt', direction: 'desc', page: 1, pageSize: 25 });
      expect(hrAccessSearch(parsed.query)).toBe('?q=Rohan+Mehta');
      expect(parseHrAccessQuery({ q: '   ', role: '' }).invalid).toEqual([]);
    });

    it('rejects a search longer than the contract allows', () => {
      expect(parseHrAccessQuery({ q: 'x'.repeat(100) }).invalid).toEqual([]);
      expect(parseHrAccessQuery({ q: 'x'.repeat(101) }).invalid).toEqual(['q']);
    });

    it('builds a clean form query: set fields once, blanks cleared, page reset, sort kept', () => {
      const current = parseHrAccessQuery({ q: 'old', role: 'SCOPED', sort: 'name', direction: 'desc', page: '3' }).query;
      const form = new FormData();
      form.set('q', '  ');
      form.set('role', 'ADMIN');
      form.set('status', 'ACTIVE');
      form.set('country', '');
      form.set('department', '');
      const next = hrAccessFormQuery(current, form);
      expect(next).toMatchObject({ role: 'ADMIN', sort: 'name', direction: 'desc', page: 1 });
      expect(next.q).toBeUndefined();
      const search = hrAccessSearch(next);
      expect(search).toBe('?role=ADMIN&sort=name&direction=desc');
      const keys = [...new URLSearchParams(search).keys()];
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('leaves fields the form does not carry unchanged', () => {
      const current = parseHrAccessQuery({ country: 'IN' }).query;
      const form = new FormData();
      form.set('q', 'Meera');
      expect(hrAccessSearch(hrAccessFormQuery(current, form))).toBe('?q=Meera&country=IN');
    });
  });
});
