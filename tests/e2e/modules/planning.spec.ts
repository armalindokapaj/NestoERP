import { expect, test, type Page } from "@playwright/test";

import { addLocalDays, dateLabel, localDate } from "@/lib/modules/project-planning/planning.dates";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { milestoneDate, PLANNING_SEED, removePlanning } from "../planning-fixtures";

/**
 * Project planning, desktop (PRD #44 §299, §300): the project manager sets out
 * a plan on an empty project — phases, milestones, owners, a dependency, a
 * blocker with its task, a follow-up task, a new forecast — completes a
 * milestone and reads the timeline; a milestone on the calendar opens the
 * planning drawer; and an outsider cannot reach another project's plan.
 *
 * Central Office Tower is Meridian's, run by Meridian's project manager
 * (E-06 §45).
 */

const PROJECT = "project_b";
const ZONE = "Europe/Tirane";
const today = () => localDate(new Date(), ZONE);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await removePlanning([PROJECT]);
});

test.afterAll(async () => {
  await removePlanning([PROJECT]);
  await db.$disconnect();
});

const drawer = (page: Page) => page.getByTestId("milestone-drawer");
const section = (page: Page, id: string) => drawer(page).getByTestId(`drawer-${id}`);

async function addMilestone(page: Page, name: string, phase: string, planned: string, critical = false) {
  await mainRegion(page).getByRole("button", { name: "Milestone", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New milestone" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Phase").selectOption({ label: phase });
  await dialog.getByLabel("Owner").selectOption({ label: "Gentian Bega" });
  await dialog.getByLabel("Planned date").fill(planned);
  if (critical) {
    await dialog.getByRole("button", { name: "More details" }).click();
    await dialog.getByRole("checkbox", { name: "Critical" }).click();
  }
  await dialog.getByRole("button", { name: "Add milestone" }).click();
  await expect(dialog).toBeHidden();
  await expect(drawer(page).getByTestId("drawer-milestone-name")).toHaveText(name);
}

test("the project manager sets out and runs a plan (§299)", async ({ page }) => {
  await signIn(page, "PM_B", { to: `/projects/${PROJECT}` });
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Planning" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/planning`));
  await expect(page.getByTestId("planning-empty")).toContainText("No project plan yet.");
  await expect(page.getByTestId("planning-template")).toHaveCount(4);

  // Phases.
  await mainRegion(page).getByRole("button", { name: "Create Phase" }).click();
  let dialog = page.getByRole("dialog", { name: "New phase" });
  await dialog.getByLabel("Name").fill("Superstructure");
  await dialog.getByRole("button", { name: "Add phase" }).click();
  await expect(dialog).toBeHidden();
  await mainRegion(page).getByRole("button", { name: "Phase", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "New phase" });
  await dialog.getByLabel("Name").fill("Envelope");
  await dialog.getByRole("button", { name: "Add phase" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("phase-row")).toHaveCount(2);

  // Milestones with owners; each opens in the drawer once added.
  await addMilestone(page, "Structure Complete", "Superstructure", addLocalDays(today(), 20), true);
  await drawer(page).getByRole("button", { name: "Close" }).click();
  await addMilestone(page, "Façade Complete", "Envelope", addLocalDays(today(), 40));

  // A dependency with lag.
  await section(page, "dependencies").getByRole("button", { name: "Depends on" }).click();
  await section(page, "dependencies").getByLabel("Predecessor").selectOption({ label: "Structure Complete · Not Started" });
  await section(page, "dependencies").getByLabel("Lag (days)").fill("7");
  await section(page, "dependencies").getByRole("button", { name: "Add dependency" }).click();
  await expect(section(page, "dependencies").getByTestId("dependency-row")).toContainText("Structure Complete");

  // A blocker, with a task raised for it.
  await section(page, "blockers").getByRole("button", { name: "Add blocker" }).click();
  await section(page, "blockers").getByLabel("Title").fill("Curtain wall submittal late");
  await section(page, "blockers").getByLabel("Severity").selectOption({ label: "High" });
  await section(page, "blockers").getByRole("checkbox", { name: "Also create a task" }).click();
  await section(page, "blockers").getByRole("button", { name: "Save blocker" }).click();
  await expect(section(page, "blockers").getByTestId("milestone-blocker")).toContainText("Curtain wall submittal late");
  await expect(section(page, "tasks").getByTestId("milestone-task")).toContainText("Curtain wall submittal late");

  // A follow-up task through the task service.
  await section(page, "tasks").getByRole("button", { name: "Create task" }).click();
  await section(page, "tasks").getByLabel("Title").fill("Issue façade shop drawings");
  await section(page, "tasks").getByRole("button", { name: "Save task" }).click();
  await expect(section(page, "tasks").getByTestId("milestone-task")).toHaveCount(2);

  // A new forecast, against the baseline set from the planned date.
  await section(page, "quick-update").getByLabel("Forecast date").fill(addLocalDays(today(), 45));
  await section(page, "quick-update").getByLabel("Why the forecast moved (optional)").fill("Submittal review takes longer");
  await section(page, "quick-update").getByRole("button", { name: "Save update" }).click();
  await expect(drawer(page).getByTestId("drawer-forecast")).toHaveText(dateLabel(addLocalDays(today(), 45)));
  await expect(drawer(page).getByTestId("milestone-variance").first()).toHaveText("+5 days");
  await drawer(page).getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/milestone=/);

  // Complete the first milestone from the list.
  await page.getByTestId("planning-view-milestones").click();
  await page.getByTestId("milestone-row").filter({ hasText: "Structure Complete" }).click();
  await drawer(page).getByRole("button", { name: "Mark complete" }).click();
  await drawer(page).getByRole("button", { name: "Complete milestone" }).click();
  await expect(drawer(page).getByTestId("milestone-status").first()).toHaveText("Completed");
  await drawer(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("milestone-row").filter({ hasText: "Structure Complete" }).getByTestId("milestone-status")).toHaveText("Completed");

  // The timeline and the dependency list read the same plan.
  await page.getByTestId("planning-view-timeline").click();
  await expect(page.getByTestId("planning-timeline")).toBeVisible();
  await expect(page.getByTestId("timeline-marker")).toHaveCount(2);
  await expect(page.getByTestId("timeline-today")).toBeVisible();
  await page.getByTestId("planning-view-dependencies").click();
  await expect(page.getByTestId("dependency-table")).toContainText("Structure Complete");
  await expect(page.getByTestId("dependency-table")).toContainText("Satisfied");

  const saved = await db.projectMilestone.findMany({ where: { projectId: PROJECT }, orderBy: { name: "asc" }, select: { name: true, status: true, baselineDate: true, forecastDate: true, ownerMemberId: true } });
  expect(saved.map((row) => [row.name, row.status])).toEqual([["Façade Complete", "NOT_STARTED"], ["Structure Complete", "COMPLETED"]]);
  expect(saved[0].baselineDate?.toISOString().slice(0, 10)).toBe(addLocalDays(today(), 40));
  expect(saved.every((row) => row.ownerMemberId)).toBe(true);
});

test("a milestone on the calendar opens its planning drawer (§300)", async ({ page }) => {
  const date = await milestoneDate(PLANNING_SEED.milestones.structure);
  await signIn(page, "PROJECT_MANAGER", { to: `/calendar?view=agenda&date=${date}` });
  await mainRegion(page).getByRole("button", { name: /Structure Complete/ }).first().click();
  await page.getByRole("link", { name: /Open critical milestone/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/project_a/planning\\?milestone=${PLANNING_SEED.milestones.structure}`));
  await expect(drawer(page).getByTestId("drawer-milestone-name")).toHaveText("Structure Complete");
  await expect(section(page, "dailyLogs")).toContainText("Daily log");
});

test("an engineer cannot open the plan of a project they are not on (§225)", async ({ page }) => {
  // Every demo company runs one project, so the engineer is taken off
  // Riverside for the length of the test rather than sent to another company,
  // which would be refused for a different reason.
  const engineer = await db.companyMember.findFirstOrThrow({ where: { companyId: "company_demo_a", user: { username: "engineer-a" } }, select: { id: true } });
  await db.projectMember.updateMany({ where: { projectId: "project_a", companyMemberId: engineer.id }, data: { status: "INACTIVE" } });
  await db.companyMember.update({ where: { id: engineer.id }, data: { accessVersion: { increment: 1 } } });
  try {
    await signIn(page, "ENGINEER", { to: "/projects/project_a/planning" });
    await expect(page.getByText("404")).toBeVisible();
    const response = await page.request.get("/api/projects/project_a/planning");
    expect(response.status()).toBe(404);
  } finally {
    await db.projectMember.updateMany({ where: { projectId: "project_a", companyMemberId: engineer.id }, data: { status: "ACTIVE" } });
  }
});
