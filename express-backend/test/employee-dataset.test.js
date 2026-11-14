import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { generateEmployees } from '../src/source-workbook/employee-generator.js';
import { validateEmployeeDataset } from '../src/source-workbook/employee-dataset.js';

const GENERATION_DATE = '2026-11-14';
const OPTIONS = { generationDate: GENERATION_DATE };

// Each test corrupts one aspect of a known-good data set and expects the
// data set validator (the gate before workbook writing) to report it.
describe('validateEmployeeDataset', () => {
  let generated;
  before(() => {
    generated = generateEmployees({ seed: 20261114, generationDate: GENERATION_DATE });
  });
  const fresh = () => structuredClone(generated);
  const assertReports = (employees, pattern) => {
    const errors = validateEmployeeDataset(employees, OPTIONS);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern}, got: ${JSON.stringify(errors.slice(0, 5))}`);
  };

  // Detects: a gate that rejects good data, which would block every generation.
  test('accepts the generated data set', () => {
    assert.deepEqual(validateEmployeeDataset(generated, OPTIONS), []);
  });

  // Detects: a truncated data set being written.
  test('reports a wrong row count', () => {
    assertReports(fresh().slice(0, 9999), /10000 employees/);
  });

  // Detects: duplicate employee IDs.
  test('reports a duplicate employee ID', () => {
    const employees = fresh();
    employees[1].employee_id = employees[0].employee_id;
    assertReports(employees, /duplicate employee_id ACME00001/);
  });

  // Detects: IDs that are unique but not the approved ACME00001..ACME10000 sequence.
  test('reports an ID outside the approved sequence', () => {
    const employees = fresh();
    employees[9999].employee_id = 'ACME99999';
    assertReports(employees, /row 10000: expected employee_id ACME10000/);
  });

  // Detects: duplicate email addresses.
  test('reports a duplicate email address', () => {
    const employees = fresh();
    employees[1].email = employees[0].email;
    assertReports(employees, /duplicate email/);
  });

  // Detects: a department total that drifts from the approved distribution
  // even though each row is individually valid.
  test('reports a department total that differs from the approved distribution', () => {
    const employees = fresh();
    const techEmployee = employees.find((e) => e.department === 'Tech' && e.level === 'MANAGER');
    techEmployee.department = 'HR';
    techEmployee.job_title = 'HR Manager';
    assertReports(employees, /department Tech: expected 4000, got 3999/);
    assertReports(employees, /department HR: expected 700, got 701/);
  });

  // Detects: zero-bonus share drifting from exactly 2,000.
  test('reports a zero-bonus count other than 2,000', () => {
    const employees = fresh();
    employees.find((e) => e.annual_bonus > 0).annual_bonus = 0;
    assertReports(employees, /zero annual_bonus: expected 2000, got 2001/);
  });

  // Detects: a department staffed from one country only.
  test('reports a department without employees from both countries', () => {
    const employees = fresh();
    for (const e of employees) {
      if (e.department === 'HR' && e.country_code === 'US') {
        Object.assign(e, { country_code: 'IN', currency: 'INR', pay_frequency: 'MONTHLY' });
      }
    }
    assertReports(employees, /department HR has no US employees/);
  });

  // Detects: a row-level violation hidden inside a large data set, and errors
  // that leak salary values.
  test('reports an invalid employee by ID and field without the value', () => {
    const employees = fresh();
    employees[5].annual_base_salary = 123.45;
    const errors = validateEmployeeDataset(employees, OPTIONS);
    const rowError = errors.find((e) => e.startsWith('ACME00006'));
    assert.match(rowError, /annual_base_salary/);
    assert.doesNotMatch(errors.join('\n'), /123\.45/);
  });

  // Detects: an unbounded error list that floods the console with 10,000 lines.
  test('bounds the number of reported row errors', () => {
    const employees = fresh();
    for (const e of employees) e.annual_base_salary = -1;
    const errors = validateEmployeeDataset(employees, OPTIONS);
    assert.ok(errors.length <= 25, `got ${errors.length} errors`);
    assert.ok(errors.some((e) => /more row errors/.test(e)));
  });
});
