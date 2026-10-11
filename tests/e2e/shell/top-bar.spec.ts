import { expect, test, type Locator } from "@playwright/test";

import { memberIdFor } from "../announcements-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The top bar's three personal surfaces, desktop: search home and My Work
 * (Fast Re-entry §200-§205, §218, §222), `+ Create` (Quick Create §166, §171,
 * §182, §183) and the Activity Center bell (Activity Center §195-§200, §212-§215).
 * And where their panels open: every one starts on the breadcrumb bar's top
 * line (lib/layout/topbar-line.ts).
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
  // Scoped: the page streams in behind its loading boundary, briefly in two copies (NAV-01).
  await mainRegion(page).getByTestId("clear-recent-work").click();
  const confirm = page.getByRole("dialog", { name: "Clear recent work?" });
  await confirm.getByRole("button", { name: "Clear recent work" }).click();
  await expect(mainRegion(page).getByTestId("recent-row")).toHaveCount(0);
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
  // The top bar's bell: until the page knows its width the phone bar's bell is in the document too (components/layout/activity-bell.tsx).
  await expect(viewer.getByTestId("global-actions").getByTestId("notification-bell")).toBeVisible();
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

test("every panel opened from the top bar starts on the breadcrumb bar's top line; search is a centred third of the page", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/tasks" });
  await expect(mainRegion(page).locator("h1").first()).toBeVisible();
  const bar = page.locator("[data-shell-breadcrumb]");
  // The line, and the content box panels line up with: the breadcrumb bar's, inside its gutters.
  const { line, left, right } = await bar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { line: rect.top, left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
  });
  expect(line).toBe(64);
  /** Where a panel rests: placed a frame after it mounts, and search travels out of its icon first. */
  const placed = async (panel: Locator) => {
    await expect(panel).toBeVisible();
    await panel.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
    await expect(async () => expect(Math.abs((await panel.boundingBox())!.y - line)).toBeLessThanOrEqual(1)).toPass({ timeout: 5_000 });
    return (await panel.boundingBox())!;
  };

  // + Create opens below its button and to the right of it, never back under the sidebar.
  const create = page.getByTestId("quick-create-button");
  await create.click();
  const menu = await placed(page.getByTestId("quick-create-panel"));
  expect(Math.abs(menu.x - (await create.boundingBox())!.x)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("quick-create-panel")).toHaveCount(0);

  // Search: a third of the content's width, never under 352px, in the middle of it; the page stays in view around it.
  await page.getByTestId("search-trigger").click();
  const search = await placed(page.getByRole("dialog", { name: "Search NESTO" }));
  expect(Math.abs(search.width - Math.max((right - left) / 3, 352))).toBeLessThanOrEqual(1);
  expect(Math.abs(search.x + search.width / 2 - (left + right) / 2)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search NESTO" })).toHaveCount(0);

  // The bell and the account: the same line; the Activity Center's right edge is the content's.
  for (const [trigger, panel] of [["notification-bell", "activity-panel"], ["account-trigger", "account-panel"]] as const) {
    await page.getByTestId("global-actions").getByTestId(trigger).click();
    const box = await placed(page.getByTestId(panel));
    if (panel === "activity-panel") expect(Math.abs(box.x + box.width - right)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(panel)).toHaveCount(0);
  }
});
