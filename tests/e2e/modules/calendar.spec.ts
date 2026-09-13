import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Calendar, desktop (PRD #39 §193): Week, Month, Day, Agenda, filters, the event
 * drawer, create, edit and dragging a Calendar-owned event.
 */

const PREFIX = "E2E calendar";
const ZONE = "Europe/Tirane";

const localDay = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

async function seededDay(id: string): Promise<string> {
  const event = await db.calendarEvent.findUniqueOrThrow({ where: { id } });
  return localDay(event.startsAt);
}

const calendar = (page: Page) => page.getByTestId("calendar");

test.afterAll(async () => {
  const events = await db.calendarEvent.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = events.map((row) => row.id);
  if (ids.length > 0) {
    await db.calendarReminder.deleteMany({ where: { eventId: { in: ids } } });
    await db.calendarEventParticipant.deleteMany({ where: { eventId: { in: ids } } });
    await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
    await db.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await db.activity.deleteMany({ where: { entityId: { in: ids } } });
    await db.calendarEvent.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
});

test("moves between Week, Month, Day and Agenda, and keeps the view in the URL", async ({ page }) => {
  const day = await seededDay("calendar_training_001");
  await signIn(page, "OWNER", { to: `/calendar?view=week&date=${day}` });

  await expect(calendar(page).getByRole("button", { name: /Working at height refresher/ }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(page.getByRole("grid", { name: "Month" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Day" }).click();
  await expect(page).toHaveURL(/view=day/);

  await page.getByRole("tab", { name: "Agenda" }).click();
  await expect(page.getByTestId("agenda").or(page.getByTestId("calendar-empty"))).toBeVisible();

  await page.getByRole("button", { name: "Go to today" }).click();
  const today = localDay(new Date());
  await expect(page).toHaveURL(new RegExp(`date=${today}`));
});

test("filters by category, and opens an event in the drawer", async ({ page }) => {
  const day = await seededDay("calendar_training_001");
  await signIn(page, "OWNER", { to: `/calendar?view=month&date=${day}` });

  const sidebar = page.getByRole("complementary", { name: "Calendar filters" });
  await expect(calendar(page).locator('[data-source="task"]').first()).toBeVisible();
  await sidebar.getByRole("checkbox", { name: "Tasks" }).click();
  await expect(calendar(page).locator('[data-source="task"]')).toHaveCount(0);

  // A busy month cell folds timed events behind "+N more"; the week grid gives
  // the training its own block.
  await page.getByRole("tab", { name: "Week" }).click();
  await calendar(page).getByRole("button", { name: /Working at height refresher/ }).first().click();
  const drawer = page.getByTestId("event-drawer");
  await expect(drawer.getByRole("heading", { name: "Working at height refresher" })).toBeVisible();
  await expect(drawer.getByText("Training room, head office")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await sidebar.getByRole("checkbox", { name: "Tasks" }).click();
  await expect(calendar(page).locator('[data-source="task"]').first()).toBeVisible();
});

test("a source event opens its own record, never an edit", async ({ page }) => {
  await signIn(page, "OWNER", { to: `/calendar?view=month` });
  const task = calendar(page).locator('[data-source="task"]').first();
  await expect(task).toBeVisible();
  await task.click();
  const drawer = page.getByTestId("event-drawer");
  await expect(drawer.getByRole("link", { name: /Open task/ })).toHaveAttribute("href", /^\/tasks\//);
  await expect(drawer.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("creates, edits and drags a personal event", async ({ page }) => {
  const today = localDay(new Date());
  await signIn(page, "ENGINEER", { to: `/calendar?view=week&date=${today}` });

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Personal event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Title").fill(`${PREFIX} site walk`);
  await form.getByLabel("Date").fill(today);
  await form.getByLabel("Start").fill("11:00");
  await form.getByLabel("End").fill("12:00");
  await form.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText("Event created", { exact: true })).toBeVisible();

  const card = calendar(page).getByRole("button", { name: new RegExp(`${PREFIX} site walk`) }).first();
  await expect(card).toBeVisible();
  const created = await db.calendarEvent.findFirstOrThrow({ where: { title: `${PREFIX} site walk` } });
  expect(created.visibility).toBe("PRIVATE");

  // Edit from the drawer.
  await card.click();
  await page.getByTestId("event-drawer").getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill(`${PREFIX} site walk (moved)`);
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Event updated", { exact: true })).toBeVisible();

  // Drag it down one hour on the week grid.
  const block = calendar(page).getByRole("button", { name: new RegExp(`${PREFIX} site walk \\(moved\\)`) }).first();
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 24, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + 48, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText("Event moved", { exact: true })).toBeVisible();

  const moved = await db.calendarEvent.findFirstOrThrow({ where: { id: created.id } });
  expect(moved.startsAt.getTime() - created.startsAt.getTime()).toBe(60 * 60_000);
});

test("keeps a private event to the engineer who made it", async ({ page }) => {
  const day = await seededDay("calendar_personal_001");
  await signIn(page, "ENGINEER", { to: `/calendar?view=agenda&date=${day}` });
  await expect(mainRegion(page).getByRole("button", { name: /Dentist appointment/ })).toBeVisible();
});

test("does not show the engineer's private event to their project manager", async ({ page }) => {
  const day = await seededDay("calendar_personal_001");
  await signIn(page, "PROJECT_MANAGER", { to: `/calendar?view=agenda&date=${day}` });
  await expect(mainRegion(page).getByRole("button", { name: /Riverside coordination meeting|Working at height/ }).first().or(page.getByTestId("calendar-empty"))).toBeVisible();
  await expect(mainRegion(page).getByRole("button", { name: /Dentist appointment/ })).toHaveCount(0);
});

test("offers the Viewer no way to create", async ({ page }) => {
  await signIn(page, "VIEWER", { to: "/calendar?view=week" });
  await expect(page.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
});

test("a link to an event opens it", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/calendar?event=calendar_training_001" });
  await expect(page.getByTestId("event-drawer").getByRole("heading", { name: "Working at height refresher" })).toBeVisible();
});

test("a project's calendar tab reads the same schedule", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/calendar" });
  await expect(page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Project schedule" })).toBeVisible();
});
