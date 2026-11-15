import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DirectoryQueryParams } from '../src/http/contract.js';
import { escapeLike } from '../src/directory/directory-repository.js';

const ok = (raw: Record<string, unknown>) => {
  const parsed = DirectoryQueryParams.safeParse(raw);
  assert.ok(parsed.success, JSON.stringify(raw));
  return parsed.data;
};
const rejected = (raw: Record<string, unknown>) => assert.equal(DirectoryQueryParams.safeParse(raw).success, false, JSON.stringify(raw));

describe('directory query validation', () => {
  // Detects: missing defaults (unbounded result sets) or a different default order.
  test('applies page 1, page size 25, and name ascending by default', () => {
    assert.deepEqual(ok({}), { page: 1, pageSize: 25, sort: 'name', direction: 'asc' });
  });

  test('parses numeric strings and every filter', () => {
    assert.deepEqual(ok({
      q: 'Sneha', department: 'Tech', country: 'IN', currency: 'INR', level: 'SENIOR', status: 'LEFT',
      sort: 'hireDate', direction: 'desc', page: '3', pageSize: '100',
    }), {
      q: 'Sneha', department: 'Tech', country: 'IN', currency: 'INR', level: 'SENIOR', status: 'LEFT',
      sort: 'hireDate', direction: 'desc', page: 3, pageSize: 100,
    });
  });

  // Detects: page values that would become a negative or fractional OFFSET.
  test('rejects page 0, negative, decimal, exponent, and non-numeric pages', () => {
    for (const page of ['0', '-1', '1.5', '1e2', 'abc', '', ' 1', '01']) rejected({ page });
  });

  // Detects: a page size cap that is off by one or missing.
  test('accepts page size 100 and rejects 101 and 0', () => {
    assert.equal(ok({ pageSize: '100' }).pageSize, 100);
    rejected({ pageSize: '101' });
    rejected({ pageSize: '0' });
  });

  // Detects: unknown parameters silently ignored, or unvalidated values reaching SQL.
  test('rejects unknown parameters and unsupported values', () => {
    rejected({ salary: '1' });
    rejected({ department: 'Legal' });
    rejected({ department: 'tech' });
    rejected({ country: 'GB' });
    rejected({ currency: 'EUR' });
    rejected({ level: 'INTERN' });
    rejected({ status: 'ACTIVE' });
    rejected({ direction: 'up' });
    rejected({ comparisonCurrency: 'INR' });
  });

  // Detects: a sort value interpolated into ORDER BY.
  test('rejects a sort-field injection value before SQL', () => {
    for (const sort of ['id', 'e.id', 'name; DROP TABLE employees', 'first_name', 'salary']) rejected({ sort });
  });

  // Detects: repeated values reaching SQL as an array.
  test('rejects repeated single-value parameters', () => {
    rejected({ page: ['1', '2'] });
    rejected({ department: ['Tech', 'HR'] });
    rejected({ q: ['a', 'b'] });
    rejected({ sort: ['name', 'name'] });
  });

  // Detects: native INR and USD amounts compared as if they were one currency.
  test('salary sorting requires comparisonCurrency=USD', () => {
    rejected({ sort: 'annualBaseSalary' });
    rejected({ sort: 'annualCashCompensation' });
    assert.equal(ok({ sort: 'annualBaseSalary', comparisonCurrency: 'USD' }).comparisonCurrency, 'USD');
    assert.equal(ok({ sort: 'annualCashCompensation', comparisonCurrency: 'USD', direction: 'desc' }).sort, 'annualCashCompensation');
  });

  test('non-salary sorts accept no comparison currency', () => {
    for (const sort of ['name', 'employeeCode', 'department', 'country', 'level', 'hireDate']) assert.equal(ok({ sort }).sort, sort);
  });

  // Detects: wildcard or quote characters stripped or rejected instead of searched literally.
  test('keeps SQL control and wildcard characters as search text', () => {
    for (const q of ["%", '_', '\\', "O'Brien", '"; DROP TABLE employees; --', 'a%b_c']) assert.equal(ok({ q }).q, q);
  });

  test('trims search text, treats blank search as absent, and limits its length', () => {
    assert.equal(ok({ q: '  Sneha  ' }).q, 'Sneha');
    assert.equal(ok({ q: '   ' }).q, undefined);
    assert.equal(ok({ q: 'x'.repeat(100) }).q?.length, 100);
    rejected({ q: 'x'.repeat(101) });
  });
});

describe('LIKE escaping', () => {
  // Detects: user "%" or "_" acting as a wildcard (search "%" would match everyone).
  test('escapes the escape character first, then both wildcards', () => {
    assert.equal(escapeLike('%'), '\\%');
    assert.equal(escapeLike('_'), '\\_');
    assert.equal(escapeLike('\\'), '\\\\');
    assert.equal(escapeLike('a\\%b_'), 'a\\\\\\%b\\_');
    assert.equal(escapeLike('Sneha'), 'Sneha');
  });
});
