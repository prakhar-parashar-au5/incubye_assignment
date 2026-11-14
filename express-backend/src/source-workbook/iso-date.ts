// Calendar-date helpers for YYYY-MM-DD strings.
// All arithmetic uses UTC day numbers, so results never depend on the
// computer's time zone or current date.

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/** True for a real calendar date written as YYYY-MM-DD. Narrows unknown input to string. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Days since 1970-01-01 for a valid ISO date string. */
export function toDayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return fromDayNumber(toDayNumber(isoDate) + days);
}
