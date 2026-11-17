import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Saved assistant conversations against the real Express backend. The lane backend runs without
// OPENAI_API_KEY, so every turn is the backend's real, recorded MODEL_NOT_CONFIGURED failure: the
// user's message is saved and the failed turn appears in the conversation. Answer and card
// rendering, timeouts, and replays use the test-only fake backend at the end of this file. No
// automated test calls a language model.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const NOTICE =
  "Assistant conversations and tool results are recorded for 30 days for quality review. This demo uses synthetic employee data. Do not enter passwords, tokens, or real personal information.";
const CONVERSATION_URL = /\/assistant\/[0-9a-f-]{36}$/;

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function openMenuIfMobile(page: Page) {
  const details = page.locator("details").filter({ has: page.locator("summary:visible") });
  if ((await details.count()) > 0 && !(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
}

async function openAssistant(page: Page) {
  await page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true }).waitFor();
  await page.waitForLoadState("networkidle");
  await openMenuIfMobile(page);
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Assistant" }).click();
  await page.waitForURL("**/assistant");
}

// With Cache Components a route left by client navigation stays mounted but hidden (React
// <Activity>), so a hidden copy of /assistant can be in the DOM. Only the visible composer counts.
function composer(page: Page) {
  return page.getByLabel("Ask about employees and compensation").filter({ visible: true });
}

async function ask(page: Page, text: string) {
  const box = composer(page);
  await box.fill(text);
  await box.press("Enter");
}

async function noSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("a signed-out visitor is sent from /assistant and from a conversation URL to sign-in", async ({ page }) => {
  await page.goto("/assistant");
  expect(page.url()).toMatch(/\/sign-in$/);
  await page.goto("/assistant/8f931e82-4092-4e34-b66d-c27ab1f040eb");
  expect(page.url()).toMatch(/\/sign-in$/);
});

test("the recording notice is shown in full before the first message, with suggestions and the conversation list", async ({ page }, testInfo) => {
  await signIn(page, "Rohan Mehta");
  await openAssistant(page);
  const notice = page.getByRole("region", { name: "Recorded for quality review" });
  await expect(notice.getByTestId("recording-notice-text")).toHaveText(NOTICE);
  await expect(notice).toContainText("India, Support and Tech");
  // The notice comes before the composer in reading order.
  const noticeBox = await notice.boundingBox();
  const composerBox = await composer(page).boundingBox();
  expect(noticeBox!.y).toBeLessThan(composerBox!.y);
  for (const label of ["Top compensation", "Recent changes", "Employee lookup", "Summary"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Your conversations" })).toBeVisible();
  await openMenuIfMobile(page);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assistant" })).toHaveAttribute("aria-current", "page");
  await openMenuIfMobile(page);
  await noHorizontalOverflow(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`assistant-new-${testInfo.project.name}.png`), fullPage: true });
});

test("a first message is saved: the URL becomes the conversation, the not-configured turn is recorded, and Retry adds a new turn", async ({ page, context }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await openAssistant(page);
  const question = unique("Who has the highest annual cash compensation?");

  // Keyboard only.
  const box = composer(page);
  await box.focus();
  await page.keyboard.type(question);
  await page.keyboard.press("Enter");

  await page.waitForURL(CONVERSATION_URL);
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(thread.getByText(question, { exact: true })).toBeVisible();
  await expect(thread.getByText("The assistant is not configured")).toBeVisible();
  await expect(thread.getByText(/Your message was saved/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Recorded for quality review" }).getByTestId("recording-notice-text")).toHaveText(NOTICE);

  // Retry: a new turn with the same text. The first failure stays and is marked as retried.
  await thread.getByRole("button", { name: "Retry" }).click();
  await expect(thread.getByText("Retried below.")).toBeVisible();
  await expect(thread.getByText(question, { exact: true })).toHaveCount(2);
  await expect(thread.getByRole("button", { name: "Retry" })).toHaveCount(1);

  // Reload: the same saved messages in the same order, from the server.
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(question, { exact: true })).toHaveCount(2);
  await expect(page.getByRole("list", { name: "Conversation" }).getByText("Retried below.")).toBeVisible();
  expect(page.url()).toBe(url);

  // Nothing from the conversation is in the URL, the browser storage, or the page source as a token.
  expect(page.url()).not.toContain(encodeURIComponent(question.split(" ")[0]));
  const token = (await context.cookies()).find((cookie) => cookie.name === "__Host-acme_session")!.value;
  expect(await page.content()).not.toContain(token);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: "" });

  await noHorizontalOverflow(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`assistant-saved-${testInfo.project.name}.png`), fullPage: true });

  // The model being unavailable does not affect the directory.
  await page.goto("/employees");
  await expect(page.getByText("10,000", { exact: true })).toBeVisible();
});

