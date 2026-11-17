import { execFileSync } from "node:child_process";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Admin AI monitoring against the real Express backend and its isolated lane database.
//
// - Overview, list, filters, pagination, Scoped HR 403, review, stale review, deletion, and MCP use
//   the real backend. Deletion uses real recorded turns (the lane has no model, so each message is a
//   recorded MODEL_NOT_CONFIGURED turn). MCP rows come from real calls to the backend MCP endpoint.
// - Trace shapes a model would produce (several tools, a rejected and a failed tool, a timeout after
//   a tool, an unrecorded outcome, a large result) are written by tests/e2e/support/seed-ai-traces.mts
//   through the backend's own observability repository, into the *_test database named by
//   E2E_DATABASE_URL. Without it, those journeys are skipped and say why.
//
// Secret checks match patterns only; no credential value is read, printed, or compared.

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
const API = process.env.E2E_API_BASE_URL ?? "";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "";
const RAW_WARNING = "Raw trace data contains complete synthetic employee identities and compensation values.";

type Seeded = { conversationId: string; traces: Record<"noTool" | "multiTool" | "toolFailed" | "timeout" | "persistence" | "large", string> };
let seeded: Seeded | null = null;

test.beforeAll(() => {
  if (!DATABASE_URL) return;
  const out = execFileSync("npx", ["--prefix", "../express-backend", "tsx", "tests/e2e/support/seed-ai-traces.mts"], {
    env: { ...process.env, E2E_DATABASE_URL: DATABASE_URL },
    encoding: "utf8",
  });
  seeded = JSON.parse(out.trim().split("\n").at(-1)!) as Seeded;
});

const needsSeed = () => test.skip(!seeded, "Needs E2E_DATABASE_URL for the isolated *_test database (trace-shape seed).");

async function signIn(page: Page, account: "Meera Iyer" | "Rohan Mehta") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: account }).check();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/employees");
}

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${API}/api/v1/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

async function noSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function noSecretsOrStorage(page: Page) {
  const html = await page.content();
  for (const pattern of [/Bearer\s+[A-Za-z0-9._-]{10,}/, /\bsk-[A-Za-z0-9]{10,}/, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, /mysql:\/\//, /Set-Cookie/i]) {
    expect(html).not.toMatch(pattern);
  }
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: "" });
}

