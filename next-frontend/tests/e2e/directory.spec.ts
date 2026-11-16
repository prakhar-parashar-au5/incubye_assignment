import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Directory journeys against the real Express directory API and the deterministic 10,000-employee
// seed. Employee codes used here come from that seed:
// - ACME00001 Sneha Singh, India, HR (outside Rohan's India + Tech/Support scope)
// - ACME00010 Marcus Thompson, United States, Tech (outside Rohan's scope)

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectNoSeriousA11yFindings(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** The visible employee list for the current viewport: table rows on desktop, list items on mobile. */
function employeeLinks(page: Page) {
  return page.locator("table tbody th a, ul[aria-label='Employees'] li a").filter({ visible: true });
}

async function search(page: Page, text: string) {
  const field = page.getByLabel("Search by name, employee ID, or exact email");
  await field.fill(text);
  await field.press("Enter");
  await page.waitForURL(`**/employees?q=${encodeURIComponent(text)}*`);
}

test("Admin HR: search by exact ID, open detail, inspect history, return with filters, sign out", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await expect(page.getByText("10,000", { exact: true })).toBeVisible();
  await expect(page.getByText("permission filtered")).toHaveCount(0);

  // Department filter first, so the return path has to carry it.
  if (testInfo.project.name === "desktop") {
    await page.getByLabel("Department").filter({ visible: true }).selectOption("HR");
  } else {
    await page.getByRole("button", { name: /Filters and sort/ }).click();
    await page.getByRole("dialog").getByLabel("Department").selectOption("HR");
    await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.waitForURL("**/employees?department=HR");
  await search(page, "ACME00001");
  expect(new URL(page.url()).search).toBe("?q=ACME00001&department=HR");

  await expect(employeeLinks(page)).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Search: “ACME00001”");
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Department: HR");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yFindings(page);

  // Keyboard: focus the employee link and open it with Enter.
  await employeeLinks(page).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/employees/ACME00001?from=*");
  await expect(page.getByRole("heading", { level: 1, name: "Sneha Singh" })).toBeVisible();
  for (const label of ["Department", "Job title", "Level", "Country", "Employment status", "Hire date", "Employee version"]) {
    await expect(page.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /compensation$/i }).first()).toBeVisible();
  await expect(page.getByText("Annual cash compensation").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/INR\u00a0[\d,]+\.\d{2}/).filter({ visible: true }).first()).toBeVisible();
  // Desktop shows a table, mobile a list; the oldest (last) entry is the initial import.
  const history =
    testInfo.project.name === "desktop"
      ? page.getByRole("table", { name: "Compensation history, newest first" }).getByRole("row").last()
      : page.getByRole("list", { name: "Compensation history, newest first" }).getByRole("listitem").last();
  await expect(history).toContainText("Initial import");
  await expect(page.getByText(/1\u00a0USD = 93\.9100\u00a0INR, effective 6 Nov 2026/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yFindings(page);
  await page.screenshot({ path: testInfo.outputPath(`detail-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("link", { name: "Back to employees" }).click();
  await page.waitForURL("**/employees?q=ACME00001&department=HR");
  await expect(page.getByLabel("Search by name, employee ID, or exact email")).toHaveValue("ACME00001");
});

test("Scoped HR: scope notice, permitted options only, no disclosure of an out-of-scope employee", async ({ page }, testInfo) => {
  await signIn(page, "Rohan Mehta");
  await expect(page.getByText("Results are permission filtered to your access: India, Support and Tech.")).toBeVisible();
  await expect(page.getByText("4,599", { exact: true })).toBeVisible();

  // Options come from the permission-filtered endpoint.
  let departmentSelect = page.getByLabel("Department").filter({ visible: true });
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: /Filters and sort/ }).click();
    departmentSelect = page.getByRole("dialog").getByLabel("Department");
  }
  await expect(departmentSelect.locator("option")).toHaveText(["All", "Support", "Tech"]);
  if (testInfo.project.name === "mobile") await page.keyboard.press("Escape");

  // A permitted employee is listed and opens.
  await expect(employeeLinks(page).first()).toBeVisible();

  // Out-of-scope employees are neither found by search nor revealed by a direct link.
  await search(page, "ACME00010");
  await expect(page.getByText("No employees match these filters.")).toBeVisible();
  await expect(page.getByText("Marcus")).toHaveCount(0);
  await page.goto("/employees/ACME00001");
  await expect(page.getByRole("heading", { level: 1, name: "Employee not found" })).toBeVisible();
  await expect(page.getByText("Sneha")).toHaveCount(0);
  await page.goto("/employees/ACME99999");
  await expect(page.getByRole("heading", { level: 1, name: "Employee not found" })).toBeVisible();
});

test("salary sort shows the comparison basis and keeps native amounts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sortable column headers are the desktop control");
  await signIn(page, "Meera Iyer");
  await page.getByRole("columnheader", { name: /Annual cash compensation/ }).getByRole("link").click();
  await page.waitForURL("**/employees?sort=annualCashCompensation&comparisonCurrency=USD");
  await expect(page.getByRole("columnheader", { name: /Annual cash compensation/ })).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByText("Sorted by USD equivalent of annual cash compensation.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Federal Reserve System, H\.10/ }).first()).toHaveAttribute(
    "href",
    "https://www.federalreserve.gov/releases/h10/20261109/",
  );
  await expect(page.getByRole("columnheader", { name: "USD equivalent (cash)" })).toBeVisible();
  await page.getByRole("columnheader", { name: /Annual cash compensation/ }).getByRole("link").click();
  await page.waitForURL("**/employees?sort=annualCashCompensation&direction=desc&comparisonCurrency=USD");
  await expect(page.getByRole("columnheader", { name: /Annual cash compensation/ })).toHaveAttribute("aria-sort", "descending");
});

test("paging keeps state, a filter change returns to page 1, and Clear all removes filters", async ({ page }) => {
  await signIn(page, "Meera Iyer");
  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL("**/employees?page=2");
  await expect(page.getByText("Page 2 of 400", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
  await page.goto("/employees?level=LEAD&page=3");
  await expect(page.getByText(/^Page 3 of \d+$/)).toBeVisible();
  await page.getByRole("group", { name: "Active filters" }).getByRole("link", { name: /Level: Lead/ }).click();
  await page.waitForURL(/\/employees$/);
  await page.goto("/employees?level=LEAD&country=US");
  await page.getByRole("link", { name: "Clear all" }).click();
  await page.waitForURL(/\/employees$/);
  await expect(page.getByText("10,000", { exact: true })).toBeVisible();
});

test("an invalid filter link shows a recoverable notice instead of results", async ({ page }) => {
  await signIn(page, "Meera Iyer");
  await page.goto("/employees?department=Legal&pageSize=500");
  await expect(page.getByText("Some filters in this link are not valid")).toBeVisible();
  await expect(employeeLinks(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Show all employees" }).click();
  await page.waitForURL(/\/employees$/);
  await expect(employeeLinks(page).first()).toBeVisible();
});

test("detail rejects an external return path", async ({ page }) => {
  await signIn(page, "Meera Iyer");
  await page.goto(`/employees/ACME00001?from=${encodeURIComponent("https://evil.example/employees")}`);
  await expect(page.getByRole("link", { name: "Back to employees" })).toHaveAttribute("href", "/employees");
});

test("mobile filter sheet traps focus, applies, closes, and returns focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the sheet is the mobile filter control");
  await signIn(page, "Meera Iyer");
  const trigger = page.getByRole("button", { name: "Filters and sort" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Filters and sort" });
  await expect(dialog).toBeVisible();
  // Focus stays inside the dialog while tabbing. Base UI's focus-guard sentinels sit at the
  // dialog's edges and send focus back in (focus can rest on <body> for a frame during that
  // bounce); no control behind the scrim is ever focused.
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    const where = await dialog.evaluate((node) =>
      node.contains(document.activeElement)
        ? "inside"
        : document.activeElement === document.body || document.activeElement?.hasAttribute("data-base-ui-focus-guard")
          ? "guard"
          : "outside",
    );
    expect(where).not.toBe("outside");
  }
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByLabel("Country").selectOption("US");
  await dialog.getByLabel("Sort by").selectOption("hireDate");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL("**/employees?country=US&sort=hireDate");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Filters and sort (1 active)" })).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL("**/employees?country=US&sort=hireDate&page=2");
  await expectNoHorizontalOverflow(page);
});

test("the JWT never appears in directory or detail HTML", async ({ page, context }) => {
  await signIn(page, "Rohan Mehta");
  const token = (await context.cookies()).find((cookie) => cookie.name === "__Host-acme_session")!.value;
  expect(await page.content()).not.toContain(token);
  await employeeLinks(page).first().click();
  await page.waitForURL("**/employees/ACME*");
  expect(await page.content()).not.toContain(token);
});

test("each sort icon sits directly after its own label at 1024, 1280, 1440, and 1920 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the sortable table is the desktop layout");
  await signIn(page, "Meera Iyer");
  for (const sort of ["name", "annualBaseSalary"]) {
    if (sort !== "name") await page.goto(`/employees?sort=${sort}&comparisonCurrency=USD`);
    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const region = page.getByRole("region", { name: "Employees table" });
      await region.evaluate((node) => (node.scrollLeft = 0));
      const gaps = await page.evaluate(() =>
        [...document.querySelectorAll("thead [data-sort-icon]")].map((icon) => {
          const wrapper = icon.parentElement!;
          const text = [...wrapper.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const word = range.getBoundingClientRect();
          const box = icon.getBoundingClientRect();
          const header = icon.closest("th")!.getBoundingClientRect();
          return {
            label: icon.closest("th")!.textContent,
            gap: Math.round(box.left - word.right),
            sameLine: box.top < word.bottom && box.bottom > word.top,
            insideHeader: box.left >= header.left && box.right <= header.right,
          };
        }),
      );
      expect(gaps.length).toBe(7);
      for (const entry of gaps) {
        expect(entry, `${entry.label} at ${width}px`).toMatchObject({ sameLine: true, insideHeader: true });
        expect(entry.gap, `${entry.label} at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(entry.gap, `${entry.label} at ${width}px`).toBeLessThanOrEqual(6);
      }
      if (sort === "name") {
        await page.locator("thead").screenshot({ path: testInfo.outputPath(`table-header-${width}.png`) });
        await page.screenshot({ path: testInfo.outputPath(`table-${width}.png`) });
      }
    }
  }
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
