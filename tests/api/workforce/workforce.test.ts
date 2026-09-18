import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { addDays, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { createAttendanceSchema, createEmployeeProfileSchema } from "@/lib/modules/hr/hr.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { createSite, listSites, updateSite } from "@/lib/modules/project-structure/structure.sites";
import { assignmentsOf, assignToProject, endProjectAssignment, projectWorkforce } from "@/lib/modules/workforce/assignment.service";
import { assignToCrew, createCrew, crewMembershipsOf, endCrewMembership, getCrew, listCrews, updateCrew } from "@/lib/modules/workforce/crew.service";
import { getAttendanceSheet, saveAttendanceSheet } from "@/lib/modules/workforce/site-attendance.service";
import * as trades from "@/lib/modules/workforce/trade.service";
import { listWorkers, workforceForPerson } from "@/lib/modules/workforce/workforce.directory";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";
import { crewAssignmentSchema, parseWorkerQuery, projectAssignmentSchema, saveSheetSchema, sheetScopeSchema, updateCrewSchema, updateSiteSchema, updateTradeSchema } from "@/lib/modules/workforce/workforce.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * The workforce (E-04 §28-§42, §105, §114, §115, §123, §124, §204-§206, §213,
 * §215, §220-§222, §264, §266).
 *
 * Crews, project and site assignments and site attendance, for employees with
 * and without a NESTO account; the history every change leaves; who may see
 * and change which of it; and what happens when the employment ends. Every row
 * a test creates is removed afterwards.
 */

const PREFIX = "T04F";
const COMPANY = "company_demo_a";
const PROJECT = "project_a";
const OTHER_PROJECT = "t04f_project_elsewhere";
const startedAt = new Date();
const TODAY = todayDay();

const DOORS = { placement: placeMembership, workforce: endWorkforce };

let hr: UserContext;
let pm: UserContext;
let engineer: UserContext;
let trade: { id: string };

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const employments = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const employmentIds = employments.map((row) => row.id);
  const crews = await prisma.workforceCrew.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const sites = await prisma.projectSite.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const trail = [...personIds, ...employmentIds, ...crews.map((row) => row.id), ...sites.map((row) => row.id)];

  await prisma.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.workforceCrewMember.deleteMany({ where: { OR: [{ employeeProfileId: { in: employmentIds } }, { crewId: { in: crews.map((row) => row.id) } }] } });
  await prisma.employeeProjectAssignment.deleteMany({ where: { OR: [{ employeeProfileId: { in: employmentIds } }, { siteId: { in: sites.map((row) => row.id) } }] } });
  await prisma.workforceCrew.deleteMany({ where: { id: { in: crews.map((row) => row.id) } } });
  await prisma.projectSite.deleteMany({ where: { id: { in: sites.map((row) => row.id) } } });
  await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entityId: { in: trail } }, { actionKey: { startsWith: "WORKFORCE_" } }, { actionKey: { startsWith: "PROJECT_SITE_" } }] } });
  await prisma.activity.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entityId: { in: trail } }, { entityType: "AttendanceRecord" }] } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.employmentChange.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.employmentStatusHistory.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.employmentAssignment.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.employeeProfile.deleteMany({ where: { id: { in: employmentIds } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
}

beforeAll(async () => {
  hr = await loginAs("HR");
  pm = await loginAs("PROJECT_MANAGER");
  engineer = await loginAs("ENGINEER");
  trade = await prisma.workforceTrade.upsert({
    where: { companyId_name: { companyId: COMPANY, name: `${PREFIX} Mason` } },
    update: { isActive: true },
    create: { companyId: COMPANY, name: `${PREFIX} Mason` },
    select: { id: true },
  });
  // A second project of the company that the Project Manager neither manages nor belongs to.
  await prisma.project.upsert({ where: { id: OTHER_PROJECT }, update: {}, create: { id: OTHER_PROJECT, companyId: COMPANY, code: `${PREFIX}-ELSE`, name: `${PREFIX} Elsewhere`, status: "ACTIVE", createdBy: "test" } });
});

afterEach(async () => {
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await prisma.workforceTrade.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { id: OTHER_PROJECT } });
  await cleanupSessions();
});

