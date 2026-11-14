import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateEmployee } from '../src/source-workbook/employee-validator.js';
import type { UnvalidatedEmployee } from '../src/source-workbook/employee-validator.js';
import type { Column } from '../src/source-workbook/constants.js';

const GENERATION_DATE = '2026-11-14';

// A hand-written, known-valid employee. Each test changes one relevant value.
function validEmployee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    employee_id: 'ACME00001',
    first_name: 'Aditi',
    last_name: 'Sharma',
    email: 'aditi.sharma.acme00001@acme.com',
    department: 'Tech',
    job_title: 'Senior Software Engineer',
    level: 'SENIOR',
    country_code: 'IN',
    currency: 'INR',
    employment_status: 'CURRENTLY_WORKING',
    hire_date: '2022-08-14',
    employment_end_date: null,
    annual_base_salary: 2500000,
    pay_frequency: 'MONTHLY',
    annual_bonus: 250000,
    salary_effective_date: '2025-04-01',
    ...overrides,
  };
}

function errorFields(employee: UnvalidatedEmployee): string[] {
  return validateEmployee(employee, { generationDate: GENERATION_DATE }).map((e) => e.field);
}

function assertRejectedOn(employee: UnvalidatedEmployee, field: Column): void {
  const fields = errorFields(employee);
  assert.ok(fields.includes(field), `expected an error on "${field}", got: [${fields.join(', ')}]`);
}

describe('validateEmployee: baseline', () => {
  // Detects: a validator that is over-strict and rejects a correct row,
  // which would make every other "rejects X" test meaningless.
  test('accepts a valid employee', () => {
    assert.deepEqual(errorFields(validEmployee()), []);
  });
});

describe('validateEmployee: required values', () => {
  // Detects: a required column silently missing from a generated row.
  test('rejects a missing required value', () => {
    const employee = validEmployee();
    delete employee.first_name;
    assertRejectedOn(employee, 'first_name');
  });

  // Detects: null treated as "present".
  test('rejects a null required value', () => {
    assertRejectedOn(validEmployee({ last_name: null }), 'last_name');
  });

  // Detects: empty or whitespace-only text treated as a real value.
  test('rejects an empty or whitespace-only required text value', () => {
    assertRejectedOn(validEmployee({ first_name: '' }), 'first_name');
    assertRejectedOn(validEmployee({ last_name: '   ' }), 'last_name');
  });
});

describe('validateEmployee: identity format', () => {
  // Detects: IDs with the wrong prefix, wrong digit count, or lowercase,
  // which would break matching by stable employee ID during import.
  for (const badId of ['ACME1', 'ACME000001', 'acme00001', 'EMP00001', 'ACME0000A', ' ACME00001']) {
    test(`rejects employee ID "${badId}"`, () => {
      assertRejectedOn(validEmployee({ employee_id: badId }), 'employee_id');
    });
  }

  // Detects: emails on another domain, uppercase emails, or emails that do not
  // embed the employee ID (the approved way to guarantee uniqueness).
  for (const badEmail of [
    'aditi.sharma.acme00001@gmail.com',
    'Aditi.Sharma.ACME00001@acme.com',
    'aditi.sharma.acme00002@acme.com',
    'aditi sharma.acme00001@acme.com',
  ]) {
    test(`rejects email "${badEmail}"`, () => {
      assertRejectedOn(validEmployee({ email: badEmail }), 'email');
    });
  }
});

describe('validateEmployee: allowed values', () => {
  // Detects: values outside the approved lists, including near-misses such as
  // the raw-notes spellings ("Engineering", "Annually", "India").
  const cases: [Column, string][] = [
    ['department', 'Engineering'],
    ['department', 'tech'],
    ['level', 'L3'],
    ['level', 'SENIOR_MANAGEMENT'],
    ['employment_status', 'active'],
    ['country_code', 'India'],
    ['country_code', 'GB'],
    ['currency', 'IND'],
    ['currency', 'GBP'],
    ['pay_frequency', 'Annually'],
    ['pay_frequency', 'ONE_TIME'],
  ];
  for (const [field, value] of cases) {
    test(`rejects ${field} "${value}"`, () => {
      assertRejectedOn(validEmployee({ [field]: value }), field);
    });
  }
});

