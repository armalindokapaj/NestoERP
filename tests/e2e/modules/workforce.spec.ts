import { expect, test } from "../pw";

import { db } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The workforce (E-04 §28-§42, §123, §124, §136-§139, §228-§236).
 *
 * HR puts two people without a NESTO account in a crew under one of them as
 * foreman, marks the crew's day on the site sheet and assigns one of them to
 * the project; the worker's profile shows where they work; the project manager
 * adds a site; an engineer on the project reads the crew but does not keep it;
 * a role without the module is turned away. Everything a test makes is removed
 * afterwards.
 */

const COMPANY_A = "company_demo_a";
const PROJECT = "project_a";
const PREFIX = "E2E-WF";
const today = new Date().toISOString().slice(0, 10);

let foreman: { id: string; personId: string };
let worker: { id: string; personId: string };

async function noLoginWorker(firstName: string): Promise<{ id: string; personId: string }> {
  const company = await db.company.findUniqueOrThrow({ where: { id: COMPANY_A }, select: { parentGroupId: true } });
  const person = await db.personProfile.create({ data: { parentGroupId: company.parentGroupId!, firstName, lastName: PREFIX, lifecycleStatus: "EMPLOYEE" }, select: { id: true } });
  const employment = await db.employeeProfile.create({
    data: { companyId: COMPANY_A, personProfileId: person.id, employmentStatus: "ACTIVE", startDate: new Date(Date.now() - 30 * 86_400_000), workerCategory: "CONSTRUCTION_WORKER", jobTitle: "Mason" },
    select: { id: true },
  });
  return { id: employment.id, personId: person.id };
}

async function removeCreated() {
  const employments = await db.employeeProfile.findMany({ where: { personProfile: { lastName: PREFIX } }, select: { id: true, personProfileId: true } });
  const ids = employments.map((row) => row.id);
  await db.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await db.workforceCrewMember.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { crew: { name: { startsWith: PREFIX } } }] } });
  await db.employeeProjectAssignment.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { site: { name: { startsWith: PREFIX } } }] } });
  await db.workforceCrew.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.projectSite.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.employeeProfile.deleteMany({ where: { id: { in: ids } } });
  await db.personProfile.deleteMany({ where: { id: { in: employments.map((row) => row.personProfileId) } } });
}

test.beforeAll(async () => {
  await removeCreated();
  foreman = await noLoginWorker("Kastriot");
  worker = await noLoginWorker("Blerim");
});

test.afterAll(async () => {
  await removeCreated();
  await db.$disconnect();
});

