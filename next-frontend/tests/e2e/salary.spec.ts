import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Salary adjustment journeys against the real Express backend (Task 09) and the deterministic
// seed. The tests change compensation, so each project uses its own employees (India, Tech or
// Support, currently working, with room inside the salary band for a 5% change), and the suite
// expects a freshly seeded database.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const EMPLOYEES = {
  desktop: { direct: "ACME00002", request: "ACME00003", cancel: "ACME00006", stale: "ACME00007", staleRequest: "ACME00008", keyboard: "ACME00009" },
  mobile: { direct: "ACME00021", request: "ACME00028", cancel: "ACME00039", stale: "ACME00043", staleRequest: "ACME00044", keyboard: "ACME00045" },
} as const;
const LEFT_EMPLOYEE = "ACME00027";
const OUT_OF_SCOPE = "ACME00010"; // United States, Tech
// A request detail URL whose only query value, if any, is the `from` return path: no completion
// flags are added on landing.
const REQUEST_URL = /\/salary-requests\/[0-9a-f-]{36}(\?from=[^&]*)?$/;
// Copy that would claim the current browser performed the action.
const FIRST_PERSON = /Request (submitted|approved|cancelled)|Salary change applied/;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function newSession(browser: Browser, account: "Meera Iyer" | "Rohan Mehta", viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

async function expectNoOverflowOrSeriousA11y(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Fill the form for a +5% base-salary performance change and preview it. */
async function previewFivePercent(page: Page, reason = "PERFORMANCE") {
  await page.getByRole("radio", { name: "Annual base salary" }).check();
  await page.getByRole("radio", { name: "Percentage increase" }).check();
  await page.getByLabel("Increase (%)").fill("5");
  await page.getByLabel("Reason").selectOption(reason);
  await page.getByRole("button", { name: /^Preview( again)?$/ }).first().click();
  await expect(page.getByRole("heading", { name: "Preview: nothing has changed yet" })).toBeVisible();
}

async function openAdjust(page: Page, code: string, linkName: "Adjust compensation" | "Request compensation change") {
  await page.goto(`/employees/${code}`);
  await page.getByRole("link", { name: linkName }).click();
  await page.waitForURL(`**/employees/${code}/adjust*`);
}

function historyTop(page: Page, projectName: string) {
  return projectName === "desktop"
    ? page.getByRole("table", { name: "Compensation history, newest first" }).getByRole("row").nth(1)
    : page.getByRole("list", { name: "Compensation history, newest first" }).getByRole("listitem").first();
}

test("Admin previews and applies a direct change, then sees the new version in history", async ({ page }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].direct;
  await signIn(page, "Meera Iyer");
  await openAdjust(page, code, "Adjust compensation");
  await expect(page.getByRole("heading", { level: 1, name: "Adjust compensation" })).toBeVisible();
  await previewFivePercent(page);
  const panel = page.getByRole("region", { name: "Preview: nothing has changed yet" });
  await expect(panel).toContainText("(+5.00%)");
  await expect(panel).toContainText("Within the salary band");
  await expect(panel).toContainText("Annual bonus");
  await expect(panel).toContainText("unchanged");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`adjust-preview-${testInfo.project.name}.png`), fullPage: true });

  await panel.getByRole("button", { name: "Apply salary change" }).click();
  await page.waitForURL(`**/employees/${code}?applied=2`);
  await expect(page.getByRole("status").filter({ hasText: "Compensation version 2 is highlighted in the history: Performance" })).toBeVisible();
  await expect(historyTop(page, testInfo.project.name)).toContainText("Performance");
  await expect(historyTop(page, testInfo.project.name)).toContainText("2");
  await expectNoOverflowOrSeriousA11y(page);
});

