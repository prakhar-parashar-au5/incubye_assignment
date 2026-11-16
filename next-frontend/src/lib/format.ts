import type { components } from "@/generated/api";

// Display formatting. Money arrives as exact decimal strings and is formatted as a string: it is
// never converted to a JavaScript number, so no rounding happens here. Dates arrive as
// calendar dates (YYYY-MM-DD) and are formatted in UTC so the day never shifts.

type Schemas = components["schemas"];
export type Currency = Schemas["SelectedCompensation"]["currency"];
type Row = Schemas["DirectoryRow"];

const MONEY_PATTERN = /^-?\d+\.\d{2}$/;

// INR uses Indian digit grouping (lakh, crore), as HR staff in India read it; USD uses US grouping.
const moneyFormatters: Record<Currency, Intl.NumberFormat> = {
  INR: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** "INR 25,00,000.00" / "USD 120,000.00". Accepts only the backend's two-decimal strings. */
export function formatMoney(amount: string, currency: Currency): string {
  if (!MONEY_PATTERN.test(amount)) return `${currency} ${amount}`;
  // Intl.NumberFormat formats a decimal string exactly (ECMA-402 string input), without
  // converting it to a binary float.
  return moneyFormatters[currency].format(amount as unknown as number).replace(/\s/u, "\u00a0");
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "6 Nov 2026" from "2026-11-06". */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return dateFormatter.format(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "15 Nov 2026, 09:12 UTC" from an ISO date-time. UTC, so server and browser render the same text. */
export function formatDateTime(isoDateTime: string): string {
  const time = Date.parse(isoDateTime);
  return Number.isNaN(time) ? isoDateTime : dateTimeFormatter.format(time);
}

const groupFormatter = new Intl.NumberFormat("en-US");
export function formatCount(value: number): string {
  return groupFormatter.format(value);
}

export const LEVEL_LABELS: Record<Row["level"], string> = {
  JUNIOR: "Junior",
  MID: "Mid",
  SENIOR: "Senior",
  LEAD: "Lead",
  MANAGER: "Manager",
};

export const STATUS_LABELS: Record<Row["employmentStatus"], string> = {
  SOON_TO_JOIN: "Soon to join",
  CURRENTLY_WORKING: "Currently working",
  LEFT: "Left",
};

export const COMPENSATION_STATE_LABELS: Record<Schemas["SelectedCompensation"]["state"], string> = {
  CURRENT: "Current",
  UPCOMING: "Upcoming",
  HISTORICAL: "Historical",
};

export const CHANGE_REASON_LABELS: Record<Schemas["CompensationHistoryEntry"]["changeReason"], string> = {
  INITIAL_IMPORT: "Initial import",
  PERFORMANCE: "Performance",
  MARKET_ADJUSTMENT: "Market adjustment",
  PROMOTION: "Promotion",
  ROLE_CHANGE: "Role change",
  CORRECTION: "Correction",
};

export const PAY_FREQUENCY_LABELS: Record<Schemas["SelectedCompensation"]["payFrequency"], string> = {
  MONTHLY: "Paid monthly",
  ANNUAL: "Paid annually",
};

export const SORT_LABELS: Record<NonNullable<Schemas["DirectoryResponse"]["sort"]["field"]>, string> = {
  name: "Employee name",
  employeeCode: "Employee ID",
  department: "Department",
  country: "Country",
  level: "Level",
  hireDate: "Hire date",
  annualBaseSalary: "Annual base salary (USD equivalent)",
  annualCashCompensation: "Annual cash compensation (USD equivalent)",
};

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}