test("HR builds a crew of people without a login, marks their day and puts one on the project (§264, §266)", async ({ page }) => {
  await signIn(page, "HR", { to: "/workforce/crews" });
  await mainRegion(page).getByTestId("new-crew").click();
  const crewDialog = page.getByTestId("crew-dialog");
  await crewDialog.getByLabel("Name").fill(`${PREFIX} Formwork`);
  await crewDialog.getByLabel("Project").selectOption({ label: "Riverside Residences" });
  await crewDialog.getByLabel("Supervisor (foreman)").selectOption({ label: `Kastriot ${PREFIX}` });
  await crewDialog.getByRole("button", { name: "Create crew" }).click();
  await expect(crewDialog).toHaveCount(0);
  await recordTable(page).getByRole("link", { name: `${PREFIX} Formwork` }).click();
  await page.waitForURL(/\/workforce\/crews\/[^/?]+$/);

  // The foreman has no login and is still the crew's supervisor (§31, §32).
  await expect(mainRegion(page).getByRole("link", { name: `Kastriot ${PREFIX}` })).toBeVisible();
  for (const name of ["Kastriot", "Blerim"]) {
    await mainRegion(page).getByTestId("assign-crew").click();
    const dialog = page.getByTestId("assign-crew-dialog");
    // No trade and no code yet, so the choice is the name alone.
    await dialog.getByLabel("Worker").selectOption({ label: `${name} ${PREFIX}` });
    await dialog.getByRole("button", { name: "Add to crew" }).click();
    await expect(dialog).toHaveCount(0);
  }
  const members = mainRegion(page).getByRole("table", { name: "Members" });
  await expect(members.getByTestId("crew-member")).toHaveCount(2);
  await expect(members.getByTestId("crew-member").first()).toContainText("No NESTO account");

  // The site sheet: the crew's people, marked at once (§123, §124).
  const crew = await db.workforceCrew.findFirstOrThrow({ where: { name: `${PREFIX} Formwork` }, select: { id: true } });
  await page.goto(`/workforce/attendance?crewId=${crew.id}&date=${today}`);
  const sheet = mainRegion(page).getByTestId("attendance-sheet");
  await expect(sheet.getByTestId("sheet-row")).toHaveCount(2);
  await sheet.getByLabel(`Attendance for Blerim ${PREFIX}`).selectOption("PRESENT");
  await sheet.getByLabel(`Check-in for Blerim ${PREFIX}`).fill("07:00");
  await sheet.getByLabel(`Check-out for Blerim ${PREFIX}`).fill("15:00");
  await sheet.getByLabel(`Attendance for Kastriot ${PREFIX}`).selectOption("ABSENT");
  await sheet.getByTestId("save-sheet").click();
  await expect(page.getByText("Attendance saved.", { exact: true })).toBeVisible();
  await expect.poll(() => db.attendanceRecord.count({ where: { employeeProfileId: { in: [foreman.id, worker.id] }, source: "SITE", crewId: crew.id } })).toBe(2);

  // Assigned to the project — a workforce assignment, not project access (§35).
  await page.goto(`/projects/${PROJECT}/workforce`);
  await mainRegion(page).getByTestId("assign-project").click();
  const assign = page.getByTestId("assign-project-dialog");
  await assign.getByLabel("Worker").selectOption({ label: `Blerim ${PREFIX}` });
  await assign.getByLabel("Their main project").check();
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(assign).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("project-worker").filter({ hasText: `Blerim ${PREFIX}` })).toBeVisible();

  // Their profile is the person's, and shows where they work (§139, E-09 §7).
  await page.goto(`/people/${worker.personId}?tab=workforce`);
  const tab = mainRegion(page).getByTestId("worker-workforce");
  await expect(tab.getByTestId("worker-crew")).toContainText(`${PREFIX} Formwork`);
  await expect(tab.getByTestId("worker-assignment")).toContainText("Riverside Residences");
  await expect(tab).toContainText("No NESTO account");
});

test("the project manager adds a site to their project (§38)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${PROJECT}/workforce` });
  await mainRegion(page).getByTestId("add-site").click();
  const dialog = page.getByTestId("site-dialog");
  await dialog.getByLabel("Name").fill(`${PREFIX} Block B`);
  await dialog.getByLabel("City").fill("Tirana");
  await dialog.getByRole("button", { name: "Add site" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("project-site").filter({ hasText: `${PREFIX} Block B` })).toBeVisible();
});

test("an engineer on the project reads its crews but does not keep them (§150)", async ({ page }) => {
  const crew = await db.workforceCrew.create({ data: { companyId: COMPANY_A, name: `${PREFIX} Rebar`, projectId: PROJECT }, select: { id: true } });
  await signIn(page, "ENGINEER", { to: "/workforce/crews" });
  await expect(recordTable(page).getByRole("link", { name: `${PREFIX} Rebar` })).toBeVisible();
  await expect(mainRegion(page).getByTestId("new-crew")).toHaveCount(0);
  await page.goto(`/workforce/crews/${crew.id}`);
  await expect(mainRegion(page).getByTestId("assign-crew")).toHaveCount(0);
});

test("a role without the workforce module is turned away (§146)", async ({ page }) => {
  await signIn(page, "ARCHITECT");
  await expectAccessDenied(page, "/workforce");
});
