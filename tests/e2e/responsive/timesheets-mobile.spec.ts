import { expect, test } from "@playwright/test";

import { db } from "../db";
import { signIn } from "../fixtures";
import { memberId, resetTimesheets } from "../timesheets-fixtures";

/**
 * Timesheets on a phone (PRD #42 §182-§188, §264): open the week, log time in
 * a few taps from the sticky bar, see it on today's card, and submit.
 */

const USERS = ["hse@nesto.test"];

test.beforeAll(async () => {
  await resetTimesheets(USERS);
});

test.afterAll(async () => {
  await resetTimesheets(USERS);
  await db.$disconnect();
});

test("quick-logs project time from the sticky bar and submits the week", async ({ page }) => {
  await signIn(page, "HSE", { to: "/timesheets" });
  const bar = page.getByTestId("timesheet-sticky-actions");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("timesheet-grid")).toBeHidden();

  await bar.getByRole("button", { name: "Log time" }).click();
  const sheet = page.getByRole("dialog", { name: "Log time" });
  await sheet.getByLabel("Project", { exact: false }).first().selectOption({ label: "PRJ-001 · Riverside Residences" });
  await sheet.getByRole("button", { name: "4h", exact: true }).click();
  await expect(sheet.getByRole("textbox", { name: "Duration" })).toHaveValue("4h");
  await sheet.getByRole("button", { name: "Log time" }).click();
  await expect(page.getByText("4h logged", { exact: true })).toBeVisible();

  const todayCard = page.getByTestId("timesheet-day").filter({ hasText: "Today" });
  await expect(todayCard).toContainText("Riverside Residences");
  await expect(todayCard).toContainText("4h");
  await expect(bar).toContainText("4h");

  await bar.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("dialog", { name: "Submit a short week?" }).getByRole("button", { name: "Submit anyway" }).click();
  await expect(page.getByTestId("timesheet-status")).toHaveText("Submitted");
  await expect(bar).toBeHidden();

  const hse = await memberId("hse@nesto.test");
  expect(await db.timesheet.count({ where: { memberId: hse, status: "SUBMITTED" } })).toBe(1);
});
