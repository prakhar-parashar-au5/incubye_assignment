import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { generateEmployees, buildEmail } from '../src/source-workbook/employee-generator.js';
import { validateEmployee } from '../src/source-workbook/employee-validator.js';
import type { EmployeeRecord } from '../src/source-workbook/constants.js';

// Literal values from docs/02-synthetic-data-rules.md. Deliberately not imported
// from constants.js, so a wrong constant cannot make its own test pass.
const SEED = 20261114;
const GENERATION_DATE = '2026-11-14';

function countBy(employees: readonly EmployeeRecord[], field: keyof EmployeeRecord): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of employees) counts[String(e[field])] = (counts[String(e[field])] ?? 0) + 1;
  return counts;
}

describe('generateEmployees: complete data set', () => {
  let employees: EmployeeRecord[];
  before(() => {
    employees = generateEmployees({ seed: SEED, generationDate: GENERATION_DATE });
  });

  // Detects: off-by-one loops or a wrong count constant.
  test('generates exactly 10,000 employees', () => {
    assert.equal(employees.length, 10000);
  });

  // Detects: an ID sequence that skips, repeats, or starts at ACME00000.
  test('generates IDs ACME00001 through ACME10000 in order', () => {
    assert.equal(employees[0].employee_id, 'ACME00001');
    assert.equal(employees[9999].employee_id, 'ACME10000');
    employees.forEach((e, i) => assert.equal(e.employee_id, `ACME${String(i + 1).padStart(5, '0')}`));
  });

  // Detects: duplicate IDs (would break import matching by employee ID).
  test('generates 10,000 unique employee IDs', () => {
    assert.equal(new Set(employees.map((e) => e.employee_id)).size, 10000);
  });

  // Detects: emails derived from names only (repeated names would collide).
  test('generates 10,000 unique email addresses', () => {
    assert.equal(new Set(employees.map((e) => e.email)).size, 10000);
  });

  // Detects: random country picks instead of exact shuffled totals.
  test('generates exactly 7,000 India and 3,000 United States employees', () => {
    assert.deepEqual(countBy(employees, 'country_code'), { IN: 7000, US: 3000 });
  });

  test('generates the approved exact status totals', () => {
    assert.deepEqual(countBy(employees, 'employment_status'), {
      CURRENTLY_WORKING: 8500,
      LEFT: 1000,
      SOON_TO_JOIN: 500,
    });
  });

  test('generates the approved exact department totals', () => {
    assert.deepEqual(countBy(employees, 'department'), {
      Tech: 4000,
      Support: 2500,
      Operations: 2000,
      Finance: 800,
      HR: 700,
    });
  });

  test('generates the approved exact level totals', () => {
    assert.deepEqual(countBy(employees, 'level'), {
      JUNIOR: 2500,
      MID: 3500,
      SENIOR: 2500,
      LEAD: 800,
      MANAGER: 700,
    });
  });

  // Detects: a zero-bonus share that drifts because a 0% pick also yields zero.
  test('gives exactly 2,000 employees (20%) a zero annual bonus', () => {
    assert.equal(employees.filter((e) => e.annual_bonus === 0).length, 2000);
  });

  // Detects: a department generated for one country only.
  test('every department contains India and United States employees', () => {
    for (const department of ['Tech', 'Support', 'Operations', 'Finance', 'HR']) {
      const countries = new Set(employees.filter((e) => e.department === department).map((e) => e.country_code));
      assert.deepEqual([...countries].sort(), ['IN', 'US'], department);
    }
  });

  // Detects: a wrong value in constants.js. The validator and generator share
  // those constants, so only literal values from the approved tables catch it.
  test('keeps every salary inside the approved literal range for its country and level', () => {
    const approved = {
      IN: { JUNIOR: [500000, 1200000], MID: [1000000, 2200000], SENIOR: [1800000, 3800000],
        LEAD: [3000000, 5500000], MANAGER: [3500000, 7000000] },
      US: { JUNIOR: [55000, 90000], MID: [80000, 130000], SENIOR: [120000, 190000],
        LEAD: [160000, 230000], MANAGER: [150000, 250000] },
    };
    for (const e of employees) {
      const [min, max] = approved[e.country_code][e.level];
      assert.ok(e.annual_base_salary >= min && e.annual_base_salary <= max, e.employee_id);
    }
  });

  // Detects: a wrong bonus cap or percentage ceiling in constants.js.
  test('keeps every bonus within the approved literal cap and percentage ceiling', () => {
    const caps = { JUNIOR: { INR: 200000, USD: 2000 }, OTHER: { INR: 1000000, USD: 10000 } };
    const maxPercent = { JUNIOR: 10, MID: 15, SENIOR: 20, LEAD: 25, MANAGER: 30 };
    for (const e of employees) {
      const cap = (e.level === 'JUNIOR' ? caps.JUNIOR : caps.OTHER)[e.currency];
      assert.ok(e.annual_bonus >= 0 && e.annual_bonus <= cap, e.employee_id);
      assert.ok(e.annual_bonus <= (e.annual_base_salary * maxPercent[e.level]) / 100, e.employee_id);
    }
  });

  // Detects: a swapped currency or pay frequency mapping in constants.js.
  test('uses INR and MONTHLY for India, USD and ANNUAL for the United States', () => {
    const expected = { IN: 'INR/MONTHLY', US: 'USD/ANNUAL' };
    for (const e of employees) assert.equal(`${e.currency}/${e.pay_frequency}`, expected[e.country_code]);
  });

  // Detects: any generated row that breaks a per-employee rule (salary range,
  // bonus cap, title, dates, currency, pay frequency, email format).
  test('every generated employee passes the employee validator', () => {
    const invalid = employees.filter((e) => validateEmployee(e, { generationDate: GENERATION_DATE }).length > 0);
    assert.equal(invalid.length, 0, `first invalid: ${invalid[0]?.employee_id}`);
  });

  // Detects: missing or extra fields relative to the approved columns.
  test('every employee has exactly the approved fields', () => {
    const expected = [
      'employee_id', 'first_name', 'last_name', 'email', 'department', 'job_title', 'level',
      'country_code', 'currency', 'employment_status', 'hire_date', 'employment_end_date',
      'annual_base_salary', 'pay_frequency', 'annual_bonus', 'salary_effective_date',
    ].sort();
    for (const e of employees) assert.deepEqual(Object.keys(e).sort(), expected);
  });

  // Detects: generated values that are valid individually but lack variety.
  test('generates varied titles, salaries, and dates', () => {
    assert.ok(new Set(employees.map((e) => e.job_title)).size >= 30);
    assert.ok(new Set(employees.map((e) => e.annual_base_salary)).size >= 1000);
    assert.ok(new Set(employees.map((e) => e.hire_date)).size >= 1000);
  });
});

