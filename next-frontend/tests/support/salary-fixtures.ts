// Contract-shaped salary responses for tests. tests/unit/salary.test.ts asserts that each one
// passes the validator compiled from the generated contract, so they cannot drift.

import type { components } from "@/generated/api";

export const COMMAND = {
  target: "BASE_SALARY",
  method: "PERCENTAGE_INCREASE",
  value: "10",
  effectiveFrom: "2026-11-16",
  reason: "PERFORMANCE",
  note: null,
} as const;

const employee = {
  employeeCode: "ACME02345",
  name: "Aarav Banerjee",
  email: "aarav.banerjee.acme02345@acme.com",
  department: "Support",
  jobTitle: "Support Associate",
  level: "JUNIOR",
  country: "IN",
  employmentStatus: "CURRENTLY_WORKING",
} as const;

export function preview(overrides: Record<string, unknown> = {}) {
  return {
    employee,
    adjustment: { ...COMMAND },
    currency: "INR",
    current: {
      compensationVersion: 1,
      state: "CURRENT",
      effectiveFrom: "2025-11-24",
      annualBaseSalary: "1052700.00",
      annualBonus: "84952.89",
      annualCashCompensation: "1137652.89",
    },
    proposed: { annualBaseSalary: "1157970.00", annualBonus: "84952.89", annualCashCompensation: "1242922.89" },
    change: { amount: "105270.00", direction: "INCREASE", percentage: "10.00", annualCashImpact: "105270.00" },
    salaryBand: {
      currency: "INR",
      minAnnualBaseSalary: "500000.00",
      maxAnnualBaseSalary: "1200000.00",
      maxAnnualBonus: "200000.00",
      minPercentageIncrease: 1,
      maxPercentageIncrease: 200,
      minPercentageDecrease: 1,
      maxPercentageDecrease: 50,
    },
    validation: { valid: true },
    warnings: { futureChange: null, pendingRequestWillBecomeStale: false },
    expectedCompensationVersion: 1,
    confirmationMode: "DIRECT_APPLY",
    previewToken: "eyJhbGciOiJIUzI1NiJ9.preview-token.sig",
    previewExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

export function compensationRecord(version = 2) {
  return {
    version,
    annualBaseSalary: "1157970.00",
    annualBonus: "84952.89",
    annualCashCompensation: "1242922.89",
    currency: "INR",
    payFrequency: "MONTHLY",
    effectiveFrom: "2026-11-16",
    changeReason: "PERFORMANCE",
    changeNote: null,
    changedBy: { displayName: "Meera Iyer", email: "meera.iyer@acme.com" },
    sourceRequestId: null,
    recordedAt: "2026-11-16T13:30:00.000Z",
  };
}

export const REQUEST_ID = "3f2b9c1e-8a4d-4c6b-9e2f-1a2b3c4d5e6f";

export function requestView(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    status: "PENDING",
    employee,
    requestedBy: { displayName: "Rohan Mehta", email: "rohan.mehta@acme.com" },
    adjustment: {
      target: "BASE_SALARY",
      method: "PERCENTAGE_INCREASE",
      value: "10",
      currency: "INR",
      previousValue: "1052700.00",
      proposedValue: "1157970.00",
      effectiveFrom: "2026-11-16",
      reason: "PERFORMANCE",
      note: null,
    },
    requestedAgainstVersion: 1,
    createdAt: "2026-11-16T13:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    resultingCompensationVersion: null,
    ...overrides,
  };
}

/** The employee detail's selected compensation (typed against the generated contract). */
export function selectedCompensation(
  overrides: Partial<components["schemas"]["SelectedCompensation"]> = {},
): components["schemas"]["SelectedCompensation"] {
  return {
    state: "CURRENT",
    version: 2,
    annualBaseSalary: "1157970.00",
    annualBonus: "84952.89",
    annualCashCompensation: "1242922.89",
    currency: "INR",
    payFrequency: "MONTHLY",
    effectiveFrom: "2026-11-16",
    usdEquivalent: null,
    ...overrides,
  };
}
