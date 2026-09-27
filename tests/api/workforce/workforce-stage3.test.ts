import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { createDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { applyWorkforceSuggestions, workforceSuggestions } from "@/lib/modules/daily-logs/daily-log.workforce";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { addDays, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { findEmploymentFindings } from "@/lib/modules/hr/employment/employment.integrity";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { createEmployeeProfileSchema } from "@/lib/modules/hr/hr.schema";
import { createIncident } from "@/lib/modules/hse/incidents/incident.service";
import { createPermit, submitPermit } from "@/lib/modules/hse/permits/permit.service";
import { createPpeCheck } from "@/lib/modules/hse/ppe/ppe.service";
import { incidentSchema, permitSchema, ppeCheckSchema, toolboxSchema } from "@/lib/modules/hse/hse.schema";
import { INCIDENT_TYPES, PERMIT_TYPES } from "@/lib/modules/hse/hse.status";
import {
  addIncidentPerson,
  addPermitWorker,
  inductionsForProject,
  listIncidentPeople,
  listPermitWorkers,
  recordInduction,
  removeIncidentPerson,
  voidInduction,
  workerHseSummary,
  workersMissingInduction,
} from "@/lib/modules/hse/hse.workforce";
import { createToolboxTalk } from "@/lib/modules/hse/toolbox/toolbox.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { assignToProject } from "@/lib/modules/workforce/assignment.service";
import { assignToCrew, createCrew } from "@/lib/modules/workforce/crew.service";
import { saveAttendanceSheet } from "@/lib/modules/workforce/site-attendance.service";
import { commitImport, previewImport } from "@/lib/modules/workforce/workforce.import";
import { findWorkforceFindings } from "@/lib/modules/workforce/workforce.integrity";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";
import { crewAssignmentSchema, projectAssignmentSchema, saveSheetSchema } from "@/lib/modules/workforce/workforce.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * The workforce on the safety record, in the daily log and imported in bulk
 * (E-04 §43, §44, §70-§74, §93-§98, §142, §182, §183, §224, §225, §270, §273).
 * Every row a test creates is removed afterwards.
 */

const PREFIX = "T04H";
const IMPORTED = "T04I";
const COMPANY = "company_demo_a";
const PROJECT = "project_a";
const startedAt = new Date();
const TODAY = todayDay();
const DOORS = { placement: placeMembership, workforce: endWorkforce };

let hr: UserContext;
let hse: UserContext;
let engineer: UserContext;
let trade: { id: string; name: string };
let createdLogId: string | null = null;

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { OR: [{ lastName: { startsWith: PREFIX } }, { lastName: { startsWith: IMPORTED } }] }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const employments = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const ids = employments.map((row) => row.id);
  const crews = await prisma.workforceCrew.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const crewIds = crews.map((row) => row.id);

  await prisma.dailyLogWorkforceEntry.deleteMany({ where: { crewId: { in: crewIds } } });
  await prisma.dailyLogWorkforceEntry.deleteMany({ where: { companyId: COMPANY, notes: "Assigned to the project", createdAt: { gte: startedAt } } });
  if (createdLogId) {
    await prisma.dailyLog.deleteMany({ where: { id: createdLogId } });
    createdLogId = null;
  }
  // Their approval cycles first: a pending cycle left without its record is
  // what verify:workflows reports as APPROVAL_CYCLE_WITHOUT_SOURCE.
  const hseRecords = [
    ...(await prisma.hseIncident.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } })),
    ...(await prisma.hseWorkPermit.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } })),
  ].map((row) => row.id);
  await prisma.hseApproval.deleteMany({ where: { recordId: { in: hseRecords } } });
  await prisma.hseIncident.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.hseWorkPermit.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.toolboxTalk.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.ppeCheck.deleteMany({ where: { subjectEmployeeProfileId: { in: ids } } });
  await prisma.hseInduction.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.workforceCrewMember.deleteMany({ where: { OR: [{ employeeProfileId: { in: ids } }, { crewId: { in: crewIds } }] } });
  await prisma.employeeProjectAssignment.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.workforceCrew.deleteMany({ where: { id: { in: crewIds } } });
  await prisma.employeeImportBatch.deleteMany({ where: { fileName: { startsWith: PREFIX } } });
  await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entityId: { in: [...personIds, ...ids] } }, { actionKey: { startsWith: "WORKFORCE_" } }] } });
  await prisma.activity.deleteMany({ where: { createdAt: { gte: startedAt }, companyId: COMPANY, OR: [{ entityId: { in: ids } }, { module: "hse" }, { module: "dailyLogs" }, { entityType: "AttendanceRecord" }] } });
  await prisma.employmentChange.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.employmentStatusHistory.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.employmentAssignment.deleteMany({ where: { employeeProfileId: { in: ids } } });
  await prisma.employeeProfile.deleteMany({ where: { id: { in: ids } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
}

beforeAll(async () => {
  hr = await loginAs("HR");
  hse = await loginAs("HSE");
  engineer = await loginAs("ENGINEER");
  trade = await prisma.workforceTrade.upsert({
    where: { companyId_name: { companyId: COMPANY, name: `${PREFIX} Scaffolder` } },
    update: { isActive: true },
    create: { companyId: COMPANY, name: `${PREFIX} Scaffolder` },
    select: { id: true, name: true },
  });
});

afterEach(async () => {
  await removeCreated();
});

afterAll(async () => {
  await removeCreated();
  await prisma.workforceTrade.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
async function worker(firstName: string, extra: Record<string, unknown> = {}): Promise<{ id: string; personId: string }> {
  const created = await employees.createEmployeeProfile(
    hr,
    createEmployeeProfileSchema.parse({ subject: "NEW", firstName, lastName: `${PREFIX} Berisha`, employmentType: "FULL_TIME", workerCategory: "CONSTRUCTION_WORKER", tradeId: trade.id, confirmNewPerson: true, ...extra }),
  );
  await applyEmploymentChange(hr, created.id, employmentChangeSchema.parse({ action: "STATUS", status: "ACTIVE", reason: "HIRE", effectiveDate: addDays(TODAY, -30) }), DOORS);
  return { id: created.id, personId: created.personId };
}

const onProject = (employeeId: string) => assignToProject(hr, employeeId, projectAssignmentSchema.parse({ projectId: PROJECT, startDate: addDays(TODAY, -10) }));

describe("HSE records name workers without a login (§70-§74, §270)", () => {
  it("takes them as toolbox participants and as the subject of a PPE check", async () => {
    const somebody = await worker("Agron");
    const talk = await createToolboxTalk(
      hse,
      toolboxSchema.parse({ title: `${PREFIX} Working at height`, topic: "Harnesses", talkDate: TODAY, conductedByMemberId: hse.membershipId, participants: [{ companyMemberId: `employee:${somebody.id}`, attendanceStatus: "ATTENDED" }] }),
    );
    expect(talk.participants).toHaveLength(1);
    expect(talk.participants[0]).toMatchObject({ member: null, worker: { employeeId: somebody.id } });

    const check = await createPpeCheck(hse, ppeCheckSchema.parse({ checkDate: TODAY, subjectMemberId: `employee:${somebody.id}`, helmetOk: "yes", footwearOk: "no" }));
    expect(check.subjectWorker?.employeeId).toBe(somebody.id);
    expect(check.subject).toBeNull();

    const summary = await workerHseSummary(hse, somebody.id);
    expect(summary).toMatchObject({ toolboxTalks: 1, lastPpeCheck: { date: TODAY } });

    // Another company's employee is not somebody this company's safety record can name.
    const foreign = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: "company_demo_b" }, select: { id: true } });
    await expectError(createPpeCheck(hse, ppeCheckSchema.parse({ checkDate: TODAY, subjectMemberId: `employee:${foreign.id}`, helmetOk: "yes" })), "VALIDATION_ERROR");
  });

  it("records who an incident involved, and keeps the details with the incident (§73, §84)", async () => {
    const somebody = await worker("Bujar");
    const incident = await createIncident(
      hse,
      incidentSchema.parse({ incidentType: INCIDENT_TYPES[0], title: `${PREFIX} Fall from a ladder`, description: "Slipped on the third rung.", occurredAt: new Date(Date.now() - 3_600_000), severity: "LOW", injuryOccurred: true }),
    );
    await addIncidentPerson(hse, incident.id, { employeeId: somebody.id, involvement: "INJURED", notes: "Bruised arm" });
    await addIncidentPerson(hse, incident.id, { externalName: "Delivery driver", involvement: "WITNESS" });
    await expectError(addIncidentPerson(hse, incident.id, { employeeId: somebody.id, involvement: "WITNESS" }), "CONFLICT", "ALREADY_RECORDED");
    await expectError(addIncidentPerson(hse, incident.id, { employeeId: somebody.id, externalName: "Both", involvement: "WITNESS" }), "VALIDATION_ERROR");

    const people = await listIncidentPeople(hse, incident.id);
    expect(people.map((person) => person.worker?.employeeId ?? person.externalName)).toEqual([somebody.id, "Delivery driver"]);
    // Somebody who cannot open the incident learns nothing about who was in it.
    await expectError(listIncidentPeople(engineer, incident.id), "NOT_FOUND");

    const summary = await workerHseSummary(hse, somebody.id);
    expect(summary?.incidents).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("Bruised");

    await removeIncidentPerson(hse, incident.id, people[1]!.id);
    expect(await listIncidentPeople(hse, incident.id)).toHaveLength(1);
  });

  it("lets a draft permit cover a person or a whole crew, and no longer once it is submitted (§74)", async () => {
    const somebody = await worker("Luan");
    const crew = await createCrew(hr, { name: `${PREFIX} Hot work`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    await assignToCrew(hr, somebody.id, crewAssignmentSchema.parse({ crewId: crew.id, startDate: addDays(TODAY, -5) }));
    const now = Date.now();
    const permit = await createPermit(hse, permitSchema.parse({ permitType: PERMIT_TYPES[0], title: `${PREFIX} Welding on level 3`, projectId: PROJECT, locationText: "Level 3", validFrom: new Date(now + 3_600_000), validUntil: new Date(now + 86_400_000), hazardsSummary: "Sparks", controlsSummary: "Fire watch" }));
    await addPermitWorker(hse, permit.id, { employeeId: somebody.id });
    await addPermitWorker(hse, permit.id, { crewId: crew.id });
    await expectError(addPermitWorker(hse, permit.id, { employeeId: somebody.id }), "CONFLICT", "ALREADY_COVERED");
    const covered = await listPermitWorkers(hse, permit.id);
    expect(covered.find((row) => row.crew)?.crew).toMatchObject({ id: crew.id, size: 1 });
    expect(covered.find((row) => row.worker)?.worker?.employeeId).toBe(somebody.id);

    await submitPermit(hse, permit.id);
    const another = await worker("Mirel");
    await expectError(addPermitWorker(hse, permit.id, { employeeId: another.id }), "CONFLICT");
  });

  it("inducts people on a project, lists who works there without one, and voids by reason (§71, §183)", async () => {
    const inducted = await worker("Nexhat");
    const waiting = await worker("Petrit");
    await onProject(inducted.id);
    await onProject(waiting.id);

    const before = (await workersMissingInduction(hse, PROJECT)).map((row) => row.employeeId);
    expect(before).toEqual(expect.arrayContaining([inducted.id, waiting.id]));

    const induction = await recordInduction(hse, { employeeId: inducted.id, projectId: PROJECT, inductedOn: TODAY, validUntil: addDays(TODAY, 365) });
    expect(induction).toMatchObject({ valid: true, worker: { employeeId: inducted.id } });
    const after = (await workersMissingInduction(hse, PROJECT)).map((row) => row.employeeId);
    expect(after).toContain(waiting.id);
    expect(after).not.toContain(inducted.id);
    expect((await inductionsForProject(hse, PROJECT)).map((row) => row.id)).toContain(induction.id);

    await expectError(recordInduction(hse, { employeeId: waiting.id, projectId: PROJECT, inductedOn: addDays(TODAY, 1) }), "VALIDATION_ERROR");
    // Reading HSE is not recording it: the CEO sees inductions and gives none (an engineer on the project may).
    await expectError(recordInduction(await loginAs("CEO"), { employeeId: waiting.id, projectId: PROJECT, inductedOn: TODAY }), "FORBIDDEN");

    await voidInduction(hse, induction.id, "Recorded for the wrong person");
    expect((await workersMissingInduction(hse, PROJECT)).map((row) => row.employeeId)).toContain(inducted.id);
    await expectError(voidInduction(hse, induction.id, "Again"), "CONFLICT");
  });
});

describe("the daily log suggests the day's workforce (§43, §44, §182)", () => {
  it("offers the crews on the project with the site sheet's headcount, and people assigned in no crew", async () => {
    const one = await worker("Qazim");
    const two = await worker("Rexhep");
    const loose = await worker("Sadik");
    const crew = await createCrew(hr, { name: `${PREFIX} Blockwork`, projectId: PROJECT, siteId: null, tradeId: trade.id, supervisorEmployeeId: null, notes: null });
    for (const member of [one, two]) await assignToCrew(hr, member.id, crewAssignmentSchema.parse({ crewId: crew.id, startDate: addDays(TODAY, -5) }));
    await onProject(loose.id);
    // One of the two was marked present on the site sheet today.
    await saveAttendanceSheet(hr, saveSheetSchema.parse({ date: TODAY, crewId: crew.id, rows: [{ employeeId: one.id, status: "PRESENT" }, { employeeId: two.id, status: "ABSENT" }] }));

    const log = await createDailyLog(engineer, { projectId: PROJECT, workDate: TODAY });
    if (log.created) createdLogId = log.id;
    const suggestions = await workforceSuggestions(engineer, log.id);
    const fromCrew = suggestions.find((row) => row.crewId === crew.id);
    expect(fromCrew).toMatchObject({ headcount: 1, basis: "ATTENDANCE", crewName: `${PREFIX} Blockwork`, trade: trade.name });
    const assigned = suggestions.find((row) => row.basis === "ASSIGNED" && row.trade === trade.name);
    expect(assigned?.headcount).toBeGreaterThanOrEqual(1);

    expect(await applyWorkforceSuggestions(engineer, log.id, [fromCrew!.key])).toEqual({ added: 1 });
    const entry = await prisma.dailyLogWorkforceEntry.findFirstOrThrow({ where: { dailyLogId: log.id, crewId: crew.id } });
    expect(entry).toMatchObject({ headcount: 1, crewName: `${PREFIX} Blockwork` });
    // A crew already on the log is not offered twice.
    expect((await workforceSuggestions(engineer, log.id)).some((row) => row.crewId === crew.id)).toBe(false);
  });
});

describe("importing the workforce in bulk (§93-§98, §224, §225, §273)", () => {
  it("checks every row, flags duplicates, imports the good ones with their project and crew, and only once", async () => {
    await worker("Taken", { employeeNumber: `${PREFIX}-001` });
    await worker("Arta");
    const crew = await createCrew(hr, { name: `${PREFIX} Plaster`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: PROJECT }, select: { name: true } });
    const csv = [
      "Employee code,First name,Last name,Trade,Category,Start date,Project,Crew,Salary,Account required",
      `${PREFIX}-101,Ilir,${IMPORTED} Kola,${trade.name},Construction worker,01.09.2026,${project.name},${PREFIX} Plaster,900,No`,
      `${PREFIX}-102,Vesa,${IMPORTED} Leka,,Driver,2026-09-02,,,,Yes`,
      `${PREFIX}-103,Gent,,${trade.name},,,,,,`,
      `${PREFIX}-104,Mira,${IMPORTED} Dema,Astronaut,,,,,,`,
      `${PREFIX}-102,Dua,${IMPORTED} Kraja,,,,,,,`,
      `${PREFIX}-001,Erion,${IMPORTED} Shala,,,,,,,`,
      `${PREFIX}-105,Toni,${IMPORTED} Zeka,,,31/02/2026,,,,`,
      `${PREFIX}-106,Arta,${PREFIX} Berisha,,,,,,,`,
    ].join("\n");

    await expectError(previewImport(engineer, { fileName: `${PREFIX} people.csv`, csv }), "FORBIDDEN");
    const batch = await previewImport(hr, { fileName: `${PREFIX} people.csv`, csv });
    expect(batch).toMatchObject({ rowCount: 8, validCount: 3, errorCount: 5, ignoredColumns: ["Salary"] });
    const byLine = new Map(batch.rows.map((row) => [row.line, row]));
    expect(byLine.get(4)!.errors).toContain("Last name is missing.");
    expect(byLine.get(5)!.errors[0]).toContain("is not one of this company's trades");
    expect(byLine.get(6)!.errors[0]).toContain("also on row 3");
    expect(byLine.get(7)!.errors[0]).toContain("already used in this company");
    expect(byLine.get(8)!.errors[0]).toContain("is not a date");
    expect(byLine.get(3)!.warnings.join(" ")).toContain("makes no NESTO account");
    expect(byLine.get(9)!.warnings.join(" ")).toContain("already in the group");

    const result = await commitImport(hr, batch.id);
    expect(result).toMatchObject({ createdCount: 3, assignedCount: 1, crewedCount: 1 });
    await expectError(commitImport(hr, batch.id), "CONFLICT");

    const ilir = await prisma.employeeProfile.findFirstOrThrow({
      where: { companyId: COMPANY, employeeNumber: `${PREFIX}-101` },
      select: { id: true, employmentStatus: true, companyMemberId: true, startDate: true, tradeId: true, workerCategory: true, projectAssignments: { select: { projectId: true, isPrimary: true } }, crewMemberships: { select: { crewId: true } } },
    });
    expect(ilir).toMatchObject({ employmentStatus: "ACTIVE", companyMemberId: null, tradeId: trade.id, workerCategory: "CONSTRUCTION_WORKER" });
    expect(ilir.startDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(ilir.projectAssignments).toEqual([{ projectId: PROJECT, isPrimary: true }]);
    expect(ilir.crewMemberships).toEqual([{ crewId: crew.id }]);
    expect(await prisma.auditEvent.count({ where: { actionKey: "WORKFORCE_IMPORT_COMMITTED", entityId: batch.id } })).toBe(1);
    expect(await prisma.employeeImportBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { includesPay: true, status: true, createdCount: true } })).toEqual({ includesPay: true, status: "COMMITTED", createdCount: 3 });

    // Every imported employment agrees with its history (E-03), as one made by hand does.
    const imported = await prisma.employeeProfile.findMany({ where: { personProfile: { lastName: { startsWith: IMPORTED } } }, select: { id: true } });
    const findings = (await findEmploymentFindings(prisma)).filter((finding) => finding.employmentId && imported.some((row) => row.id === finding.employmentId));
    expect(findings).toEqual([]);
  });

  it("takes a thousand people at once (§224)", { timeout: 180_000 }, async () => {
    const lines = ["First name,Last name,Employee code,Start date"];
    for (let index = 1; index <= 1000; index += 1) lines.push(`Worker${index},${IMPORTED} Bulk${index},${PREFIX}-B${String(index).padStart(4, "0")},2026-09-01`);
    const batch = await previewImport(hr, { fileName: `${PREFIX} thousand.csv`, csv: lines.join("\n") });
    expect(batch).toMatchObject({ rowCount: 1000, validCount: 1000, errorCount: 0 });
    const result = await commitImport(hr, batch.id);
    expect(result.createdCount).toBe(1000);
    expect(result.failed).toEqual([]);
    expect(await prisma.employeeProfile.count({ where: { companyId: COMPANY, employeeNumber: { startsWith: `${PREFIX}-B` }, companyMemberId: null } })).toBe(1000);
  });
});

describe("verify:employee-integrity (§197, §198)", () => {
  it("finds nothing wrong in the seeded company, and notices a crew membership that outlived its employment", async () => {
    const mine = (findings: Awaited<ReturnType<typeof findWorkforceFindings>>, ids: string[]) => findings.filter((finding) => ids.includes(finding.id));
    const somebody = await worker("Valon");
    const crew = await createCrew(hr, { name: `${PREFIX} Integrity`, projectId: PROJECT, siteId: null, tradeId: null, supervisorEmployeeId: null, notes: null });
    const membership = await assignToCrew(hr, somebody.id, crewAssignmentSchema.parse({ crewId: crew.id, startDate: addDays(TODAY, -5) }));
    expect(mine(await findWorkforceFindings(prisma), [membership.id])).toEqual([]);

    // Ended behind HR's back, so the end door never ran: the check is what catches it.
    await prisma.employeeProfile.update({ where: { id: somebody.id }, data: { employmentStatus: "ENDED", endDate: new Date(`${addDays(TODAY, -1)}T12:00:00.000Z`) } });
    expect(mine(await findWorkforceFindings(prisma), [membership.id]).map((finding) => finding.code)).toEqual(["CREW_AFTER_END"]);
  });
});