test("Scoped HR submits a request with the keyboard; compensation does not change", async ({ page }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].request;
  await signIn(page, "Rohan Mehta");
  await page.goto(`/employees/${code}`);
  await page.getByRole("link", { name: "Request compensation change" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/employees/${code}/adjust*`);
  await expect(page.getByText("Your request will go to an Admin HR user for approval.")).toBeVisible();

  // Keyboard only: radios with arrow keys, then fields with Tab.
  await page.getByRole("radio", { name: "Annual base salary" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("radio", { name: "Percentage increase" }).focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Increase (%)").focus();
  await page.keyboard.type("5");
  // A native select opens its OS menu on ArrowDown on macOS Chromium, which Playwright cannot
  // drive with key presses, so the option is chosen directly; the select itself stays native.
  await page.getByLabel("Reason").selectOption("PERFORMANCE");
  await page.getByLabel("Note (optional)").focus();
  await page.keyboard.type("Annual review <script>alert(1)</script>");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); // Preview
  const heading = page.getByRole("heading", { name: "Preview: nothing has changed yet" });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("region", { name: "Preview: nothing has changed yet" })).toContainText("Annual review <script>alert(1)</script>");
  await page.getByRole("button", { name: "Submit for approval" }).focus();
  await page.keyboard.press("Enter");

  await page.waitForURL(REQUEST_URL);
  await expect(page.getByRole("status").filter({ hasText: "Pending approval since" })).toContainText("Compensation has not changed.");
  await expect(page.getByText("Pending approval").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`request-submitted-${testInfo.project.name}.png`), fullPage: true });

  await page.goto(`/employees/${code}`);
  await expect(page.getByText(/waiting for approval/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Request compensation change" })).toHaveCount(0);
  await expect(historyTop(page, testInfo.project.name)).toContainText("Initial import");
});

test("Admin approves the request from the queue; Rohan then sees Approved and the new compensation", async ({ page, browser }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].request;
  await signIn(page, "Meera Iyer");
  // Wait for the streamed shell to finish rendering before using the disclosure menu.
  await page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true }).waitFor();
  await page.waitForLoadState("networkidle");
  const menu = page.locator("summary", { hasText: "Menu" }).filter({ visible: true });
  if ((await menu.count()) > 0) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Salary requests" }).click();
  await page.waitForURL("**/salary-requests?status=PENDING&direction=asc");
  await page.locator("table tbody tr, ul[aria-label='Salary requests'] li").filter({ visible: true }).first().waitFor();
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`queue-${testInfo.project.name}.png`), fullPage: true });
  await page.getByLabel("Search by employee name, employee ID, or exact email").fill(code);
  await page.getByLabel("Search by employee name, employee ID, or exact email").press("Enter");
  await page.waitForURL(`**/salary-requests?q=${code}*`);
  await page.locator("table tbody th a, ul[aria-label='Salary requests'] li a").filter({ visible: true }).first().click();
  await page.waitForURL(REQUEST_URL);
  await expect(page.getByText("Rohan Mehta").first()).toBeVisible();

  // Before deciding, the Admin sees the employee's full current compensation from the backend,
  // above the decision controls.
  const current = page.getByRole("region", { name: "Current compensation" });
  await expect(current).toBeVisible();
  const currentValue = (label: string) => current.getByText(label, { exact: true }).locator("xpath=following-sibling::dd");
  // Money is "INR" + a non-breaking space + the amount.
  await expect(currentValue("Annual base salary")).toHaveText(/^INR\s[0-9,]+\.[0-9]{2}$/);
  await expect(currentValue("Annual bonus")).toHaveText(/^INR\s[0-9,]+\.[0-9]{2}$/);
  await expect(currentValue("Annual cash compensation")).toHaveText(/^INR\s[0-9,]+\.[0-9]{2}$/);
  await expect(currentValue("Compensation version")).toHaveText(/^1, effective /);
  await expect(current).toContainText("Current");
  await expect(current).toContainText("Amounts are in INR");
  // The request was made against version 1, so its "Before" is the current base salary.
  const before = page.getByRole("region", { name: "Requested change" }).getByText("Before", { exact: true }).locator("xpath=following-sibling::dd");
  await expect(before).toHaveText((await currentValue("Annual base salary").textContent())!);
  const approveButton = page.getByRole("button", { name: "Approve request" });
  const currentFirst = await current.evaluate(
    (section, button) => Boolean(section.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING),
    await approveButton.elementHandle(),
  );
  expect(currentFirst).toBe(true);

  await approveButton.click();
  await expect(page.getByText(/Approve this exact change\?/)).toBeFocused();
  await expect(current).toBeVisible();
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`approve-confirm-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Confirm approval" }).click();
  // The page is re-read from the backend in place; no completion flag is added to the URL.
  await expect(page.getByRole("status").filter({ hasText: /^Approved by Meera Iyer on .+\. Compensation version 2 was created\./ })).toBeVisible();
  expect(page.url()).toMatch(REQUEST_URL);
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
  await expect(currentValue("Compensation version")).toHaveText(/^2, effective /);
  await page.screenshot({ path: testInfo.outputPath(`approved-${testInfo.project.name}.png`), fullPage: true });

  const rohan = await newSession(browser, "Rohan Mehta", page.viewportSize()!);
  await rohan.page.goto(`/salary-requests?q=${code}`);
  await expect(rohan.page.getByText("Approved").filter({ visible: true }).first()).toBeVisible();
  await rohan.page.goto(`/employees/${code}`);
  await expect(historyTop(rohan.page, testInfo.project.name)).toContainText("Performance");
  await rohan.context.close();
});

test("Admin cancels a request with a required note; compensation is unchanged", async ({ page, browser }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].cancel;
  const rohan = await newSession(browser, "Rohan Mehta", page.viewportSize()!);
  await openAdjust(rohan.page, code, "Request compensation change");
  await previewFivePercent(rohan.page);
  await rohan.page.getByRole("button", { name: "Submit for approval" }).click();
  await rohan.page.waitForURL(REQUEST_URL);
  const requestUrl = new URL(rohan.page.url()).pathname;

  await signIn(page, "Meera Iyer");
  await page.goto(requestUrl);
  await expect(page.getByRole("region", { name: "Current compensation" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByLabel("Reason for cancelling")).toBeFocused();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByLabel("Reason for cancelling")).toHaveAccessibleDescription(/Enter a reason for cancelling/);
  await page.getByLabel("Reason for cancelling").fill("Budget review postponed to next quarter.");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Cancelled by Meera Iyer on .+\. Compensation did not change\.$/ })).toBeVisible();
  expect(page.url()).toMatch(REQUEST_URL);
  await expect(page.getByText("Budget review postponed to next quarter.")).toBeVisible();
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`cancelled-${testInfo.project.name}.png`), fullPage: true });

  await rohan.page.goto(requestUrl);
  await expect(rohan.page.getByText("Cancelled").first()).toBeVisible();
  await rohan.page.goto(`/employees/${code}`);
  await expect(historyTop(rohan.page, testInfo.project.name)).toContainText("Initial import");
  await rohan.context.close();
});