describe('generateEmployees: repeatability', () => {
  // Detects: hidden use of Math.random, the computer date, or object-order
  // dependence. Compares logical data, not file bytes.
  test('produces the same logical data for the same seed and generation date', () => {
    const first = generateEmployees({ seed: SEED, generationDate: GENERATION_DATE });
    const second = generateEmployees({ seed: SEED, generationDate: GENERATION_DATE });
    assert.deepEqual(first, second);
  });

  // Detects: a seed parameter that is accepted but ignored.
  test('produces different logical data for a different seed', () => {
    const first = generateEmployees({ seed: SEED, generationDate: GENERATION_DATE });
    const other = generateEmployees({ seed: SEED + 1, generationDate: GENERATION_DATE });
    assert.notDeepEqual(first, other);
  });

  // Detects: invalid generation input silently replaced by defaults.
  test('rejects an invalid seed or generation date', () => {
    assert.throws(() => generateEmployees({ seed: 1.5, generationDate: GENERATION_DATE }), /seed/);
    assert.throws(() => generateEmployees({ seed: -1, generationDate: GENERATION_DATE }), /seed/);
    assert.throws(() => generateEmployees({ seed: SEED, generationDate: '14-11-2026' }), /generationDate/);
  });
});

describe('buildEmail', () => {
  // Detects: emails built from raw names with spaces, apostrophes, accents, or capitals.
  test('normalizes name characters and appends the lowercase employee ID', () => {
    assert.equal(buildEmail('Aditi', 'Sharma', 'ACME00001'), 'aditi.sharma.acme00001@acme.com');
    assert.equal(buildEmail('Mary Ann', "O'Brien", 'ACME00042'), 'maryann.obrien.acme00042@acme.com');
    assert.equal(buildEmail('José', 'D’Souza', 'ACME10000'), 'jose.dsouza.acme10000@acme.com');
  });

  // Detects: an address with an empty name part such as ".sharma.acme00001@acme.com".
  test('throws when a name has no supported characters', () => {
    assert.throws(() => buildEmail('李', 'Sharma', 'ACME00001'), /name/);
  });
});
