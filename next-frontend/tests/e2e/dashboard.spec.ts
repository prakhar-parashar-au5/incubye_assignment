import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

// Dashboard journeys against the real Express backend and an isolated, freshly seeded database.
// The seed has no salary activity, so the activity these journeys check is created here through
// the existing salary screens. Assertions compare before and after, because the salary suite and
// the other project also change compensation in the same database.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const API = process.env.E2E_API_BASE_URL ?? "";
const NO_RATE_URL = process.env.E2E_NO_RATE_API_BASE_URL ? "http://localhost:3904" : "";
const MYSQL_CONTAINER = process.env.E2E_MYSQL_CONTAINER ?? "";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "";
const PROXY_APP = "http://localhost:3908";
const PROXY = "http://127.0.0.1:3907";

// India, Tech or Support, with room in the salary band for +5%. Not used by salary.spec.ts.
const EMPLOYEES = {
  desktop: { recent: "ACME00046", pending: "ACME00050", future: "ACME00055", joiner: "ACME00065" },
  mobile: { recent: "ACME00066", pending: "ACME00071", future: "ACME00075", joiner: "ACME00673" },
} as const;

test.describe.configure({ mode: "serial" });

type Account = "Meera Iyer" | "Rohan Mehta";

async function signIn(page: Page, account: Account, base = "") {
  await page.goto(`${base}/sign-in`);
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function newSession(browser: Browser, account: Account, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

async function openDashboard(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function expectNoOverflowOrSeriousA11y(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const toNumber = (text: string) => Number(text.replace(/[^0-9]/g, ""));
/** Exact cents from a displayed amount such as "INR 88,23,40,300.19" or "−INR 1.00". */
const toCents = (text: string) => BigInt(text.replace(/[^0-9]/g, "")) * BigInt(/[−-]/.test(text) ? -1 : 1);

function attentionLink(page: Page, label: RegExp): Locator {
  return page.getByRole("region", { name: "Needs attention" }).getByRole("link", { name: label });
}
async function attentionCount(page: Page, label: RegExp) {
  return toNumber(await attentionLink(page, label).locator(".tabular-nums").innerText());
}
function ledger(page: Page, key: string): Locator {
  return page.locator(`[data-ledger="${key}"]`).filter({ visible: true });
}
async function headcount(page: Page, label: string) {
  return toNumber(await page.getByRole("region", { name: "People" }).getByRole("link", { name: new RegExp(`${label} employees`) }).innerText());
}
async function directoryCount(page: Page) {
  return toNumber(await page.locator("main p.tabular-nums").first().innerText());
}

function isoDateInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Admin direct change through the existing salary screen. Returns the preview's budget impact. */
async function applyChange(page: Page, code: string, options: { reason?: string; effectiveFrom?: string } = {}) {
  await page.goto(`/employees/${code}`);
  await page.getByRole("link", { name: "Adjust compensation" }).click();
  await page.waitForURL(`**/employees/${code}/adjust*`);
  await page.getByRole("radio", { name: "Annual base salary" }).check();
  await page.getByRole("radio", { name: "Percentage increase" }).check();
  await page.getByLabel("Increase (%)").fill("5");
  if (options.effectiveFrom) await page.getByLabel("Effective date").fill(options.effectiveFrom);
  await page.getByLabel("Reason").selectOption(options.reason ?? "PERFORMANCE");
  await page.getByRole("button", { name: /^Preview( again)?$/ }).first().click();
  const panel = page.getByRole("region", { name: "Preview: nothing has changed yet" });
  await expect(panel).toBeVisible();
  const impact = (await panel.getByText(/^Annual budget impact:/).innerText()).replace("Annual budget impact:", "").trim();
  await panel.getByRole("button", { name: "Apply salary change" }).click();
  await page.waitForURL(`**/employees/${code}?applied=*`);
  return impact;
}

test("Admin first viewport: scope, UTC date, headcount, separate INR and USD rows, and linked attention counts", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const scope = page.getByRole("region", { name: "Overview" });
  await expect(scope).toContainText(/Scope\s*All employees/);
  await expect(scope).toContainText(/As of\s*\d{1,2} [A-Z][a-z]{2} \d{4} \(UTC business date\)/);

  const working = await headcount(page, "currently working");
  const joining = await headcount(page, "soon to join");
  const left = await headcount(page, "left");
  expect(working + joining + left).toBe(10_000); // the synthetic seed has 10,000 employees

  // One row per native currency, INR first, no total row, every amount with its own code.
  const inrCash = await ledger(page, "INR:cash").innerText();
  const usdCash = await ledger(page, "USD:cash").innerText();
  expect(inrCash).toMatch(/^INR\s[\d,]+\.\d{2}$/);
  expect(usdCash).toMatch(/^USD\s[\d,]+\.\d{2}$/);
  if (testInfo.project.name === "desktop") {
    const rows = page.getByRole("table", { name: /native currency/ }).getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).getByRole("rowheader")).toHaveText("INR");
    await expect(rows.nth(2).getByRole("rowheader")).toHaveText("USD");
  } else {
    await expect(page.getByRole("list", { name: "Compensation by currency" }).getByRole("listitem")).toHaveCount(2);
  }
  await expect(page.locator("main")).not.toContainText(/total across currencies:/i);

  // Every attention count is a link to the workflow.
  await expect(attentionLink(page, /Pending salary requests/)).toHaveAttribute("href", "/salary-requests?status=PENDING&direction=asc");
  await expect(attentionLink(page, /Requests out of date/)).toHaveAttribute("href", "/salary-requests?status=STALE");
  await expect(attentionLink(page, /recorded in the last 30 days/)).toHaveAttribute("href", "#recent-changes");
  await expect(attentionLink(page, /No recorded adjustment in 12 months/)).toHaveAttribute("href", "#without-adjustment");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-admin-${testInfo.project.name}.png`), fullPage: true });

  // The headcount agrees with the directory, which counts through a different endpoint.
  await page.getByRole("region", { name: "People" }).getByRole("link", { name: /currently working employees/ }).click();
  await page.waitForURL("**/employees?status=CURRENTLY_WORKING");
  expect(await directoryCount(page)).toBe(working);
});

test("Scoped HR sees only their scope: options, figures, and rows reveal nothing outside it", async ({ page }, testInfo) => {
  await signIn(page, "Rohan Mehta");
  await openDashboard(page);
  await expect(page.getByRole("region", { name: "Overview" })).toContainText(/Scope\s*India, Support and Tech \(permission filtered\)/);
  const main = page.locator("main");

  if (testInfo.project.name === "desktop") {
    const filters = page.getByRole("form", { name: "Dashboard filters" });
    await expect(filters.getByLabel("Department").locator("option")).toHaveText(["All", "Support", "Tech"]);
    await expect(filters.getByLabel("Country").locator("option")).toHaveText(["All", "India"]);
    await expect(filters.getByLabel("Currency").locator("option")).toHaveText(["All", "INR"]);
  } else {
    await page.getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.getByRole("dialog", { name: "Dashboard filters" });
    await expect(sheet.getByLabel("Department").locator("option")).toHaveText(["All", "Support", "Tech"]);
    await expect(sheet.getByLabel("Country").locator("option")).toHaveText(["All", "India"]);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
  }

  // Only an INR row; no USD amount, no out-of-scope department, country, or employee.
  await expect(ledger(page, "INR:cash")).toHaveCount(1);
  await expect(ledger(page, "USD:cash")).toHaveCount(0);
  const text = await main.innerText();
  expect(text).not.toMatch(/USD\s?[\d,]+\.\d{2}/);
  expect(text).not.toMatch(/\b(Finance|Operations|United States)\b/);
  expect(text).not.toMatch(/ACME00010\b/); // an out-of-scope (US) employee
  // Department breakdown groups are only Support and Tech.
  const groups = page.getByRole("figure").first().getByRole("listitem");
  await expect(groups).toHaveText([/^Support/, /^Tech/]);
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-scoped-${testInfo.project.name}.png`), fullPage: true });

  const working = await headcount(page, "currently working");
  await page.goto("/employees?status=CURRENTLY_WORKING");
  expect(await directoryCount(page)).toBe(working);
});

