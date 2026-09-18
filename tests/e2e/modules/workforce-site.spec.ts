import { expect, test } from "@playwright/test";

import { removeCreatedDailyLogs } from "../daily-logs-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { createSpareProject, removeSpareProject } from "../structure-fixtures";

/**
 * The workforce on site and in bulk (E-04 §43, §71, §93-§98, §182, §270, §273).
 *
 * HR adds people from a spreadsheet — none of them gets a login; the project
 * manager inducts a worker who is on the project without an induction, and
 * fills the day's log from the crew the site sheet marked present. On a spare
 * project of Aurelia's, so the demo's own project and its logs are untouched;
 * everything made here is removed afterwards.
 */

const COMPANY_A = "company_demo_a";
const PROJECT = "e2e_wf3_project";
const PREFIX = "E2E-WF3";
const DAY = 86_400_000;
const dayOf = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const yesterday = dayOf(-1);

async function noLoginWorker(firstName: string): Promise<string> {
  const company = await db.company.findUniqueOrThrow({ where: { id: COMPANY_A }, select: { parentGroupId: true } });
  const person = await db.personProfile.create({ data: { parentGroupId: company.parentGroupId!, firstName, lastName: PREFIX, lifecycleStatus: "EMPLOYEE" }, select: { id: true } });
  const employment = await db.employeeProfile.create({
    data: { companyId: COMPANY_A, personProfileId: person.id, employmentStatus: "ACTIVE", startDate: new Date(Date.now() - 60 * DAY), workerCategory: "CONSTRUCTION_WORKER", jobTitle: "Steel fixer" },
    select: { id: true },
  });
  return employment.id;
}

async function removeCreated() {
  await removeCreatedDailyLogs([PROJECT]);
  const employments = await db.employeeProfile.findMany({ where: { companyId: COMPANY_A, personProfile: { lastName: PREFIX } }, select: { id: true, personProfileId: true } });
  const ids = employments.map((row) => row.id);
  await db.hseInduction.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { projectId: PROJECT }] } });
  await db.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await db.workforceCrewMember.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { crew: { name: { startsWith: PREFIX } } }] } });
  await db.employeeProjectAssignment.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { projectId: PROJECT }] } });
  await db.workforceCrew.deleteMany({ where: { name: { startsWith: PREFIX } } });
  // History, leave and attendance go with the employment.
  await db.employeeProfile.deleteMany({ where: { id: { in: ids } } });
  await db.personProfile.deleteMany({ where: { id: { in: employments.map((row) => row.personProfileId) } } });
  await db.employeeImportBatch.deleteMany({ where: { companyId: COMPANY_A, fileName: { startsWith: PREFIX } } });
  await removeSpareProject(PROJECT);
}

test.beforeAll(async () => {
  await removeCreated();
  await createSpareProject(PROJECT, "E2EWF3", `${PREFIX} Harbour Works`);
});

test.afterAll(async () => {
  await removeCreated();
  await db.$disconnect();
});

