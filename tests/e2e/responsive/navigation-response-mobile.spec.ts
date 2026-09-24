import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

/**
 * Immediate navigation response on a phone (NAV-01 N02, L06, Q24): the drawer
 * closes on an accepted tap and the shell keeps the wait visible after the
 * tapped item is gone; `+ Create` states fit the sheet.
 */

test("a drawer tap closes the drawer, and the wait stays visible in the shell (N02)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/tasks",
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await held;
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.locator('a[href="/tasks"]').click();
  await expect(drawer).toHaveCount(0);
  // The tapped item is gone with the drawer; the shell keeps the wait on screen (the bar until
  // the commit, then the destination's skeleton).
  await expect(page.getByTestId("nav-progress").or(mainRegion(page).getByTestId("page-skeleton")).first()).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId("nav-progress")).toHaveCount(0);
});

test("the loading surface fits a 320px screen without horizontal scroll (L06)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page, "FINANCE", { to: "/dashboard" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/finance",
    async (route) => {
      const headers = route.request().headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) await held;
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").locator('a[href="/finance"]').click();
  await expect(mainRegion(page).getByTestId("page-skeleton")).toBeVisible();
  const whileLoading = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(whileLoading).toBeLessThanOrEqual(0);
  release();
  await expect(page).toHaveURL(/\/finance$/);
});

test("+ Create's loading and retry states are reachable in the sheet (Q24)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  let fail = true;
  await page.route("**/api/quick-create/actions**", (route) => (fail ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
  await page.getByTestId("quick-create-button").click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel.getByTestId("quick-create-error")).toBeVisible();
  fail = false;
  await panel.getByTestId("quick-create-retry").tap();
  await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
  // The whole sheet is on screen, resting on its lower edge — not hung from the top bar.
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(Math.abs(box!.y + box!.height - viewport.height)).toBeLessThanOrEqual(1);
});
