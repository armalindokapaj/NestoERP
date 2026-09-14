import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { signIn } from "../fixtures";
import { memberId, resetTimesheets, TIMESHEET_SEED } from "../timesheets-fixtures";

/**
 * Timesheets, desktop (PRD #42 §261-§263): an engineer fills in and submits
 * their week; their approver returns last week with a question, the engineer
 * corrects and resubmits it, and it is approved; a project manager reads
 * project hours and cannot reach a project that is not theirs.
 */

const USERS = ["engineer@nesto.test"];
const ZONE = "Europe/Tirane";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test.beforeAll(async () => {
  await resetTimesheets(USERS);
});

test.afterAll(async () => {
  await resetTimesheets(USERS);
  await db.$disconnect();
});

const week = (page: Page) => page.getByTestId("timesheet-week");

test("an engineer logs project, task and internal time, and submits the week (§261)", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/timesheets" });
  await expect(week(page).getByTestId("timesheet-status")).toHaveText("Draft");

  // Project time, through the detailed entry.
  await week(page).getByRole("button", { name: "Log time" }).first().click();
  const drawer = page.getByRole("dialog", { name: "Log time" });
  await drawer.getByLabel("Project", { exact: false }).first().selectOption({ label: "PRJ-001 · Riverside Residences" });
  await drawer.getByRole("textbox", { name: "Duration" }).fill("2h");
  await drawer.getByLabel(/^Description/).fill("Coordination with the site team.");
  await drawer.getByRole("button", { name: "Log time" }).click();
  await expect(page.getByText("2h logged", { exact: true })).toBeVisible();

  // Task time, choosing the task.
  await week(page).getByRole("button", { name: "Log time" }).first().click();
  await drawer.getByLabel("Project", { exact: false }).first().selectOption({ label: "PRJ-001 · Riverside Residences" });
  await drawer.getByLabel("Task (optional)").selectOption({ label: "Review structural detail S-204" });
  await drawer.getByRole("textbox", { name: "Duration" }).fill("3:30");
  await drawer.getByRole("button", { name: "Log time" }).click();
  await expect(page.getByText("3h 30m logged", { exact: true })).toBeVisible();

  // Internal time, straight into the grid.
  const grid = page.getByTestId("timesheet-grid");
  await grid.getByRole("button", { name: "Add row" }).click();
  await grid.getByLabel("Row work type").selectOption("INTERNAL");
  await grid.getByRole("button", { name: "Add row" }).click();
  const cell = grid.locator(`[data-cell="INTERNAL||@${today()}"]`);
  await cell.fill("1.5");
  await cell.press("Enter");
  await expect(page.getByTestId("save-indicator")).toHaveText("Saved");
  await expect(grid.getByTestId("week-total")).toHaveText("7h");
  await expect(week(page).getByTestId("summary-total")).toHaveText("7h");

  // Submit a short week: it asks first.
  await week(page).getByRole("button", { name: "Submit week" }).click();
  const confirm = page.getByRole("dialog", { name: "Submit a short week?" });
  await expect(confirm).toContainText("You logged 7h of the expected");
  await confirm.getByRole("button", { name: "Submit anyway" }).click();
  await expect(week(page).getByTestId("timesheet-status")).toHaveText("Submitted");
  await expect(page.getByTestId("timesheet-banner")).toContainText("Submitted to Alex Morgan");
  await expect(grid.locator(`[data-cell="INTERNAL||@${today()}"]`)).toHaveCount(0);

  const engineer = await memberId("engineer@nesto.test");
  const stored = await db.timesheet.findFirstOrThrow({ where: { memberId: engineer, status: "SUBMITTED", id: { not: { startsWith: "timesheet_" } } }, include: { workLogs: true } });
  expect(stored.workLogs.map((log) => log.minutes).sort((a, b) => a - b)).toEqual([90, 120, 210]);
  expect(await db.timesheetApproval.count({ where: { recordId: stored.id, status: "PENDING" } })).toBe(1);
});

