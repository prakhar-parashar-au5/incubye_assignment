import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { canAccessEmployee, canManageHrUsers } from '../src/access/access-policy.js';

// Hand-written principals and employees. Literal expectations from docs/10.
const admin = { role: 'ADMIN', status: 'ACTIVE', countries: [], departments: [] };
const rohan = { role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech', 'Support'] };
const employee = (country_code: string, department: string) => ({ country_code, department });

describe('canAccessEmployee', () => {
  // Detects: admin access accidentally limited by (empty) scope lists.
  test('Admin HR can access every employee', () => {
    for (const e of [employee('IN', 'Tech'), employee('US', 'HR'), employee('US', 'Finance')]) {
      assert.equal(canAccessEmployee(admin, e), true);
    }
  });

  test('Scoped HR can access an employee when country and department both match', () => {
    assert.equal(canAccessEmployee(rohan, employee('IN', 'Tech')), true);
  });

  // Detects: OR across dimensions instead of AND.
  test('rejects when only the country matches', () => {
    assert.equal(canAccessEmployee(rohan, employee('IN', 'Finance')), false);
  });

  test('rejects when only the department matches', () => {
    assert.equal(canAccessEmployee(rohan, employee('US', 'Tech')), false);
  });

  test('rejects when neither matches', () => {
    assert.equal(canAccessEmployee(rohan, employee('US', 'HR')), false);
  });

  // Detects: only the first list entry being checked.
  test('multiple countries use OR within the country list', () => {
    const scoped = { ...rohan, countries: ['IN', 'US'], departments: ['Tech'] };
    assert.equal(canAccessEmployee(scoped, employee('IN', 'Tech')), true);
    assert.equal(canAccessEmployee(scoped, employee('US', 'Tech')), true);
  });

  test('multiple departments use OR within the department list', () => {
    assert.equal(canAccessEmployee(rohan, employee('IN', 'Tech')), true);
    assert.equal(canAccessEmployee(rohan, employee('IN', 'Support')), true);
  });

  // Detects: pairing (IN+Tech, US+HR) instead of the approved cross product.
  test('country and department lists combine as a cross product (AND across dimensions)', () => {
    const scoped = { ...rohan, countries: ['IN', 'US'], departments: ['Tech', 'HR'] };
    const allowed = ['IN:Tech', 'IN:HR', 'US:Tech', 'US:HR'];
    for (const country of ['IN', 'US']) {
      for (const department of ['Tech', 'HR', 'Finance', 'Operations', 'Support']) {
        assert.equal(
          canAccessEmployee(scoped, employee(country, department)),
          allowed.includes(`${country}:${department}`),
          `${country}:${department}`,
        );
      }
    }
  });

  // Detects: an empty list treated as "no restriction".
  test('an empty country list grants no access', () => {
    assert.equal(canAccessEmployee({ ...rohan, countries: [] }, employee('IN', 'Tech')), false);
  });

  test('an empty department list grants no access', () => {
    assert.equal(canAccessEmployee({ ...rohan, departments: [] }, employee('IN', 'Tech')), false);
  });

  // Detects: an inactive user keeping access when a caller skips the session check.
  test('an INACTIVE HR user, admin or scoped, has no access', () => {
    assert.equal(canAccessEmployee({ ...admin, status: 'INACTIVE' }, employee('IN', 'Tech')), false);
    assert.equal(canAccessEmployee({ ...rohan, status: 'INACTIVE' }, employee('IN', 'Tech')), false);
  });

  // Detects: an unknown role (e.g. a typo) falling through to "allow".
  test('an unknown role has no access', () => {
    assert.equal(canAccessEmployee({ ...admin, role: 'SUPERUSER' }, employee('IN', 'Tech')), false);
  });

  // Detects: case-insensitive or substring matching ("in", "Tech Support").
  test('matches exact values only', () => {
    assert.equal(canAccessEmployee(rohan, employee('in', 'Tech')), false);
    assert.equal(canAccessEmployee(rohan, employee('IN', 'tech')), false);
  });
});

describe('canManageHrUsers', () => {
  test('Admin HR can manage HR users', () => {
    assert.equal(canManageHrUsers(admin), true);
  });

  // Detects: scoped HR escalating their own access.
  test('Scoped HR cannot manage HR users', () => {
    assert.equal(canManageHrUsers(rohan), false);
  });

  test('an INACTIVE admin cannot manage HR users', () => {
    assert.equal(canManageHrUsers({ ...admin, status: 'INACTIVE' }), false);
  });
});