test("global filters update the URL and compatible sections, are explained when not applicable, and survive reload", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const allWorking = await headcount(page, "currently working");

  if (testInfo.project.name === "desktop") {
    await page.getByRole("form", { name: "Dashboard filters" }).getByLabel("Department").selectOption("Tech");
  } else {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog", { name: "Dashboard filters" }).getByLabel("Department").selectOption("Tech");
    await page.getByRole("button", { name: "Apply" }).click();
  }
  await page.waitForURL("**/dashboard?department=Tech");
  await expect(page.getByTestId("dashboard-announcement")).toHaveText("Dashboard updated.");
  const techWorking = await headcount(page, "currently working");
  expect(techWorking).toBeLessThan(allWorking);
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Department: Tech");
  // The breakdown, the recorded-change list, and the without-adjustment list follow the filter.
  await expect(page.getByRole("figure").first().getByRole("listitem")).toHaveText([/^Tech/]);
  await page.reload();
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Department: Tech");
  expect(await headcount(page, "currently working")).toBe(techWorking);
  // The detail link carries this exact view as the return path.
  const firstEmployee = page.getByRole("region", { name: "Employees without a recorded adjustment", exact: true }).getByRole("link").filter({ visible: true }).first();
  await firstEmployee.click();
  await page.waitForURL("**/employees/ACME*?from=*");
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await page.waitForURL("**/dashboard?department=Tech");

  // A filter a section cannot apply is said, never silently ignored.
  await page.goto("/dashboard?status=LEFT");
  const ledgerSection = page.getByRole("region", { name: "Compensation by currency", exact: true });
  await expect(ledgerSection.getByRole("list", { name: "Filters not applied to this section" })).toContainText(
    "Employment status filter not applied here. This section includes currently working employees only.",
  );
  await expect(page.getByRole("region", { name: "Needs attention" }).getByRole("list", { name: "Filters not applied to this section" })).toContainText(
    "Employment status filter not applied here.",
  );
  await page.getByRole("group", { name: "Active filters" }).getByRole("link", { name: /Employment status: Left/ }).click();
  await page.waitForURL(/\/dashboard$/);
  await expectNoOverflowOrSeriousA11y(page);
});