describe('validateEmployee: country rules', () => {
  // Detects: an India employee paid in USD (would corrupt per-currency analytics).
  test('rejects a country and currency mismatch', () => {
    assertRejectedOn(validEmployee({ currency: 'USD' }), 'currency');
  });

  // Detects: India employee marked ANNUAL, contrary to the approved rule.
  test('rejects a country and pay frequency mismatch', () => {
    assertRejectedOn(validEmployee({ pay_frequency: 'ANNUAL' }), 'pay_frequency');
  });
});

describe('validateEmployee: job titles', () => {
  // Detects: a title that belongs to another department.
  test('rejects a title from another department', () => {
    assertRejectedOn(validEmployee({ job_title: 'Senior Accountant' }), 'job_title');
  });

  // Detects: a title that belongs to another level in the same department.
  test('rejects a title from another level', () => {
    assertRejectedOn(validEmployee({ job_title: 'Software Engineer' }), 'job_title');
  });

  // Detects: a MANAGER without a management title.
  test('rejects a MANAGER with a non-management title', () => {
    assertRejectedOn(validEmployee({ level: 'MANAGER', job_title: 'Tech Lead' }), 'job_title');
  });

  // Detects: a non-manager given a management title.
  test('rejects a non-manager with a management title', () => {
    assertRejectedOn(validEmployee({ job_title: 'Engineering Manager' }), 'job_title');
  });

  // Detects: a free-text title not in the approved list (e.g. the doc example).
  test('rejects a title that is not in the approved list', () => {
    assertRejectedOn(validEmployee({ job_title: 'Backend Engineer' }), 'job_title');
  });
});

describe('validateEmployee: annual base salary', () => {
  // Detects: off-by-one at the range edges. Boundaries are inclusive.
  test('accepts salaries exactly at the approved range boundaries', () => {
    assert.deepEqual(errorFields(validEmployee({ annual_base_salary: 1800000 })), []);
    assert.deepEqual(errorFields(validEmployee({ annual_base_salary: 3800000 })), []);
  });

  // Detects: India SENIOR salary below 1,800,000 or above 3,800,000 INR.
  test('rejects an annual base salary outside the India SENIOR range', () => {
    assertRejectedOn(validEmployee({ annual_base_salary: 1799999.99 }), 'annual_base_salary');
    assertRejectedOn(validEmployee({ annual_base_salary: 3800000.01 }), 'annual_base_salary');
  });

  // Detects: the range lookup ignoring country (an INR-sized figure for a US employee).
  test('rejects a US salary that is only valid as an INR amount', () => {
    const us = { country_code: 'US', currency: 'USD', pay_frequency: 'ANNUAL', annual_bonus: 0 };
    assert.deepEqual(errorFields(validEmployee({ ...us, annual_base_salary: 150000 })), []);
    assertRejectedOn(validEmployee({ ...us, annual_base_salary: 2500000 }), 'annual_base_salary');
  });

  // Detects: the range lookup ignoring level (a JUNIOR paid a SENIOR salary).
  test('rejects a JUNIOR salary that is only valid for SENIOR', () => {
    const junior = { level: 'JUNIOR', job_title: 'Junior Software Engineer', annual_bonus: 0 };
    assertRejectedOn(validEmployee({ ...junior, annual_base_salary: 2500000 }), 'annual_base_salary');
  });

  // Detects: sub-paisa/sub-cent precision that cannot be stored exactly.
  test('rejects an annual base salary with more than two decimal places', () => {
    assertRejectedOn(validEmployee({ annual_base_salary: 2500000.005 }), 'annual_base_salary');
  });

  // Detects: numeric-looking strings, NaN, or Infinity accepted as money.
  test('rejects a non-numeric annual base salary', () => {
    for (const bad of ['2500000', Number.NaN, Number.POSITIVE_INFINITY, 'gibberish']) {
      assertRejectedOn(validEmployee({ annual_base_salary: bad }), 'annual_base_salary');
    }
  });

  // Detects: zero or negative base salary.
  test('rejects a zero or negative annual base salary', () => {
    assertRejectedOn(validEmployee({ annual_base_salary: 0 }), 'annual_base_salary');
    assertRejectedOn(validEmployee({ annual_base_salary: -2500000 }), 'annual_base_salary');
  });
});

