import { expect, test, type Browser, type Page } from "@playwright/test";

import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { runAnnouncementSchedule } from "@/lib/modules/announcements/announcement.publish";
import { ANNOUNCEMENT_SEED, memberIdFor, resetAnnouncements } from "../announcements-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Announcements, favorites and recent work, desktop (PRD #45 §321-§326): the
 * Owner publishes to the company and the Engineer reads it; HR asks the
 * company to acknowledge a policy and sees who has; the Project Manager speaks
 * to a project and only its people hear; an Admin's schedule goes out through
 * the worker; a favorite follows access; recent work keeps its order.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetAnnouncements();
});

test.afterAll(async () => {
  await resetAnnouncements();
  await db.$disconnect();
});

const card = (page: Page, title: string) => page.getByTestId("announcement-card").filter({ hasText: title });

/** Another person, in a browser context of their own. */
async function as(browser: Browser, role: Parameters<typeof signIn>[1], to: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, role, { to });
  return page;
}

async function write(page: Page, title: string, body: string) {
  await mainRegion(page).getByRole("link", { name: "New announcement", exact: true }).click();
  await expect(page).toHaveURL(/\/announcements\/new/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Body").fill(body);
}

test("the Owner drafts and publishes a company announcement, and the Engineer reads it (§321)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/announcements" });
  await write(page, "New site canteen opens Monday", "The **new canteen** opens on Monday at the Riverside compound.\n\n- Breakfast from 06:30\n- Lunch from 12:00");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/announcements\/c[a-z0-9]+$/);
  await expect(page.getByTestId("announcement-manage").getByTestId("announcement-status")).toHaveText("Draft");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByTestId("announcement-manage").getByTestId("announcement-status")).toHaveText("Published");
  await expect(page.getByTestId("announcement-body").getByRole("listitem")).toHaveCount(2);
});

test("the Engineer sees it unread, opens it, and it is read (§321)", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/announcements" });
  const item = card(page, "New site canteen opens Monday");
  await expect(item).toBeVisible();
  await expect(item.getByLabel("Unread")).toBeVisible();
  await expect(page.getByTestId("announcements-unread-dot")).toBeVisible();
  await item.click();
  await expect(page.getByTestId("announcement-title")).toHaveText("New site canteen opens Monday");
  await expect(page.getByTestId("announcement-manage")).toHaveCount(0);
  await expect.poll(async () => db.announcementRead.count({ where: { memberId: await memberIdFor("engineer@nesto.test"), announcement: { title: "New site canteen opens Monday" } } })).toBe(1);
  await page.goto("/announcements");
  await expect(card(page, "New site canteen opens Monday").getByLabel("Unread")).toHaveCount(0);
});

test("HR asks the company to acknowledge a policy; the Engineer acknowledges and HR sees it (§322)", async ({ page, browser }) => {
  await signIn(page, "HR", { to: "/announcements" });
  await write(page, "Hot works permit policy", "## Summary\n\nEvery hot work needs a permit issued the same day.\n\nPlease acknowledge below.");
  await page.locator("label").filter({ hasText: /^Important$/ }).click();
  await page.getByRole("button", { name: "Dates, pinning and acknowledgment" }).click();
  await page.getByRole("checkbox", { name: "Ask readers to acknowledge" }).click();
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByTestId("announcement-title")).toHaveText("Hot works permit policy");
  await reconcileAttention({ companyId: "company_demo_a" });

  const engineer = await as(browser, "ENGINEER", "/notifications?tab=attention");
  await expect(engineer.getByTestId("attention-item").filter({ hasText: "Acknowledge: Hot works permit policy" })).toBeVisible();
  await engineer.goto("/announcements?tab=acknowledge");
  await card(engineer, "Hot works permit policy").click();
  await engineer.getByTestId("announcement-acknowledgment").getByRole("button", { name: "I have read this" }).click();
  await expect(engineer.getByTestId("announcement-acknowledgment")).toContainText("Acknowledged •");
  await engineer.goto("/notifications?tab=attention");
  await expect(engineer.getByTestId("attention-item").filter({ hasText: "Acknowledge: Hot works permit policy" })).toHaveCount(0);
  await engineer.close();

  await page.reload();
  await expect(page.getByTestId("announcement-metrics").getByTestId("metric-acknowledged")).toHaveText("1");
  await page.getByTestId("announcement-metrics").getByRole("button", { name: /^Acknowledged/ }).click();
  await expect(page.getByTestId("announcement-metrics")).toContainText("Ethan Cole");
});