async function expectError(promise: Promise<unknown>, code: string, detail?: string) {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (detail) expect(((error as AccessError).details as { code?: string } | undefined)?.code).toBe(detail);
}

/** A worker with no login, employed for the last month. */
async function worker(firstName: string): Promise<{ id: string; personId: string }> {
  const created = await employees.createEmployeeProfile(
    hr,
    createEmployeeProfileSchema.parse({ subject: "NEW", firstName, lastName: `${PREFIX} Gashi`, employmentType: "FULL_TIME", workerCategory: "CONSTRUCTION_WORKER", tradeId: trade.id, jobTitle: "Mason", confirmNewPerson: true }),
  );
  await applyEmploymentChange(hr, created.id, employmentChangeSchema.parse({ action: "STATUS", status: "ACTIVE", reason: "HIRE", effectiveDate: addDays(TODAY, -30) }), DOORS);
  return { id: created.id, personId: created.personId };
}

const assign = (context: UserContext, employeeId: string, input: Record<string, unknown>) => assignToProject(context, employeeId, projectAssignmentSchema.parse({ startDate: TODAY, ...input }));
const crewJoin = (context: UserContext, employeeId: string, input: Record<string, unknown>) => assignToCrew(context, employeeId, crewAssignmentSchema.parse({ startDate: TODAY, ...input }));

describe("trades (§11)", () => {
  it("keeps a company list: add, rename, retire, delete only what nobody has", async () => {
    const created = await trades.createTrade(hr, { name: `${PREFIX} Welder`, code: null });
    await expectError(trades.createTrade(hr, { name: `${PREFIX} welder`, code: null }), "CONFLICT");
    const renamed = await trades.updateTrade(hr, created.id, updateTradeSchema.parse({ name: `${PREFIX} Welder (MIG)` }));
    expect(renamed.name).toBe(`${PREFIX} Welder (MIG)`);
    const retired = await trades.updateTrade(hr, created.id, updateTradeSchema.parse({ isActive: false }));
    expect(retired.isActive).toBe(false);
    expect((await trades.tradeChoices(COMPANY)).some((choice) => choice.value === created.id)).toBe(false);
    await trades.deleteTrade(hr, created.id);

    const used = await worker("Trade");
    expect(used).toBeTruthy();
    await expectError(trades.deleteTrade(hr, trade.id), "CONFLICT", "TRADE_IN_USE");
  });

  it("is company configuration an engineer cannot change", async () => {
    await expectError(trades.createTrade(engineer, { name: `${PREFIX} Plumber`, code: null }), "FORBIDDEN");
  });
});

describe("sites (§38, §172)", () => {
  it("belong to their project and are kept by whoever sets up the physical project", async () => {
    const site = await createSite(pm, PROJECT, { name: `${PREFIX} Block B`, code: null, address: "Rruga e Kavajës", city: "Tirana", notes: null });
    expect((await listSites(pm, PROJECT)).map((row) => row.id)).toContain(site.id);
    await expectError(createSite(pm, PROJECT, { name: `${PREFIX} block b`, code: null, address: null, city: null, notes: null }), "CONFLICT");
    // Out of the manager's scope, the project is not there at all.
    await expectError(createSite(pm, OTHER_PROJECT, { name: `${PREFIX} Yard`, code: null, address: null, city: null, notes: null }), "NOT_FOUND");
    await expectError(createSite(engineer, PROJECT, { name: `${PREFIX} Yard`, code: null, address: null, city: null, notes: null }), "FORBIDDEN");

    // A site is a site of its project: naming it on another project is an invalid link.
    const somebody = await worker("Site");
    await expectError(assign(hr, somebody.id, { projectId: OTHER_PROJECT, siteId: site.id }), "VALIDATION_ERROR");

    // Somebody still working there keeps the site from being archived.
    await assign(hr, somebody.id, { projectId: PROJECT, siteId: site.id });
    await expectError(updateSite(pm, PROJECT, site.id, updateSiteSchema.parse({ status: "ARCHIVED" })), "CONFLICT", "SITE_IN_USE");
  });
});

