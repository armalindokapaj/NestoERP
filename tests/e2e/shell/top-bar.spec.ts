import { expect, test } from "@playwright/test";

import { memberIdFor } from "../announcements-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The top bar's three personal surfaces, desktop: search home and My Work
 * (Fast Re-entry §200-§205, §218, §222), `+ Create` (Quick Create §166, §171,
 * §182, §183) and the Activity Center bell (Activity Center §195-§200, §212-§215).
 */

test.describe.configure({ mode: "serial" });

test("an empty search shows favorites and recent work; typing shows search results only", async ({ page }) => {
  const engineer = await memberIdFor("engineer@nesto.test");
  await db.recentItem.deleteMany({ where: { memberId: engineer } });
  try {
    await signIn(page, "ENGINEER", { to: "/tasks/task_006" });
    await expect(mainRegion(page).getByTestId("favorite-button")).toHaveAttribute("aria-label", /favorites/);
    await expect.poll(() => db.recentItem.count({ where: { memberId: engineer, entityId: "task_006" } })).toBe(1);

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search NESTO" });
    await expect(dialog.getByTestId("palette-recent")).toContainText("Review structural detail S-204");
    await expect(dialog.getByRole("link", { name: /View all recent work/ })).toBeVisible();

    await dialog.getByRole("combobox").fill("Riverside");
    await expect(dialog.getByTestId("palette-recent")).toHaveCount(0);
    await expect(dialog.getByRole("listbox")).toContainText("Riverside");

    await dialog.getByRole("combobox").fill("");
    await dialog.getByRole("link", { name: /View all recent work/ }).click();
    await expect(page).toHaveURL(/\/my-work\?tab=recent/);
    await expect(page.getByTestId("recent-row").first()).toContainText("Review structural detail S-204");
  } finally {
    await db.recentItem.deleteMany({ where: { memberId: engineer } });
  }
});

test("My Work clears recent work only after confirmation, and keeps favorites", async ({ page }) => {
  const engineer = await memberIdFor("engineer@nesto.test");
  await db.recentItem.upsert({ where: { memberId_entityType_entityId: { memberId: engineer, entityType: "task", entityId: "task_006" } }, create: { companyId: "company_demo_a", memberId: engineer, entityType: "task", entityId: "task_006", lastAccessedAt: new Date() }, update: {} });
  const favorites = await db.userFavorite.count({ where: { memberId: engineer } });
  await signIn(page, "ENGINEER", { to: "/my-work?tab=recent" });
  await page.getByTestId("clear-recent-work").click();
  const confirm = page.getByRole("dialog", { name: "Clear recent work?" });
  await confirm.getByRole("button", { name: "Clear recent work" }).click();
  await expect(page.getByTestId("recent-row")).toHaveCount(0);
  expect(await db.recentItem.count({ where: { memberId: engineer } })).toBe(0);
  expect(await db.userFavorite.count({ where: { memberId: engineer } })).toBe(favorites);
  // The old favorites page lands here (§49, §50).
  await page.goto("/favorites");
  await expect(page).toHaveURL(/\/my-work\?tab=favorites/);
});

test("+ Create opens the module's own create page, with the project from the page it was opened on", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  await page.getByTestId("quick-create-button").click();
  const panel = page.getByTestId("quick-create-panel");
  await expect(panel.getByTestId("quick-create-context")).toContainText("Riverside Residences");
  await panel.getByTestId("quick-create-tasks.task.create").click();
  await expect(page).toHaveURL(/\/tasks\/new\?projectId=project_a$/);
  await expect(page.getByRole("heading", { level: 1, name: "New task" })).toBeVisible();
});

test("+ Create offers Finance an invoice, and a viewer with nothing to create sees no button", async ({ page, browser }) => {
  await signIn(page, "FINANCE", { to: "/dashboard" });
  await page.getByTestId("quick-create-button").click();
  await page.getByTestId("quick-create-finance.invoice.create").click();
  await expect(page).toHaveURL(/\/finance\/invoices\/new$/);

  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, "VIEWER", { to: "/dashboard" });
  await expect(viewer.getByTestId("notification-bell")).toBeVisible();
  await expect(viewer.getByTestId("quick-create-button")).toHaveCount(0);
  await viewer.close();
});

test("the bell opens the Activity Center without reading anything, and View all opens /activity", async ({ page }) => {
  const engineer = await memberIdFor("engineer@nesto.test");
  const row = await db.notification.create({
    data: { companyId: "company_demo_a", recipientMemberId: engineer, eventType: "TASK_ASSIGNED", moduleKey: "tasks", title: "E2E activity: pour check", dedupeKey: `e2e-activity-${Date.now()}`, entityType: "task", entityId: "task_006" },
  });
  try {
    await signIn(page, "ENGINEER", { to: "/dashboard" });
    await expect(page.getByTestId("notification-badge")).toBeVisible();
    await page.getByTestId("notification-bell").click();
    const panel = page.getByRole("dialog", { name: "Activity Center" });
    await expect(panel.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    const item = panel.getByTestId("activity-item").filter({ hasText: "E2E activity: pour check" });
    await expect(item).toHaveAttribute("data-read", "UNREAD");
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readState).toBe("UNREAD");

    await panel.getByTestId("activity-tab-announcement").click();
    await expect(panel.getByTestId("activity-item").filter({ hasText: "E2E activity: pour check" })).toHaveCount(0);
    await panel.getByTestId("activity-tab-all").click();

    await item.getByRole("button").first().click();
    await page.waitForURL(/\/tasks\/task_006$/);
    await expect.poll(async () => (await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readState).toBe("READ");

    await page.getByTestId("notification-bell").click();
    await page.getByTestId("activity-view-all").click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { level: 1, name: "Activity Center" })).toBeVisible();
  } finally {
    await db.notification.delete({ where: { id: row.id } });
  }
});

test("Announcements is no longer a sidebar item; its reader page lands in the Activity Center", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  await expect(page.getByRole("navigation", { name: /main navigation/i }).getByRole("link", { name: "Announcements", exact: true })).toHaveCount(0);
  await page.goto("/announcements");
  await expect(page).toHaveURL(/\/activity\?type=announcements/);
});
