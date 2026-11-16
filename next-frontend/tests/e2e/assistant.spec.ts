import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Assistant journeys against the real Express backend. The test backend runs without
// OPENAI_API_KEY, so every question gets the backend's real 503 ASSISTANT_UNAVAILABLE. Answer and
// card rendering is covered by tests/component/assistant-chat.test.tsx with contract-checked
// fixtures; no automated test calls a language model.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function openAssistant(page: Page) {
  // Wait for the streamed shell to finish rendering before using the disclosure menu.
  await page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true }).waitFor();
  await page.waitForLoadState("networkidle");
  const menu = page.locator("summary", { hasText: "Menu" }).filter({ visible: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: "Assistant" }).filter({ visible: true }).click();
  await page.waitForURL("**/assistant");
}

test("a signed-out visitor is sent from /assistant to sign-in", async ({ page }) => {
  await page.goto("/assistant");
  expect(page.url()).toMatch(/\/sign-in$/);
});

test("the assistant page labels synthetic data and shows the four suggested prompts", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openAssistant(page);
  const notice = page.getByRole("region", { name: "Synthetic data assistant" });
  await expect(notice).toContainText("synthetic demo data");
  await expect(notice).toContainText("India, Support and Tech");
  // The visible navigation (desktop rail, or the opened mobile menu) marks Assistant as current.
  const menu = page.locator("summary", { hasText: "Menu" }).filter({ visible: true });
  if (await menu.isVisible()) await menu.click();
  const current = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assistant" });
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Employees" })).not.toHaveAttribute("aria-current", "page");
  if (await menu.isVisible()) await menu.click();
  for (const label of ["Top compensation", "Recent changes", "Employee lookup", "Summary"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("a question reaches the real backend through the server; model unavailable is shown and other pages keep working", async ({ page, context }) => {
  await signIn(page, "Meera Iyer");
  await openAssistant(page);

  // Keyboard only: type in the composer and press Enter.
  const box = page.getByLabel("Ask about employees and compensation");
  await box.focus();
  await page.keyboard.type("Who has the highest annual cash compensation?");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Who has the highest annual cash compensation?", { exact: true })).toBeVisible();
  const alert = page.getByRole("alert").filter({ hasText: "The assistant is unavailable" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Try again" })).toBeEnabled();
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The assistant is unavailable" })).toBeVisible();

  // A suggested prompt is no longer offered once the conversation has started; the composer is.
  await expect(box).toBeVisible();

  // The browser never received the JWT, and nothing was stored.
  const token = (await context.cookies()).find((cookie) => cookie.name === "__Host-acme_session")!.value;
  expect(await page.content()).not.toContain(token);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: "" });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // The model being unavailable does not affect the directory.
  await page.goto("/employees");
  await expect(page.getByText("10,000", { exact: true })).toBeVisible();

  // Leaving and returning starts a new, empty conversation (memory only).
  await page.goto("/assistant");
  await expect(page.getByRole("button", { name: /Top compensation/ })).toBeVisible();
  await expect(page.getByText("Who has the highest annual cash compensation?", { exact: true })).toHaveCount(0);
});

test("leaving Assistant through app navigation and returning starts a new conversation", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openAssistant(page);
  const box = page.getByLabel("Ask about employees and compensation");
  await box.fill("Who has the highest annual base salary?");
  await box.press("Enter");
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("Who has the highest annual base salary?");
  await expect(page.getByRole("alert").filter({ hasText: "The assistant is unavailable" })).toBeVisible();
  await box.fill("an unsent draft");

  // A marker on window proves the next two navigations are client-side, not page loads.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  // On mobile, open the Menu disclosure only if it is closed (it can stay open across client
  // navigation, see the response's known limitations).
  const openMenu = async () => {
    const details = page.locator("details").filter({ has: page.locator("summary:visible") });
    if ((await details.count()) > 0 && !(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await details.locator("summary").click();
    }
  };
  await openMenu();
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Employees" }).click();
  await page.waitForURL("**/employees");
  await expect(page.getByText("4,599", { exact: true })).toBeVisible();
  await openMenu();
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Assistant" }).click();
  await page.waitForURL("**/assistant");
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

  await expect(page.getByRole("button", { name: /Top compensation/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation" })).toHaveCount(0);
  await expect(page.getByText("Who has the highest annual base salary?", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Ask about employees and compensation")).toHaveValue("");
});

test.describe("answers and cards (test-only fake assistant backend)", () => {
  test.use({ baseURL: "http://localhost:3906" });

  async function as(page: Page, user: "fake-meera" | "fake-rohan") {
    await page.context().addCookies([
      { name: "__Host-acme_session", value: user, url: "https://localhost", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    await page.goto("/assistant");
    await expect(page.getByRole("region", { name: "Synthetic data assistant" })).toBeVisible();
  }

  test("a suggested prompt renders the answer, tool activity, cards, and limitations", async ({ page }, testInfo) => {
    await as(page, "fake-meera");
    await page.getByRole("button", { name: /Top compensation/ }).click();
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer).toContainText("Sneha Singh has the highest annual cash compensation");
    await expect(answer.getByText("Ranked employees by compensation")).toBeVisible();
    const list = answer.getByRole("region", { name: "Top annual cash compensation (USD comparison)" });
    await expect(list.getByRole("link", { name: "Sneha Singh" })).toHaveAttribute("href", "/employees/ACME00042");
    await expect(list.getByRole("link", { name: "Marcus Thompson" })).toBeVisible();
    await expect(list.getByText("USD 165,000.00").first()).toBeVisible();
    await expect(answer.getByRole("region", { name: "Annual base salary by department", exact: true })).toContainText("currencies are never added together");
    await expect(answer.getByText("Only employees within your access are included.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`assistant-answer-${testInfo.project.name}.png`), fullPage: true });
  });

  test("Scoped HR never sees an out-of-scope row, even if the backend returned one", async ({ page }) => {
    await as(page, "fake-rohan");
    await page.getByRole("button", { name: /Top compensation/ }).click();
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer.getByRole("link", { name: "Sneha Singh" }).first()).toBeVisible();
    await expect(page.getByText("Marcus Thompson")).toHaveCount(0);
    // Generic notice: the number of withheld records is not disclosed.
    await expect(answer.getByText("Some results outside your access were not shown.")).toBeVisible();
    await expect(answer.getByText(/\d+ records? outside your access/)).toHaveCount(0);
  });

  test("model text with HTML is shown as text and never executed", async ({ page }) => {
    await as(page, "fake-meera");
    const box = page.getByLabel("Ask about employees and compensation");
    await box.fill("[html] show me");
    await box.press("Enter");
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer).toContainText('<script>document.title="pwned"</script> plain');
    await expect(answer.locator("img, script")).toHaveCount(0);
    expect(await page.title()).not.toBe("pwned");
  });

  test("timeout and malformed responses have their own states", async ({ page }) => {
    await as(page, "fake-meera");
    const box = page.getByLabel("Ask about employees and compensation");
    await box.fill("[slow] please");
    await box.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "The assistant is working" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "The assistant took too long to answer" })).toBeVisible({ timeout: 10_000 });
    await box.fill("[malformed] please");
    await box.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "The assistant sent a response this page cannot read" })).toBeVisible();
  });
});
