import {
  BONUS_CAPS,
  BONUS_PERCENT_BP,
  CURRENCY_BY_COUNTRY,
  DISTRIBUTIONS,
  EARLIEST_HIRE_DATE,
  EMAIL_DOMAIN,
  EMPLOYEE_COUNT,
  JOB_TITLES,
  PAY_FREQUENCY_BY_COUNTRY,
  SALARY_RANGES,
  SOON_TO_JOIN_MAX_DAYS_AHEAD,
  ZERO_BONUS_COUNT,
} from './constants.js';
import { fromDayNumber, isIsoDate, toDayNumber } from './iso-date.js';
import { NAMES_BY_COUNTRY } from './names.js';
import { createRandom } from './seeded-random.js';

export function formatEmployeeId(sequence) {
  return `ACME${String(sequence).padStart(5, '0')}`;
}

function normalizeNamePart(name) {
  const part = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (part === '') throw new Error('name has no supported characters for an email address');
  return part;
}

/** first.last.<employee id>@acme.com, lowercase, letters only in the name parts. */
export function buildEmail(firstName, lastName, employeeId) {
  return `${normalizeNamePart(firstName)}.${normalizeNamePart(lastName)}.${employeeId.toLowerCase()}@${EMAIL_DOMAIN}`;
}

/** Expands { A: 2, B: 1 } to a shuffled ['A', 'B', 'A'] with exact totals. */
function shuffledAssignments(totals, random) {
  const values = Object.entries(totals).flatMap(([value, count]) => Array(count).fill(value));
  return random.shuffle(values);
}

function generateDates(status, generationDay, random) {
  const earliestDay = toDayNumber(EARLIEST_HIRE_DATE);
  if (status === 'SOON_TO_JOIN') {
    const hireDay = generationDay + random.integer(1, SOON_TO_JOIN_MAX_DAYS_AHEAD);
    return { hireDay, endDay: null, effectiveDay: hireDay };
  }
  if (status === 'LEFT') {
    const hireDay = random.integer(earliestDay, generationDay - 1);
    const endDay = random.integer(hireDay + 1, generationDay);
    return { hireDay, endDay, effectiveDay: random.integer(hireDay, endDay) };
  }
  const hireDay = random.integer(earliestDay, generationDay);
  return { hireDay, endDay: null, effectiveDay: random.integer(hireDay, generationDay) };
}

/** Salary in whole currency units, rounded to 100. Ranges are multiples of 1,000. */
function generateSalary(country, level, random) {
  const { min, max } = SALARY_RANGES[country][level];
  return random.integer(min / 100, max / 100) * 100;
}

/** bonus = min(salary x percentage, currency cap), computed in minor units. */
function generateBonus(salary, level, currency, isZeroBonus, random) {
  if (isZeroBonus) return 0;
  const percent = BONUS_PERCENT_BP[level];
  // Non-zero bonus employees get at least 0.01%, so "exactly 20% zero" holds.
  const basisPoints = random.integer(Math.max(percent.min, 1), percent.max);
  const capMinor = (level === 'JUNIOR' ? BONUS_CAPS.JUNIOR : BONUS_CAPS.OTHER)[currency] * 100;
  const bonusMinor = Math.min(Math.floor((salary * 100 * basisPoints) / 10000), capMinor);
  return bonusMinor / 100;
}

/**
 * Generates the synthetic employee data set. Pure: same seed and generation
 * date give the same logical data. Does not validate; see employee-dataset.js.
 *
 * @param {{ seed: number, generationDate: string }} options
 */
export function generateEmployees({ seed, generationDate }) {
  if (!isIsoDate(generationDate) || generationDate <= EARLIEST_HIRE_DATE) {
    throw new TypeError(`generationDate must be a YYYY-MM-DD date after ${EARLIEST_HIRE_DATE}`);
  }
  const random = createRandom(seed);
  const generationDay = toDayNumber(generationDate);

  // Each dimension is an independent exact-total shuffle.
  const countries = shuffledAssignments(DISTRIBUTIONS.country_code, random);
  const statuses = shuffledAssignments(DISTRIBUTIONS.employment_status, random);
  const departments = shuffledAssignments(DISTRIBUTIONS.department, random);
  const levels = shuffledAssignments(DISTRIBUTIONS.level, random);
  const zeroBonusFlags = random.shuffle(
    Array.from({ length: EMPLOYEE_COUNT }, (_, i) => i < ZERO_BONUS_COUNT),
  );

  const employees = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
    const employeeId = formatEmployeeId(i + 1);
    const country = countries[i];
    const currency = CURRENCY_BY_COUNTRY[country];
    const department = departments[i];
    const level = levels[i];
    const status = statuses[i];
    const names = NAMES_BY_COUNTRY[country];
    const firstName = random.pick(names.first);
    const lastName = random.pick(names.last);
    const salary = generateSalary(country, level, random);
    const { hireDay, endDay, effectiveDay } = generateDates(status, generationDay, random);

    employees.push({
      employee_id: employeeId,
      first_name: firstName,
      last_name: lastName,
      email: buildEmail(firstName, lastName, employeeId),
      department,
      job_title: random.pick(JOB_TITLES[department][level]),
      level,
      country_code: country,
      currency,
      employment_status: status,
      hire_date: fromDayNumber(hireDay),
      employment_end_date: endDay === null ? null : fromDayNumber(endDay),
      annual_base_salary: salary,
      pay_frequency: PAY_FREQUENCY_BY_COUNTRY[country],
      annual_bonus: generateBonus(salary, level, currency, zeroBonusFlags[i], random),
      salary_effective_date: fromDayNumber(effectiveDay),
    });
  }
  return employees;
}
