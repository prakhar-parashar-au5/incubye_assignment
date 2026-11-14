// Approved values from docs/01-source-workbook.md and docs/02-synthetic-data-rules.md.
// Change these only after a product decision is recorded in those documents.

export const DEFAULT_SEED = 20261114;
export const DEFAULT_GENERATION_DATE = '2026-11-14';
export const EMPLOYEE_COUNT = 10000;

export const WORKSHEET_NAME = 'Employees';

export const COLUMNS = Object.freeze([
  'employee_id',
  'first_name',
  'last_name',
  'email',
  'department',
  'job_title',
  'level',
  'country_code',
  'currency',
  'employment_status',
  'hire_date',
  'employment_end_date',
  'annual_base_salary',
  'pay_frequency',
  'annual_bonus',
  'salary_effective_date',
]);

export const DEPARTMENTS = Object.freeze(['Tech', 'HR', 'Finance', 'Operations', 'Support']);
export const LEVELS = Object.freeze(['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER']);
export const COUNTRY_CODES = Object.freeze(['IN', 'US']);
export const CURRENCIES = Object.freeze(['INR', 'USD']);
export const EMPLOYMENT_STATUSES = Object.freeze(['SOON_TO_JOIN', 'CURRENTLY_WORKING', 'LEFT']);
export const PAY_FREQUENCIES = Object.freeze(['MONTHLY', 'ANNUAL']);

export const CURRENCY_BY_COUNTRY = Object.freeze({ IN: 'INR', US: 'USD' });
export const PAY_FREQUENCY_BY_COUNTRY = Object.freeze({ IN: 'MONTHLY', US: 'ANNUAL' });

// Exact totals for a 10,000-employee data set.
export const DISTRIBUTIONS = Object.freeze({
  country_code: { IN: 7000, US: 3000 },
  employment_status: { CURRENTLY_WORKING: 8500, LEFT: 1000, SOON_TO_JOIN: 500 },
  department: { Tech: 4000, Support: 2500, Operations: 2000, Finance: 800, HR: 700 },
  level: { JUNIOR: 2500, MID: 3500, SENIOR: 2500, LEAD: 800, MANAGER: 700 },
});
export const ZERO_BONUS_COUNT = 2000;

// Annual base salary ranges in whole currency units, inclusive.
export const SALARY_RANGES = Object.freeze({
  IN: {
    JUNIOR: { min: 500000, max: 1200000 },
    MID: { min: 1000000, max: 2200000 },
    SENIOR: { min: 1800000, max: 3800000 },
    LEAD: { min: 3000000, max: 5500000 },
    MANAGER: { min: 3500000, max: 7000000 },
  },
  US: {
    JUNIOR: { min: 55000, max: 90000 },
    MID: { min: 80000, max: 130000 },
    SENIOR: { min: 120000, max: 190000 },
    LEAD: { min: 160000, max: 230000 },
    MANAGER: { min: 150000, max: 250000 },
  },
});

// Bonus percentage ranges in basis points (100 bp = 1%), inclusive.
export const BONUS_PERCENT_BP = Object.freeze({
  JUNIOR: { min: 0, max: 1000 },
  MID: { min: 0, max: 1500 },
  SENIOR: { min: 0, max: 2000 },
  LEAD: { min: 500, max: 2500 },
  MANAGER: { min: 1000, max: 3000 },
});

// Maximum annual bonus in whole currency units.
export const BONUS_CAPS = Object.freeze({
  JUNIOR: { INR: 200000, USD: 2000 },
  OTHER: { INR: 1000000, USD: 10000 },
});

export const JOB_TITLES = Object.freeze({
  Tech: {
    JUNIOR: ['Junior Software Engineer', 'Junior Quality Engineer'],
    MID: ['Software Engineer', 'Quality Engineer', 'Data Engineer', 'Platform Engineer'],
    SENIOR: [
      'Senior Software Engineer',
      'Senior Quality Engineer',
      'Senior Data Engineer',
      'Senior Platform Engineer',
    ],
    LEAD: ['Tech Lead', 'Quality Lead', 'Data Lead', 'Platform Lead'],
    MANAGER: ['Engineering Manager'],
  },
  Support: {
    JUNIOR: ['Support Associate'],
    MID: ['Support Specialist'],
    SENIOR: ['Senior Support Specialist', 'Technical Support Engineer'],
    LEAD: ['Support Lead'],
    MANAGER: ['Support Manager'],
  },
  Operations: {
    JUNIOR: ['Operations Associate'],
    MID: ['Operations Analyst'],
    SENIOR: ['Senior Operations Analyst', 'Program Manager'],
    LEAD: ['Operations Lead', 'Program Lead'],
    MANAGER: ['Operations Manager'],
  },
  Finance: {
    JUNIOR: ['Finance Associate'],
    MID: ['Accountant', 'Financial Analyst'],
    SENIOR: ['Senior Accountant', 'Senior Financial Analyst'],
    LEAD: ['Finance Lead'],
    MANAGER: ['Finance Manager'],
  },
  HR: {
    JUNIOR: ['HR Associate'],
    MID: ['Recruiter', 'HR Generalist'],
    SENIOR: ['Senior Recruiter', 'HR Business Partner', 'Compensation Analyst'],
    LEAD: ['HR Lead', 'Recruitment Lead'],
    MANAGER: ['HR Manager'],
  },
});

// Earliest hire date in the synthetic data ("dates from 2012").
export const EARLIEST_HIRE_DATE = '2012-01-01';
// SOON_TO_JOIN hire dates fall 1..N days after the generation date.
export const SOON_TO_JOIN_MAX_DAYS_AHEAD = 90;

export const EMAIL_DOMAIN = 'acme.com';
