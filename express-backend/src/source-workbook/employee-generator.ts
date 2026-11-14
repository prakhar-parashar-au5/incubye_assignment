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
import type { CountryCode, Currency, EmployeeRecord, EmploymentStatus, Level } from './constants.js';
import { fromDayNumber, isIsoDate, toDayNumber } from './iso-date.js';
import { NAMES_BY_COUNTRY } from './names.js';
import { createRandom } from './seeded-random.js';
import type { SeededRandom } from './seeded-random.js';

export function formatEmployeeId(sequence: number): string {
  return `ACME${String(sequence).padStart(5, '0')}`;
}

function normalizeNamePart(name: string): string {
  const part = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (part === '') throw new Error('name has no supported characters for an email address');
  return part;
}

/** first.last.<employee id>@acme.com, lowercase, letters only in the name parts. */
export function buildEmail(firstName: string, lastName: string, employeeId: string): string {
  return `${normalizeNamePart(firstName)}.${normalizeNamePart(lastName)}.${employeeId.toLowerCase()}@${EMAIL_DOMAIN}`;
}

/** Expands { A: 2, B: 1 } to a shuffled ['A', 'B', 'A'] with exact totals. */
function shuffledAssignments<K extends string>(totals: Readonly<Record<K, number>>, random: SeededRandom): K[] {
  // Object.entries widens keys to string; the keys are exactly K by the parameter type.
  const entries = Object.entries(totals) as [K, number][];
  const values = entries.flatMap(([value, count]) => Array<K>(count).fill(value));
  return random.shuffle(values);
}

interface GeneratedDates {
  hireDay: number;
  endDay: number | null;
  effectiveDay: number;
}

function generateDates(status: EmploymentStatus, generationDay: number, random: SeededRandom): GeneratedDates {
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
function generateSalary(country: CountryCode, level: Level, random: SeededRandom): number {
  const { min, max } = SALARY_RANGES[country][level];
  return random.integer(min / 100, max / 100) * 100;
}

/** bonus = min(salary x percentage, currency cap), computed in minor units. */
function generateBonus(salary: number, level: Level, currency: Currency, isZeroBonus: boolean, random: SeededRandom): number {
  if (isZeroBonus) return 0;
  const percent = BONUS_PERCENT_BP[level];
  // Non-zero bonus employees get at least 0.01%, so "exactly 20% zero" holds.
  const basisPoints = random.integer(Math.max(percent.min, 1), percent.max);
  const capMinor = (level === 'JUNIOR' ? BONUS_CAPS.JUNIOR : BONUS_CAPS.OTHER)[currency] * 100;
  const bonusMinor = Math.min(Math.floor((salary * 100 * basisPoints) / 10000), capMinor);
  return bonusMinor / 100;
}

/** Value at index i of an array whose length is EMPLOYEE_COUNT by construction. */
function at<T>(values: readonly T[], i: number): T {
  return values[i] as T;
}

/**
 * Generates the synthetic employee data set. Pure: same seed and generation
 * date give the same logical data. Does not validate; see employee-dataset.ts.
 */
export function generateEmployees({ seed, generationDate }: { seed: number; generationDate: string }): EmployeeRecord[] {
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

  const employees: EmployeeRecord[] = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
    const employeeId = formatEmployeeId(i + 1);
    const country = at(countries, i);
    const currency = CURRENCY_BY_COUNTRY[country];
    const department = at(departments, i);
    const level = at(levels, i);
    const status = at(statuses, i);
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
      annual_bonus: generateBonus(salary, level, currency, at(zeroBonusFlags, i), random),
      salary_effective_date: fromDayNumber(effectiveDay),
    });
  }
  return employees;
}