test("HR imports people from a spreadsheet: the good rows, and none of them with a login (§93-§98, §273)", async ({ page }) => {
  await signIn(page, "HR", { to: "/hr/employees/import" });
  const csv = ["First name,Last name,Job title,Start date", `Arbër,${PREFIX},Mason,${dayOf(-7)}`, `Dea,${PREFIX},Painter,${dayOf(-7)}`, `,${PREFIX},Labourer,not a date`].join("\n");
  await mainRegion(page).getByTestId("import-file").setInputFiles({ name: `${PREFIX}-crew.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

  // Every row checked before anything is written (§96).
  const preview = mainRegion(page).getByTestId("import-preview");
  await expect(preview.getByTestId("import-row")).toHaveCount(3);
  await expect(preview.locator('[data-testid="import-row"][data-row-state="error"]')).toHaveCount(1);
  expect(await db.employeeProfile.count({ where: { companyId: COMPANY_A, personProfile: { lastName: PREFIX } } })).toBe(0);

  await preview.getByTestId("import-commit").click();
  await expect(mainRegion(page).getByTestId("import-result")).toContainText("2 employees imported");
  const imported = await db.employeeProfile.findMany({ where: { companyId: COMPANY_A, personProfile: { lastName: PREFIX } }, select: { companyMemberId: true, employmentStatus: true, jobTitle: true } });
  expect(imported).toHaveLength(2);
  expect(imported.every((row) => row.companyMemberId === null && row.employmentStatus === "ACTIVE")).toBe(true);
});

test("the project manager inducts a worker who is on the project without one (§71, §270)", async ({ page }) => {
  const employment = await noLoginWorker("Ilirian");
  await db.employeeProjectAssignment.create({ data: { companyId: COMPANY_A, employeeProfileId: employment, projectId: PROJECT, isPrimary: true, startDate: new Date(`${dayOf(-10)}T00:00:00.000Z`) } });

  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${PROJECT}/workforce` });
  const panel = mainRegion(page).getByTestId("project-inductions");
  await expect(panel.getByTestId("missing-inductions")).toContainText("1 person works here without a valid induction");
  await panel.getByRole("button", { name: `Induct Ilirian ${PREFIX}` }).click();
  const dialog = page.getByTestId("induction-dialog");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Induction recorded.", { exact: true })).toBeVisible();

  await expect(panel.getByTestId("missing-inductions")).toHaveCount(0);
  await expect(panel.locator(`[data-testid="induction"][data-worker-name="Ilirian ${PREFIX}"]`)).toContainText("Valid");
  expect(await db.hseInduction.count({ where: { employeeProfileId: employment, projectId: PROJECT, voidedAt: null } })).toBe(1);
});

test("the day's log takes its workforce from the crew the site sheet marked present (§43, §182)", async ({ page }) => {
  const [present, absent] = [await noLoginWorker("Gent"), await noLoginWorker("Sokol")];
  const crew = await db.workforceCrew.create({ data: { companyId: COMPANY_A, name: `${PREFIX} Rebar`, projectId: PROJECT }, select: { id: true } });
  const start = new Date(`${dayOf(-30)}T00:00:00.000Z`);
  await db.workforceCrewMember.createMany({ data: [present, absent].map((employeeProfileId) => ({ companyId: COMPANY_A, crewId: crew.id, employeeProfileId, startDate: start })) });
  const date = new Date(`${yesterday}T12:00:00.000Z`);
  await db.attendanceRecord.createMany({
    data: [
      { companyId: COMPANY_A, employeeProfileId: present, projectId: PROJECT, crewId: crew.id, date, status: "PRESENT", source: "SITE", createdByMemberId: "member_pm" },
      { companyId: COMPANY_A, employeeProfileId: absent, projectId: PROJECT, crewId: crew.id, date, status: "ABSENT", source: "SITE", createdByMemberId: "member_pm" },
    ],
  });
  const log = await db.dailyLog.create({ data: { companyId: COMPANY_A, projectId: PROJECT, workDate: date, createdByMemberId: "member_pm" }, select: { id: true } });

  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${PROJECT}/daily-logs/${log.id}` });
  await page.getByTestId("daily-log-workspace").getByTestId("workforce-suggest").click();
  const dialog = page.getByTestId("workforce-suggestions");
  // Counted from the site sheet: one of the crew's two was there (§44).
  const suggestion = dialog.getByTestId("workforce-suggestion").filter({ hasText: `${PREFIX} Rebar` });
  await expect(suggestion).toContainText("1 person");
  // Everything offered starts ticked; keep only the crew.
  await expect(suggestion.getByRole("checkbox")).toBeChecked();
  for (const other of await dialog.getByTestId("workforce-suggestion").filter({ hasNotText: `${PREFIX} Rebar` }).all()) {
    await other.getByRole("checkbox").uncheck();
  }
  await dialog.getByRole("button", { name: "Add 1" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("1 entry added.", { exact: true })).toBeVisible();

  const entries = await db.dailyLogWorkforceEntry.findMany({ where: { dailyLogId: log.id }, select: { crewId: true, headcount: true } });
  expect(entries).toEqual([{ crewId: crew.id, headcount: 1 }]);
});
