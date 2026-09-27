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

/*
 * AUD-04 §3, §9: the responsive size matrix. Each project runs only the
 * `responsive/aud04-*.spec.ts` specs, so the rest of the suite is not
 * multiplied by eleven; a spec about one size family skips the others with
 * `outsideProjects` (tests/e2e/responsive/geometry.ts). Phones and tablets
 * emulate touch, so the `touch:` hit areas (pointer: coarse) apply as on a
 * device; the desktop pair keeps a fine pointer (MW-21). The existing `mobile`
 * project (Pixel 7, 412×915) runs these specs too and is the 412 phone.
 */
const AUD04 = /responsive\/aud04-.*\.spec\.ts/;
const touchPhone = { ...devices["Pixel 7"] };
const aud04Chromium = [
  { name: "aud04-phone-320", use: { ...touchPhone, viewport: { width: 320, height: 568 } } },
  { name: "aud04-phone-360", use: { ...touchPhone, viewport: { width: 360, height: 800 } } },
  { name: "aud04-phone-390", use: { ...touchPhone, viewport: { width: 390, height: 844 } } },
  { name: "aud04-tablet-768", use: { ...touchPhone, viewport: { width: 768, height: 1024 } } },
  { name: "aud04-tablet-820", use: { ...touchPhone, viewport: { width: 820, height: 1180 } } },
  { name: "aud04-landscape-844", use: { ...touchPhone, viewport: { width: 844, height: 390 } } },
  { name: "aud04-tablet-1024", use: { ...touchPhone, viewport: { width: 1024, height: 768 } } },
  { name: "aud04-desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  { name: "aud04-desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
].map((project) => ({ ...project, testMatch: AUD04 }));
/* WebKit and Firefox phones need their browser downloads, so they are opt-in like the other non-Chromium projects. */
const aud04OtherBrowsers = [
  { name: "aud04-webkit-phone", use: { ...devices["iPhone 14"] } },
  // Firefox has no `isMobile`; touch and the phone viewport are what the layout reads.
  { name: "aud04-firefox-phone", use: { browserName: "firefox" as const, viewport: { width: 390, height: 844 }, hasTouch: true } },
].map((project) => ({ ...project, testMatch: AUD04 }));

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
    ...aud04Chromium,
    ...(process.env.E2E_ALL_BROWSERS || process.env.E2E_AUD04_BROWSERS ? aud04OtherBrowsers : []),
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
