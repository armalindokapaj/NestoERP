import { expect, test, type Locator } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * The top bar on a phone (Fast Re-entry §148, Quick Create §48, §181,
 * Activity Center §102-§105, §214): search opens full screen; create and the
 * bell, which live in the bottom bar, open as bubbles of glass above it with
 * a pointer on the button pressed — all with the same content as on a desktop.
 */

/** Above the bar and whole on screen, the pointer under the panel aimed at the middle of its button. */
async function expectBubbleOver(panel: Locator, control: Locator) {
  const pointer = panel.locator('.nesto-panel-pointer[data-side="below"]');
  await expect(pointer).toBeVisible();
  const [button, bubble, tail] = [(await control.boundingBox())!, (await panel.boundingBox())!, (await pointer.boundingBox())!];
  const viewport = panel.page().viewportSize()!;
  expect(bubble.x).toBeGreaterThanOrEqual(0);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(viewport.width);
  expect(bubble.y).toBeGreaterThanOrEqual(0);
  expect(bubble.y + bubble.height).toBeLessThanOrEqual(button.y + 1);
  expect(Math.abs(tail.x + tail.width / 2 - (button.x + button.width / 2))).toBeLessThanOrEqual(2);
}

test("search opens full screen with recent work and the link to My Work", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await page.getByTestId("search-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Search NESTO" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /View all recent work/ })).toBeVisible();
  // Under 640px the panel is the whole screen, once it has travelled out of its icon.
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
});

test("+ Create opens a bubble of the actions the person may create, and closes from the same button", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  const create = page.getByTestId("mobile-create");
  await create.click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
  await expectBubbleOver(panel, create);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The bar's button toggles: pressed while its panel is open, it closes it.
  await create.click();
  await expect(panel).toBeVisible();
  await create.click();
  await expect(panel).toHaveCount(0);
});

test("the bell opens the Activity Center as a bubble above the bar, with All alerts", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  // A phone's bell is the bottom bar's.
  const bell = page.getByRole("navigation", { name: "Primary" }).getByTestId("notification-bell");
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Activity Center" });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-placement", "bar");
  await expect(panel.getByRole("tab", { name: "Announcements" })).toBeVisible();
  await expectBubbleOver(panel, bell);
  // The way to the whole Activity Center, as the popup names it.
  const all = panel.getByTestId("activity-view-all");
  await expect(all).toHaveText("All alerts");
  await expect(all).toHaveAttribute("href", "/activity");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
});
