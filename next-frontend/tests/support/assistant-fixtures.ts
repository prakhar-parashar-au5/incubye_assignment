// Contract-shaped assistant responses for tests. tests/unit/assistant.test.ts asserts that each
// fixture passes the validator compiled from the generated contract, so these cannot drift into
// an invented shape.

export const RATE = {
  baseCurrency: "USD",
  quoteCurrency: "INR",
  rate: "93.9100",
  sourceName: "Board of Governors of the Federal Reserve System, H.10 Foreign Exchange Rates",
  sourceUrl: "https://www.federalreserve.gov/releases/h10/20261109/",
  effectiveDate: "2026-11-06",
  retrievedAt: "2026-11-14T18:47:36Z",
} as const;

const money = (amount: string, currency: "INR" | "USD") => ({ amount, currency });

export function employee(code: string, name: string, country: "IN" | "US", department: "Tech" | "HR" | "Support") {
  const currency = country === "IN" ? "INR" : "USD";
  return {
    employeeCode: code,
    name,
    department,
    jobTitle: "Senior Software Engineer",
    level: "SENIOR" as const,
    country,
    employmentStatus: "CURRENTLY_WORKING" as const,
    compensation: {
      state: "CURRENT" as const,
      effectiveFrom: "2026-04-01",
      annualBaseSalary: money(currency === "INR" ? "2500000.00" : "150000.00", currency),
      annualBonus: money(currency === "INR" ? "250000.00" : "15000.00", currency),
      annualCashCompensation: money(currency === "INR" ? "2750000.00" : "165000.00", currency),
      usdEquivalent: { annualBaseSalary: currency === "INR" ? "26621.23" : "150000.00", annualCashCompensation: currency === "INR" ? "29283.35" : "165000.00" },
    },
  };
}

export function reply(overrides: Record<string, unknown> = {}) {
  return {
    answer: "Sneha Singh has the highest annual cash compensation among the employees I can see.",
    toolCalls: [{ name: "get_top_compensated_employees", status: "completed" }],
    cards: [
      {
        type: "employee_list",
        title: "Top annual cash compensation (USD comparison)",
        employees: [employee("ACME00042", "Sneha Singh", "IN", "Tech"), employee("ACME00010", "Marcus Thompson", "US", "Tech")],
        exchangeRate: RATE,
      },
      {
        type: "compensation_summary",
        title: "Annual base salary by department",
        groupBy: "DEPARTMENT",
        metric: "ANNUAL_BASE",
        population: "CURRENTLY_WORKING",
        groups: [
          {
            group: "Tech",
            currency: "INR",
            employeeCount: 1200,
            total: money("3000000000.00", "INR"),
            average: money("2500000.00", "INR"),
            minimum: money("500000.00", "INR"),
            maximum: money("6000000.00", "INR"),
            usdEquivalent: { total: "31945479.71", average: "26621.23" },
          },
          {
            group: "HR",
            currency: "INR",
            employeeCount: 300,
            total: money("450000000.00", "INR"),
            average: money("1500000.00", "INR"),
            minimum: money("400000.00", "INR"),
            maximum: money("3000000.00", "INR"),
            usdEquivalent: null,
          },
        ],
        exchangeRate: RATE,
      },
      {
        type: "recent_changes",
        title: "Compensation changes recorded in the last 90 days",
        days: 90,
        totalMatching: 2,
        changes: [
          {
            employeeCode: "ACME00042",
            name: "Sneha Singh",
            department: "Tech",
            country: "IN",
            version: 2,
            effectiveFrom: "2027-01-01",
            recordedAt: "2026-11-15T09:12:00.000Z",
            changeReason: "PERFORMANCE",
            annualBaseSalary: money("2750000.00", "INR"),
            annualBonus: money("250000.00", "INR"),
            previous: { annualBaseSalary: money("2500000.00", "INR"), annualBonus: money("250000.00", "INR"), effectiveFrom: "2026-04-01" },
            annualBaseSalaryChange: money("250000.00", "INR"),
          },
          {
            employeeCode: "ACME00010",
            name: "Marcus Thompson",
            department: "Tech",
            country: "US",
            version: 2,
            effectiveFrom: "2026-11-01",
            recordedAt: "2026-11-01T08:00:00.000Z",
            changeReason: "MARKET_ADJUSTMENT",
            annualBaseSalary: money("155000.00", "USD"),
            annualBonus: money("15000.00", "USD"),
            previous: { annualBaseSalary: money("150000.00", "USD"), annualBonus: money("15000.00", "USD"), effectiveFrom: "2026-04-01" },
            annualBaseSalaryChange: money("5000.00", "USD"),
          },
        ],
      },
      { type: "notice", level: "warning", message: "USD comparison uses a saved rate; it is not a payroll figure." },
    ],
    limitations: ["Only employees within your access are included."],
    generatedAt: "2026-11-15T10:30:00.000Z",
    ...overrides,
  };
}
