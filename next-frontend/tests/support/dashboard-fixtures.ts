// Contract-shaped dashboard responses for tests. tests/unit/dashboard.test.ts asserts each one
// passes the validator compiled from the generated contract, so they cannot drift from it.

import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export const RATE: Schemas["ExchangeRateContext"] = {
  baseCurrency: "USD",
  quoteCurrency: "INR",
  rate: "93.9100",
  sourceName: "Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates",
  sourceUrl: "https://www.federalreserve.gov/releases/h10/current/",
  effectiveDate: "2026-11-06",
  retrievedAt: "2026-11-07T10:00:00.000Z",
};

const filters = { department: null, country: null, currency: null, level: null, employmentStatus: null } as const;

export const ADMIN_ACCESS: Schemas["DashboardAccess"] = { hasEmployeeAccess: true, message: null, scope: { kind: "ALL", countries: [], departments: [] } };
export const SCOPED_ACCESS: Schemas["DashboardAccess"] = {
  hasEmployeeAccess: true,
  message: null,
  scope: { kind: "SCOPED", countries: ["IN"], departments: ["Support", "Tech"] },
};
export const NO_ACCESS: Schemas["DashboardAccess"] = {
  hasEmployeeAccess: false,
  message: "Your HR account has no employee access.",
  scope: { kind: "SCOPED", countries: [], departments: [] },
};

export function usdComparison(available = true): Schemas["DashboardUsdComparison"] {
  return available
    ? {
        available: true,
        unavailableReason: null,
        exchangeRate: RATE,
        quoteDescription: "1 USD = 93.9100 INR (INR per one US dollar)",
        disclaimer: "USD equivalents are informational; native amounts are authoritative.",
      }
    : {
        available: false,
        unavailableReason: "USD comparison is unavailable: no saved exchange rate. Native totals are unaffected.",
        exchangeRate: null,
        quoteDescription: null,
        disclaimer: "USD equivalents are informational; native amounts are authoritative.",
      };
}

const WORKING_ONLY: Schemas["DashboardFilterNote"] = { filter: "employmentStatus", reason: "This section includes currently working employees only." };

export function summary({ usd = true, access = ADMIN_ACCESS, notApplied = false } = {}): Schemas["DashboardSummaryResponse"] {
  const usdBlock = usdComparison(usd);
  return {
    asOf: "2026-11-16",
    generatedAt: "2026-11-16T10:00:00.000Z",
    access,
    filters,
    figures: {
      headcount: { currentlyWorking: 8500, soonToJoin: 500, left: 1000, notApplied: [] },
      currentSpending: {
        population: "CURRENTLY_WORKING",
        byCurrency: [
          {
            currency: "USD",
            employeeCount: 2564,
            annualBaseSalary: "314438700.00",
            annualCashCompensation: "327543912.77",
            usdEquivalent: usd ? { annualBaseSalary: "314438700.00", annualCashCompensation: "327543912.77" } : null,
          },
          {
            currency: "INR",
            employeeCount: 5936,
            annualBaseSalary: "1299073580000.00",
            annualCashCompensation: "1414103315722.00",
            usdEquivalent: usd ? { annualBaseSalary: "13833176445.55", annualCashCompensation: "15058069379.43" } : null,
          },
        ],
        notApplied: notApplied ? [WORKING_ONLY] : [],
      },
      upcomingCommitment: {
        definition: "Selected initial annual cash compensation of soon-to-join employees, plus the signed annual cash change of each approved later future adjustment.",
        byCurrency: [
          {
            currency: "INR",
            soonToJoinCount: 353,
            soonToJoinAnnualCashCompensation: "882340300.19",
            approvedFutureChangeCount: 1,
            approvedFutureChangeAnnualCashImpact: "-12000.50",
            totalAnnualCashCommitment: "882328299.69",
          },
        ],
        upcomingChanges: {
          total: 1,
          items: [
            {
              employee: { employeeCode: "ACME00012", name: "Aarav Banerjee", department: "Support", country: "IN", employmentStatus: "CURRENTLY_WORKING" },
              currency: "INR",
              previous: { annualBaseSalary: "1000000.00", annualBonus: "50000.00", annualCashCompensation: "1050000.00" },
              scheduled: { annualBaseSalary: "988000.00", annualBonus: "50000.00", annualCashCompensation: "1037999.50" },
              effectiveFrom: "2027-01-01",
              changeReason: "CORRECTION",
              approvedBy: { displayName: "Meera Iyer" },
              requestId: "3f2b9c1e-8a4d-4c6b-9e2f-1a2b3c4d5e6f",
            },
          ],
        },
        notApplied: [],
      },
      requests: { pending: 3, stale: 1, notApplied: [] },
      recentChanges: { periodDays: 30, count: 2, notApplied: [] },
      withoutRecentAdjustment: {
        months: 12,
        definition: "No recorded salary adjustment since import or during the selected period.",
        count: 8498,
        notApplied: notApplied ? [WORKING_ONLY] : [],
      },
      usdComparison: { ...usdBlock, currentSpending: usd ? { annualBaseSalary: "14147615145.55", annualCashCompensation: "15385613292.20" } : null },
    },
  };
}