test("breakdown tabs work by keyboard and the bars show the table's exact values", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const tabs = page.getByRole("tablist", { name: "Breakdown" });
  await expect(tabs.getByRole("tab", { name: "Department" })).toHaveAttribute("aria-selected", "true");

  // Department chart: each bar's printed value equals that group's cash in the exact table/list.
  const inrChart = page.getByRole("figure").filter({ hasText: "Annual cash compensation by department, INR" });
  const techBar = (await inrChart.getByRole("listitem").filter({ hasText: "Tech" }).innerText()).match(/INR\s[\d,]+\.\d{2}/)?.[0];
  expect(techBar).toBeTruthy();
  if (testInfo.project.name === "desktop") {
    const row = page.getByRole("region", { name: "Department breakdown, INR" }).getByRole("row", { name: /^Tech/ });
    await expect(row).toContainText(techBar!);
  } else {
    await expect(page.getByRole("list", { name: "Department breakdown" }).getByRole("listitem").filter({ hasText: "Tech" }).filter({ hasText: "INR" })).toContainText(techBar!);
  }
  await expect(inrChart.locator("[aria-hidden='true'] [data-bar]").first()).toBeAttached();

  await tabs.getByRole("tab", { name: "Department" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Country" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Employment status" })).toBeFocused();
  expect(page.url()).toMatch(/\/dashboard$/); // moving focus loads nothing
  await page.keyboard.press("Enter");
  await page.waitForURL("**/dashboard?breakdown=status");
  await expect(tabs.getByRole("tab", { name: "Employment status" })).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Employment status" });
  await expect(panel.getByRole("figure").first()).toContainText("Employees by employment status, paid in INR");
  await expect(panel).toContainText(/Left/);
  await expect(panel).toContainText("employees in every employment status");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-breakdown-status-${testInfo.project.name}.png`), fullPage: true });
});

test("USD comparison: the rate context opens by click, tap, or keyboard and the columns are opt-in", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const section = page.getByRole("region", { name: "Compensation by currency", exact: true });
  const about = section.getByRole("button", { name: "About USD comparison" });
  await expect(about).toHaveAttribute("aria-expanded", "false");
  if (testInfo.project.name === "mobile") await about.tap();
  else await about.click();
  await expect(about).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`#${await about.getAttribute("aria-controls")}`);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("1 USD = 93.9100 INR");
  await expect(panel).toContainText("INR per one US dollar");
  await expect(panel).toContainText("6 Nov 2026");
  await expect(panel).toContainText("native amounts are authoritative");
  await expect(panel.getByRole("link", { name: /Federal Reserve/ })).toHaveAttribute("href", "https://www.federalreserve.gov/releases/h10/20261109/");
  await about.focus();
  await page.keyboard.press("Enter");
  await expect(about).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(about).toHaveAttribute("aria-expanded", "true");

  await expect(page.getByText(/USD equivalent, cash/)).toHaveCount(0);
  await section.getByRole("link", { name: "Show USD comparison" }).click();
  await page.waitForURL("**/dashboard?usd=1");
  await expect(page.getByText("USD equivalent, cash (comparison only)").filter({ visible: true }).first()).toBeVisible();
  await expect(section).toContainText("informational only");
  await expectNoOverflowOrSeriousA11y(page);
});

