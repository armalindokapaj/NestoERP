import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "../pw";

import { photoWithExif, removeCreatedDailyLogs } from "../daily-logs-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Construction daily logs, desktop (PRD #43 §269-§271): an engineer records the
 * day on site and submits it; the project manager is told, returns it, sees it
 * corrected, reviews and locks it; and an official correction is added beside
 * the locked record without changing it.
 */

const PROJECT = "project_a";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await removeCreatedDailyLogs([PROJECT]);
});

test.afterAll(async () => {
  await removeCreatedDailyLogs([PROJECT]);
  await db.$disconnect();
});

const workspace = (page: Page) => page.getByTestId("daily-log-workspace");
let logId = "";

async function addEntry(page: Page, section: string, fill: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) {
  await workspace(page).getByRole("button", { name: `Add ${section}` }).click();
  const dialog = page.getByRole("dialog");
  await fill(dialog);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("an engineer records the day on site and submits it (§269)", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: `/projects/${PROJECT}/daily-logs` });
  await mainRegion(page).getByRole("button", { name: "Start today's log" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/daily-logs/c[a-z0-9]+$`));
  logId = page.url().split("/").pop()!;
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Draft");

  await workspace(page).getByTestId("overview-summary").fill("Level 4 column pour and façade scaffold.");
  await workspace(page).getByTestId("overview-summary").blur();
  await expect(page.getByTestId("save-indicator")).toHaveText("Saved");

  await addEntry(page, "weather", async (dialog) => {
    await dialog.getByLabel("Observed at").fill("07:00");
    await dialog.getByLabel("Condition").selectOption({ label: "Cloudy" });
    await dialog.getByLabel("Temperature (°C)").fill("18");
  });
  await addEntry(page, "workforce", async (dialog) => {
    await dialog.getByLabel("Company or crew").fill("Alba Concrete");
    await dialog.getByLabel("Trade").fill("Concrete");
    await dialog.getByLabel("Headcount").fill("11");
  });
  await addEntry(page, "work completed", async (dialog) => {
    await dialog.getByLabel("Work done").fill("Level 4 column pour");
    await dialog.getByLabel("Area").fill("Block B");
    await dialog.getByLabel("Progress today (%)").fill("50");
  });
  await addEntry(page, "deliveries", async (dialog) => {
    await dialog.getByLabel("What arrived").fill("Ready-mix C30/37");
    await dialog.getByLabel("Quantity", { exact: true }).fill("48 m³");
  });
  await addEntry(page, "delays", async (dialog) => {
    await dialog.getByLabel("What held work up").fill("Pump arrived late");
    await dialog.getByLabel("Category").selectOption({ label: "Equipment" });
    await dialog.getByLabel("From", { exact: true }).fill("08:00");
    await dialog.getByLabel("To", { exact: true }).fill("09:30");
  });
  await expect(workspace(page).getByTestId("workforce-total")).toHaveText("11");
  await expect(workspace(page).getByTestId("delay-entry")).toContainText("1h 30m");

  // A photo, with its location data removed before it leaves the browser.
  await workspace(page).getByTestId("evidence-input").setInputFiles({ name: "column-pour.jpg", mimeType: "image/jpeg", buffer: photoWithExif() });
  await expect(workspace(page).getByTestId("count-photos")).toHaveText("1", { timeout: 20_000 });
  const photo = await db.document.findFirstOrThrow({ where: { entityType: "daily_log", entityId: logId }, select: { sizeBytes: true, storageStatus: true } });
  expect(photo.storageStatus).toBe("AVAILABLE");
  expect(Number(photo.sizeBytes)).toBeLessThan(photoWithExif().length);

  // A follow-up task through Tasks.
  await workspace(page).getByTestId("section-tasks").getByRole("button", { name: "Create" }).click();
  const taskDialog = page.getByRole("dialog", { name: "Create a follow-up task" });
  await taskDialog.getByLabel("Task title").fill("Book the pump for the level 5 pour");
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(workspace(page).getByTestId("linked-task")).toContainText("Book the pump for the level 5 pour");

  await workspace(page).getByRole("button", { name: "Submit", exact: true }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Submitted");
  await expect(workspace(page).getByRole("button", { name: "Add workforce" })).toHaveCount(0);
  expect(await db.notificationEventOutbox.count({ where: { entityId: logId, eventType: "DAILY_LOG_SUBMITTED" } })).toBe(1);
});

test("the project manager is told, returns it, and reviews and locks the corrected log (§270)", async ({ page, browser }) => {
  expect(logId).not.toBe("");
  execFileSync("npx", ["tsx", "scripts/notifications.ts", "--limit=500"], { stdio: "pipe", env: process.env, timeout: 120_000 });
  expect(await db.notification.count({ where: { entityId: logId, eventType: "DAILY_LOG_SUBMITTED", recipientMemberId: "member_pm" } })).toBe(1);

  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${PROJECT}/daily-logs/${logId}` });
  await workspace(page).getByRole("button", { name: "Return" }).click();
  const dialog = page.getByRole("dialog", { name: "Return for correction?" });
  await dialog.getByRole("button", { name: "Return" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give a reason.");
  await dialog.getByLabel("What needs correcting").fill("Add the pump crew to the workforce.");
  await dialog.getByRole("button", { name: "Return" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Correction required");

  const engineerContext = await browser.newContext();
  const engineer = await engineerContext.newPage();
  await signIn(engineer, "ENGINEER", { to: `/projects/${PROJECT}/daily-logs/${logId}` });
  // Scoped to the main region: the list streams, and for a moment React's parked copy is in the document too (see mainRegion).
  await expect(mainRegion(engineer).getByTestId("daily-log-banner")).toContainText("Add the pump crew to the workforce.");
  await addEntry(engineer, "workforce", async (entry) => {
    await entry.getByLabel("Company or crew").fill("Alba pump crew");
    await entry.getByLabel("Headcount").fill("2");
  });
  await expect(engineer.getByTestId("workforce-total")).toHaveText("13");
  await workspace(engineer).getByRole("button", { name: "Submit", exact: true }).click();
  await expect(workspace(engineer).getByTestId("daily-log-status")).toHaveText("Submitted");
  await engineerContext.close();

  await page.reload();
  await workspace(page).getByRole("button", { name: "Mark reviewed" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Reviewed");
  await workspace(page).getByRole("button", { name: "Lock" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Locked");
  expect((await db.dailyLog.findUniqueOrThrow({ where: { id: logId } })).status).toBe("LOCKED");
});

test("an official correction is added beside the locked log, which does not change (§271)", async ({ page }) => {
  const before = await db.dailyLog.findUniqueOrThrow({ where: { id: logId }, include: { workforce: true, workActivities: true, delayEntries: true } });
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${PROJECT}/daily-logs/${logId}` });
  await workspace(page).getByRole("button", { name: "Add correction" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an official correction" });
  await dialog.getByLabel("Why it needs correcting").fill("Delay start time was mistyped.");
  await dialog.getByLabel("The correction").fill("The pump delay started at 08:15, not 08:00.");
  await dialog.getByRole("button", { name: "Add correction" }).click();
  await expect(page.getByTestId("daily-log-correction")).toContainText("The pump delay started at 08:15, not 08:00.");

  const after = await db.dailyLog.findUniqueOrThrow({ where: { id: logId }, include: { workforce: true, workActivities: true, delayEntries: true } });
  expect(after.workforce).toEqual(before.workforce);
  expect(after.delayEntries).toEqual(before.delayEntries);
  expect(after.version).toBe(before.version);
  expect(await db.auditEvent.count({ where: { entityId: logId, actionKey: "DAILY_LOG_CORRECTION_ADDED" } })).toBe(1);
  await expect(workspace(page).getByRole("button", { name: "Add workforce" })).toHaveCount(0);
});

test("an engineer cannot open a log on a project they are not on", async ({ page }) => {
  const other = await db.dailyLog.create({ data: { companyId: "company_demo_a", projectId: "project_c", workDate: new Date(Date.UTC(2026, 0, 5, 12)), createdByMemberId: "member_architect" } });
  try {
    await signIn(page, "ENGINEER", { to: `/projects/project_c/daily-logs/${other.id}` });
    await expect(page.getByText("404")).toBeVisible();
  } finally {
    await db.dailyLog.delete({ where: { id: other.id } });
  }
});
