import { expect, test, type Locator } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * The top bar on a phone (Fast Re-entry §148, Quick Create §48, §181,
 * Activity Center §102-§105, §214): search opens full screen; New, in the
 * phone's bar at the bottom, opens Quick Create as a sheet of glass standing
 * on the bar; the bell is not drawn — Inbox, beside search, is its place —
 * with the same content as on a desktop.
 */

/** Standing on the bar, across the screen and whole on it. */
async function expectSheetOnBar(panel: Locator, bar: Locator) {
  await panel.evaluate((element) => Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined));
  const [cells, sheet] = [(await bar.boundingBox())!, (await panel.boundingBox())!];
  const viewport = panel.page().viewportSize()!;
  expect(sheet.x).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(viewport.width);
  expect(sheet.y).toBeGreaterThanOrEqual(0);
  expect(Math.abs(sheet.y + sheet.height - cells.y)).toBeLessThanOrEqual(2);
}

test("search opens full screen with recent work and the link to My Work", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await page.getByTestId("search-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Search NESTO" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /View all recent work/ })).toBeVisible();
  // Under 640px the palette is the whole screen (docs/ui/UI-08-search.md).
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
});

test("New opens a sheet of the actions the person may create, and closes from the same button", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  const create = page.getByTestId("phone-create");
  await create.click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("quick-create-field-tasks.task.create")).toBeVisible();
  await expectSheetOnBar(panel, page.getByTestId("phone-navigation"));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The bar's button toggles: pressed while its panel is open, it closes it.
  await create.click();
  await expect(panel).toBeVisible();
  await create.click();
  await expect(panel).toHaveCount(0);
});

test("the bell's place is Inbox, beside search: it opens the alerts with the way to all activity", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await expect(page.getByTestId("global-actions").getByTestId("notification-bell")).toBeHidden();
  await page.locator("header[data-shell-region]").getByTestId("phone-inbox").click();
  const inbox = page.getByTestId("inbox");
  await expect(inbox).toBeVisible();
  await inbox.getByTestId("inbox-everything").click();
  await expect(inbox.getByRole("link", { name: /all activity/i })).toHaveAttribute("href", "/activity");
});
