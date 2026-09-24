import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { devices, expect, test, type Page } from "@playwright/test";

import { expectAccessDenied, mainRegion, sidebar, signIn } from "../fixtures";

/**
 * NAV-01 release evidence (§17 item 6): desktop and phone pictures of the
 * loading, pending, empty, retry and denied outcomes, written to
 * `docs/navigation/evidence/`. Opt-in: `NAV_EVIDENCE=1`, against a production
 * build. Destinations are held with test-only route delays (§14.3 step 6);
 * nothing here asserts more than the navigation-response specs already do.
 */

const ENABLED = process.env.NAV_EVIDENCE === "1";
const DIR = join(process.cwd(), "docs", "navigation", "evidence");

async function shot(page: Page, name: string) {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: join(DIR, `${name}.jpg`), type: "jpeg", quality: 60, animations: "disabled" });
}

/**
 * Holds one pathname's navigation request until released. With `prefetch`, its
 * prefetch is held too, so no boundary is cached and the route cannot commit
 * early. Holding, not failing: the router treats a failed prefetch as a
 * document load.
 */
async function hold(page: Page, pathname: string, { prefetch = false } = {}) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && (prefetch || !headers["next-router-prefetch"])) await released;
      await route.continue();
    },
  );
  return release;
}

async function quickCreateStates(page: Page, prefix: string) {
  let mode: "hold" | "error" | "empty" = "hold";
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/quick-create/actions**", async (route) => {
    if (mode === "hold") await released;
    if (mode === "error") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x" } }) });
    const response = await route.fetch();
    const body = (await response.json()) as { data: { actions: unknown[] } };
    if (mode === "empty") body.data.actions = [];
    return route.fulfill({ response, json: body });
  });
  const panel = page.getByTestId("quick-create-panel");
  await page.getByTestId("quick-create-button").click();
  await expect(panel.getByTestId("quick-create-loading")).toBeVisible();
  await shot(page, `${prefix}-quick-create-loading`);
  mode = "error";
  release();
  await expect(panel.getByTestId("quick-create-error")).toBeVisible();
  await shot(page, `${prefix}-quick-create-retry`);
  mode = "empty";
  await panel.getByTestId("quick-create-retry").click();
  await expect(panel.getByTestId("quick-create-empty")).toBeVisible();
  await shot(page, `${prefix}-quick-create-empty`);
}

test.describe("NAV-01 evidence, desktop", () => {
  test.skip(!ENABLED, "Set NAV_EVIDENCE=1 to write the release pictures.");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a held destination: the skeleton and the top bar", async ({ page }) => {
    await signIn(page, "FINANCE", { to: "/dashboard" });
    const target = sidebar(page).locator('a[href="/finance"]');
    await expect(target).toBeVisible();
    await page.waitForTimeout(800); // the link's default prefetch brings the boundary
    const release = await hold(page, "/finance");
    await target.click();
    await expect(mainRegion(page).getByTestId("page-skeleton")).toBeVisible();
    await page.waitForTimeout(250); // past the top bar's 150 ms fade-in
    await shot(page, "desktop-01-loading-skeleton");
    release();
  });

  test("an unprefetched destination: the pending mark on the clicked item", async ({ page }) => {
    const release = await hold(page, "/finance", { prefetch: true });
    await signIn(page, "FINANCE", { to: "/dashboard" });
    const target = sidebar(page).locator('a[href="/finance"]');
    await target.click();
    await expect(target.getByTestId("nav-pending-hint")).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, "desktop-02-pending-mark");
    release();
  });

  test("+ Create: loading, retry and a real empty menu", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    await quickCreateStates(page, "desktop-03");
  });

  test("a module the person may not use: the denied screen", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expectAccessDenied(page, "/finance/invoices");
    await shot(page, "desktop-04-denied");
  });
});

test.describe("NAV-01 evidence, phone", () => {
  test.skip(!ENABLED, "Set NAV_EVIDENCE=1 to write the release pictures.");
  // The Pixel 7 profile without its browser choice, which a describe block cannot change.
  const pixel: Partial<(typeof devices)["Pixel 7"]> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType;
  test.use(pixel);

  test("a drawer tap: the drawer closes and the skeleton owns the wait", async ({ page }) => {
    await signIn(page, "FINANCE", { to: "/dashboard" });
    const release = await hold(page, "/finance");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").locator('a[href="/finance"]').click();
    await expect(mainRegion(page).getByTestId("page-skeleton")).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, "phone-01-loading-skeleton");
    release();
  });

  test("+ Create in the sheet: loading, retry and a real empty menu", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
    await quickCreateStates(page, "phone-02");
  });

  test("a module the person may not use: the denied screen", async ({ page }) => {
    await signIn(page, "VIEWER", { to: "/dashboard" });
    await expectAccessDenied(page, "/finance/invoices");
    await shot(page, "phone-03-denied");
  });
});

/**
 * NAV-02 release evidence (§20 item 6): the shell's optional slots while held,
 * failed and retried, over a page that is already usable. Opt-in:
 * `NAV_EVIDENCE=nav02`, against a production build started with
 * NESTO_TEST_SHELL_DELAYS=1, whose test-only hook holds or fails a slot's read
 * as the `nesto-test-shell-delay` cookie says.
 */
const SLOT_EVIDENCE = process.env.NAV_EVIDENCE === "nav02";

async function slotStates(page: Page, prefix: string) {
  const origin = new URL(page.url()).origin;
  const rules = async (value: string) => page.context().addCookies([{ name: "nesto-test-shell-delay", value, url: origin }]);
  await rules("workspaces=8000,banner=8000");
  await page.goto("/tasks", { waitUntil: "commit" });
  await expect(mainRegion(page).locator("h1").first()).toBeVisible();
  // The header is drawn from the verified core at once; only its options are pending (OW §57).
  const header = page.getByTestId("sidebar-header").getByTestId("organization-header");
  await expect(header).toHaveAttribute("data-options", "pending");
  await shot(page, `${prefix}-01-slots-pending`);
  await rules("workspaces=0:fail,banner=0:fail");
  await page.goto("/tasks");
  await expect(header).toHaveAttribute("data-options", "failed");
  await expect(page.getByTestId("critical-banner-failed")).toBeVisible();
  await header.click();
  await shot(page, `${prefix}-02-slots-failed`);
  await page.getByTestId("workspace-options-retry").click();
  await expect(page.getByTestId("workspace-option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("critical-banner-retry").click();
  await expect(header).toHaveAttribute("data-options", "ready");
  await expect(page.getByTestId("critical-banner-failed")).toHaveCount(0);
  await shot(page, `${prefix}-03-slots-retried`);
}

test.describe("NAV-02 evidence, desktop", () => {
  test.skip(!SLOT_EVIDENCE, "Set NAV_EVIDENCE=nav02 (and start the server with NESTO_TEST_SHELL_DELAYS=1).");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the chooser and the banner held, failed and retried", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await slotStates(page, "nav02-desktop");
  });
});

test.describe("NAV-02 evidence, phone", () => {
  test.skip(!SLOT_EVIDENCE, "Set NAV_EVIDENCE=nav02 (and start the server with NESTO_TEST_SHELL_DELAYS=1).");
  const pixel: Partial<(typeof devices)["Pixel 7"]> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType;
  test.use(pixel);

  test("the chooser and the banner held, failed and retried", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await slotStates(page, "nav02-phone");
  });
});