describe("project assignments (§33-§42, §115, §204, §264)", () => {
  it("assigns a worker with no login, without making them a project member", async () => {
    const somebody = await worker("Arben");
    const assignment = await assign(hr, somebody.id, { projectId: PROJECT, isPrimary: true, role: "Mason" });
    expect(assignment).toMatchObject({ project: { id: PROJECT }, isPrimary: true, current: true, endDate: null });
    expect(await prisma.projectMember.count({ where: { projectId: PROJECT, createdAt: { gte: startedAt } } })).toBe(0);
    expect((await projectWorkforce(pm, PROJECT)).map((row) => row.worker.employeeId)).toContain(somebody.id);
  });

  it("refuses a second main project, and the same project twice at once", async () => {
    const somebody = await worker("Besnik");
    await assign(hr, somebody.id, { projectId: PROJECT, isPrimary: true });
    await expectError(assign(hr, somebody.id, { projectId: OTHER_PROJECT, isPrimary: true }), "CONFLICT", "PRIMARY_EXISTS");
    await expectError(assign(hr, somebody.id, { projectId: PROJECT }), "CONFLICT", "ALREADY_ON_PROJECT");
    // A secondary assignment elsewhere is fine (§40).
    await assign(hr, somebody.id, { projectId: OTHER_PROJECT });
    expect((await assignmentsOf(hr, somebody.id)).live).toHaveLength(2);
  });

  it("moves a worker by closing one assignment and opening the next — history kept (§41, §42, §111)", async () => {
    const somebody = await worker("Dritan");
    const first = await assign(hr, somebody.id, { projectId: PROJECT, isPrimary: true, startDate: addDays(TODAY, -10) });
    const moved = await assign(hr, somebody.id, { projectId: OTHER_PROJECT, transferFromId: first.id });
    expect(moved.isPrimary).toBe(true);
    const old = await prisma.employeeProjectAssignment.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.endDate?.toISOString().slice(0, 10)).toBe(addDays(TODAY, -1));
    expect(old.endReason).toContain("Moved to");
    const mine = await assignmentsOf(hr, somebody.id);
    expect(mine.live.map((row) => row.project.id)).toEqual([OTHER_PROJECT]);
    expect(mine.history.map((row) => row.id)).toEqual([first.id]);
  });

  it("ends an assignment after a last day, never before it began", async () => {
    const somebody = await worker("Ermal");
    const assignment = await assign(hr, somebody.id, { projectId: PROJECT });
    await expectError(endProjectAssignment(hr, somebody.id, assignment.id, { endDate: addDays(TODAY, -1), reason: null }), "VALIDATION_ERROR");
    await endProjectAssignment(hr, somebody.id, assignment.id, { endDate: TODAY, reason: "Phase finished" });
    await expectError(endProjectAssignment(hr, somebody.id, assignment.id, { endDate: TODAY, reason: null }), "CONFLICT");
  });

  it("keeps a project manager to their own projects (§150, §171)", async () => {
    const somebody = await worker("Fatmir");
    await expectError(assign(pm, somebody.id, { projectId: OTHER_PROJECT }), "VALIDATION_ERROR");
    await assign(pm, somebody.id, { projectId: PROJECT });
    await expectError(assign(engineer, somebody.id, { projectId: PROJECT }), "FORBIDDEN");
  });

  it("does not assign another company's project, or another company's employee (§215, §220)", async () => {
    const somebody = await worker("Gjergj");
    await expectError(assign(hr, somebody.id, { projectId: "project_b" }), "VALIDATION_ERROR");
    const foreign = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: "company_demo_b" }, select: { id: true } });
    await expectError(assign(hr, foreign.id, { projectId: PROJECT }), "NOT_FOUND");
  });

  it("lets only one of two racing main assignments through (§221)", async () => {
    const somebody = await worker("Ilir");
    const results = await Promise.allSettled([assign(hr, somebody.id, { projectId: PROJECT, isPrimary: true }), assign(hr, somebody.id, { projectId: OTHER_PROJECT, isPrimary: true })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.employeeProjectAssignment.count({ where: { employeeProfileId: somebody.id, isPrimary: true } })).toBe(1);
  });
});