describe('validateEmployee: annual bonus', () => {
  // Detects: zero bonus wrongly treated as missing (0 is falsy in JavaScript).
  test('accepts a zero annual bonus', () => {
    assert.deepEqual(errorFields(validEmployee({ annual_bonus: 0 })), []);
  });

  // Detects: a negative bonus.
  test('rejects a negative annual bonus', () => {
    assertRejectedOn(validEmployee({ annual_bonus: -1 }), 'annual_bonus');
  });

  // Detects: bonus with more than two decimal places.
  test('rejects an annual bonus with more than two decimal places', () => {
    assertRejectedOn(validEmployee({ annual_bonus: 100.001 }), 'annual_bonus');
  });

  // Detects: the JUNIOR cap not applied (INR 200,000 / USD 2,000).
  test('rejects a JUNIOR bonus above the currency cap', () => {
    const junior = {
      level: 'JUNIOR',
      job_title: 'Junior Software Engineer',
      annual_base_salary: 1200000,
    };
    assert.deepEqual(errorFields(validEmployee({ ...junior, annual_bonus: 120000 })), []);
    // 200,000.01 INR: above the cap. Percentage is also above 10%, so check the
    // US case where the cap binds before the percentage limit.
    const usJunior = {
      ...junior,
      country_code: 'US',
      currency: 'USD',
      pay_frequency: 'ANNUAL',
      annual_base_salary: 90000,
    };
    assert.deepEqual(errorFields(validEmployee({ ...usJunior, annual_bonus: 2000 })), []);
    assertRejectedOn(validEmployee({ ...usJunior, annual_bonus: 2000.01 }), 'annual_bonus');
  });

  // Detects: the non-JUNIOR cap not applied (INR 1,000,000 / USD 10,000).
  test('rejects a non-JUNIOR bonus above the currency cap', () => {
    const manager = {
      level: 'MANAGER',
      job_title: 'Engineering Manager',
      annual_base_salary: 7000000,
    };
    // 30% of 7,000,000 = 2,100,000, so the 1,000,000 cap is the binding limit.
    assert.deepEqual(errorFields(validEmployee({ ...manager, annual_bonus: 1000000 })), []);
    assertRejectedOn(validEmployee({ ...manager, annual_bonus: 1000000.01 }), 'annual_bonus');
  });

  // Detects: the level's bonus percentage ceiling not applied.
  // SENIOR max is 20%: 20% of 2,500,000 = 500,000.
  test('rejects a non-zero bonus above the level percentage', () => {
    assert.deepEqual(errorFields(validEmployee({ annual_bonus: 500000 })), []);
    assertRejectedOn(validEmployee({ annual_bonus: 500000.01 }), 'annual_bonus');
  });

  // Detects: the level's bonus percentage floor not applied to a non-zero bonus.
  // MANAGER min is 10%: 10% of 4,000,000 = 400,000.
  test('rejects a non-zero bonus below the level percentage floor', () => {
    const manager = {
      level: 'MANAGER',
      job_title: 'Engineering Manager',
      annual_base_salary: 4000000,
    };
    assert.deepEqual(errorFields(validEmployee({ ...manager, annual_bonus: 400000 })), []);
    assertRejectedOn(validEmployee({ ...manager, annual_bonus: 399999.99 }), 'annual_bonus');
  });

  // Detects: the floor wrongly rejecting a bonus that sits below the floor only
  // because the currency cap made it smaller ("smaller of percentage and cap").
  // US LEAD: 5% of 230,000 = 11,500 > 10,000 cap, so 10,000 is legitimate.
  test('accepts a capped bonus that falls below the percentage floor', () => {
    const usLead = {
      level: 'LEAD',
      job_title: 'Tech Lead',
      country_code: 'US',
      currency: 'USD',
      pay_frequency: 'ANNUAL',
      annual_base_salary: 230000,
    };
    assert.deepEqual(errorFields(validEmployee({ ...usLead, annual_bonus: 10000 })), []);
    assertRejectedOn(validEmployee({ ...usLead, annual_bonus: 9999 }), 'annual_bonus');
  });
});

describe('validateEmployee: date format', () => {
  // Detects: locale formats, unpadded parts, impossible calendar dates, and
  // Date objects (which Excel would convert using the reader's locale).
  for (const bad of ['2022-8-14', '14/08/2022', '2022-02-30', '2023-02-29', '20220814', new Date(0)]) {
    test(`rejects hire_date ${JSON.stringify(bad)}`, () => {
      assertRejectedOn(validEmployee({ hire_date: bad }), 'hire_date');
    });
  }

  // Detects: a leap-day check that is too strict.
  test('accepts a real leap day', () => {
    assert.deepEqual(errorFields(validEmployee({ hire_date: '2024-02-29' })), []);
  });
});

