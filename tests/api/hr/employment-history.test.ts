import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyEmploymentChange, cancelScheduledChange } from "@/lib/modules/hr/employment/employment.change.service";
import { correctEmploymentHistory } from "@/lib/modules/hr/employment/employment.correction.service";
import { addDays, dayOf, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { deriveCache } from "@/lib/modules/hr/employment/employment.history";
import { findEmploymentFindings, repairEmploymentCaches } from "@/lib/modules/hr/employment/employment.integrity";
import { employmentAt, getEmploymentHistory, getPersonEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";
import { getOrganizationReport } from "@/lib/modules/hr/employment/employment.report";
import { runScheduledEmploymentChanges } from "@/lib/modules/hr/employment/employment.schedule";
import { correctionSchema, employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";
import { listPeople, updateManagedWorkProfile } from "@/lib/modules/people/people.service";
import * as team from "@/lib/modules/team/team.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { snapshotEmployments } from "./employment-fixture";

/**
 * Employment & organization history (E-03 §196-§224, §238-§250).
 *
 * Through the same services the routes, the pages and the worker call. Every
 * test that changes an employment snapshots everything the change can touch
 * and puts it back, so the next one starts from the seed.
 */

let hr: UserContext;
let ceo: UserContext;
let owner: UserContext;

const DOOR = { placement: placeMembership, workforce: endWorkforce };
const today = () => todayDay();

async function employmentOf(email: string, companyId: string = COMPANY.a) {
  return prisma.employeeProfile.findFirstOrThrow({
    where: { companyId, companyMember: { user: { email } } },
    select: { id: true, companyMemberId: true, personProfileId: true, jobTitle: true, departmentId: true, managerMemberId: true, companyMember: { select: { userId: true } } },
  });
}

function change(context: UserContext, employmentId: string, input: Record<string, unknown>) {
  return applyEmploymentChange(context, employmentId, employmentChangeSchema.parse({ effectiveDate: today(), ...input }), DOOR);
}

async function standing(employmentId: string) {
  return prisma.employmentAssignment.findMany({ where: { employeeProfileId: employmentId, supersededAt: null }, orderBy: { startDate: "asc" } });
}

async function inStep(employmentId: string) {
  const profile = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: employmentId } });
  const derived = await deriveCache(prisma, employmentId, profile.endDate);
  expect(derived).not.toBeNull();
  expect({ departmentId: profile.departmentId, jobTitle: profile.jobTitle, managerMemberId: profile.managerMemberId, employmentStatus: profile.employmentStatus }).toEqual({
    departmentId: derived!.departmentId,
    jobTitle: derived!.jobTitle,
    managerMemberId: derived!.managerMemberId,
    employmentStatus: derived!.employmentStatus,
  });
  expect(await prisma.employmentAssignment.count({ where: { employeeProfileId: employmentId, endDate: null, supersededAt: null } })).toBeLessThanOrEqual(1);
}

async function withSnapshot<T>(employmentIds: string[], body: () => Promise<T>): Promise<T> {
  const restore = await snapshotEmployments(employmentIds);
  try {
    return await body();
  } finally {
    await restore();
  }
}

beforeAll(async () => {
  [hr, ceo, owner] = await Promise.all([loginAs("HR"), loginAs("CEO"), loginAs("OWNER")]);
});

afterAll(async () => {
  await cleanupSessions();
});

