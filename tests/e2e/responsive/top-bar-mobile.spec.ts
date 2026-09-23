import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * The top bar on a phone (Fast Re-entry §148, Quick Create §48, §181,
 * Activity Center §102-§105, §214): search, create and the bell open as
 * full-screen or bottom sheets, with the same content as on a desktop.
 */

test("search opens full screen with recent work and the link to My Work", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await page.getByTestId("mobile-search-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Search NESTO" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /View all recent work/ })).toBeVisible();
});

test("+ Create opens a bottom sheet of the actions the person may create", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  await page.getByTestId("quick-create-button").click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("quick-create-tasks.task.create")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("the bell opens the Activity Center as a full-height sheet", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await page.getByTestId("notification-bell").click();
  const panel = page.getByRole("dialog", { name: "Activity Center" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("tab", { name: "Announcements" })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
});