async function openMenuIfMobile(page: Page) {
  const details = page.locator("details").filter({ has: page.locator("summary:visible") });
  if ((await details.count()) > 0 && !(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await details.locator("summary").click();
}

test("Admin HR opens AI monitoring from the rail; the Overview links counts into the trace list", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await page.getByRole("region", { name: "Signed-in HR account" }).filter({ visible: true }).waitFor();
  await page.waitForLoadState("networkidle");
  await openMenuIfMobile(page);
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "AI monitoring" }).click();
  await page.waitForURL("**/admin/ai-monitoring");
  await expect(page.getByRole("heading", { name: "AI monitoring", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "AI monitoring views" }).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  for (const section of ["Assistant turns", "Failures by stage and category", "Duration and tokens", "Model calls by model", "Reviews", "Assistant tool calls", "MCP calls"]) {
    await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
  }
  await noHorizontalOverflow(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`monitoring-overview-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("link", { name: "Last 7 days" }).click();
  await page.waitForURL("**/admin/ai-monitoring?window=7d");
  await expect(page.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Traces and failures by day (UTC)" })).toBeVisible();

  await page.getByRole("link", { name: /failed traces, open in the trace list/ }).first().click();
  await page.waitForURL(/\/admin\/ai-traces\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&status=FAILED/);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Status: Failed");
});

test("Scoped HR has no AI monitoring link and every Admin page shows only the forbidden state", async ({ page }) => {
  await signIn(page, "Rohan Mehta");
  await openMenuIfMobile(page);
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "AI monitoring" })).toHaveCount(0);
  const paths = ["/admin/ai-monitoring", "/admin/ai-traces", "/admin/mcp-calls", "/admin/ai-traces/7548c0db-598f-45ea-8200-f1a5effb9008", "/admin/mcp-calls/e6d1d691-e180-414f-966e-939cfa57d516"];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("alert").filter({ hasText: "Admin HR only" })).toBeVisible();
    const main = await page.locator("main").filter({ visible: true }).innerText();
    expect(main).not.toMatch(/Meera Iyer|not-configured|search_employees|Step 1|Started \(UTC\)/);
  }
  await noSeriousAxe(page);
});

test("trace list: filters live in the URL, page size and pagination are server-side, invalid filters are refused", async ({ page }, testInfo) => {
  await signIn(page, "Meera Iyer");
  await page.goto("/admin/ai-traces");
  const results = page.locator("#results");
  await expect(results).toContainText(/\d+ traces?/);
  const form = page.getByRole("form", { name: "Filters" });
  await form.getByLabel("Status").selectOption("FAILED");
  await form.getByLabel("Per page").selectOption("100");
  await form.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL(/status=FAILED/);
  expect(page.url()).toMatch(/pageSize=100/);
  expect(page.url()).toMatch(/#results$/);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Status: Failed");
  // Every visible row is failed.
  const rows = testInfo.project.name === "desktop" ? page.getByRole("region", { name: "AI traces table" }).locator("tbody tr") : page.getByRole("list", { name: "AI traces, newest first" }).locator("li");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(count, 10); i += 1) await expect(rows.nth(i)).toContainText("Failed");
  // Reload keeps the filters.
  await page.reload();
  await expect(form.getByLabel("Status")).toHaveValue("FAILED");
  // The list never carries prompt or answer text.
  expect(await page.locator("main").filter({ visible: true }).innerText()).not.toMatch(/Who are the top earners|Employee 1|Sneha/);

  await page.goto("/admin/ai-traces?pageSize=2");
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Older" }).click();
  await page.waitForURL(/page=2/);
  await expect(results).toContainText("page 2 of");

  for (const bad of ["?pageSize=500", "?from=2026-11-10&to=2026-11-01", "?status=DELETED"]) {
    await page.goto(`/admin/ai-traces${bad}`);
    await expect(page.getByRole("alert").filter({ hasText: "These filters could not be applied" })).toBeVisible();
  }
  await page.getByRole("link", { name: "Clear filters" }).click();
  await page.waitForURL(/\/admin\/ai-traces(#results)?$/);
  await noHorizontalOverflow(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`monitoring-traces-${testInfo.project.name}.png`), fullPage: true });
});

test("several tools: ordered steps, scrubbed rejected arguments, formatted redaction, and warned raw view", async ({ page }, testInfo) => {
  needsSeed();
  await signIn(page, "Meera Iyer");
  const url = `/admin/ai-traces/${seeded!.traces.multiTool}`;
  await page.goto(url);
  const ledger = page.getByRole("list", { name: "Turn timeline" });
  await expect(ledger.getByRole("heading", { level: 3 })).toHaveCount(6);
  const headings = await ledger.getByRole("heading", { level: 3 }).allInnerTexts();
  expect(headings.map((h) => h.replace(/\s+/g, " ").trim())).toEqual([
    "Step 1 of 6: User prompt",
    "Step 2 of 6: Model call 1 Succeeded",
    "Step 3 of 6: Tool call 1: get_top_compensated_employees Succeeded",
    "Step 4 of 6: Tool call 2: search_employees Rejected (not run)",
    "Step 5 of 6: Model call 2 Succeeded",
    "Step 6 of 6: Final response",
  ]);
  await expect(ledger.getByRole("region", { name: "Requested arguments JSON" }).nth(1)).toContainText('"password": "[REDACTED]"');
  const formatted = await page.locator("main").filter({ visible: true }).innerText();
  expect(formatted).toContain("Employee 1");
  expect(formatted).toContain("2500000.00");
  expect(formatted).not.toMatch(/Sneha Singh|ACME00042|Marcus Thompson/);
  await expect(page.getByText("Employee names, codes, and emails are replaced with placeholders in this view. Salary values are shown.")).toBeVisible();
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`monitoring-trace-formatted-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("tab", { name: "Raw JSON" }).click();
  await expect(page.getByRole("heading", { name: "Raw trace data" })).toBeFocused();
  await expect(page.getByText(RAW_WARNING).first()).toBeVisible();
  expect(await page.locator("main").filter({ visible: true }).innerText()).not.toContain("Sneha Singh");
  await page.getByRole("button", { name: "Show raw trace data" }).click();
  const rawLedger = page.getByRole("list", { name: "Turn timeline, raw data" });
  await expect(rawLedger).toBeVisible();
  await expect(rawLedger.getByRole("region", { name: "Result JSON" }).first()).toContainText("Sneha Singh");
  expect(new URL(page.url()).pathname).toBe(url);
  expect(page.url()).not.toMatch(/raw|Sneha/);
  await noSecretsOrStorage(page);
  await noSeriousAxe(page);
  await page.screenshot({ path: testInfo.outputPath(`monitoring-trace-raw-${testInfo.project.name}.png`), fullPage: true });

  // Leaving and returning asks again.
  await page.goto("/admin/ai-traces");
  await page.goto(url);
  await page.getByRole("tab", { name: "Raw JSON" }).click();
  await expect(page.getByRole("button", { name: "Show raw trace data" })).toBeVisible();
  expect(await page.locator("main").filter({ visible: true }).innerText()).not.toContain("Sneha Singh");
});

test("no-tool, failed-tool, timeout-after-tool, and unrecorded-outcome turns are told apart", async ({ page }) => {
  needsSeed();
  await signIn(page, "Meera Iyer");
  await page.goto(`/admin/ai-traces/${seeded!.traces.noTool}`);
  await expect(page.getByText("No tool requested.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Turn timeline" }).getByRole("heading", { name: /Tool call/ })).toHaveCount(0);

  await page.goto(`/admin/ai-traces/${seeded!.traces.toolFailed}`);
  await expect(page.getByText("Tool · Tool failed while running: TOOL_FAILED")).toBeVisible();

  await page.goto(`/admin/ai-traces/${seeded!.traces.timeout}`);
  const ledger = page.getByRole("list", { name: "Turn timeline" });
  await expect(ledger.getByRole("heading", { name: /Tool call 1: get_compensation_summary Succeeded/ })).toBeVisible();
  await expect(ledger.getByRole("heading", { name: /Stopped here/ })).toBeVisible();
  await expect(page.getByText(/Stopped at Model · Model call failed: timeout/)).toBeVisible();
  await page.getByRole("link", { name: /Go to step \d/ }).click();
  await expect(page).toHaveURL(/#step-\d+$/);
  await expect(page.getByRole("link", { name: "Go to review" }).or(page.getByRole("heading", { name: "Review" })).first()).toBeVisible();

  await page.goto(`/admin/ai-traces/${seeded!.traces.persistence}`);
  await expect(page.getByText(/Stopped at Recording · Recording the tool result failed: persistence_unavailable/)).toBeVisible();
  await expect(page.getByText("The outcome could not be recorded, so the assistant stopped here.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Final response/ })).toHaveCount(0);
});

test("a large nested result stays collapsed, opens without freezing the page, and copies only on request", async ({ page }) => {
  needsSeed();
  await signIn(page, "Meera Iyer");
  await page.goto(`/admin/ai-traces/${seeded!.traces.large}`);
  const result = page.locator("details").filter({ hasText: /^› ?Result/ }).first();
  await expect(result).not.toHaveAttribute("open", "");
  await expect(result.locator("summary")).toContainText("KB");
  const started = Date.now();
  await result.locator("summary").click();
  await expect(page.getByRole("region", { name: "Result JSON" })).toBeVisible();
  // The page still responds: typing into the review note registers promptly.
  const note = page.getByLabel("Note (optional)");
  await note.fill("still responsive");
  await expect(note).toHaveValue("still responsive");
  expect(Date.now() - started).toBeLessThan(5_000);
  await noHorizontalOverflow(page);
});

test("review, then a stale second review is refused and kept until the reviewer replaces it", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Two browser contexts on one trace; run once.");
  needsSeed();
  const traceUrl = `/admin/ai-traces/${seeded!.traces.toolFailed}`;
  const open = async (b: Browser) => {
    const context = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await signIn(page, "Meera Iyer");
    await page.goto(traceUrl);
    return page;
  };
  const a = await open(browser);
  const b = await open(browser);

  await b.getByRole("radio", { name: "Correct", exact: true }).check();
  await b.getByRole("button", { name: /Save review|Replace review/ }).click();
  await expect(b.getByText("Review saved: Correct.")).toBeVisible();

  await a.getByRole("radio", { name: "Incorrect" }).check();
  await a.getByLabel("Note (optional)").fill("Explained the failure badly.");
  await a.getByRole("checkbox", { name: /Nominate/ }).check();
  await a.getByRole("button", { name: /Save review|Replace review/ }).click();
  const stale = a.getByRole("alert").filter({ hasText: "Another review was saved while you were editing." });
  await expect(stale).toBeVisible();
  await expect(stale).toBeFocused();
  await expect(a.getByRole("radio", { name: "Incorrect" })).toBeChecked();
  await expect(a.getByLabel("Note (optional)")).toHaveValue("Explained the failure badly.");
  await a.getByRole("button", { name: "Replace with my review" }).click();
  await expect(a.getByText("Review saved: Incorrect.")).toBeVisible();
  await a.reload();
  await expect(a.getByText(/Incorrect · reviewed by Meera Iyer/)).toBeVisible();
  await expect(a.getByText("Nominated as an evaluation-fixture candidate.")).toBeVisible();
  await noSeriousAxe(a);
  await a.context().close();
  await b.context().close();
});

test("deleting one recorded turn removes only that turn; a reload is not found and the next turn stays", async ({ page, request }, testInfo) => {
  // Two real recorded turns in a new conversation (the lane has no model: each is a FAILED turn).
  const token = await apiToken(request, "meera.iyer@acme.com");
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/api/v1/assistant/conversations`, { headers, data: {} });
  const conversationId = ((await created.json()) as { conversation: { conversationId: string } }).conversation.conversationId;
  const first = `Disposable turn one ${testInfo.project.name} ${Date.now()}`;
  const second = `Disposable turn two ${testInfo.project.name} ${Date.now()}`;
  for (const content of [first, second]) {
    await request.post(`${API}/api/v1/assistant/conversations/${conversationId}/messages`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: { content } });
  }
  const detail = (await (await request.get(`${API}/api/v1/assistant/conversations/${conversationId}`, { headers })).json()) as { turns: { traceId: string }[] };
  const [firstTrace, secondTrace] = detail.turns.map((t) => t.traceId);

  await signIn(page, "Meera Iyer");
  await page.goto(`/admin/ai-traces/${firstTrace}`);
  await page.getByRole("button", { name: "Delete this trace…" }).click();
  await expect(page.getByRole("heading", { name: "Delete this trace permanently?" })).toBeFocused();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`monitoring-delete-confirm-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Delete trace" }).click();
  await expect(page.getByRole("heading", { name: "Trace deleted" })).toBeFocused();
  expect(page.url()).not.toMatch(/deleted/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trace not found" })).toBeVisible();

  await page.goto(`/admin/ai-traces/${secondTrace}`);
  await expect(page.getByRole("heading", { name: /^Trace /, level: 2 })).toBeVisible();
  // previous_trace_id is ON DELETE SET NULL: the later turn no longer points at the deleted one.
  await expect(page.locator("div").filter({ has: page.locator("dt", { hasText: /^Previous turn$/ }) }).last().locator("dd")).toHaveText("None");
  await page.goto(`/assistant/${conversationId}`);
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(thread.getByText(second, { exact: true })).toBeVisible();
  await expect(thread.getByText(first, { exact: true })).toHaveCount(0);
  await expect(thread.getByText("Earlier messages in this conversation were removed.")).toBeVisible();
});

test("MCP calls have their own list and detail, with no model data, placeholders, and the warned raw result", async ({ page, request }, testInfo) => {
  const token = await apiToken(request, "meera.iyer@acme.com");
  const call = (body: unknown) =>
    request.post(`${API}/api/v1/mcp`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: body });
  await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_employees", arguments: { query: "Sneha" } } });
  await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_employees", arguments: { bogus: true } } });

  await signIn(page, "Meera Iyer");
  await page.goto("/admin/mcp-calls");
  await expect(page.getByRole("heading", { name: "MCP calls", level: 1 })).toBeVisible();
  await expect(page.getByText(/do not use the language model/).first()).toBeVisible();
  const main = await page.locator("main").filter({ visible: true }).innerText();
  expect(main).not.toMatch(/Tokens|Model calls|Review/);
  await noSeriousAxe(page);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`monitoring-mcp-${testInfo.project.name}.png`), fullPage: true });

  await page.goto("/admin/mcp-calls?status=REJECTED");
  await expect(page.locator("#results")).toContainText(/MCP calls?/);
  await page.goto("/admin/mcp-calls?status=SUCCEEDED&tool=search_employees");
  await page.getByRole("link", { name: /MCP call started .* search_employees, Succeeded/ }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/admin\/mcp-calls\/[0-9a-f-]{36}/);
  // A larger result starts collapsed; open it to read the formatted identities.
  const result = page.locator("details").filter({ hasText: /^› ?Result/ }).first();
  if ((await result.getAttribute("open")) === null) await result.locator("summary").click();
  const formatted = await page.getByRole("region", { name: "Result JSON" }).innerText();
  expect(formatted).toMatch(/Employee 1/);
  expect(formatted).not.toMatch(/ACME\d{5}/);
  await page.getByRole("tab", { name: "Raw JSON" }).click();
  await expect(page.getByRole("heading", { name: "Raw MCP call data" })).toBeFocused();
  await page.getByRole("button", { name: "Show raw MCP call data" }).click();
  await expect(page.getByText(RAW_WARNING).first()).toBeVisible();
  const rawResult = page.getByRole("tabpanel").filter({ visible: true }).locator("details").filter({ hasText: /^› ?Result/ }).first();
  if ((await rawResult.getAttribute("open")) === null) await rawResult.locator("summary").click();
  await expect(page.getByRole("region", { name: "Result JSON" }).filter({ visible: true })).toContainText(/ACME\d{5}/);
  await noSecretsOrStorage(page);
});

test("keyboard and 200% zoom: the Overview, list, and a trace stay usable without sideways scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Zoom is emulated from the desktop viewport.");
  needsSeed();
  await signIn(page, "Meera Iyer");
  await page.goto(`/admin/ai-traces/${seeded!.traces.multiTool}`);
  // Tabs by keyboard: arrows move focus, Enter selects.
  await page.getByRole("tab", { name: "Formatted" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Raw JSON" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Raw trace data" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Show raw trace data" })).toBeFocused();

  await page.setViewportSize({ width: 720, height: 450 });
  for (const path of ["/admin/ai-monitoring", "/admin/ai-traces", `/admin/ai-traces/${seeded!.traces.multiTool}`, "/admin/mcp-calls"]) {
    await page.goto(path);
    await noHorizontalOverflow(page);
    await noSeriousAxe(page);
  }
  await page.screenshot({ path: testInfo.outputPath("monitoring-zoom-200.png"), fullPage: true });
});