test("continue, start a new conversation, and return to the first from the list", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openAssistant(page);
  const first = unique("First conversation question");
  await ask(page, first);
  await page.waitForURL(CONVERSATION_URL);
  const firstUrl = page.url();
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(first, { exact: true })).toBeVisible();

  const followUp = unique("A follow-up in the same conversation");
  await ask(page, followUp);
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(followUp, { exact: true })).toBeVisible();
  expect(page.url()).toBe(firstUrl);

  // Start a new conversation (on narrow screens through All conversations).
  const allLink = page.getByRole("link", { name: "All conversations" });
  if (await allLink.isVisible()) await allLink.click();
  else await page.getByRole("link", { name: "Start a new conversation" }).click();
  await page.waitForURL(/\/assistant$/);
  await expect(page.getByRole("button", { name: /Top compensation/ })).toBeVisible();
  const second = unique("Second conversation question");
  await ask(page, second);
  await page.waitForURL(CONVERSATION_URL);
  expect(page.url()).not.toBe(firstUrl);
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(first, { exact: true })).toHaveCount(0);

  // The list (most recently active first) has both; the first one opens with its two messages.
  await page.goto("/assistant");
  const list = page.getByRole("navigation", { name: "Your conversations" });
  const links = list.getByRole("link").filter({ hasText: /conversation question/ });
  await expect(links.first()).toContainText(second.slice(0, 80));
  await list.getByRole("link", { name: new RegExp(first) }).click();
  await page.waitForURL(firstUrl);
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(thread.getByText(first, { exact: true })).toBeVisible();
  await expect(thread.getByText(followUp, { exact: true })).toBeVisible();
});

test("another HR user's conversation and an unknown ID show the same not-found page", async ({ browser, page }) => {
  await signIn(page, "Meera Iyer");
  await openAssistant(page);
  const secret = unique("Meera private question");
  await ask(page, secret);
  await page.waitForURL(CONVERSATION_URL);
  const meeraUrl = new URL(page.url()).pathname;

  const rohan = await browser.newPage();
  await signIn(rohan, "Rohan Mehta");
  await rohan.goto(meeraUrl);
  await expect(rohan.getByRole("heading", { name: "Conversation not found" })).toBeVisible();
  await expect(rohan.getByText("This conversation does not exist or is not yours.")).toBeVisible();
  expect(await rohan.content()).not.toContain(secret);
  const forbiddenText = await rohan.locator("main").filter({ visible: true }).innerText();
  await rohan.goto("/assistant/00000000-0000-4000-8000-000000000000");
  expect(await rohan.locator("main").filter({ visible: true }).innerText()).toBe(forbiddenText);
  await rohan.goto("/assistant/not-a-uuid");
  expect(await rohan.locator("main").filter({ visible: true }).innerText()).toBe(forbiddenText);
  await rohan.close();
});

test("leaving through app navigation clears the draft; the saved conversation is still there on return", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openAssistant(page);
  const question = unique("Who has the highest annual base salary?");
  await ask(page, question);
  await page.waitForURL(CONVERSATION_URL);
  const url = page.url();
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(question, { exact: true })).toBeVisible();
  await composer(page).fill("an unsent draft");

  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  await openMenuIfMobile(page);
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Employees" }).click();
  await page.waitForURL("**/employees");
  await expect(page.getByText("4,599", { exact: true })).toBeVisible();
  await page.goBack();
  await page.waitForURL(url);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(question, { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue("");
});

