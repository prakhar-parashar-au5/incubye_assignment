import {
  BONUS_CAPS,
  BONUS_PERCENT_BP,
  SALARY_RANGES,
  COUNTRY_CODES,
  CURRENCIES,
  CURRENCY_BY_COUNTRY,
  DEPARTMENTS,
  EMAIL_DOMAIN,
  EMPLOYMENT_STATUSES,
  JOB_TITLES,
  LEVELS,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_BY_COUNTRY,
} from './constants.js';
import { isIsoDate } from './iso-date.js';

const REQUIRED_TEXT_FIELDS = [
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
  'pay_frequency',
  'salary_effective_date',
];
const REQUIRED_NUMBER_FIELDS = ['annual_base_salary', 'annual_bonus'];

const EMPLOYEE_ID_PATTERN = /^ACME\d{5}$/;
const EMAIL_LOCAL_NAME_PATTERN = /^[a-z]+(\.[a-z]+)*$/;

const ENUM_FIELDS = {
  department: DEPARTMENTS,
  level: LEVELS,
  employment_status: EMPLOYMENT_STATUSES,
  country_code: COUNTRY_CODES,
  currency: CURRENCIES,
  pay_frequency: PAY_FREQUENCIES,
};

// A "management title" is any title approved for the MANAGER level.
const MANAGEMENT_TITLES = new Set(Object.values(JOB_TITLES).flatMap((byLevel) => byLevel.MANAGER));

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function isValidEmail(email, employeeId) {
  const suffix = `.${employeeId.toLowerCase()}@${EMAIL_DOMAIN}`;
  if (!email.endsWith(suffix)) return false;
  return EMAIL_LOCAL_NAME_PATTERN.test(email.slice(0, -suffix.length));
}

/**
 * Validates one employee row against the approved workbook rules.
 * Returns a list of { field, message } errors. An empty list means valid.
 * Messages never include salary values or the full record.
 *
 * @param {object} employee
 * @param {{ generationDate: string }} options  fixed YYYY-MM-DD date; never the computer date
 */
export function validateEmployee(employee, { generationDate } = {}) {
  if (!isIsoDate(generationDate)) {
    throw new TypeError('validateEmployee requires options.generationDate in YYYY-MM-DD format');
  }
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  const present = (field) => !isBlank(employee[field]);

  for (const field of [...REQUIRED_TEXT_FIELDS, ...REQUIRED_NUMBER_FIELDS]) {
    if (!present(field)) fail(field, 'is required');
  }

  const idValid = present('employee_id') && EMPLOYEE_ID_PATTERN.test(employee.employee_id);
  if (present('employee_id') && !idValid) {
    fail('employee_id', 'must be ACME followed by five digits');
  }
  if (idValid && present('email') && !isValidEmail(employee.email, employee.employee_id)) {
    fail('email', `must be lowercase name parts plus the employee ID at ${EMAIL_DOMAIN}`);
  }

  const enumValid = {};
  for (const [field, allowed] of Object.entries(ENUM_FIELDS)) {
    enumValid[field] = allowed.includes(employee[field]);
    if (present(field) && !enumValid[field]) fail(field, 'is not an allowed value');
  }

  if (enumValid.country_code) {
    const country = employee.country_code;
    if (enumValid.currency && employee.currency !== CURRENCY_BY_COUNTRY[country]) {
      fail('currency', `must be ${CURRENCY_BY_COUNTRY[country]} for ${country}`);
    }
    if (enumValid.pay_frequency && employee.pay_frequency !== PAY_FREQUENCY_BY_COUNTRY[country]) {
      fail('pay_frequency', `must be ${PAY_FREQUENCY_BY_COUNTRY[country]} for ${country}`);
    }
  }

  if (enumValid.department && enumValid.level && present('job_title')) {
    const allowedTitles = JOB_TITLES[employee.department][employee.level];
    if (!allowedTitles.includes(employee.job_title)) {
      fail('job_title', 'is not valid for the department and level');
    } else if ((employee.level === 'MANAGER') !== MANAGEMENT_TITLES.has(employee.job_title)) {
      // Defensive: holds by construction of JOB_TITLES, guards future list edits.
      fail('job_title', 'management titles are reserved for the MANAGER level');
    }
  }

  validateCompensation(employee, enumValid, fail);
  validateDates(employee, generationDate, fail);

  return errors;
}