describe("dated changes (E-03 §13-§17, §203-§206, §240-§242)", () => {
  it("promotes: the old assignment closes, the new one opens, the profile and the membership follow, and it is audited", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      const before = await standing(engineer.id);
      const result = await change(hr, engineer.id, { action: "POSITION", jobTitle: "Senior Structural Engineer", reason: "PROMOTION" });
      expect(result.outcome).toBe("APPLIED");

      const after = await standing(engineer.id);
      expect(after).toHaveLength(before.length + 1);
      const closed = after.find((row) => row.id === before[before.length - 1]!.id)!;
      expect(closed.endDate && dayOf(closed.endDate)).toBe(addDays(today(), -1));
      const open = after[after.length - 1]!;
      expect({ jobTitle: open.jobTitle, reason: open.reason, endDate: open.endDate, start: dayOf(open.startDate) }).toEqual({ jobTitle: "Senior Structural Engineer", reason: "PROMOTION", endDate: null, start: today() });

      const profile = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: engineer.id }, select: { jobTitle: true } });
      const member = await prisma.companyMember.findUniqueOrThrow({ where: { id: engineer.companyMemberId! }, select: { jobTitle: true, roleId: true } });
      expect(profile.jobTitle).toBe("Senior Structural Engineer");
      // The membership carries the title; the NESTO role is never a consequence of a promotion (§107).
      expect(member.jobTitle).toBe("Senior Structural Engineer");
      const audit = await prisma.auditEvent.findFirst({ where: { actionKey: "HR_EMPLOYMENT_ASSIGNMENT_CHANGED", entityId: engineer.id }, orderBy: { createdAt: "desc" } });
      expect(audit).not.toBeNull();
      await inStep(engineer.id);
    });
  });

  it("transfers a department: the membership and the department's team move with it (ADR 0004)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const projects = await prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.a, key: "projects" }, select: { id: true } });
    await withSnapshot([engineer.id], async () => {
      await change(hr, engineer.id, { action: "DEPARTMENT", departmentId: projects.id });
      const member = await prisma.companyMember.findUniqueOrThrow({ where: { id: engineer.companyMemberId! }, select: { departmentId: true } });
      expect(member.departmentId).toBe(projects.id);
      const places = await prisma.departmentAssignment.findMany({ where: { userId: engineer.companyMember!.userId, companyId: COMPANY.a, positionLevel: "MEMBER" }, select: { companyDepartmentId: true, status: true } });
      expect(places).toEqual(expect.arrayContaining([{ companyDepartmentId: projects.id, status: "ACTIVE" }, { companyDepartmentId: engineer.departmentId, status: "INACTIVE" }]));
      expect((await standing(engineer.id)).at(-1)!.reason).toBe("DEPARTMENT_TRANSFER");
      await inStep(engineer.id);
    });
  });

  it("changes a manager, keeps the previous one in the history, and refuses a loop (§112, §113)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const pm = await employmentOf("pm@nesto.test");
    const ceoMember = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.a, user: { email: "ceo@nesto.test" } }, select: { id: true } });
    await withSnapshot([engineer.id, pm.id], async () => {
      const previousManager = (await standing(engineer.id)).at(-1)!.managerName;
      await change(hr, engineer.id, { action: "MANAGER", managerMemberId: ceoMember.id });
      const rows = await standing(engineer.id);
      expect(rows.at(-2)!.managerName).toBe(previousManager);
      expect(rows.at(-1)!.managerMemberId).toBe(ceoMember.id);

      // The engineer now reports to the CEO, who reports to the owner; the PM manages nobody in that line —
      // so make the engineer the PM's manager, then the PM the engineer's: a loop.
      await change(hr, pm.id, { action: "MANAGER", managerMemberId: engineer.companyMemberId });
      await expect(change(hr, engineer.id, { action: "MANAGER", managerMemberId: pm.companyMemberId })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "MANAGER_CYCLE" } });
    });
  });

  it("refuses a stale form, and two simultaneous changes leave one current assignment (§40, §207, §248)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      const current = (await standing(engineer.id)).at(-1)!;
      const results = await Promise.allSettled([
        change(hr, engineer.id, { action: "POSITION", jobTitle: "Engineer One", reason: "TITLE_CHANGE", expectedAssignmentId: current.id }),
        change(hr, engineer.id, { action: "POSITION", jobTitle: "Engineer Two", reason: "TITLE_CHANGE", expectedAssignmentId: current.id }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(AccessError);
      expect((refused.reason as AccessError).code).toBe("CONFLICT");
      expect(await prisma.employmentAssignment.count({ where: { employeeProfileId: engineer.id, endDate: null, supersededAt: null } })).toBe(1);
      await inStep(engineer.id);
    });
  });

  it("backdates only with the right to correct history, and only inside the current period (§86-§88)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      const current = (await standing(engineer.id)).at(-1)!;
      const start = dayOf(current.startDate);
      const withoutCorrect = { ...hr, permissions: hr.permissions.filter((permission) => permission !== "hr.employment_history.correct") } as UserContext;
      await expect(change(withoutCorrect, engineer.id, { action: "LOCATION", workLocationType: "SITE", workLocation: "East Gate", effectiveDate: addDays(start, 1) })).rejects.toMatchObject({ code: "FORBIDDEN" });

      await change(hr, engineer.id, { action: "LOCATION", workLocationType: "SITE", workLocation: "East Gate", effectiveDate: addDays(start, 1) });
      const rows = await standing(engineer.id);
      expect(dayOf(rows.at(-1)!.startDate)).toBe(addDays(start, 1));
      expect(dayOf(rows.at(-2)!.endDate!)).toBe(start);

      await expect(change(hr, engineer.id, { action: "LOCATION", workLocationType: "OFFICE", effectiveDate: addDays(start, -5) })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "BEFORE_CURRENT_PERIOD" } });
      await inStep(engineer.id);
    });
  });
});

