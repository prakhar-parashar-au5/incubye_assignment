// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardHref } from "@/lib/dashboard-url";

import {
  departmentBreakdown,
  recentChanges,
  statusBreakdown,
  summary,
  withoutAdjustment,
} from "../support/dashboard-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const { DashboardNavigationProvider } = await import("@/app/dashboard/dashboard-navigation");
const { BreakdownTabs } = await import("@/app/dashboard/breakdown-tabs");
const { UsdDisclosure } = await import("@/app/dashboard/usd-disclosure");
const sections = await import("@/components/dashboard/dashboard-sections");

function wrap(node: ReactNode) {
  return render(<DashboardNavigationProvider>{node}</DashboardNavigationProvider>);
}

const figures = (options?: Parameters<typeof summary>[0]) => summary(options).figures!;

beforeEach(() => push.mockReset());
afterEach(cleanup);

describe("CommitmentLedger", () => {
  it("shows one row per native currency, INR first, and no combined total", () => {
    wrap(<sections.CommitmentLedger figures={figures()} query={{}} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["INR", "USD"]);
    // The caption says there is no total; no row is a total.
    expect(within(table).queryByRole("row", { name: /total/i })).toBeNull();
    // Each money value carries its own currency code, and INR and USD never share a row.
    expect(within(rows[0]).getByText("INR 12,99,07,35,80,000.00")).toBeTruthy();
    expect(within(rows[0]).queryByText(/USD/)).toBeNull();
    expect(within(rows[1]).getByText("USD 314,438,700.00")).toBeTruthy();
    expect(within(rows[1]).queryByText(/INR/)).toBeNull();
  });

  it("renders the backend's commitment figures as given, including a signed decrease", () => {
    // A deliberately inconsistent total proves the browser shows the backend value and does
    // not add the soon-to-join and future-change parts itself.
    const data = figures();
    data.upcomingCommitment.byCurrency[0] = { ...data.upcomingCommitment.byCurrency[0], totalAnnualCashCommitment: "1.00" };
    wrap(<sections.CommitmentLedger figures={data} query={{}} />);
    const inr = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(inr.textContent).toContain("INR\u00a01.00");
    expect(inr.textContent).toContain("353 soon to join: INR\u00a088,23,40,300.19");
    expect(inr.textContent).toContain("1 approved change: −minus INR\u00a012,000.50");
    expect(inr.textContent).not.toContain("88,23,28,299.69");
    expect(screen.getByText(/Selected initial annual cash compensation of soon-to-join employees/)).toBeTruthy();
  });

  it("adds USD comparison only when asked and only as secondary columns", () => {
    const { unmount } = wrap(<sections.CommitmentLedger figures={figures()} query={{}} />);
    expect(screen.queryByRole("columnheader", { name: /USD equivalent/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Show USD comparison" }).getAttribute("href")).toBe("/dashboard?usd=1");
    unmount();
    wrap(<sections.CommitmentLedger figures={figures()} query={{ usd: true }} />);
    expect(screen.getByRole("columnheader", { name: "USD equivalent, cash (comparison only)" })).toBeTruthy();
    expect(screen.getByText(/USD comparison of current spending \(sum of each currency’s USD equivalent, informational only\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hide USD comparison" }).getAttribute("href")).toBe("/dashboard");
  });

  it("keeps native totals and explains the missing rate when no exchange rate is saved", () => {
    wrap(<sections.CommitmentLedger figures={figures({ usd: false })} query={{ usd: true }} />);
    expect(screen.getAllByText("INR 12,99,07,35,80,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("USD comparison is unavailable: no saved exchange rate. Native totals are unaffected.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /USD comparison/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /About USD comparison/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /USD equivalent/ })).toBeNull();
  });

  it("explains a filter the section did not apply", () => {
    wrap(<sections.CommitmentLedger figures={figures({ notApplied: true })} query={{ status: "LEFT" }} />);
    expect(screen.getByRole("list", { name: "Filters not applied to this section" }).textContent).toBe(
      "Employment status filter not applied here. This section includes currently working employees only.",
    );
  });
});

describe("USD disclosure", () => {
  it("opens with a click or the keyboard and reads the full rate context as text", async () => {
    const user = userEvent.setup();
    wrap(
      <UsdDisclosure>
        <sections.RateContext usd={figures().usdComparison} />
      </UsdDisclosure>,
    );
    const button = screen.getByRole("button", { name: "About USD comparison" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("USD (US dollar)");
    expect(panel.textContent).toContain("1\u00a0USD = 93.9100\u00a0INR");
    expect(panel.textContent).toContain("INR per one US dollar");
    expect(panel.textContent).toContain("6 Nov 2026");
    expect(panel.textContent).toContain("USD equivalents are informational; native amounts are authoritative.");
    expect(within(panel).getByRole("link", { name: /Federal Reserve/ }).getAttribute("href")).toBe("https://www.federalreserve.gov/releases/h10/current/");
    button.focus();
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("BreakdownTabs", () => {
  const tabs = [
    { key: "department", label: "Department", href: "/dashboard" },
    { key: "country", label: "Country", href: "/dashboard?breakdown=country" },
    { key: "level", label: "Level", href: "/dashboard?breakdown=level" },
  ];

  it("uses tab semantics with a roving tab stop and manual activation", async () => {
    const user = userEvent.setup();
    wrap(
      <BreakdownTabs tabs={tabs} selected="department">
        <p>Panel</p>
      </BreakdownTabs>,
    );
    const [department, country, level] = screen.getAllByRole("tab");
    expect(department.getAttribute("aria-selected")).toBe("true");
    expect([department.tabIndex, country.tabIndex, level.tabIndex]).toEqual([0, -1, -1]);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(department.id);

    department.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(country);
    // Moving focus does not load anything; Enter selects.
    expect(push).not.toHaveBeenCalled();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(level);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(department);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(level);
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/dashboard?breakdown=level", { scroll: false });
    country.focus();
    await user.keyboard(" ");
    expect(push).toHaveBeenLastCalledWith("/dashboard?breakdown=country", { scroll: false });
  });
});

describe("BreakdownPanel", () => {
  it("shows the backend's exact group values in one table per currency, with links into the directory", () => {
    wrap(<sections.BreakdownPanel data={departmentBreakdown()} breakdown="department" query={{ level: "SENIOR" }} />);
    const inr = screen.getByRole("region", { name: "Department breakdown, INR" });
    const usd = screen.getByRole("region", { name: "Department breakdown, USD" });
    expect(within(inr).queryByText(/USD/)).toBeNull();
    expect(within(usd).queryByText(/INR/)).toBeNull();
    const tech = within(inr).getByRole("row", { name: /Tech/ });
    expect(tech.textContent).toContain("2,401");
    expect(tech.textContent).toContain("INR\u00a05,25,37,77,10,000.00");
    expect(tech.textContent).toContain("INR\u00a023,81,068.87");
    expect(tech.textContent).toContain("INR\u00a019,13,418.00");
    expect(tech.textContent).toContain("INR\u00a05,09,874.36");
    expect(tech.textContent).toContain("INR\u00a079,93,800.00");
    expect(within(tech).getByRole("link", { name: "Tech" }).getAttribute("href")).toBe(
      "/employees?department=Tech&currency=INR&level=SENIOR&status=CURRENTLY_WORKING",
    );
    expect(screen.getByText(/currently working employees only/)).toBeTruthy();
  });

  it("draws bars only as decoration next to the exact text value, scaled within each currency", () => {
    const { container } = wrap(<sections.BreakdownPanel data={departmentBreakdown()} breakdown="department" query={{}} />);
    const charts = screen.getAllByRole("figure");
    expect(charts.map((chart) => chart.querySelector("figcaption")?.textContent)).toEqual([
      "Annual cash compensation by department, INR",
      "Annual cash compensation by department, USD",
    ]);
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "1%", "100%"]);
    for (const bar of bars) expect(bar.closest("[aria-hidden='true']")).not.toBeNull();
    expect(within(charts[0]).getAllByText("INR 5,71,69,46,36,273.00").length).toBeGreaterThan(0);
  });

  it("explains count-only status groups and charts headcount per currency", () => {
    wrap(<sections.BreakdownPanel data={statusBreakdown()} breakdown="status" query={{}} />);
    const left = within(screen.getByRole("region", { name: "Employment status breakdown, INR" })).getByRole("row", { name: /Left/ });
    expect(left.textContent).toContain("Count only");
    expect(within(left).getAllByText("Not applicable").length).toBeGreaterThan(0);
    expect(screen.getByRole("figure").querySelector("figcaption")?.textContent).toBe("Employees by employment status, paid in INR");
    expect(screen.getByText(/employees in every employment status/)).toBeTruthy();
  });

  it("explains filters the breakdown did not apply and shows the empty state", () => {
    const data = { ...departmentBreakdown(), groups: [], notApplied: [{ filter: "employmentStatus" as const, reason: "This section includes currently working employees only." }] };
    wrap(<sections.BreakdownPanel data={data} breakdown="department" query={{ status: "LEFT" }} />);
    expect(screen.getByText("Employment status filter not applied here.")).toBeTruthy();
    expect(screen.getByText("No compensation data matches these filters.")).toBeTruthy();
  });
});

describe("activity lists", () => {
  it("labels recorded time, future effect, and a direct change; links to detail with this dashboard as the return path", () => {
    wrap(<sections.RecentChangesList data={recentChanges()} query={{ recentDays: "90" }} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row.textContent).toContain("16 Nov 2026, 09:12 UTC");
    expect(row.textContent).toContain("1 Jan 2027Upcoming");
    expect(row.textContent).toContain("Direct change");
    expect(row.textContent).toContain("Meera Iyer");
    expect(row.textContent).toContain("INR\u00a050,28,894.78");
    expect(row.textContent).toContain("INR\u00a052,36,049.78");
    expect(within(row).getByRole("link", { name: "Varun Saxena" }).getAttribute("href")).toBe(
      `/employees/ACME00002?from=${encodeURIComponent(dashboardHref({ recentDays: "90" }))}`,
    );
  });

  it("uses the approved empty message for recorded changes", () => {
    wrap(<sections.RecentChangesList data={recentChanges({ empty: true })} query={{}} />);
    expect(screen.getByText("No compensation changes were recorded in this period.")).toBeTruthy();
  });

  it("lists upcoming changes with the approver and the related request", () => {
    wrap(<sections.UpcomingChangesList upcoming={figures().upcomingCommitment.upcomingChanges} query={{}} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row.textContent).toContain("1 Jan 2027");
    expect(row.textContent).toContain("Correction");
    expect(within(row).getByRole("link", { name: "View request" }).getAttribute("href")).toBe("/salary-requests/3f2b9c1e-8a4d-4c6b-9e2f-1a2b3c4d5e6f");
  });

  it("pages the without-adjustment list and never claims there was no adjustment before import", () => {
    wrap(<sections.WithoutAdjustmentList data={withoutAdjustment({ page: 2, totalRows: 23 })} query={{ noAdjustmentPage: 2, level: "MID" }} />);
    const pages = screen.getByRole("navigation", { name: "Employees without a recorded adjustment, pages" });
    expect(pages.textContent).toContain("Page 2 of 3, 23 employees");
    expect(within(pages).getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/dashboard?level=MID");
    expect(within(pages).getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/dashboard?level=MID&noAdjustmentPage=3");
    expect(document.body.textContent).toContain("None since import");
    expect(document.body.textContent).not.toMatch(/never (been )?(adjusted|received)/i);
  });
});

describe("first viewport and page states", () => {
  it("shows scope, the UTC business date, and the headcount line with directory links", () => {
    wrap(
      <>
        <sections.ScopeLine access={summary({ access: undefined }).access} asOf="2026-11-16" />
        <sections.HeadcountLine headcount={figures().headcount} query={{ department: "Tech" }} />
      </>,
    );
    expect(screen.getByText("All employees")).toBeTruthy();
    expect(screen.getByText("16 Nov 2026")).toBeTruthy();
    expect(screen.getByText("(UTC business date)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /8,500 currently working employees/ }).getAttribute("href")).toBe("/employees?department=Tech&status=CURRENTLY_WORKING");
    expect(screen.getByRole("link", { name: /1,000 left employees/ }).getAttribute("href")).toBe("/employees?department=Tech&status=LEFT");
  });

  it("marks Scoped HR as permission filtered", () => {
    wrap(<sections.ScopeLine access={{ hasEmployeeAccess: true, message: null, scope: { kind: "SCOPED", countries: ["IN"], departments: ["Tech", "Support"] } }} asOf="2026-11-16" />);
    expect(screen.getByText(/India, Support and Tech/).textContent).toBe("India, Support and Tech (permission filtered)");
  });

  it("links every attention count to its workflow, and says which filters the request list cannot keep", () => {
    wrap(<sections.AttentionList figures={figures()} query={{ department: "Tech", country: "IN" }} isAdmin={false} />);
    expect(screen.getByRole("link", { name: /Pending salary requests\s*3/ }).getAttribute("href")).toBe("/salary-requests?status=PENDING&direction=asc");
    expect(screen.getByRole("link", { name: /Requests out of date\s*1/ }).getAttribute("href")).toBe("/salary-requests?status=STALE");
    expect(screen.getByRole("link", { name: /recorded in the last 30 days\s*2/ }).getAttribute("href")).toBe("#recent-changes");
    expect(screen.getByRole("link", { name: /Upcoming approved changes\s*1/ }).getAttribute("href")).toBe("#upcoming-changes");
    expect(screen.getByRole("link", { name: /No recorded adjustment in 12 months\s*8,498/ }).getAttribute("href")).toBe("#without-adjustment");
    expect(screen.getByText(/does not filter by department or country; it shows every request in your access/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the no-access, no-match, invalid-link, and failed-section states without figures", () => {
    const { container } = wrap(
      <>
        <sections.NoAccessState />
        <sections.NoDataState query={{ level: "MID", breakdown: "country" }} />
        <sections.InvalidLinkState />
        <sections.SectionFailure title="The breakdown" retryHref="/dashboard?level=MID" kind="SERVICE_UNAVAILABLE" />
        <sections.SectionFailure title="Recorded salary changes" retryHref="/dashboard" kind="INVALID_RESPONSE" />
      </>,
    );
    expect(screen.getByText("Your HR account has no employee access.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe("/dashboard?breakdown=country");
    expect(screen.getByRole("link", { name: "Reset filters" }).getAttribute("href")).toBe("/dashboard");
    const alerts = screen.getAllByRole("alert");
    expect(alerts[0].textContent).toContain("The breakdown could not be loaded.");
    expect(within(alerts[0]).getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/dashboard?level=MID");
    expect(alerts[1].textContent).toContain("not in the expected format");
    // None of these states shows a number that could be mistaken for a figure.
    expect(container.textContent).not.toMatch(/\d{2,}|INR|USD/);
  });
});