test("missing exchange rate keeps native figures and disables only USD comparison", async ({ page }) => {
  test.skip(!NO_RATE_URL, "Needs E2E_NO_RATE_API_BASE_URL: a real backend started without its saved exchange-rate file.");
  await signIn(page, "Meera Iyer", NO_RATE_URL);
  await page.goto(`${NO_RATE_URL}/dashboard?usd=1`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(ledger(page, "INR:cash")).toHaveText(/^INR\s[\d,]+\.\d{2}$/);
  await expect(ledger(page, "USD:cash")).toHaveText(/^USD\s[\d,]+\.\d{2}$/);
  await expect(page.getByText("USD comparison is unavailable: no saved exchange rate. Native totals are unaffected.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "About USD comparison" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /USD comparison/ })).toHaveCount(0);
  await expect(page.getByText(/USD equivalent, cash/)).toHaveCount(0);
  await expectNoOverflowOrSeriousA11y(page);
});

test("a change recorded through the salary screen appears as recorded activity, with a working return path", async ({ page }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].recent;
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const before = await attentionCount(page, /recorded in the last 30 days/);
  await applyChange(page, code);
  await openDashboard(page);
  expect(await attentionCount(page, /recorded in the last 30 days/)).toBe(before + 1);

  const recent = page.getByRole("region", { name: "Recorded salary changes", exact: true });
  const entry = recent.locator("tr, li").filter({ visible: true }).filter({ hasText: code }).first();
  await expect(entry).toContainText("Performance");
  await expect(entry).toContainText("Meera Iyer");
  await expect(entry).toContainText("Direct change");
  await expect(entry).toContainText(/Recorded|UTC/);

  // The 7-day period keeps it; the period is about recording time.
  await recent.getByText("7 days").click();
  await page.waitForURL("**/dashboard?recentDays=7");
  await expect(page.getByTestId("dashboard-announcement")).toHaveText("Dashboard updated.");
  await expect(recent.locator("tr, li").filter({ visible: true }).filter({ hasText: code }).first()).toBeVisible();
  await expect(attentionLink(page, /recorded in the last 7 days/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`dashboard-recent-${testInfo.project.name}.png`), fullPage: true });
  await recent.locator("tr, li").filter({ visible: true }).filter({ hasText: code }).first().getByRole("link").first().click();
  await page.waitForURL(`**/employees/${code}?from=*`);
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await page.waitForURL("**/dashboard?recentDays=7");
});

test("a Scoped HR request increments Admin's pending count, and the count opens the approval queue", async ({ page, browser }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].pending;
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const before = await attentionCount(page, /Pending salary requests/);

  const rohan = await newSession(browser, "Rohan Mehta", page.viewportSize()!);
  const rohanBefore = await (async () => {
    await openDashboard(rohan.page);
    return attentionCount(rohan.page, /Pending salary requests/);
  })();
  await rohan.page.goto(`/employees/${code}`);
  await rohan.page.getByRole("link", { name: "Request compensation change" }).click();
  await rohan.page.getByRole("radio", { name: "Annual base salary" }).check();
  await rohan.page.getByRole("radio", { name: "Percentage increase" }).check();
  await rohan.page.getByLabel("Increase (%)").fill("5");
  await rohan.page.getByLabel("Reason").selectOption("PERFORMANCE");
  await rohan.page.getByRole("button", { name: "Preview" }).click();
  await rohan.page.getByRole("button", { name: "Submit for approval" }).click();
  await rohan.page.waitForURL(/\/salary-requests\/[0-9a-f-]{36}$/);
  await openDashboard(rohan.page);
  expect(await attentionCount(rohan.page, /Pending salary requests/)).toBe(rohanBefore + 1);
  await expect(attentionLink(rohan.page, /Pending salary requests/)).toHaveAttribute("href", "/salary-requests?status=PENDING&direction=asc");
  await rohan.context.close();

  await openDashboard(page);
  expect(await attentionCount(page, /Pending salary requests/)).toBe(before + 1);
  await attentionLink(page, /Pending salary requests/).click();
  await page.waitForURL("**/salary-requests?status=PENDING&direction=asc");
  await expect(page.locator("table tbody tr, ul[aria-label='Salary requests'] li").filter({ visible: true }).filter({ hasText: code })).toHaveCount(1);
  // Nothing on the dashboard approves or cancels.
  await openDashboard(page);
  await expect(page.getByRole("button", { name: /Approve|Cancel request/ })).toHaveCount(0);
});

