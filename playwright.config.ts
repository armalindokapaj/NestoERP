import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration (PRD #9 §143, §144, §246).
 *
 * Runs against a production build of NESTO with the seeded demo data, because
 * an E2E suite against mocks proves nothing about authorisation (PRD #9 §223).
 * Artefacts are produced on failure only (PRD #9 §246).
 */
/*
 * NESTO runs on port 3000 and only port 3000 — dev, start, E2E and the role
 * walk all point here, so a link copied from one is valid in the others.
 * `reuseExistingServer` means a dev server already on 3000 is used as-is, so a
 * plain `pnpm test:e2e` exercises whatever is already running. Use
 * `pnpm test:e2e:prod` for a real production-build run: it builds into its own
 * `NEXT_DIST_DIR` on its own port, so it cannot overwrite the build directory a
 * dev server is reading from underneath it.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The responsive specs assert mobile behaviour and belong to the mobile
      // project; running them at desktop width would assert the opposite.
      testIgnore: /responsive\/.*\.spec\.ts/,
    },
    {
      // A real mobile browser, not an imitation of a native app (PRD #9 §182).
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\/.*\.spec\.ts/,
    },
    /*
     * Chromium is the required baseline; Firefox and WebKit cover the critical
     * flows in CI where the browsers are available (PRD #9 §144). They are
     * opt-in so a first `pnpm test:e2e` does not need three browser downloads.
     */
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /auth\/.*\.spec\.ts/ },
          // Plus NAV-01's critical navigation and Create flows (NAV-01 §15.4).
          { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /(auth\/.*|shell\/navigation-response)\.spec\.ts/ },
          {
            name: "mobile-safari",
            use: { ...devices["iPhone 14 Pro"] },
            testMatch: /responsive\/.*\.spec\.ts/,
          },
        ]
      : []),
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