describe("scheduled changes (E-03 §31-§34, §153-§157, §208-§210, §226)", () => {
  it("schedules a change, applies it once on its day — late if the worker was down — and never applies a cancelled one", async () => {
    const sales = await employmentOf("sales@nesto.test");
    await withSnapshot([sales.id], async () => {
      const location = await change(hr, sales.id, { action: "LOCATION", workLocationType: "HYBRID", workLocation: "Tirana", effectiveDate: addDays(today(), 5) });
      expect(location.outcome).toBe("SCHEDULED");
      // Nothing is in effect before its day.
      expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id: sales.id }, select: { workLocationType: true } })).workLocationType).not.toBe("HYBRID");
      // Another change for the same day is refused rather than stacked (§170).
      await expect(change(hr, sales.id, { action: "EMPLOYMENT_TYPE", employmentType: "PART_TIME", effectiveDate: addDays(today(), 5) })).rejects.toMatchObject({ details: { code: "SCHEDULE_CLASH" } });
      const type = await change(hr, sales.id, { action: "EMPLOYMENT_TYPE", employmentType: "PART_TIME", effectiveDate: addDays(today(), 7) });
      await cancelScheduledChange(hr, sales.id, type.scheduledChangeId!, "Not agreed after all");

      // The worker runs eight days from now, having missed day five: the change applies once, dated day five.
      const now = new Date(Date.now() + 8 * 86_400_000);
      const first = await runScheduledEmploymentChanges(now, DOOR);
      expect(first.applied).toBeGreaterThanOrEqual(1);
      const rows = await standing(sales.id);
      const applied = rows.find((row) => row.workLocationType === "HYBRID")!;
      expect(dayOf(applied.startDate)).toBe(addDays(today(), 5));
      expect(applied.source).toBe("SCHEDULED");
      expect(rows.some((row) => row.employmentType === "PART_TIME")).toBe(false);
      expect((await prisma.employmentChange.findUniqueOrThrow({ where: { id: type.scheduledChangeId! } })).status).toBe("CANCELLED");

      // A second run finds nothing to do (§155).
      const second = await runScheduledEmploymentChanges(now, DOOR);
      expect(second.applied).toBe(0);
      expect((await standing(sales.id)).filter((row) => row.workLocationType === "HYBRID")).toHaveLength(1);
    });
  });

  it("marks a change that can no longer apply as failed, and tells whoever scheduled it", async () => {
    const sales = await employmentOf("sales@nesto.test");
    const architect = await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.a, user: { email: "architect@nesto.test" } }, select: { id: true, status: true } });
    await withSnapshot([sales.id], async () => {
      const scheduled = await change(hr, sales.id, { action: "MANAGER", managerMemberId: architect.id, effectiveDate: addDays(today(), 3) });
      await prisma.companyMember.update({ where: { id: architect.id }, data: { status: "INACTIVE" } });
      try {
        await runScheduledEmploymentChanges(new Date(Date.now() + 4 * 86_400_000), DOOR);
        const row = await prisma.employmentChange.findUniqueOrThrow({ where: { id: scheduled.scheduledChangeId! } });
        expect(row.status).toBe("FAILED");
        expect(row.failureReason).toMatch(/manager/i);
        const told = await prisma.notificationEventOutbox.findFirst({ where: { eventType: "EMPLOYMENT_CHANGE_FAILED", entityId: sales.id }, orderBy: { createdAt: "desc" } });
        expect(told).not.toBeNull();
      } finally {
        await prisma.companyMember.update({ where: { id: architect.id }, data: { status: architect.status } });
      }
    });
  });
});