test("the Project Manager announces to Riverside; its people see it and others do not (§323)", async ({ page, browser }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  await mainRegion(page).getByRole("link", { name: "Announce" }).click();
  await expect(page).toHaveURL(/\/announcements\/new\?projectId=project_a/);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("project_a");
  await page.getByLabel("Title").fill("Concrete pour on Block C tomorrow");
  await page.getByLabel("Body").fill("Expect mixer trucks at the east gate from 06:00.");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByTestId("announcement-scope")).toHaveText("Project · Riverside Residences");
  const url = page.url();

  const engineer = await as(browser, "ENGINEER", "/announcements");
  await expect(card(engineer, "Concrete pour on Block C tomorrow")).toBeVisible();
  await engineer.close();
  const inventory = await as(browser, "INVENTORY", "/announcements");
  await expect(inventory.getByTestId("announcement-feed")).toBeVisible();
  await expect(card(inventory, "Concrete pour on Block C tomorrow")).toHaveCount(0);
  await inventory.goto(url);
  await expect(inventory.getByText("404")).toBeVisible();
  await inventory.close();
});

test("an Admin schedules a notice; the worker publishes it and the audience is told (§324)", async ({ page, browser }) => {
  await signIn(page, "ADMIN", { to: "/announcements" });
  await write(page, "Network maintenance on Saturday", "Email and NESTO may be slow on Saturday morning.");
  await page.locator("label").filter({ hasText: /^Important$/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/announcements\/c[a-z0-9]+$/);
  const inAnHour = new Date(Date.now() + 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  await page.getByLabel("Schedule for").fill(`${inAnHour.getFullYear()}-${pad(inAnHour.getMonth() + 1)}-${pad(inAnHour.getDate())}T${pad(inAnHour.getHours())}:${pad(inAnHour.getMinutes())}`);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByTestId("announcement-manage").getByTestId("announcement-status")).toHaveText("Scheduled");

  const scheduled = await db.announcement.findFirstOrThrow({ where: { title: "Network maintenance on Saturday" } });
  expect(scheduled.status).toBe("SCHEDULED");
  await runAnnouncementSchedule(new Date(Date.now() + 2 * 60 * 60_000));
  expect((await db.announcement.findUniqueOrThrow({ where: { id: scheduled.id } })).status).toBe("PUBLISHED");
  expect(await db.notificationEventOutbox.count({ where: { entityId: scheduled.id, eventType: "ANNOUNCEMENT_PUBLISHED" } })).toBe(1);

  const engineer = await as(browser, "ENGINEER", "/announcements");
  await expect(card(engineer, "Network maintenance on Saturday")).toBeVisible();
  await engineer.close();
});

test("a favorite shows on the dashboard and in the palette, and disappears with access (§325)", async ({ page }) => {
  const engineer = await memberIdFor("engineer@nesto.test");
  try {
    await signIn(page, "ENGINEER", { to: "/projects/project_d" });
    // Leave only once the star is saved: the click is optimistic.
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/favorites") && response.request().method() === "POST");
    await mainRegion(page).getByTestId("favorite-button").click();
    expect((await saved).ok()).toBe(true);
    await expect(mainRegion(page).getByTestId("favorite-button")).toHaveAttribute("aria-pressed", "true");

    await page.goto("/dashboard");
    const widget = mainRegion(page).getByRole("region", { name: "Favorites" });
    await expect(widget).toContainText("Logistics Hub");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("palette-favorites")).toContainText("Logistics Hub");
    await page.keyboard.press("Escape");

    await db.projectMember.updateMany({ where: { projectId: "project_d", companyMemberId: engineer }, data: { status: "INACTIVE" } });
    await db.companyMember.update({ where: { id: engineer }, data: { accessVersion: { increment: 1 } } });
    await page.reload();
    await expect(mainRegion(page).getByRole("region", { name: "Favorites" })).not.toContainText("Logistics Hub");
  } finally {
    await db.projectMember.updateMany({ where: { projectId: "project_d", companyMemberId: engineer }, data: { status: "ACTIVE" } });
    await db.userFavorite.deleteMany({ where: { memberId: engineer, entityType: "project", entityId: "project_d" } });
  }
});

test("recent work puts the last record opened first (§326)", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/tasks/task_006" });
  await expect(mainRegion(page).getByTestId("favorite-button")).toBeVisible();
  await page.goto("/favorites?tab=recent");
  await expect(page.getByTestId("recent-row").first()).toContainText("Review structural detail S-204");

  await page.goto(`/projects/project_a/planning?milestone=milestone_riverside_facade`);
  await expect(page.getByTestId("milestone-drawer").getByTestId("drawer-milestone-name")).toHaveText("Façade Complete");
  await expect.poll(async () => db.recentItem.count({ where: { memberId: await memberIdFor("engineer@nesto.test"), entityId: "milestone_riverside_facade" } })).toBe(1);
  await page.goto("/favorites?tab=recent");
  await expect(page.getByTestId("recent-row").first()).toContainText("Façade Complete");
  expect(ANNOUNCEMENT_SEED.company).toBeTruthy();
});