describe('validateEmployee: CURRENTLY_WORKING dates', () => {
  // Detects: salary effective before the employee was hired.
  test('rejects a salary effective date before the hire date', () => {
    assertRejectedOn(validEmployee({ salary_effective_date: '2022-08-13' }), 'salary_effective_date');
  });

  // Detects: a current employee with a hire date after the generation date.
  test('rejects a future hire date', () => {
    assertRejectedOn(
      validEmployee({ hire_date: '2026-11-15', salary_effective_date: '2026-11-15' }),
      'hire_date',
    );
  });

  // Detects: hire date equal to the generation date wrongly treated as future.
  test('accepts a hire date equal to the generation date', () => {
    assert.deepEqual(
      errorFields(validEmployee({ hire_date: '2026-11-14', salary_effective_date: '2026-11-14' })),
      [],
    );
  });

  // Detects: a current employee carrying an end date.
  test('rejects an end date', () => {
    assertRejectedOn(validEmployee({ employment_end_date: '2025-01-31' }), 'employment_end_date');
  });

  // Detects: a current salary that only starts in the future.
  test('rejects a salary effective date after the generation date', () => {
    assertRejectedOn(validEmployee({ salary_effective_date: '2026-11-15' }), 'salary_effective_date');
  });
});

describe('validateEmployee: SOON_TO_JOIN dates', () => {
  const soon = {
    employment_status: 'SOON_TO_JOIN',
    hire_date: '2026-12-01',
    salary_effective_date: '2026-12-01',
  };

  test('accepts a valid SOON_TO_JOIN employee', () => {
    assert.deepEqual(errorFields(validEmployee(soon)), []);
  });

  // Detects: a joiner whose hire date is not in the future (including today).
  test('rejects a past or current hire date', () => {
    assertRejectedOn(
      validEmployee({ ...soon, hire_date: '2026-11-14', salary_effective_date: '2026-11-14' }),
      'hire_date',
    );
  });

  // Detects: a joiner carrying an end date.
  test('rejects an end date', () => {
    assertRejectedOn(validEmployee({ ...soon, employment_end_date: '2027-01-01' }), 'employment_end_date');
  });

  // Detects: a joiner whose salary starts on a date other than the hire date.
  test('rejects a salary effective date different from the hire date', () => {
    assertRejectedOn(validEmployee({ ...soon, salary_effective_date: '2026-12-02' }), 'salary_effective_date');
  });
});

describe('validateEmployee: LEFT dates', () => {
  const left = {
    employment_status: 'LEFT',
    hire_date: '2020-01-10',
    employment_end_date: '2025-01-31',
    salary_effective_date: '2024-04-01',
  };

  test('accepts a valid LEFT employee', () => {
    assert.deepEqual(errorFields(validEmployee(left)), []);
  });

  // Detects: a leaver without an end date.
  test('rejects a missing end date', () => {
    assertRejectedOn(validEmployee({ ...left, employment_end_date: null }), 'employment_end_date');
    assertRejectedOn(validEmployee({ ...left, employment_end_date: '' }), 'employment_end_date');
  });

  // Detects: an end date before or on the hire date.
  test('rejects an end date that is not after the hire date', () => {
    assertRejectedOn(
      validEmployee({ ...left, employment_end_date: '2020-01-10', salary_effective_date: '2020-01-10' }),
      'employment_end_date',
    );
    assertRejectedOn(
      validEmployee({ ...left, employment_end_date: '2019-12-31', salary_effective_date: '2020-01-10' }),
      'employment_end_date',
    );
  });

  // Detects: a leaver whose end date is after the generation date.
  test('rejects an end date after the generation date', () => {
    assertRejectedOn(validEmployee({ ...left, employment_end_date: '2026-11-15' }), 'employment_end_date');
  });

  // Detects: a salary change effective after the employee left.
  test('rejects a salary effective date after the end date', () => {
    assertRejectedOn(validEmployee({ ...left, salary_effective_date: '2025-02-01' }), 'salary_effective_date');
  });
});

describe('validateEmployee: options', () => {
  // Detects: the validator silently falling back to the computer date.
  test('throws when the generation date is missing or invalid', () => {
    assert.throws(() => validateEmployee(validEmployee(), {}), /generationDate/);
    assert.throws(() => validateEmployee(validEmployee(), { generationDate: '2026-13-01' }), /generationDate/);
  });
});