test.describe("answers, cards, and failure states (test-only fake assistant backend)", () => {
  test.use({ baseURL: "http://localhost:3906" });

  async function as(page: Page, user: "fake-meera" | "fake-rohan") {
    await page.context().addCookies([
      { name: "__Host-acme_session", value: user, url: "https://localhost", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    await page.goto("/assistant");
    await expect(page.getByRole("region", { name: "Recorded for quality review" })).toBeVisible();
  }

  test("a suggested prompt renders the saved answer, tool activity, cards, and limitations; reload keeps them", async ({ page }, testInfo) => {
    await as(page, "fake-meera");
    await page.getByRole("button", { name: /Top compensation/ }).click();
    await page.waitForURL(CONVERSATION_URL);
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer).toContainText("Sneha Singh has the highest annual cash compensation");
    await expect(answer.getByText("Ranked employees by compensation")).toBeVisible();
    const list = answer.getByRole("region", { name: "Top annual cash compensation (USD comparison)" });
    await expect(list.getByRole("link", { name: "Sneha Singh" })).toHaveAttribute("href", "/employees/ACME00042");
    await expect(list.getByText("USD 165,000.00").first()).toBeVisible();
    await expect(answer.getByRole("region", { name: "Annual base salary by department", exact: true })).toContainText("currencies are never added together");
    await expect(answer.getByText("Only employees within your access are included.")).toBeVisible();
    await noHorizontalOverflow(page);
    await noSeriousAxe(page);
    await page.screenshot({ path: testInfo.outputPath(`assistant-answer-${testInfo.project.name}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole("article", { name: "Assistant answer" })).toContainText("Sneha Singh has the highest annual cash compensation");
  });

  test("Scoped HR never sees an out-of-scope row from a saved answer", async ({ page }) => {
    await as(page, "fake-rohan");
    await page.getByRole("button", { name: /Top compensation/ }).click();
    await page.waitForURL(CONVERSATION_URL);
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer.getByRole("link", { name: "Sneha Singh" }).first()).toBeVisible();
    await expect(page.getByText("Marcus Thompson")).toHaveCount(0);
    await expect(answer.getByText("Some results outside your access were not shown.")).toBeVisible();
  });

  test("a withheld saved answer shows only the fixed text", async ({ page }) => {
    await as(page, "fake-rohan");
    await page.goto("/assistant/7e7e7e7e-0000-4000-8000-00000000000a");
    const withheld = page.getByRole("article", { name: "Assistant answer withheld" });
    await expect(withheld).toContainText("hidden because your current access no longer covers it");
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(page.getByText("Limitations")).toHaveCount(0);
    await noSeriousAxe(page);
  });

  test("model text with HTML is shown as text and never executed", async ({ page }) => {
    await as(page, "fake-meera");
    await ask(page, "[html] show me");
    await page.waitForURL(CONVERSATION_URL);
    const answer = page.getByRole("article", { name: "Assistant answer" });
    await expect(answer).toContainText('<script>document.title="pwned"</script> plain');
    await expect(answer.locator("img, script")).toHaveCount(0);
    expect(await page.title()).not.toBe("pwned");
  });

  test("a recorded model failure offers Retry; a rate limit keeps the draft and says when", async ({ page }) => {
    await as(page, "fake-meera");
    await ask(page, "[fail] who earns most");
    await page.waitForURL(CONVERSATION_URL);
    await expect(page.getByText("The language model did not answer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await ask(page, "[ratelimit] again");
    const alert = page.getByRole("alert").filter({ hasText: "Too many assistant requests" });
    await expect(alert).toContainText("Try again in about 9 minutes.");
    await expect(composer(page)).toHaveValue("[ratelimit] again");
  });

  test("a timeout is unconfirmed; Send again replays the same submission and the running turn is shown", async ({ page }) => {
    test.setTimeout(60_000);
    await as(page, "fake-meera");
    await ask(page, "warm up");
    await page.waitForURL(CONVERSATION_URL);
    await ask(page, "[slow] please");
    await expect(page.getByRole("status").filter({ hasText: "The assistant is working" })).toBeVisible();
    await expect(page.getByText("This message may not have been received")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Send again" }).click();
    // Same key while the first attempt is still running: the backend says it is in progress.
    await expect(page.getByText("Still working on this message.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Conversation" }).getByText("[slow] please", { exact: true })).toHaveCount(1);
    await page.waitForTimeout(9_000);
    await page.getByRole("link", { name: "Check again" }).click();
    await expect(page.getByRole("article", { name: "Assistant answer" })).toHaveCount(2);
  });

  test("an unreadable response is unconfirmed, and Send again shows the saved answer once", async ({ page }) => {
    await as(page, "fake-meera");
    await ask(page, "[malformed] please");
    await expect(page.getByText("This message may not have been received")).toBeVisible();
    await page.getByRole("button", { name: "Send again" }).click();
    // The fake replays the stored (still malformed) body; the thread shows the one saved turn.
    await expect(page.getByText("This message may not have been received")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(composer(page)).toHaveValue("[malformed] please");
    await page.goto("/assistant");
    await page.getByRole("navigation", { name: "Your conversations" }).getByRole("link", { name: /\[malformed\] please/ }).first().click();
    await expect(page.getByRole("list", { name: "Conversation" }).getByText("[malformed] please", { exact: true })).toHaveCount(1);
  });
});
