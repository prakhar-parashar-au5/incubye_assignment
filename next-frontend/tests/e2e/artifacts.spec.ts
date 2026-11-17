import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Artifacts section (Frontend Task 07): Admin HR only, static content, generated pages embedded
// from the authenticated raw route. Runs against the real backend lane.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const RAW = "/artifacts/raw/F1.html";

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
  await page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true }).waitFor();
}

async function openMenuIfMobile(page: Page) {
  const details = page.locator("details").filter({ has: page.locator("summary:visible") });
  if ((await details.count()) > 0 && !(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await details.locator("summary").click();
}

// axe injects itself into every frame, and a sandboxed frame that allows no scripts never gets
// an execution context, so the scan would hang. Pages with a frame are scanned after the frame is
// swapped for an empty box (its title and sandbox are asserted separately), and each generated
// page is scanned on its own raw URL instead.
async function noSeriousAxe(page: Page, { detachFrames = false } = {}) {
  if (detachFrames) {
    await page.evaluate(() => document.querySelectorAll("iframe").forEach((frame) => frame.replaceWith(Object.assign(document.createElement("div"), { className: frame.className }))));
  }
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

function rail(page: Page) {
  return page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
}

test("Admin HR opens Artifacts from the rail, after AI monitoring, and every artifact page", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await page.waitForLoadState("networkidle");
  await openMenuIfMobile(page);
  const items = (await rail(page).getByRole("link").allTextContents()).map((text) => text.trim());
  expect(items.indexOf("Artifacts")).toBe(items.indexOf("AI monitoring") + 1);
  await rail(page).getByRole("link", { name: "Artifacts" }).click();
  await page.waitForURL("**/artifacts");
  await expect(page.getByRole("heading", { level: 1, name: "Artifacts" })).toBeVisible();
  // Counted in the DOM: on mobile the Menu closes after navigation.
  await expect(page.locator('nav[aria-label="Main"] a[href="/artifacts"][aria-current="page"]').first()).toBeAttached();
  const list = page.getByRole("navigation", { name: "Artifacts" });
  await expect(list.getByRole("listitem")).toHaveCount(13);
  // Task 07b order.
  await expect(list.getByRole("heading", { level: 3 })).toHaveText([
    "Requirements", "Decisions and trade-offs", "Tech stack", "How it was built", "Human specs and AI specs",
    "Database schema", "Opening the employee directory", "An assistant question with a tool call", "A salary request and its approval",
    "AI evaluation", "Testing", "Performance", "Evolution",
  ]);
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Thinking", "How it works", "Quality and history"]);
  await noHorizontalOverflow(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`artifacts-overview-${testInfo.project.name}.png`), fullPage: true });

  // Every generated page loads in the sandboxed frame from the raw route, and on its own raw URL.
  for (const { link, path, file, title, heading } of [
    { link: "Opening the employee directory", path: "/artifacts/flows/employees-click", file: "F1.html", title: "Request flow F1: Opening the employee directory", heading: /^F1: Admin clicks Employees/ },
    { link: "An assistant question with a tool call", path: "/artifacts/flows/assistant-tool-call", file: "F2.html", title: "Request flow F2: An assistant question with a tool call", heading: /^F2: Admin asks the assistant/ },
    { link: "A salary request and its approval", path: "/artifacts/flows/salary-request", file: "F3.html", title: "Request flow F3: A salary request and its approval", heading: /^F3: Scoped HR requests a salary change and Admin HR approves it$/ },
    { link: "Database schema", path: "/artifacts/database", file: "schema.html", title: "Database schema", heading: /^Database schema$/ },
  ]) {
    await page.goto("/artifacts");
    const raw = page.waitForResponse((response) => response.url().endsWith(`/artifacts/raw/${file}`));
    await list.getByRole("link", { name: link }).click();
    await page.waitForURL(`**${path}`);
    expect((await raw).status()).toBe(200);
    // Scoped to the visible page: Next.js keeps visited routes mounted but hidden.
    await expect(page.locator("main").filter({ visible: true }).getByText("Coming soon")).toHaveCount(0);
    const frame = page.locator("iframe").filter({ visible: true });
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(frame).toHaveAttribute("title", title);
    await expect(page.frameLocator("iframe").getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", `/artifacts/raw/${file}`);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`artifacts-${file.replace(".html", "")}-${testInfo.project.name}.png`) });
    const fullPage = page.getByRole("link", { name: "Open full page" });
    await noSeriousAxe(page, { detachFrames: true });

    // Open full page: the same raw route at the top level, scanned on its own.
    await fullPage.click();
    await page.waitForURL(`**/artifacts/raw/${file}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await noSeriousAxe(page);
  }

  // Written pages: readable without sideways scrolling at 390 and 1440 px, every source a repository link.
  for (const [path, title, section] of [
    ["/artifacts/tech-stack", "Tech stack", "Key decisions and their trade-offs"],
    ["/artifacts/how-it-was-built", "How it was built", "Worked example: two assistant hard-gate failures"],
  ] as const) {
    await page.goto("/artifacts");
    await list.getByRole("link", { name: title }).click();
    await page.waitForURL(`**${path}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    const sources = page.locator("main").filter({ visible: true }).getByRole("link", { name: /\.(md|ts|tsx|json|sql|yml|mts|mjs)$|nvmrc$/ });
    expect(await sources.count()).toBeGreaterThan(5);
    for (const href of await sources.evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
      expect(href).toMatch(/^https:\/\/github\.com\/prakhar-parashar-au5\/incubye_assignment\/blob\/master\//);
    }
    await noHorizontalOverflow(page);
    await noSeriousAxe(page);
    await page.screenshot({ path: testInfo.outputPath(`artifacts-${path.split("/").pop()}-${testInfo.project.name}.png`), fullPage: true });
  }
});

test("Admin HR opens every Task 07a page from the overview", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  const pages = [
    { link: "Requirements", path: "/artifacts/requirements", check: "Written before implementation" },
    { link: "Decisions and trade-offs", path: "/artifacts/decisions", check: "Option C: withhold saved answers when scope narrows" },
    { link: "Human specs and AI specs", path: "/artifacts/specs", check: "Example, salary adjustments: what the human decided" },
    { link: "AI evaluation", path: "/artifacts/ai-evaluation", check: "D1 and D2, and the fix" },
    { link: "Testing", path: "/artifacts/testing", check: "How the suites stay reliable" },
    { link: "Performance", path: "/artifacts/performance", check: "Stale statistics right after a bulk seed" },
    { link: "Evolution", path: "/artifacts/evolution", check: "merge: architecture flows and schema" },
  ];
  for (const { link, path, check } of pages) {
    await page.goto("/artifacts");
    await page.getByRole("navigation", { name: "Artifacts" }).getByRole("link", { name: link }).click();
    await page.waitForURL(`**${path}`);
    await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
    await expect(page.locator("main").filter({ visible: true }).getByText(check).first()).toBeVisible();
    const external = page.locator("main").filter({ visible: true }).locator('a[href^="https://"]');
    expect(await external.count(), path).toBeGreaterThan(3);
    for (const href of await external.evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
      expect(href).toMatch(/^https:\/\/github\.com\/prakhar-parashar-au5\/incubye_assignment\/(blob\/master\/|commit\/[0-9a-f]{7,40}$)/);
    }
    await noHorizontalOverflow(page);
    await noSeriousAxe(page);
    await page.screenshot({ path: testInfo.outputPath(`artifacts-${path.split("/").pop()}-${testInfo.project.name}.png`), fullPage: true });
  }

  // Evolution: one row per entry in evolution.json, each linking to its commit.
  await page.goto("/artifacts/evolution");
  const rows = page.getByRole("list", { name: "Commits and merges" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(page.getByRole("link", { name: "Commit b801680 on GitHub" })).toHaveAttribute("href", "https://github.com/prakhar-parashar-au5/incubye_assignment/commit/b801680");
});

test("the raw route sends the security headers and only allowlisted files", async ({ page }) => {
  await signIn(page, "Meera Iyer");
  const response = await page.request.get(RAW);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).not.toContain("script-src");
  expect(await response.text()).toContain("<title>F1:");

  for (const name of ["F2.html", "F3.html", "schema.html"]) expect((await page.request.get(`/artifacts/raw/${name}`)).status(), name).toBe(200);
  for (const path of ["/artifacts/raw/F4.html", "/artifacts/raw/..%2Fpackage.json", "/artifacts/raw/files.json", "/artifacts/raw/F1.png"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("Scoped HR has no Artifacts item, and every Artifacts route is forbidden", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openMenuIfMobile(page);
  await expect(rail(page).getByRole("link", { name: "Artifacts" })).toHaveCount(0);
  // Counted in the DOM, so a link hidden in the closed mobile Menu would still count.
  await expect(page.locator('a[href^="/artifacts"]')).toHaveCount(0);

  for (const path of [
    "/artifacts", "/artifacts/database", "/artifacts/flows/employees-click", "/artifacts/tech-stack", "/artifacts/how-it-was-built",
    "/artifacts/requirements", "/artifacts/decisions", "/artifacts/specs", "/artifacts/performance", "/artifacts/testing", "/artifacts/ai-evaluation", "/artifacts/evolution",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("alert").filter({ hasText: "Admin HR only" })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    const main = await page.locator("main").filter({ visible: true }).innerText();
    expect(main).not.toMatch(/Tech stack|Key decisions|Worked example|Open full page|Coming soon|Written before implementation|Options considered|What the agents added|Hard-gate results|Commits and merges|github\.com/);
  }
  await noSeriousAxe(page);

  for (const path of [RAW, "/artifacts/raw/F2.html", "/artifacts/raw/F3.html", "/artifacts/raw/..%2Fpackage.json"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(403);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await response.text()).not.toContain("<html");
  }
});

test("signed out, Artifacts pages and files redirect to sign-in", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  for (const path of ["/artifacts", "/artifacts/database", RAW]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toMatch(/\/sign-in$/);
  }
  await context.close();
});
