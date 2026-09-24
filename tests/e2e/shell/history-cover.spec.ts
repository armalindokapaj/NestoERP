import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * The workspace boundary on history restores (NAV-03 PREFETCH-06, F12). A page
 * leaving is covered, so the copy a browser keeps for Back and Forward comes
 * back covered, and a restored copy reloads instead of being shown.
 *
 * Automated Chromium keeps no back/forward cache, so the browser's own events
 * are dispatched here: the handlers are what is under test.
 */

test("a page leaving is covered; a copy restored from history reloads instead of being shown (F12)", async ({ page }) => {
  // Tasks keeps its URL as it loads (Calendar rewrites its own, which would race the events).
  await signIn(page, "OWNER", { to: "/tasks" });
  await page.waitForLoadState("networkidle");
  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-nesto-covered", /.*/);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(root).toHaveAttribute("data-nesto-covered", "");
  // Covered means nothing of the page is shown.
  expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe("hidden");

  // A restore from the back/forward cache: a plain document load, which reads the session's workspace.
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await reloaded;
  await expect(page.locator("#nesto-main h1").first()).toBeVisible();
  await expect(root).not.toHaveAttribute("data-nesto-covered", /.*/);
});

test("an ordinary pageshow uncovers without reloading", async ({ page }) => {
  // Tasks keeps its URL as it loads (Calendar rewrites its own, which would race the events).
  await signIn(page, "OWNER", { to: "/tasks" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect(page.locator("html")).toHaveAttribute("data-nesto-covered", "");
  let loads = 0;
  page.on("load", () => (loads += 1));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  await expect(page.locator("html")).not.toHaveAttribute("data-nesto-covered", /.*/);
  await page.waitForTimeout(500);
  expect(loads).toBe(0);
});