function validateDates(employee, generationDate, fail) {
  const status = employee.employment_status;
  const hire = employee.hire_date;
  const effective = employee.salary_effective_date;
  const end = employee.employment_end_date;
  const hasEnd = !isBlank(end);

  const hireOk = isIsoDate(hire);
  const effectiveOk = isIsoDate(effective);
  const endOk = hasEnd && isIsoDate(end);
  if (!isBlank(hire) && !hireOk) fail('hire_date', 'must be a real date in YYYY-MM-DD format');
  if (!isBlank(effective) && !effectiveOk) {
    fail('salary_effective_date', 'must be a real date in YYYY-MM-DD format');
  }
  if (hasEnd && !endOk) fail('employment_end_date', 'must be a real date in YYYY-MM-DD format');

  // ISO YYYY-MM-DD strings compare correctly as text.
  if (hireOk && effectiveOk && effective < hire) {
    fail('salary_effective_date', 'must not be before the hire date');
  }

  if (status === 'SOON_TO_JOIN') {
    if (hasEnd) fail('employment_end_date', 'must be empty for SOON_TO_JOIN');
    if (hireOk && hire <= generationDate) fail('hire_date', 'must be after the generation date for SOON_TO_JOIN');
    if (hireOk && effectiveOk && effective !== hire) {
      fail('salary_effective_date', 'must equal the hire date for SOON_TO_JOIN');
    }
  } else if (status === 'CURRENTLY_WORKING') {
    if (hasEnd) fail('employment_end_date', 'must be empty for CURRENTLY_WORKING');
    if (hireOk && hire > generationDate) fail('hire_date', 'must not be after the generation date');
    if (effectiveOk && effective > generationDate) {
      fail('salary_effective_date', 'must not be after the generation date');
    }
  } else if (status === 'LEFT') {
    if (!hasEnd) {
      fail('employment_end_date', 'is required for LEFT');
    } else if (endOk) {
      if (hireOk && end <= hire) fail('employment_end_date', 'must be after the hire date');
      if (end > generationDate) fail('employment_end_date', 'must not be after the generation date');
      if (effectiveOk && effective > end) fail('salary_effective_date', 'must not be after the end date');
    }
  }
}

/**
 * Converts a money amount to integer minor units (paise / cents).
 * Returns null for non-numbers, non-finite values, and more than two decimals.
 */
function toMinorUnits(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const minor = Math.round(scaled);
  return Math.abs(scaled - minor) < 1e-6 ? minor : null;
}

function validateCompensation(employee, enumValid, fail) {
  const { annual_base_salary: salary, annual_bonus: bonus, level } = employee;
  const countryOk = enumValid.country_code && enumValid.currency && enumValid.level;
  const currencyMatches = countryOk && employee.currency === CURRENCY_BY_COUNTRY[employee.country_code];

  let salaryMinor = null;
  if (salary !== undefined && salary !== null) {
    salaryMinor = toMinorUnits(salary);
    if (salaryMinor === null) {
      fail('annual_base_salary', 'must be a number with at most two decimal places');
    } else if (salaryMinor <= 0) {
      fail('annual_base_salary', 'must be more than zero');
      salaryMinor = null;
    } else if (countryOk) {
      const range = SALARY_RANGES[employee.country_code][level];
      if (salaryMinor < range.min * 100 || salaryMinor > range.max * 100) {
        fail('annual_base_salary', `is outside the approved ${employee.country_code} ${level} range`);
        salaryMinor = null;
      }
    }
  }

  if (bonus === undefined || bonus === null) return;
  const bonusMinor = toMinorUnits(bonus);
  if (bonusMinor === null) {
    fail('annual_bonus', 'must be a number with at most two decimal places');
    return;
  }
  if (bonusMinor < 0) {
    fail('annual_bonus', 'must be zero or positive');
    return;
  }
  if (bonusMinor === 0 || !currencyMatches) return;

  const capMinor = (level === 'JUNIOR' ? BONUS_CAPS.JUNIOR : BONUS_CAPS.OTHER)[employee.currency] * 100;
  if (bonusMinor > capMinor) {
    fail('annual_bonus', `exceeds the ${level} ${employee.currency} cap`);
    return;
  }
  if (salaryMinor === null) return;

  // Approved rule: bonus = min(salary x percentage, cap), percentage within the level range.
  const percent = BONUS_PERCENT_BP[level];
  if (bonusMinor * 10000 > salaryMinor * percent.max) {
    fail('annual_bonus', `exceeds the ${level} bonus percentage`);
  } else if (bonusMinor < Math.min(Math.floor((salaryMinor * percent.min) / 10000), capMinor)) {
    fail('annual_bonus', `is below the ${level} bonus percentage`);
  }
}
