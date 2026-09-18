import { expect, test } from "@playwright/test";

import { db } from "../db";
import { signIn } from "../fixtures";

/**
 * Calendar on a phone (PRD #39 §28, §192): Agenda first, date change, the filter
 * sheet, opening an event and creating a personal event.
 */

const PREFIX = "E2E mobile calendar";

test.afterAll(async () => {
  const events = await db.calendarEvent.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = events.map((row) => row.id);
  if (ids.length > 0) {
    await db.calendarReminder.deleteMany({ where: { eventId: { in: ids } } });
    await db.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await db.calendarEvent.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
});

test("opens on Agenda, filters in a sheet, opens an event and creates one", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/calendar" });

  await expect(page.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("agenda").or(page.getByTestId("calendar-empty"))).toBeVisible();

  await page.getByRole("button", { name: "Next period" }).click();
  await expect(page).toHaveURL(/date=/);
  await page.getByRole("button", { name: "Go to today" }).click();

  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("switch", { name: "My calendar" })).toBeVisible();
  await sheet.getByRole("switch", { name: "My calendar" }).click();
  await page.keyboard.press("Escape");

  const first = page.getByTestId("agenda").getByTestId("calendar-event").first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByTestId("event-drawer")).toBeVisible();
    await page.getByTestId("event-drawer").getByRole("button", { name: "Close" }).click();
  }

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("menuitem", { name: "Personal event" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Title").fill(`${PREFIX} pick up drawings`);
  await form.getByLabel("Start").fill("08:30");
  await form.getByLabel("End").fill("09:00");
  await form.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText("Event created", { exact: true })).toBeVisible();

  // Back on the agenda, with nothing lost: no horizontal scroll either.
  await expect(page.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
