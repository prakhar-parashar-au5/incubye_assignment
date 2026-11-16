import { defineConfig, devices } from "@playwright/test";

// Browser journeys against the real Express authentication API.
//
// Requires a running express-backend with seeded demo users, reachable at E2E_API_BASE_URL, and
// the synthetic shared demo password the users were seeded with in E2E_DEMO_PASSWORD. Values are
// passed in the environment by the person running the tests; nothing reads `.env` files.
//
// Started from the same build (`npm run build` first):
// - port 3900: Next.js against the real backend;
// - port 3902: Next.js against a closed port, for the backend-unavailable journeys;
// - port 3905: a test-only fake of the auth and assistant endpoints (no language model exists in
//   tests), with port 3906 running Next.js against it for answer and card rendering.

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "";
const demoPassword = process.env.E2E_DEMO_PASSWORD ?? "";
if (!apiBaseUrl || !demoPassword) {
  throw new Error("Set E2E_API_BASE_URL and E2E_DEMO_PASSWORD to run the browser tests.");
}

const serverEnv = { DEMO_SHARED_PASSWORD: demoPassword, NODE_ENV: "production" };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3900",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: "npx next start -p 3900",
      url: "http://localhost:3900/sign-in",
      env: { ...serverEnv, API_BASE_URL: apiBaseUrl },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx next start -p 3902",
      url: "http://localhost:3902/sign-in",
      env: { ...serverEnv, API_BASE_URL: "http://127.0.0.1:9", API_TIMEOUT_MS: "1000" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // Assistant rendering: a test-only fake backend (tests/e2e/support) and a Next.js server
    // pointed at it, with a short assistant timeout for the timeout journey.
    {
      command: "node tests/e2e/support/fake-assistant-backend.ts",
      port: 3905,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npx next start -p 3906",
      url: "http://localhost:3906/sign-in",
      env: { ...serverEnv, API_BASE_URL: "http://127.0.0.1:3905", API_ASSISTANT_TIMEOUT_MS: "1500" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