export function noAccessSummary(): Schemas["DashboardSummaryResponse"] {
  return { asOf: "2026-11-16", generatedAt: "2026-11-16T10:00:00.000Z", access: NO_ACCESS, filters, figures: null };
}

function group(overrides: Partial<Schemas["DashboardBreakdownGroup"]>): Schemas["DashboardBreakdownGroup"] {
  return {
    group: "Tech",
    label: "Tech",
    currency: "INR",
    basis: "CURRENT_SPENDING",
    employeeCount: 2401,
    annualBaseSalary: "525377710000.00",
    annualCashCompensation: "571694636273.00",
    averageAnnualCashCompensation: "2381068.87",
    medianAnnualCashCompensation: "1913418.00",
    minimumAnnualCashCompensation: "509874.36",
    maximumAnnualCashCompensation: "7993800.00",
    usdEquivalent: { annualBaseSalary: "5594480.00", annualCashCompensation: "6087686.04" },
    ...overrides,
  };
}

export function departmentBreakdown({ usd = true } = {}): Schemas["DashboardBreakdownResponse"] {
  return {
    asOf: "2026-11-16",
    generatedAt: "2026-11-16T10:00:00.000Z",
    access: ADMIN_ACCESS,
    filters,
    breakdown: "DEPARTMENT",
    population: "CURRENTLY_WORKING",
    groups: [
      group({ usdEquivalent: usd ? group({}).usdEquivalent : null }),
      group({
        group: "Support",
        label: "Support",
        employeeCount: 1500,
        annualBaseSalary: "325498520000.00",
        annualCashCompensation: "354558986.32",
        usdEquivalent: null,
      }),
      group({
        group: "Tech",
        label: "Tech",
        currency: "USD",
        employeeCount: 983,
        annualBaseSalary: "122569900.00",
        annualCashCompensation: "127581374.36",
        averageAnnualCashCompensation: "129787.77",
        medianAnnualCashCompensation: "121681.74",
        minimumAnnualCashCompensation: "55000.00",
        maximumAnnualCashCompensation: "259000.00",
        usdEquivalent: usd ? { annualBaseSalary: "122569900.00", annualCashCompensation: "127581374.36" } : null,
      }),
    ],
    notApplied: [],
    usdComparison: usdComparison(usd),
  };
}

export function statusBreakdown(): Schemas["DashboardBreakdownResponse"] {
  return {
    ...departmentBreakdown(),
    breakdown: "EMPLOYMENT_STATUS",
    population: "ALL_STATUSES",
    groups: [
      group({ group: "CURRENTLY_WORKING", label: "Currently working", employeeCount: 5936 }),
      group({ group: "SOON_TO_JOIN", label: "Soon to join", basis: "FUTURE_COMMITMENT", employeeCount: 353 }),
      group({
        group: "LEFT",
        label: "Left",
        basis: "COUNT_ONLY",
        employeeCount: 711,
        annualBaseSalary: null,
        annualCashCompensation: null,
        averageAnnualCashCompensation: null,
        medianAnnualCashCompensation: null,
        minimumAnnualCashCompensation: null,
        maximumAnnualCashCompensation: null,
        usdEquivalent: null,
      }),
    ],
  };
}

export function recentChanges({ empty = false } = {}): Schemas["DashboardRecentChangesResponse"] {
  return {
    asOf: "2026-11-16",
    generatedAt: "2026-11-16T10:00:00.000Z",
    access: ADMIN_ACCESS,
    filters,
    periodDays: 30,
    emptyMessage: "No compensation changes were recorded in this period.",
    changes: empty
      ? []
      : [
          {
            employee: { employeeCode: "ACME00002", name: "Varun Saxena", department: "Tech", country: "IN" },
            currency: "INR",
            previous: { annualBaseSalary: "4143100.00", annualBonus: "885794.78", annualCashCompensation: "5028894.78" },
            new: { annualBaseSalary: "4350255.00", annualBonus: "885794.78", annualCashCompensation: "5236049.78" },
            changeReason: "PERFORMANCE",
            recordedAt: "2026-11-16T09:12:00.000Z",
            effectiveFrom: "2027-01-01",
            effectiveInFuture: true,
            changedBy: { displayName: "Meera Iyer" },
            requestId: null,
          },
        ],
    page: { number: 1, size: 10, totalRows: empty ? 0 : 1, totalPages: empty ? 0 : 1 },
    notApplied: [],
  };
}

export function withoutAdjustment({ page = 1, totalRows = 23 } = {}): Schemas["DashboardWithoutAdjustmentResponse"] {
  return {
    asOf: "2026-11-16",
    generatedAt: "2026-11-16T10:00:00.000Z",
    access: ADMIN_ACCESS,
    filters,
    months: 12,
    definition: "No recorded salary adjustment since import or during the selected period.",
    employees: [
      {
        employee: { employeeCode: "ACME00001", name: "Sneha Singh", department: "HR", country: "IN", level: "SENIOR" },
        currency: "INR",
        annualBaseSalary: "3200000.00",
        annualCashCompensation: "3557885.85",
        lastRecordedAdjustmentAt: null,
      },
    ],
    page: { number: page, size: 10, totalRows, totalPages: Math.ceil(totalRows / 10) },
    notApplied: [],
  };
}
