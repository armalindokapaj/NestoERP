import { expect, test, type Page } from "@playwright/test";

import { photoWithExif, removeCreatedDailyLogs } from "../daily-logs-fixtures";
import { db } from "../db";
import { signIn } from "../fixtures";

/**
 * A daily log on a phone (PRD #43 §150-§154, §272): start today's log, add the
 * workforce, a photo, the work done and a delay from the sticky bar, submit.
 */

/** East Gate Logistics Hub, Terra's, where Terra's engineer works (E-06 §45). */
const PROJECT = "project_c";

test.beforeAll(async () => {
  await removeCreatedDailyLogs([PROJECT]);
});

test.afterAll(async () => {
  await removeCreatedDailyLogs([PROJECT]);
  await db.$disconnect();
});

async function quickAdd(page: Page, section: string, fill: (sheet: ReturnType<Page["getByRole"]>) => Promise<void>) {
  await page.getByTestId("daily-log-sticky-actions").getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: section }).click();
  const sheet = page.getByRole("dialog");
  await fill(sheet);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet).toBeHidden();
}

test("records a site day from the phone and submits it", async ({ page }) => {
  await signIn(page, "ENGINEER_C", { to: `/projects/${PROJECT}/daily-logs` });
  await page.getByRole("button", { name: "Start today's log" }).click();
  await expect(page).toHaveURL(/\/daily-logs\/c[a-z0-9]+$/);
  const logId = page.url().split("/").pop()!;
  await expect(page.getByTestId("daily-log-sticky-actions")).toBeVisible();

  await quickAdd(page, "Workforce", async (sheet) => {
    await sheet.getByLabel("Company or crew").fill("Atlas Groundworks");
    await sheet.getByLabel("Headcount").fill("7");
  });
  await quickAdd(page, "Work completed", async (sheet) => {
    await sheet.getByLabel("Work done").fill("Yard drainage trench");
  });
  await quickAdd(page, "Delays", async (sheet) => {
    await sheet.getByLabel("What held work up").fill("Waiting for survey levels");
    await sheet.getByLabel("Category").selectOption({ label: "Access" });
    await sheet.getByLabel("Duration (minutes)").fill("45");
  });
  await expect(page.getByTestId("count-workforce")).toHaveText("7");

  await page.getByTestId("section-evidence").getByRole("button", { name: /Photos & documents/ }).click();
  await page.getByTestId("evidence-input").setInputFiles({ name: "trench.jpg", mimeType: "image/jpeg", buffer: photoWithExif() });
  await expect(page.getByTestId("count-photos")).toHaveText("1", { timeout: 20_000 });

  await page.getByTestId("daily-log-sticky-actions").getByRole("button", { name: "Submit log" }).click();
  await expect(page.getByTestId("daily-log-status")).toHaveText("Submitted");
  expect((await db.dailyLog.findUniqueOrThrow({ where: { id: logId } })).status).toBe("SUBMITTED");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(412);
});