test("approved future changes appear in the upcoming list and commitment, including a soon-to-join employee", async ({ page }, testInfo) => {
  const { future, joiner } = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"];
  const effective = isoDateInDays(40);
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  const beforeCount = await attentionCount(page, /Upcoming approved changes/);
  const beforeTotal = toCents(await ledger(page, "INR:upcoming").innerText());
  const beforeDetail = await ledger(page, "INR:upcoming-detail").innerText();
  const joinersBefore = toNumber(beforeDetail.split("soon to join")[0]);

  // A currently working employee's future change.
  const workingImpact = await applyChange(page, future, { effectiveFrom: effective, reason: "MARKET_ADJUSTMENT" });
  // A soon-to-join employee's later approved adjustment (Backend Task 11b correction).
  const joinerImpact = await applyChange(page, joiner, { effectiveFrom: effective, reason: "PROMOTION" });

  await openDashboard(page);
  expect(await attentionCount(page, /Upcoming approved changes/)).toBe(beforeCount + 2);
  const upcoming = page.getByRole("region", { name: "Upcoming approved changes", exact: true });
  for (const code of [future, joiner]) {
    const row = upcoming.locator("tr, li").filter({ visible: true }).filter({ hasText: code }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Meera Iyer");
  }
  await expect(upcoming.locator("tr, li").filter({ visible: true }).filter({ hasText: joiner }).first()).toContainText("Soon to join");

  // The commitment is the backend's figure. Each signed impact is counted once, and the
  // soon-to-join headcount in the commitment does not change.
  const afterTotal = toCents(await ledger(page, "INR:upcoming").innerText());
  expect(afterTotal - beforeTotal).toBe(toCents(workingImpact) + toCents(joinerImpact));
  const afterDetail = await ledger(page, "INR:upcoming-detail").innerText();
  expect(toNumber(afterDetail.split("soon to join")[0])).toBe(joinersBefore);
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-upcoming-${testInfo.project.name}.png`), fullPage: true });
});

test("without-adjustment count agrees with the list total and pages keep the view", async ({ page }, testInfo) => {
  await signIn(page, "Rohan Mehta");
  await openDashboard(page, "/dashboard?noAdjustmentMonths=6");
  const count = await attentionCount(page, /No recorded adjustment in 6 months/);
  const section = page.getByRole("region", { name: "Employees without a recorded adjustment", exact: true });
  await expect(section).toContainText(`${count.toLocaleString("en-US")} employees: No recorded salary adjustment since import or during the selected period.`);
  await expect(section).not.toContainText(/never (been )?(adjusted|received)/i);
  const pages = section.getByRole("navigation", { name: /pages/ });
  await expect(pages).toContainText(`${count.toLocaleString("en-US")} employees`);
  await pages.getByRole("link", { name: "Next" }).click();
  await page.waitForURL("**/dashboard?noAdjustmentMonths=6&noAdjustmentPage=2");
  await expect(pages).toContainText("Page 2 of");
  await expect(section.getByRole("heading", { name: "Employees without a recorded adjustment" })).toBeFocused();
  // A filter change returns the list to page 1.
  await page.goto("/dashboard?noAdjustmentMonths=6&noAdjustmentPage=2");
  await page.getByRole("combobox", { name: "No recorded adjustment in the last" }).selectOption("24");
  await page.waitForURL("**/dashboard?noAdjustmentMonths=24");
  await expect(section.getByRole("navigation", { name: /pages/ })).toContainText("Page 1 of");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-without-${testInfo.project.name}.png`), fullPage: true });
});

