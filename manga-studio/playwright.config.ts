import { defineConfig, devices } from "@playwright/test";

/**
 * A minimal e2e smoke suite — not exhaustive UI coverage (that's what the
 * vitest component tests are for), just "does the app actually boot and
 * can its main dialogs open" across a real browser, which no unit test can
 * verify. The `playwright` devDependency existed with zero config and zero
 * tests before this; this is what actually uses it.
 *
 * `webServer` starts `next dev` itself and waits for it to answer before
 * running tests, and tears it down afterward — no separate "start the app,
 * then run tests" step to remember.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
