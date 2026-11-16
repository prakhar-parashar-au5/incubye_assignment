import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "";
const COOKIE = "__Host-acme_session";

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === COOKIE);
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

/** Selects an account with the arrow keys, types the password, and submits with Enter. */
async function signInWithKeyboard(page: Page, account: "Meera Iyer" | "Rohan Mehta", password: string) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Meera Iyer" }).focus();
  if (account === "Rohan Mehta") await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: account })).toBeChecked();
  await page.getByLabel("Password").focus();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
}

test("a signed-out visitor is sent from /employees to sign-in", async ({ page }) => {
  const response = await page.goto("/employees");
  expect(page.url()).toMatch(/\/sign-in$/);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("sign-in page shows both demo accounts and the labelled synthetic password", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("radio", { name: "Meera Iyer" })).toHaveAccessibleDescription(
    "Admin HR. Access: All employees.",
  );
  await expect(page.getByRole("radio", { name: "Rohan Mehta" })).toHaveAccessibleDescription(
    "Scoped HR. Access: India, Support and Tech.",
  );
  await expect(page.getByRole("heading", { name: "Synthetic demo credentials" })).toBeVisible();
  await expect(page.getByText(DEMO_PASSWORD, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yFindings(page);
});

test("Meera signs in and out with the keyboard; the JWT stays in an HttpOnly cookie", async ({ page, context, request }) => {
  const before = Date.now();
  await signInWithKeyboard(page, "Meera Iyer", DEMO_PASSWORD);
  await page.waitForURL("**/employees");

  // Cookie flags.
  const cookie = await sessionCookie(context);
  expect(cookie).toBeDefined();
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: true, path: "/" });
  const twoHours = 2 * 60 * 60;
  expect(cookie!.expires).toBeGreaterThan(before / 1000 + twoHours - 120);
  expect(cookie!.expires).toBeLessThan(Date.now() / 1000 + twoHours + 120);

  // Shell content.
  const identity = page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true });
  await expect(identity).toContainText("Meera Iyer");
  await expect(identity).toContainText("Admin HR");
  await expect(identity).toContainText("All employees");
  await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();
  await expect(page.getByText("Search and review compensation records")).toBeVisible();
  await expect(page.getByText("permission filtered")).toHaveCount(0);
  await expect(page.getByText("10,000", { exact: true })).toBeVisible();

  // The token is in neither the rendered HTML, the RSC payload, nor anything script can read.
  const token = cookie!.value;
  expect(await page.content()).not.toContain(token);
  const html = await (await request.get("/employees", { headers: { cookie: `${COOKIE}=${token}` } })).text();
  expect(html).toContain("Meera Iyer");
  expect(html).not.toContain(token);
  expect(await page.evaluate(() => document.cookie)).not.toContain("acme_session");

  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yFindings(page);

  // Keyboard sign-out: on mobile, open the menu first.
  const menu = page.locator("summary", { hasText: "Menu" });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/sign-in?reason=signed-out");
  await expect(page.getByText("You have signed out.")).toBeVisible();
  expect(await sessionCookie(context)).toBeUndefined();

  // The backend session was revoked, not just forgotten by the browser.
  const me = await request.get(new URL("/api/v1/auth/me", API_BASE_URL).href, { headers: { authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(401);

  // Protected page now redirects again.
  await page.goto("/employees");
  expect(page.url()).toMatch(/\/sign-in$/);
});

test("Rohan sees his scope and the permission-filtered notice", async ({ page }) => {
  await signInWithKeyboard(page, "Rohan Mehta", DEMO_PASSWORD);
  await page.waitForURL("**/employees");
  const identity = page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true });
  await expect(identity).toContainText("Rohan Mehta");
  await expect(identity).toContainText("Scoped HR");
  await expect(identity).toContainText("India, Support and Tech");
  await expect(page.getByText("Results are permission filtered to your access: India, Support and Tech.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("an incorrect password shows a public error and keeps Rohan selected", async ({ page, context }, testInfo) => {
  // One project only: each failure counts toward the backend's 5-per-15-minutes limit.
  test.skip(testInfo.project.name !== "desktop", "limits failed attempts against the shared backend");
  await signInWithKeyboard(page, "Rohan Mehta", "synthetic-wrong-password");
  const password = page.getByLabel("Password");
  await expect(password).toHaveAccessibleDescription(/not correct for this account/);
  await expect(password).toBeFocused();
  await expect(page.getByRole("radio", { name: "Rohan Mehta" })).toBeChecked();
  expect(page.url()).toMatch(/\/sign-in$/);
  expect(await sessionCookie(context)).toBeUndefined();
});

test("an invalid session cookie is cleared and the visitor is asked to sign in again", async ({ page, context }) => {
  await context.addCookies([
    { name: COOKIE, value: "not-a-valid-jwt", url: "https://localhost", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
  await page.goto("/employees");
  await page.waitForURL("**/sign-in?reason=session-expired");
  await expect(page.getByText("Your session has ended. Sign in again to continue.")).toBeVisible();
  expect(await sessionCookie(context)).toBeUndefined();
});

test.describe("backend unavailable", () => {
  test.use({ baseURL: "http://localhost:3902" });

  test("the protected page shows a retryable service error and keeps the session cookie", async ({ page, context }) => {
    await context.addCookies([
      { name: COOKIE, value: "synthetic-cookie-value", url: "https://localhost", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    await page.goto("/employees");
    await expect(page.getByText("The compensation service is not responding")).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/employees");
    expect(page.url()).toMatch(/\/employees$/);
    expect(await sessionCookie(context)).toBeDefined();
    await expectNoHorizontalOverflow(page);
  });

  test("sign-in reports the outage instead of a password error", async ({ page }) => {
    await signInWithKeyboard(page, "Meera Iyer", DEMO_PASSWORD);
    await expect(page.getByText(/compensation service did not respond/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Meera Iyer" })).toBeChecked();
  });
});

test("desktop uses the rail and mobile uses the compact header", async ({ page }, testInfo) => {
  await signInWithKeyboard(page, "Meera Iyer", DEMO_PASSWORD);
  await page.waitForURL("**/employees");
  const rail = page.locator("aside");
  const mobileMenu = page.locator("summary", { hasText: "Menu" });
  if (testInfo.project.name === "desktop") {
    await expect(rail).toBeVisible();
    await expect(mobileMenu).toBeHidden();
  } else {
    await expect(rail).toBeHidden();
    await expect(mobileMenu).toBeVisible();
  }
  // Future sections are listed but are not links or buttons.
  for (const label of ["Dashboard", "Salary Reviews", "HR Access"]) {
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath(`employees-${testInfo.project.name}.png`), fullPage: true });
});