test("the approver returns a week with a reason; the engineer corrects and resubmits it; it is approved (§262)", async ({ page, browser }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/approvals?approval=timesheets%3A${TIMESHEET_SEED.engineerSubmittedApproval}` });
  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByTestId("approval-title")).toContainText("Ethan Cole");
  await expect(detail).toContainText("Riverside Residences");
  await expect(detail).toContainText("Daily totals");
  await detail.getByRole("button", { name: "Return this timesheet for revision" }).click();
  const dialog = page.getByRole("dialog", { name: /for revision\?/ });
  await dialog.getByLabel("What needs to change").fill("Thursday's admin hour looks short — please check it.");
  await dialog.getByRole("button", { name: "Return for revision" }).click();
  await expect(page.getByText("Timesheet returned for revision", { exact: true })).toBeVisible();
  expect((await db.timesheet.findUniqueOrThrow({ where: { id: TIMESHEET_SEED.engineerSubmitted } })).status).toBe("RETURNED");

  // The engineer sees why, corrects Thursday, and resubmits.
  const engineerContext = await browser.newContext();
  const engineer = await engineerContext.newPage();
  const seeded = await db.timesheet.findUniqueOrThrow({ where: { id: TIMESHEET_SEED.engineerSubmitted } });
  const periodStart = seeded.periodStart.toISOString().slice(0, 10);
  await signIn(engineer, "ENGINEER", { to: `/timesheets?week=${periodStart}` });
  await expect(engineer.getByTestId("timesheet-banner")).toContainText("Thursday's admin hour looks short");
  const thursday = new Date(`${periodStart}T12:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const cell = engineer.getByTestId("timesheet-grid").locator(`[data-cell="ADMIN||@${thursday.toISOString().slice(0, 10)}"]`);
  await expect(cell).toHaveValue("1");
  await cell.fill("1.5");
  await cell.press("Enter");
  await expect(engineer.getByTestId("save-indicator")).toHaveText("Saved");
  await engineer.getByTestId("timesheet-week").getByRole("button", { name: "Resubmit week" }).click();
  await expect(engineer.getByTestId("timesheet-week").getByTestId("timesheet-status")).toHaveText("Submitted");
  await engineerContext.close();

  // A new cycle, decided by the approver.
  const next = await db.timesheetApproval.findFirstOrThrow({ where: { recordId: TIMESHEET_SEED.engineerSubmitted, status: "PENDING" } });
  expect(next.id).not.toBe(TIMESHEET_SEED.engineerSubmittedApproval);
  await page.goto(`/approvals?approval=timesheets%3A${next.id}`);
  const history = detail.getByTestId("approval-history");
  await expect(history).toContainText("Returned for revision");
  await expect(history).toContainText("Resubmitted");
  await detail.getByRole("button", { name: "Approve this timesheet" }).click();
  await expect(page.getByText("Timesheet approved", { exact: true })).toBeVisible();
  const approved = await db.timesheet.findUniqueOrThrow({ where: { id: TIMESHEET_SEED.engineerSubmitted }, select: { status: true, workLogs: { select: { minutes: true } } } });
  expect(approved.status).toBe("APPROVED");
  expect(approved.workLogs.reduce((sum, log) => sum + log.minutes, 0)).toBe(40 * 60 + 30);
});

test("a project manager reads their projects' hours, and another project is not there (§263)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/timesheets/projects" });
  const project = page.getByRole("combobox", { name: "Project" });
  await expect(project.locator("option", { hasText: "Riverside Residences" })).toHaveCount(1);
  await expect(project.locator("option", { hasText: "Marina Apartments" })).toHaveCount(0);
  await project.selectOption({ label: "PRJ-001 · Riverside Residences" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/projectId=project_a/);
  await expect(page.getByTestId("project-total")).not.toHaveText("0h");
  await expect(page.getByTestId("by-member")).toContainText("Anna Rossi");

  await page.goto("/timesheets/projects?projectId=project_c");
  await expect(page.getByText("404")).toBeVisible();
});