describe("ending, rehire and transfer (E-03 §13, §91-§95, §196, §197, §212, §213, §221)", () => {
  it("ends employment: the assignment closes, the history stays, what was scheduled is cancelled — and a rehire starts a new period", async () => {
    const sales = await employmentOf("sales@nesto.test");
    await withSnapshot([sales.id], async () => {
      const before = await prisma.employmentAssignment.count({ where: { employeeProfileId: sales.id } });
      const pending = await prisma.employmentChange.findFirstOrThrow({ where: { employeeProfileId: sales.id, status: "SCHEDULED" }, select: { id: true } });
      const lastDay = addDays(today(), -10);
      await change(hr, sales.id, { action: "TERMINATE", lastWorkingDay: lastDay, reason: "RESIGNATION", privateReason: "Moving abroad" });

      const profile = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: sales.id }, select: { employmentStatus: true, endDate: true } });
      expect(profile.employmentStatus).toBe("ENDED");
      expect(dayOf(profile.endDate!)).toBe(lastDay);
      expect(await prisma.employmentAssignment.count({ where: { employeeProfileId: sales.id } })).toBe(before);
      expect(await prisma.employmentAssignment.count({ where: { employeeProfileId: sales.id, endDate: null, supersededAt: null } })).toBe(0);
      expect((await prisma.employmentChange.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("CANCELLED");
      await inStep(sales.id);

      await change(hr, sales.id, { action: "REHIRE", effectiveDate: today() });
      const statuses = await prisma.employmentStatusHistory.findMany({ where: { employeeProfileId: sales.id, supersededAt: null }, orderBy: { effectiveFrom: "asc" }, select: { status: true, reason: true, effectiveFrom: true, effectiveTo: true } });
      expect(statuses.slice(-2).map((row) => [row.status, row.reason])).toEqual([["ENDED", "RESIGNATION"], ["ACTIVE", "REHIRE"]]);
      expect(dayOf(statuses.at(-2)!.effectiveTo!)).toBe(addDays(today(), -1));
      const rows = await standing(sales.id);
      expect(rows.at(-1)!.reason).toBe("REHIRE");
      expect(rows.length).toBe(before + 1);
      await inStep(sales.id);
    });
  });

  it("moves somebody to another company of the group and keeps where they were (§13, §196, §221)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const engineeringB = await prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.b, key: "engineering" }, select: { id: true } });
    await withSnapshot([engineer.id], async () => {
      const result = await change(hr, engineer.id, { action: "LEGAL_ENTITY", targetCompanyId: COMPANY.b, departmentId: engineeringB.id, jobTitle: "Site Engineer" });
      expect(result.outcome).toBe("APPLIED");

      const here = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: engineer.id }, select: { employmentStatus: true, endDate: true } });
      expect(here.employmentStatus).toBe("ENDED");
      expect(dayOf(here.endDate!)).toBe(addDays(today(), -1));
      const there = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: result.employmentId }, select: { companyId: true, employmentStatus: true, jobTitle: true, personProfileId: true } });
      expect(there).toEqual({ companyId: COMPANY.b, employmentStatus: "ACTIVE", jobTitle: "Site Engineer", personProfileId: engineer.personProfileId });
      expect((await standing(result.employmentId))[0]!.reason).toBe("LEGAL_ENTITY_TRANSFER");

      // Group HR sees both companies in the person's history (§66).
      const history = await getPersonEmploymentHistory(hr, engineer.personProfileId);
      expect(new Set(history.employments.map((row) => row.employment.company.id))).toEqual(new Set([COMPANY.a, COMPANY.b]));
      expect(history.timeline.some((event) => event.kind === "LEGAL_ENTITY_TRANSFER" && event.company.id === COMPANY.b)).toBe(true);
      await inStep(engineer.id);
      await inStep(result.employmentId);
    });
  });

  it("refuses a company of another group, and any id from one (§5, §197, §201)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const foreignDepartment = await prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true } });
    await expect(change(hr, engineer.id, { action: "LEGAL_ENTITY", targetCompanyId: COMPANY.tenant, departmentId: foreignDepartment.id, jobTitle: "Engineer" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(change(hr, engineer.id, { action: "DEPARTMENT", departmentId: foreignDepartment.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const tenantEmployment = await prisma.employeeProfile.findFirst({ where: { company: { id: COMPANY.tenant } }, select: { id: true, personProfileId: true } });
    // Another group's employment, or — when it has none — a login there, which addresses nothing in HR.
    const foreign = tenantEmployment?.id ?? (await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true } })).id;
    await expect(change(hr, foreign, { action: "POSITION", jobTitle: "Anything", reason: "OTHER" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    if (tenantEmployment) await expect(getPersonEmploymentHistory(hr, tenantEmployment.personProfileId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("corrections (E-03 §42-§44, §171, §211, §224)", () => {
  it("corrects a row with a reason: the original stays, the row before it moves, and the audit keeps both", async () => {
    const architect = await employmentOf("architect@nesto.test");
    await withSnapshot([architect.id], async () => {
      const [first, promotion] = await standing(architect.id);
      expect(promotion!.reason).toBe("PROMOTION");
      const newStart = addDays(dayOf(promotion!.startDate), 10);
      expect(correctionSchema.safeParse({ kind: "ASSIGNMENT", rowId: promotion!.id, startDate: newStart }).success).toBe(false);

      await correctEmploymentHistory(hr, architect.id, correctionSchema.parse({ kind: "ASSIGNMENT", rowId: promotion!.id, startDate: newStart, correctionReason: "The promotion letter took effect later." }), DOOR);

      const rows = await standing(architect.id);
      expect(rows.map((row) => [row.reason, dayOf(row.startDate), row.endDate && dayOf(row.endDate)])).toEqual([
        [first!.reason, dayOf(first!.startDate), addDays(newStart, -1)],
        ["PROMOTION", newStart, null],
      ]);
      const originals = await prisma.employmentAssignment.findMany({ where: { id: { in: [first!.id, promotion!.id] } }, select: { supersededAt: true } });
      expect(originals.every((row) => row.supersededAt !== null)).toBe(true);
      expect(rows.every((row) => row.source === "CORRECTION" && row.correctionReason === "The promotion letter took effect later.")).toBe(true);
      const audit = await prisma.auditEvent.findFirst({ where: { actionKey: "HR_EMPLOYMENT_HISTORY_CORRECTED", entityId: architect.id }, orderBy: { createdAt: "desc" } });
      expect(JSON.stringify(audit)).toContain("The promotion letter took effect later.");

      // HR sees the original beside the correction; the employee sees their corrected history only (§128, §171).
      const hrView = await getEmploymentHistory(hr, architect.id);
      expect(hrView.assignments.filter((row) => row.supersededAt)).toHaveLength(2);
      const self = await getEmploymentHistory(await loginAs("ARCHITECT"), architect.id);
      expect(self.view).toBe("SELF");
      expect(self.assignments.every((row) => row.supersededAt === null && row.correctionReason === null && row.createdBy === null)).toBe(true);
      await inStep(architect.id);
    });
  });
});

describe("who sees history (E-03 §56-§62, §191-§200, §245)", () => {
  it("keeps the history from the CEO, IT, Finance and colleagues, while the CEO still sees the current record", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await expect(employees.getEmployee(ceo, engineer.id)).resolves.toMatchObject({ memberId: engineer.companyMemberId });
    await expect(getEmploymentHistory(ceo, engineer.id)).rejects.toBeInstanceOf(AccessError);
    for (const role of ["GROUP_IT", "FINANCE", "ARCHITECT"] as const) {
      await expect(getEmploymentHistory(await loginAs(role), engineer.id)).rejects.toBeInstanceOf(AccessError);
      await expect(getPersonEmploymentHistory(await loginAs(role), engineer.personProfileId)).rejects.toBeInstanceOf(AccessError);
    }
    // Finance cannot move anybody (§200); IT cannot edit history (§199).
    await expect(change(await loginAs("FINANCE"), engineer.id, { action: "DEPARTMENT", departmentId: engineer.departmentId! })).rejects.toBeInstanceOf(AccessError);
    await expect(change(await loginAs("GROUP_IT"), engineer.id, { action: "MANAGER", managerMemberId: null })).rejects.toBeInstanceOf(AccessError);
  });

  it("shows the employee their own history without HR's notes or private reasons, which only private HR reads (§24, §105, §128, §137)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      await change(hr, engineer.id, { action: "STATUS", status: "ON_LEAVE", privateReason: "Medical: surgery recovery", note: "HR-only note" });

      const hrView = await getEmploymentHistory(hr, engineer.id);
      expect(hrView.statuses.find((row) => row.status === "ON_LEAVE")!.privateReason).toBe("Medical: surgery recovery");

      const self = await getEmploymentHistory(await loginAs("ENGINEER"), engineer.id);
      expect(self.view).toBe("SELF");
      expect(JSON.stringify(self)).not.toContain("surgery");
      expect(JSON.stringify(self)).not.toContain("HR-only note");
      const person = await getPersonEmploymentHistory(await loginAs("ENGINEER"), engineer.personProfileId);
      expect(JSON.stringify(person)).not.toContain("surgery");

      const withoutPrivate = { ...hr, permissions: hr.permissions.filter((permission) => permission !== "hr.employment_history.view_private") } as UserContext;
      expect(JSON.stringify(await getEmploymentHistory(withoutPrivate, engineer.id))).not.toContain("surgery");

      const audits = await prisma.auditEvent.findMany({ where: { entityId: engineer.id }, orderBy: { createdAt: "desc" }, take: 5 });
      expect(JSON.stringify(audits)).not.toContain("surgery");
      const outbox = await prisma.notificationEventOutbox.findMany({ where: { entityId: engineer.id }, orderBy: { createdAt: "desc" }, take: 5 });
      expect(JSON.stringify(outbox)).not.toContain("surgery");
    });
  });

  it("indexes only current titles in the directory, never a past one (§138, §139, §218)", async () => {
    const people = await listPeople(hr, { q: "Junior Architect", page: 1, limit: 50, status: "active" });
    expect(people.data.map((row) => row.name)).toHaveLength(0);
    const current = await listPeople(hr, { q: "Lead Architect", page: 1, limit: 50, status: "active" });
    expect(current.data.length).toBeGreaterThan(0);
  });
});

describe("supporting documents (E-03 §45-§53, §202, §216, §244)", () => {
  it("links a canonical document by reference, never a copy, and never one of another company", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const created = await prisma.document.create({
      data: { companyId: COMPANY.a, name: "Promotion letter.pdf", module: "hr", entityType: "employee", entityId: engineer.id, status: "ACTIVE", createdBy: hr.userId },
      select: { id: true },
    });
    const foreign = await prisma.document.create({ data: { companyId: COMPANY.b, name: "Other company.pdf", status: "ACTIVE", createdBy: hr.userId }, select: { id: true } });
    try {
      await withSnapshot([engineer.id], async () => {
        const documents = await prisma.document.count();
        await change(hr, engineer.id, { action: "POSITION", jobTitle: "Lead Structural Engineer", reason: "PROMOTION", documentId: created.id });
        expect(await prisma.document.count()).toBe(documents);
        expect((await standing(engineer.id)).at(-1)!.sourceDocumentId).toBe(created.id);
        const view = await getEmploymentHistory(hr, engineer.id);
        expect(view.timeline[0]!.document?.id).toBe(created.id);

        await expect(change(hr, engineer.id, { action: "LOCATION", workLocationType: "SITE", documentId: foreign.id })).rejects.toMatchObject({ details: { code: "DOCUMENT_UNAVAILABLE" } });
      });
    } finally {
      await prisma.document.deleteMany({ where: { id: { in: [created.id, foreign.id] } } });
    }
  });
});

describe("one authority for placement (E-03 §180, §181, §187; ADR 0004)", () => {
  it("records a Team edit of an employee's title into the history instead of losing the old one", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      const member = await prisma.companyMember.findUniqueOrThrow({ where: { id: engineer.companyMemberId! }, select: { roleId: true, departmentId: true } });
      await team.updateMember(owner, engineer.companyMemberId!, { jobTitle: "Structural Lead", roleId: member.roleId, departmentId: member.departmentId ?? undefined, versionUpdatedAt: undefined }, { placement: placeMembership });
      const open = (await standing(engineer.id)).at(-1)!;
      expect({ jobTitle: open.jobTitle, source: open.source, reason: open.reason }).toEqual({ jobTitle: "Structural Lead", source: "SYNC", reason: "TITLE_CHANGE" });
      await inStep(engineer.id);
    });
  });

  it("refuses HR's People edit of an employee's title: it is the employment's (§187)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await expect(updateManagedWorkProfile(hr, engineer.personProfileId, { jobTitle: "Something else" } as Parameters<typeof updateManagedWorkProfile>[2])).rejects.toMatchObject({ code: "CONFLICT", details: { code: "TITLE_FROM_EMPLOYMENT" } });
  });

  it("finds drift between an employment and its history, and repairs it only when told to (§182)", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    await withSnapshot([engineer.id], async () => {
      await prisma.employeeProfile.update({ where: { id: engineer.id }, data: { jobTitle: "Drifted" } });
      const findings = await findEmploymentFindings(prisma);
      expect(findings.some((finding) => finding.code === "CACHE_DRIFT" && finding.employmentId === engineer.id)).toBe(true);
      expect((await repairEmploymentCaches(prisma, { apply: false })).map((row) => row.employmentId)).toContain(engineer.id);
      expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id: engineer.id } })).jobTitle).toBe("Drifted");
      await repairEmploymentCaches(prisma, { apply: true });
      expect((await prisma.employeeProfile.findUniqueOrThrow({ where: { id: engineer.id } })).jobTitle).toBe(engineer.jobTitle);
    });
  });
});