test("a stale conflict shows a fresh preview and does not confirm until clicked again", async ({ page, browser }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].stale;
  await signIn(page, "Meera Iyer");
  await openAdjust(page, code, "Adjust compensation");
  await previewFivePercent(page);

  // A second Admin session changes the same employee first.
  const other = await newSession(browser, "Meera Iyer", page.viewportSize()!);
  await openAdjust(other.page, code, "Adjust compensation");
  await previewFivePercent(other.page, "MARKET_ADJUSTMENT");
  await other.page.getByRole("button", { name: "Apply salary change" }).click();
  await other.page.waitForURL(`**/employees/${code}?applied=2`);
  await other.context.close();

  await page.getByRole("button", { name: "Apply salary change" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Compensation changed while you were reviewing" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("compensation version 2");
  await expect(alert.locator("s")).toBeVisible();
  await expect(page.getByRole("region", { name: "Current compensation" })).toContainText("version 2");
  await expect(alert).toBeFocused();
  expect(page.url()).toContain("/adjust");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`stale-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("button", { name: "Apply salary change" }).click();
  await page.waitForURL(`**/employees/${code}?applied=3`);
  await expect(page.getByText(/Compensation version 3 is highlighted in the history: Performance/)).toBeVisible();
});

test("a direct change makes a pending request out of date, and it cannot be approved", async ({ page, browser }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].staleRequest;
  const rohan = await newSession(browser, "Rohan Mehta", page.viewportSize()!);
  await openAdjust(rohan.page, code, "Request compensation change");
  await previewFivePercent(rohan.page);
  await rohan.page.getByRole("button", { name: "Submit for approval" }).click();
  await rohan.page.waitForURL(REQUEST_URL);
  const requestUrl = new URL(rohan.page.url()).pathname;

  await signIn(page, "Meera Iyer");
  await openAdjust(page, code, "Adjust compensation");
  await expect(page.getByText(/A direct change will make it out of date/)).toBeVisible();
  await previewFivePercent(page, "PROMOTION");
  await expect(page.getByText(/Applying this change will make that request out of date/)).toBeVisible();
  await page.getByRole("button", { name: "Apply salary change" }).click();
  await page.waitForURL(`**/employees/${code}?applied=2`);

  await page.goto(requestUrl);
  await expect(page.getByText("Out of date").first()).toBeVisible();
  await expect(page.getByText(/It can no longer be approved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
  // The current record (version 2 from the direct change) sits beside the stale request.
  await expect(page.getByRole("region", { name: "Current compensation" })).toContainText("2, effective");
  await expectNoOverflowOrSeriousA11y(page);
  await page.screenshot({ path: testInfo.outputPath(`request-out-of-date-${testInfo.project.name}.png`), fullPage: true });
  await rohan.page.goto(requestUrl);
  await expect(rohan.page.getByText("Out of date").first()).toBeVisible();
  await rohan.context.close();
});

test("ineligible and out-of-scope employees cannot be adjusted", async ({ page }) => {
  await signIn(page, "Meera Iyer");
  await page.goto(`/employees/${LEFT_EMPLOYEE}`);
  await expect(page.getByText("This employee is not eligible for a compensation adjustment.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Adjust compensation" })).toHaveCount(0);
  await page.goto(`/employees/${LEFT_EMPLOYEE}/adjust`);
  await expect(page.getByText("This employee is not eligible for a compensation adjustment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toHaveCount(0);

  await page.goto("/sign-in");
  await signIn(page, "Rohan Mehta");
  await page.goto(`/employees/${OUT_OF_SCOPE}/adjust`);
  await expect(page.getByRole("heading", { level: 1, name: "Employee not found" })).toBeVisible();
  await page.goto("/employees/ACME99999/adjust");
  await expect(page.getByRole("heading", { level: 1, name: "Employee not found" })).toBeVisible();
  await page.goto("/salary-requests?department=Tech");
  await expect(page.getByText("Some filters in this link are not valid")).toBeVisible();
});

test("the JWT and idempotency details never appear in page HTML", async ({ page, context }, testInfo) => {
  const code = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"].keyboard;
  await signIn(page, "Rohan Mehta");
  const token = (await context.cookies()).find((cookie) => cookie.name === "__Host-acme_session")!.value;
  await openAdjust(page, code, "Request compensation change");
  await previewFivePercent(page);
  expect(await page.content()).not.toContain(token);
  await page.goto("/salary-requests");
  expect(await page.content()).not.toContain(token);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ local: 0, session: 0 });
});

test("crafted applied, submitted, and decided values never produce a completion claim", async ({ page, browser }, testInfo) => {
  const employees = EMPLOYEES[testInfo.project.name as "desktop" | "mobile"];
  const mainText = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");

  // A pending request, created in another session so this browser performed nothing.
  const rohan = await newSession(browser, "Rohan Mehta", page.viewportSize()!);
  await openAdjust(rohan.page, employees.keyboard, "Request compensation change");
  await previewFivePercent(rohan.page);
  await rohan.page.getByRole("button", { name: "Submit for approval" }).click();
  await rohan.page.waitForURL(REQUEST_URL);
  const pendingUrl = new URL(rohan.page.url()).pathname;
  await rohan.context.close();

  await signIn(page, "Meera Iyer");
  const requestUrlFor = async (code: string) => {
    await page.goto(`/salary-requests?q=${code}`);
    await page.locator("table tbody th a, ul[aria-label='Salary requests'] li a").filter({ visible: true }).first().click();
    await page.waitForURL(REQUEST_URL);
    return new URL(page.url()).pathname;
  };
  const approvedUrl = await requestUrlFor(employees.request);
  const cancelledUrl = await requestUrlFor(employees.cancel);

  // Pending request: the flags are ignored; the record says it is still pending.
  await page.goto(`${pendingUrl}?submitted=1&decided=approved`);
  await expect(page.getByRole("status").filter({ hasText: "Pending approval since" })).toContainText("Compensation has not changed.");
  await expect(page.getByRole("button", { name: "Approve request" })).toBeVisible();
  expect(await mainText()).not.toMatch(FIRST_PERSON);
  expect(await mainText()).not.toMatch(/Approved by|Cancelled by/);

  // Approved request opened with a contradicting flag: the persisted outcome wins.
  await page.goto(`${approvedUrl}?decided=cancelled&submitted=1`);
  await expect(page.getByRole("status").filter({ hasText: /^Approved by Meera Iyer on / })).toBeVisible();
  expect(await mainText()).not.toMatch(FIRST_PERSON);
  expect(await mainText()).not.toMatch(/Cancelled by|Pending approval since/);

  // Cancelled request opened with decided=approved.
  await page.goto(`${cancelledUrl}?decided=approved`);
  await expect(page.getByRole("status").filter({ hasText: /^Cancelled by Meera Iyer on / })).toBeVisible();
  expect(await mainText()).not.toMatch(FIRST_PERSON);
  expect(await mainText()).not.toMatch(/Approved by/);

  // Employee detail: `applied` only highlights an existing history row, in neutral words.
  await page.goto(`/employees/${employees.direct}?applied=2`);
  await expect(page.getByRole("status").filter({ hasText: "Compensation version 2 is highlighted in the history: Performance" })).toBeVisible();
  expect(await mainText()).not.toMatch(FIRST_PERSON);
  await page.goto(`/employees/${employees.direct}?applied=1`);
  await expect(page.getByRole("status").filter({ hasText: "Compensation version 1 is highlighted in the history: Initial import" })).toBeVisible();
  expect(await mainText()).not.toMatch(FIRST_PERSON);
  for (const crafted of ["99", "0", "-1", "abc", "%3Cscript%3E"]) {
    await page.goto(`/employees/${employees.direct}?applied=${crafted}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/is highlighted in the history/)).toHaveCount(0);
    expect(await mainText()).not.toMatch(FIRST_PERSON);
  }
  await expectNoOverflowOrSeriousA11y(page);
});
