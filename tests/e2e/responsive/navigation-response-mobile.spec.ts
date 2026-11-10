import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

/**
 * Immediate navigation response on a phone (NAV-01 N02, L06, Q24): the drawer
 * closes on an accepted tap and the shell keeps the wait visible after the
 * tapped item is gone; `+ Create` states fit its panel.
 */

test("a bottom-bar tap keeps the shell, and the wait stays visible in it (N02)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/projects",
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await held;
      await route.continue();
    },
  );
  // Projects is a tile under the phone Ribbon's Work tab, prepared only on deliberate intent, so a tap
  // fetches it then. The bar stays, and the shell keeps the wait on screen (the progress bar until the
  // commit, then the destination's skeleton).
  const bar = page.locator("[data-mobile-bottom-nav]");
  await bar.getByTestId("phone-tab-work").click();
  await page.getByTestId("phone-module-projects").click();
  await expect(page.getByTestId("phone-panel")).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("nav-progress").or(mainRegion(page).getByTestId("page-skeleton")).first()).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("nav-progress")).toHaveCount(0);
});

test("the loading surface fits a 320px screen without horizontal scroll (L06)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page, "FINANCE", { to: "/dashboard" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  // Calendar keeps its default prefetch; the five approved module links are prepared only on
  // deliberate intent, and a tap is not intent (NAV-03 PREFETCH-03), so their skeleton does not
  // precede the response.
  await page.route(
    (url) => url.pathname === "/calendar",
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await held;
      await route.continue();
    },
  );
  await page.getByTestId("phone-tab-primary").click();
  await page.waitForTimeout(800); // the panel's default prefetch brings the boundary
  await page.getByTestId("phone-panel").locator('a[href="/calendar"]').click();
  await expect(mainRegion(page).getByTestId("page-skeleton")).toBeVisible();
  const whileLoading = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(whileLoading).toBeLessThanOrEqual(0);
  release();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("+ Create's loading and retry states are reachable in its panel (Q24)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  let fail = true;
  await page.route("**/api/quick-create/actions**", (route) => (fail ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
  const create = page.getByTestId("phone-create");
  await create.click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel.getByTestId("quick-create-error")).toBeVisible();
  fail = false;
  await panel.getByTestId("quick-create-retry").tap();
  await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
  // The whole panel is on screen, a bubble floating just above the phone Ribbon's Create — not hung from the top bar.
  const box = await panel.boundingBox();
  const button = await create.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  // Between the two: the pointer's 12px and a breath of room, no more.
  const gap = button!.y - (box!.y + box!.height);
  expect(gap).toBeGreaterThanOrEqual(-1);
  expect(gap).toBeLessThanOrEqual(40);
});