test("an invalid link shows the invalid-filter state and makes no dashboard call", async ({ page, request }) => {
  await signIn(page, "Meera Iyer", PROXY_APP);
  const count = async () => (await (await request.get(`${PROXY}/__test/dashboard-requests`)).json()).count as number;
  const before = await count();
  for (const path of ["/dashboard?level=CEO", "/dashboard?recentDays=14", "/dashboard?breakdown=DEPARTMENT", "/dashboard?usd=yes", "/dashboard?status=LEFT&status=SOON_TO_JOIN"]) {
    await page.goto(`${PROXY_APP}${path}`);
    await expect(page.getByText("Some filters in this link are not valid")).toBeVisible();
  }
  expect(await count()).toBe(before);
  await expect(page.locator("main")).not.toContainText(/INR|USD/);
  await expectNoOverflowOrSeriousA11y(page);
  await page.getByRole("link", { name: "Reset filters" }).click();
  await page.waitForURL(`${PROXY_APP}/dashboard`);
  expect(await count()).toBeGreaterThan(before);
});

test("one failed dashboard endpoint does not hide the healthy sections", async ({ page }, testInfo) => {
  // Port 3908 reaches the real backend through a test proxy that fails only the breakdown endpoint.
  await signIn(page, "Meera Iyer", PROXY_APP);
  await page.goto(`${PROXY_APP}/dashboard`);
  const failure = page.getByRole("alert").filter({ hasText: "The breakdown could not be loaded." });
  await expect(failure).toBeVisible();
  await expect(failure.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/dashboard");
  await expect(page.getByRole("figure")).toHaveCount(0);
  // The other three requests succeeded, and their real figures are shown.
  await expect(ledger(page, "INR:cash")).toHaveText(/^INR\s[\d,]+\.\d{2}$/);
  expect(await headcount(page, "currently working")).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Recorded salary changes", exact: true })).not.toContainText("could not be loaded");
  await expect(page.getByRole("region", { name: "Employees without a recorded adjustment", exact: true }).getByRole("navigation", { name: /pages/ })).toBeVisible();
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-partial-failure-${testInfo.project.name}.png`), fullPage: true });
});

test("an HR user with an empty scope sees only the no-access state", async ({ page, context, request }, testInfo) => {
  test.skip(!MYSQL_CONTAINER || !DATABASE_URL, "Needs E2E_MYSQL_CONTAINER and E2E_DATABASE_URL for the isolated test database.");
  // The API refuses to create a Scoped user without a scope, so the test creates a normal Scoped
  // user through the real HR-access API, then removes its scope rows in the isolated database.
  const login = async (email: string, password: string) => {
    const response = await request.post(`${API}/api/v1/auth/login`, { data: { email, password } });
    expect(response.status()).toBe(200);
    return (await response.json()).token as string;
  };
  const admin = await login("meera.iyer@acme.com", DEMO_PASSWORD);
  const command = {
    email: `empty.scope.${testInfo.project.name}.${Date.now()}@acme.com`,
    displayName: "Empty Scope Test",
    role: "SCOPED",
    countries: ["IN"],
    departments: ["HR"],
  };
  const headers = { Authorization: `Bearer ${admin}` };
  const preview = await request.post(`${API}/api/v1/hr-users/preview`, { headers, data: command });
  expect(preview.status()).toBe(200);
  const created = await request.post(`${API}/api/v1/hr-users`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { ...command, previewToken: (await preview.json()).previewToken },
  });
  expect(created.status()).toBe(201);
  const { hrUser, temporaryPassword } = await created.json();
  const id = Number(hrUser.hrUserId);
  expect(Number.isSafeInteger(id)).toBe(true);
  const db = new URL(DATABASE_URL);
  execFileSync("docker", [
    "exec",
    MYSQL_CONTAINER,
    "mysql",
    `-u${decodeURIComponent(db.username)}`,
    `-p${decodeURIComponent(db.password)}`,
    db.pathname.slice(1),
    "-e",
    `DELETE FROM hr_user_country_scopes WHERE hr_user_id = ${id}; DELETE FROM hr_user_department_scopes WHERE hr_user_id = ${id};`,
  ], { stdio: "ignore" });

  const token = await login(command.email, temporaryPassword);
  // The backend agrees: no employee access and no figures.
  const summary = await (await request.get(`${API}/api/v1/dashboard/summary`, { headers: { Authorization: `Bearer ${token}` } })).json();
  expect(summary.access.hasEmployeeAccess).toBe(false);
  expect(summary.figures).toBeNull();

  await context.addCookies([{ name: "__Host-acme_session", value: token, url: "https://localhost", httpOnly: true, secure: true, sameSite: "Lax" }]);
  await page.goto("/dashboard");
  await expect(page.getByText("Your HR account has no employee access.")).toBeVisible();
  const main = await page.locator("main").innerText();
  expect(main).not.toMatch(/\d|INR|USD|Needs attention|Department/);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-no-access-${testInfo.project.name}.png`), fullPage: true });
});

test("keyboard-only path and 200% zoom stay usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Zoom is emulated from the desktop viewport.");
  await signIn(page, "Meera Iyer");
  await openDashboard(page);
  // Skip link, then Tab to the first filter, and change it by keyboard.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  const department = page.getByRole("form", { name: "Dashboard filters" }).getByLabel("Department");
  for (let i = 0; i < 6 && !(await department.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
  await expect(department).toBeFocused();
  await department.selectOption("Support");
  await page.waitForURL("**/dashboard?department=Support");
  await expect(department).toBeFocused();
  // The USD disclosure and an attention link by keyboard.
  await page.getByRole("button", { name: "About USD comparison" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "About USD comparison" }).first()).toHaveAttribute("aria-expanded", "true");
  await attentionLink(page, /No recorded adjustment/).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#without-adjustment$/);

  // 200% zoom of a 1440 px window is a 720 px CSS viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await openDashboard(page);
  await expectNoOverflowOrSeriousA11y(page);
  await expect(ledger(page, "INR:cash")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Breakdown" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`dashboard-zoom-200.png`), fullPage: true });
});