describe("as of a date (E-03 §141-§144, §178, §214, §247)", () => {
  it("places people where they were on the day, and counts only who was employed then", async () => {
    const engineer = await employmentOf("engineer@nesto.test");
    const transfer = (await standing(engineer.id)).find((row) => row.reason === "DEPARTMENT_TRANSFER")!;
    const before = addDays(dayOf(transfer.startDate), -1);
    expect((await employmentAt(engineer.id, before)).assignment?.departmentName).toBe("Projects");
    expect((await employmentAt(engineer.id, today())).assignment?.departmentName).toBe("Engineering");

    const then = await getOrganizationReport(hr, { asOf: before });
    const now = await getOrganizationReport(hr, { asOf: today() });
    const count = (report: typeof now, label: string) => report.byDepartment.find((row) => row.label === `${label} · Aurelia Construction`)?.count ?? 0;
    // The engineer moved from Projects to Engineering: Engineering has them now and did not then.
    expect(count(now, "Engineering") - count(then, "Engineering")).toBeGreaterThanOrEqual(1);
    expect((await getOrganizationReport(hr, { asOf: "2019-01-01" })).headcount).toBe(0);
    expect(now.headcount).toBeGreaterThan(20);
    // The CEO has no history view, so no organization report either (§59, §195).
    await expect(getOrganizationReport(ceo, {})).rejects.toBeInstanceOf(AccessError);
  });

  it("leaves every employment in step with its history after all of the above (§215)", async () => {
    const errors = (await findEmploymentFindings(prisma)).filter((finding) => finding.level === "error");
    expect(errors).toEqual([]);
  });
});

describe("the demo's history (E-03 §123)", () => {
  it("tells a transfer between two of the group's companies to Group HR, and to the person", async () => {
    const aurelia = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: "employee_emp_022" }, select: { personProfileId: true } });
    const history = await getPersonEmploymentHistory(hr, aurelia.personProfileId);
    expect(history.timeline.map((event) => event.kind)).toEqual(expect.arrayContaining(["LEGAL_ENTITY_TRANSFER", "TERMINATED", "HIRE"]));
    const self = await getPersonEmploymentHistory(await loginAsEmail(DEMO_EMAIL.multiCompany), aurelia.personProfileId);
    expect(self.isSelf).toBe(true);
    expect(self.employments.length).toBe(2);
  });
});