describe("crews (§28-§32, §114, §205, §264)", () => {
  it("has a foreman who needs no login, and one crew at a time per person", async () => {
    const foreman = await worker("Kujtim");
    const somebody = await worker("Luan");
    const crew = await createCrew(hr, { name: `${PREFIX} Formwork`, projectId: PROJECT, siteId: null, tradeId: trade.id, supervisorEmployeeId: foreman.id, notes: null });
    expect(crew.supervisor).toMatchObject({ employeeId: foreman.id });
    const other = await createCrew(hr, { name: `${PREFIX} Rebar`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });

    await crewJoin(hr, somebody.id, { crewId: crew.id, startDate: addDays(TODAY, -5) });
    await expectError(crewJoin(hr, somebody.id, { crewId: crew.id }), "CONFLICT", "ALREADY_IN_CREW");
    await expectError(crewJoin(hr, somebody.id, { crewId: other.id }), "CONFLICT", "IN_ANOTHER_CREW");

    // Moving them closes the old membership the day before (§30, §110).
    await crewJoin(hr, somebody.id, { crewId: other.id, transfer: true });
    const memberships = await crewMembershipsOf(hr, somebody.id);
    expect(memberships.live.map((row) => row.crew.id)).toEqual([other.id]);
    expect(memberships.history).toHaveLength(1);
    expect(memberships.history[0]).toMatchObject({ crew: { id: crew.id }, endDate: addDays(TODAY, -1) });

    const detail = await getCrew(hr, other.id);
    expect(detail.members.map((member) => member.employeeId)).toEqual([somebody.id]);
    expect(detail.members[0]!.accountStatus).toBe("NO_ACCOUNT");
    expect((await getCrew(hr, crew.id)).history.map((member) => member.employeeId)).toEqual([somebody.id]);
  });

  it("is not archived with people in it; ending their membership frees it", async () => {
    const somebody = await worker("Mentor");
    const crew = await createCrew(hr, { name: `${PREFIX} Finishing`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    const membership = await crewJoin(hr, somebody.id, { crewId: crew.id });
    await expectError(updateCrew(hr, crew.id, updateCrewSchema.parse({ status: "ARCHIVED" })), "CONFLICT", "CREW_HAS_MEMBERS");
    await endCrewMembership(hr, somebody.id, membership.id, { endDate: TODAY, reason: "Back to the yard" });
    // Still a member today — the last day is included — so still not archivable until tomorrow.
    await expectError(updateCrew(hr, crew.id, updateCrewSchema.parse({ status: "ARCHIVED" })), "CONFLICT", "CREW_HAS_MEMBERS");
  });

  it("keeps a project manager to crews on their projects", async () => {
    await expectError(createCrew(pm, { name: `${PREFIX} Loose`, projectId: null, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null }), "VALIDATION_ERROR");
    await expectError(createCrew(pm, { name: `${PREFIX} Elsewhere`, projectId: OTHER_PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null }), "VALIDATION_ERROR");
    const mine = await createCrew(pm, { name: `${PREFIX} Mine`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    const theirs = await createCrew(hr, { name: `${PREFIX} Theirs`, projectId: OTHER_PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    const listed = (await listCrews(pm)).map((crew) => crew.id);
    expect(listed).toContain(mine.id);
    expect(listed).not.toContain(theirs.id);
    await expectError(getCrew(pm, theirs.id), "NOT_FOUND");
    // An engineer reads crews on their projects but does not keep them.
    expect((await listCrews(engineer)).map((crew) => crew.id)).toContain(mine.id);
    await expectError(updateCrew(engineer, mine.id, updateCrewSchema.parse({ name: `${PREFIX} Renamed` })), "FORBIDDEN");
  });

  it("lets only one of two racing crew changes through (§222)", async () => {
    const somebody = await worker("Nard");
    const [first, second] = await Promise.all([
      createCrew(hr, { name: `${PREFIX} Race A`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null }),
      createCrew(hr, { name: `${PREFIX} Race B`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null }),
    ]);
    const results = await Promise.allSettled([crewJoin(hr, somebody.id, { crewId: first.id }), crewJoin(hr, somebody.id, { crewId: second.id })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.workforceCrewMember.count({ where: { employeeProfileId: somebody.id } })).toBe(1);
  });
});

describe("the directory and its scope (§18, §19, §150)", () => {
  it("shows a project manager the people on their projects and nobody else", async () => {
    const here = await worker("Olsi");
    const there = await worker("Pellumb");
    await assign(hr, here.id, { projectId: PROJECT, isPrimary: true });
    await assign(hr, there.id, { projectId: OTHER_PROJECT, isPrimary: true });

    const seen = (await listWorkers(pm, parseWorkerQuery({ search: PREFIX, limit: "100" }))).data.map((row) => row.employeeId);
    expect(seen).toContain(here.id);
    expect(seen).not.toContain(there.id);
    expect(await workforceForPerson(pm, there.personId)).toBeNull();

    const everyone = (await listWorkers(hr, parseWorkerQuery({ search: PREFIX, limit: "100" }))).data;
    const row = everyone.find((candidate) => candidate.employeeId === here.id);
    expect(row).toMatchObject({ project: { id: PROJECT }, accountStatus: "NO_ACCOUNT", trade: { id: trade.id } });
    expect(everyone.map((candidate) => candidate.employeeId)).toContain(there.id);
    const onProject = (await listWorkers(hr, parseWorkerQuery({ search: PREFIX, projectId: PROJECT, limit: "100" }))).data.map((candidate) => candidate.employeeId);
    expect(onProject).toEqual([here.id]);
  });
});

describe("site attendance (§123, §124, §206, §266)", () => {
  it("marks a crew at once, for workers without a login, and records where", async () => {
    const one = await worker("Qemal");
    const two = await worker("Rrok");
    const site = await createSite(pm, PROJECT, { name: `${PREFIX} Block C`, code: null, address: null, city: null, notes: null });
    const crew = await createCrew(hr, { name: `${PREFIX} Concrete`, projectId: PROJECT, siteId: site.id, tradeId: null, supervisorEmployeeId: one.id, notes: null });
    await crewJoin(hr, one.id, { crewId: crew.id });
    await crewJoin(hr, two.id, { crewId: crew.id });

    const sheet = await getAttendanceSheet(engineer, sheetScopeSchema.parse({ date: TODAY, crewId: crew.id }));
    expect(sheet).toMatchObject({ project: { id: PROJECT }, site: { id: site.id }, crew: { id: crew.id }, canRecord: true });
    expect(sheet.rows.map((row) => row.employeeId).sort()).toEqual([one.id, two.id].sort());

    const input = saveSheetSchema.parse({
      date: TODAY,
      crewId: crew.id,
      rows: [
        { employeeId: one.id, status: "PRESENT", checkIn: "07:00", checkOut: "15:30" },
        { employeeId: two.id, status: "ABSENT", notes: "Sick, called in" },
      ],
    });
    expect(await saveAttendanceSheet(engineer, input)).toEqual({ created: 2, updated: 0, unchanged: 0 });
    const record = await prisma.attendanceRecord.findFirstOrThrow({ where: { employeeProfileId: one.id } });
    expect(record).toMatchObject({ source: "SITE", projectId: PROJECT, siteId: site.id, crewId: crew.id, companyMemberId: null, status: "PRESENT", workedMinutes: 510 });

    // Saving the same sheet again changes nothing; a correction is an update, not a second row.
    expect(await saveAttendanceSheet(engineer, input)).toEqual({ created: 0, updated: 0, unchanged: 2 });
    const corrected = saveSheetSchema.parse({ ...input, rows: [{ employeeId: two.id, status: "PRESENT", checkIn: "08:00", checkOut: "16:00" }] });
    expect(await saveAttendanceSheet(engineer, corrected)).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(await prisma.attendanceRecord.count({ where: { employeeProfileId: two.id } })).toBe(1);
  });

  it("writes only the people on the sheet, and never over a day HR recorded", async () => {
    const onSheet = await worker("Sokol");
    const offSheet = await worker("Tahir");
    await assign(hr, onSheet.id, { projectId: PROJECT, startDate: addDays(TODAY, -10) });
    await expectError(
      saveAttendanceSheet(pm, saveSheetSchema.parse({ date: TODAY, projectId: PROJECT, rows: [{ employeeId: offSheet.id, status: "PRESENT" }] })),
      "VALIDATION_ERROR",
      "NOT_ON_SHEET",
    );

    const day = addDays(TODAY, -1);
    await attendance.createAttendance(hr, createAttendanceSchema.parse({ employeeId: onSheet.id, date: day, status: "PRESENT" }));
    const sheet = await getAttendanceSheet(pm, sheetScopeSchema.parse({ date: day, projectId: PROJECT }));
    expect(sheet.rows.find((row) => row.employeeId === onSheet.id)?.locked).toBe("Recorded in HR");
    await expectError(saveAttendanceSheet(pm, saveSheetSchema.parse({ date: day, projectId: PROJECT, rows: [{ employeeId: onSheet.id, status: "ABSENT" }] })), "CONFLICT", "RECORDED_ELSEWHERE");

    await expectError(saveAttendanceSheet(pm, saveSheetSchema.parse({ date: addDays(TODAY, 1), projectId: PROJECT, rows: [{ employeeId: onSheet.id, status: "PRESENT" }] })), "VALIDATION_ERROR");
    await expectError(getAttendanceSheet(pm, sheetScopeSchema.parse({ date: TODAY, projectId: OTHER_PROJECT })), "VALIDATION_ERROR");
  });
});

describe("when the employment ends (§105, §213)", () => {
  it("ends crew and project assignments on the last day and withdraws those not yet begun", async () => {
    const somebody = await worker("Urim");
    const crew = await createCrew(hr, { name: `${PREFIX} Demolition`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    await crewJoin(hr, somebody.id, { crewId: crew.id, startDate: addDays(TODAY, -10) });
    const now = await assign(hr, somebody.id, { projectId: PROJECT, isPrimary: true, startDate: addDays(TODAY, -10) });
    const later = await assign(hr, somebody.id, { projectId: OTHER_PROJECT, startDate: addDays(TODAY, 7) });

    // Their last day was yesterday, so the employment has ended today and the change applies now.
    const lastDay = addDays(TODAY, -1);
    await applyEmploymentChange(hr, somebody.id, employmentChangeSchema.parse({ action: "TERMINATE", lastWorkingDay: lastDay, reason: "RESIGNATION" }), DOORS);

    const kept = await prisma.employeeProjectAssignment.findUniqueOrThrow({ where: { id: now.id } });
    expect(kept.endDate?.toISOString().slice(0, 10)).toBe(lastDay);
    expect(kept.endReason).toBe("Employment ended");
    expect(await prisma.employeeProjectAssignment.count({ where: { id: later.id } })).toBe(0);
    const membership = await prisma.workforceCrewMember.findFirstOrThrow({ where: { employeeProfileId: somebody.id } });
    expect(membership.endDate?.toISOString().slice(0, 10)).toBe(lastDay);
    expect(await prisma.auditEvent.count({ where: { actionKey: "WORKFORCE_ENDED_WITH_EMPLOYMENT", entityId: somebody.id } })).toBe(1);

    // A former worker is assigned nowhere new (§107).
    await expectError(assign(hr, somebody.id, { projectId: PROJECT, startDate: addDays(TODAY, 2) }), "CONFLICT", "EMPLOYMENT_ENDED");
  });
});
