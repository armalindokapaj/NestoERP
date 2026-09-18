import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { loadRecord } from "@/lib/core/records/record.registry";
import type { UserContext } from "@/lib/context/types";
import { canReachDocumentParent } from "@/lib/modules/documents/document.parent-access";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { today } from "@/lib/modules/hr/hr.calendar";
import {
  createAttendanceSchema,
  createEmployeeProfileSchema,
  createLeaveSchema,
  employeeListQuerySchema,
  leaveBalanceSchema,
  updateEmployeeProfileSchema,
} from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { createProvisioningRequestSchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import * as provisioning from "@/lib/modules/organization/provisioning/provisioning.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Employees without a NESTO account (E-04 §5, §14, §88-§92, §228-§230).
 *
 * Most of a construction company's workforce never signs in. They are a person
 * and an employment, addressed by the employment, and everything HR keeps —
 * leave, attendance, documents, history — hangs off that employment, so a login
 * requested later joins the same record rather than starting a second one.
 * Every row a test creates is removed afterwards.
 */

const PREFIX = "T04W";
const startedAt = new Date();

let hr: UserContext;
let engineer: UserContext;
let trade: { id: string };

async function removeCreated(): Promise<void> {
  const people = await prisma.personProfile.findMany({ where: { lastName: { startsWith: PREFIX } }, select: { id: true } });
  const personIds = people.map((row) => row.id);
  const employments = await prisma.employeeProfile.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true, companyMemberId: true } });
  const employmentIds = employments.map((row) => row.id);
  const memberIds = employments.flatMap((row) => (row.companyMemberId ? [row.companyMemberId] : []));
  const members = await prisma.companyMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, userId: true } });
  const userIds = members.map((row) => row.userId);

  const requests = await prisma.userProvisioningRequest.findMany({ where: { personProfileId: { in: personIds } }, select: { id: true } });
  const leaveRows = await prisma.leaveRequest.findMany({ where: { employeeProfileId: { in: employmentIds } }, select: { id: true } });
  const assignments = await prisma.departmentAssignment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const trail = [...personIds, ...employmentIds, ...requests.map((row) => row.id), ...leaveRows.map((row) => row.id), ...assignments.map((row) => row.id)];
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail }, createdAt: { gte: startedAt } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.userProvisioningRequest.deleteMany({ where: { id: { in: requests.map((row) => row.id) } } });

  await prisma.attendanceRecord.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });
  await prisma.leaveBalance.deleteMany({ where: { employeeProfileId: { in: employmentIds } } });

  await prisma.employeeProfile.updateMany({ where: { id: { in: employmentIds } }, data: { companyMemberId: null } });
  await prisma.departmentAssignment.deleteMany({ where: { id: { in: assignments.map((row) => row.id) } } });
  await prisma.session.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { membershipId: { in: memberIds } }] } });
  await prisma.companyMember.deleteMany({ where: { id: { in: memberIds } } });
  await prisma.employeeProfile.deleteMany({ where: { id: { in: employmentIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.personProfile.deleteMany({ where: { id: { in: personIds } } });
}

beforeAll(async () => {
  hr = await loginAs("HR");
  engineer = await loginAs("ENGINEER");
  trade = await prisma.workforceTrade.upsert({
    where: { companyId_name: { companyId: hr.companyId, name: `${PREFIX} Steel fixer` } },
    update: { isActive: true },
    create: { companyId: hr.companyId, name: `${PREFIX} Steel fixer` },
    select: { id: true },
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

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/** A new worker with nothing to sign in with, as HR adds one from the form. */
function newWorker(firstName: string, extra: Record<string, unknown> = {}) {
  return employees.createEmployeeProfile(
    hr,
    createEmployeeProfileSchema.parse({
      subject: "NEW",
      firstName,
      lastName: `${PREFIX} Hoxha`,
      employmentType: "FULL_TIME",
      workerCategory: "CONSTRUCTION_WORKER",
      tradeId: trade.id,
      jobTitle: "Steel fixer",
      ...extra,
    }),
  );
}

/** Starts a planned employment today, so leave and attendance can be kept for it. */
async function start(employmentId: string) {
  await applyEmploymentChange(hr, employmentId, employmentChangeSchema.parse({ action: "STATUS", status: "ACTIVE", reason: "HIRE", effectiveDate: todayDay() }), {
    placement: placeMembership,
  });
}

/** A weekday in the recent past, so attendance may exist for it. */
function pastWorkingDay(daysBack: number): Date {
  const date = today();
  date.setUTCDate(date.getUTCDate() - daysBack);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

describe("an employee with no NESTO account (E-04 §5, §228)", () => {
  it("is a person and an employment, and nothing to sign in with", async () => {
    const created = await newWorker("Arben", { employeeNumber: `${PREFIX}-001` });

    expect(created).toMatchObject({
      memberId: null,
      accountStatus: "NO_ACCOUNT",
      workerCategory: "CONSTRUCTION_WORKER",
      trade: { id: trade.id },
      employmentStatus: "PLANNED",
    });
    expect(created.capabilities.canRequestAccount).toBe(true);

    const person = await prisma.personProfile.findUniqueOrThrow({ where: { id: created.personId } });
    expect(person).toMatchObject({ firstName: "Arben", lifecycleStatus: "EMPLOYEE", parentGroupId: hr.parentGroupId });
    expect(await prisma.user.count({ where: { personProfileId: created.personId } })).toBe(0);

    // Found by its account status, beside the employees who do sign in.
    const withoutLogin = await employees.listEmployees(hr, employeeListQuerySchema.parse({ accountStatus: ["NO_ACCOUNT"], limit: 100 }));
    expect(withoutLogin.data.map((row) => row.id)).toContain(created.id);
    expect(withoutLogin.data.every((row) => row.accountStatus === "NO_ACCOUNT")).toBe(true);
    const withLogin = await employees.listEmployees(hr, employeeListQuerySchema.parse({ accountStatus: ["HAS_ACCOUNT"], limit: 100 }));
    expect(withLogin.data.map((row) => row.id)).not.toContain(created.id);
    const byTrade = await employees.listEmployees(hr, employeeListQuerySchema.parse({ tradeId: trade.id, limit: 100 }));
    expect(byTrade.data.map((row) => row.id)).toEqual([created.id]);

    // The creation is audited, the person's too.
    expect(await prisma.auditEvent.count({ where: { entityId: created.id, actionKey: "HR_EMPLOYEE_CREATED" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: created.personId, actionKey: "HR_PERSON_PROFILE_CREATED" } })).toBe(1);
  });

  it("is addressed by the employment, and a login's id no longer finds anybody", async () => {
    const created = await newWorker("Besnik");
    expect((await employees.getEmployee(hr, created.id)).name.fullName).toBe(`Besnik ${PREFIX} Hoxha`);

    const ownMember = engineer.membershipId;
    await expectError(employees.getEmployee(hr, ownMember), "NOT_FOUND");
    // The old member address is translated only for links written before (the page redirects).
    expect(await employees.employmentIdForMember(hr, ownMember)).toBe((await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: ownMember } })).id);
  });

  it("warns about somebody the group may already have, and employs them once confirmed new", async () => {
    const first = await newWorker("Dritan", { workPhone: "+355 69 404 0404" });

    // Same name: HR is shown who it may be, and nothing is written.
    const people = await prisma.personProfile.count();
    const refused = await newWorker("Dritan").catch((error: AccessError) => error);
    expect(refused).toBeInstanceOf(AccessError);
    expect((refused as AccessError).code).toBe("CONFLICT");
    expect((refused as AccessError).details).toMatchObject({ code: "PROBABLE_DUPLICATE", candidates: [{ personId: first.personId, reasons: ["Same name"] }] });
    expect(await prisma.personProfile.count()).toBe(people);

    // A shared phone is as telling as a shared name.
    const byPhone = await newWorker("Genti", { personalPhone: "+355 69 404 0404" }).catch((error: AccessError) => error);
    expect((byPhone as AccessError).details).toMatchObject({ candidates: [{ personId: first.personId, reasons: ["Same phone"] }] });

    // Two people can share a name: once HR says so, the second is recorded.
    const second = await newWorker("Dritan", { confirmNewPerson: "true" });
    expect(second.personId).not.toBe(first.personId);
  });

  it("refuses a second employment here for a person already employed here", async () => {
    const created = await newWorker("Erion");
    await expect(
      employees.createEmployeeProfile(hr, createEmployeeProfileSchema.parse({ subject: "PERSON", personProfileId: created.personId, employmentType: "FULL_TIME" })),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { code: "HAS_EMPLOYMENT" } });
  });

  it("refuses another group's person, and a trade that is not this company's", async () => {
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const foreignPerson = await prisma.personProfile.findFirstOrThrow({ where: { parentGroupId: tenant.parentGroupId }, select: { id: true } });
    await expectError(
      employees.createEmployeeProfile(hr, createEmployeeProfileSchema.parse({ subject: "PERSON", personProfileId: foreignPerson.id, employmentType: "FULL_TIME" })),
      "VALIDATION_ERROR",
    );

    const foreignTrade = await prisma.workforceTrade.create({ data: { companyId: tenant.companyId, name: `${PREFIX} Welder` }, select: { id: true } });
    await expectError(newWorker("Fatos", { tradeId: foreignTrade.id }), "VALIDATION_ERROR");
  });

  it("keeps its category and trade on edit unless HR changes them, and audits the change", async () => {
    const created = await newWorker("Ilir");
    const kept = await employees.updateEmployeeProfile(hr, created.id, updateEmployeeProfileSchema.parse({ weeklyHours: "40" }));
    expect(kept).toMatchObject({ workerCategory: "CONSTRUCTION_WORKER", trade: { id: trade.id } });

    const cleared = await employees.updateEmployeeProfile(hr, created.id, updateEmployeeProfileSchema.parse({ weeklyHours: "40", workerCategory: "DRIVER", tradeId: "" }));
    expect(cleared).toMatchObject({ workerCategory: "DRIVER", trade: null });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: created.id, actionKey: "HR_EMPLOYEE_UPDATED" } });
    expect(audit.afterJson).toMatchObject({ workerCategory: "DRIVER", tradeId: null });
  });

  it("is invisible to a self-scoped reader and to another company", async () => {
    const created = await newWorker("Jetmir");
    await expectError(employees.getEmployee(engineer, created.id), "NOT_FOUND");
    await expectError(employees.getEmployee(await loginAsEmail(DEMO_EMAIL.tenantOwner), created.id), "NOT_FOUND");
    expect(await loadRecord(engineer, "employee", created.id)).toBeNull();

    const record = await loadRecord(hr, "employee", created.id);
    expect(record?.href).toBe(`/hr/employees/${created.id}`);
  });

  it("files documents against the employment, reachable by HR and not by the worker's colleagues", async () => {
    const created = await newWorker("Klodian");
    const ref = { projectId: null, clientId: null, module: "hr", entityType: "employee", entityId: created.id };
    expect(await canReachDocumentParent(hr, ref)).toBe(true);
    expect(await canReachDocumentParent(engineer, ref)).toBe(false);

    // The engineer's own file stays theirs through the self door, now by employment.
    const own = await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: engineer.membershipId }, select: { id: true } });
    expect(await canReachDocumentParent(engineer, { ...ref, entityId: own.id })).toBe(true);
  });
});

describe("leave and attendance for somebody who never signs in (E-04 §115, §120)", () => {
  it("lets HR record leave for them, decide it, and write their attendance", async () => {
    const created = await newWorker("Lulzim");
    await start(created.id);
    const year = today().getUTCFullYear();
    await leave.setLeaveBalance(hr, created.id, leaveBalanceSchema.parse({ leaveType: "ANNUAL", year, entitledDays: "20" }));

    const range = (() => {
      const startDate = today();
      startDate.setUTCDate(startDate.getUTCDate() + 21);
      while (startDate.getUTCDay() !== 1) startDate.setUTCDate(startDate.getUTCDate() + 1);
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      return { startDate, endDate };
    })();
    if (range.startDate.getUTCFullYear() !== year) {
      await leave.setLeaveBalance(hr, created.id, leaveBalanceSchema.parse({ leaveType: "ANNUAL", year: range.startDate.getUTCFullYear(), entitledDays: "20" }));
    }

    const requested = await leave.createLeave(hr, createLeaveSchema.parse({ leaveType: "ANNUAL", ...range, employeeId: created.id }));
    expect(requested.employee).toMatchObject({ employeeId: created.id, memberId: null });
    await leave.submitLeave(hr, requested.id);

    // HR asked for it, so somebody else with the grant decides it.
    const owner = await loginAs("OWNER");
    await leave.approveLeave(owner, requested.id, null);
    const rows = await prisma.attendanceRecord.findMany({ where: { sourceEntityId: requested.id }, select: { status: true, employeeProfileId: true, companyMemberId: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "ON_LEAVE" && row.employeeProfileId === created.id && row.companyMemberId === null)).toBe(true);

    // Nobody to notify: the worker has no login (the decision still stands).
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: requested.id, createdAt: { gte: startedAt } } })).toBe(0);

    const day = await attendance.createAttendance(hr, createAttendanceSchema.parse({ employeeId: created.id, date: pastWorkingDay(1), status: "PRESENT", checkIn: "07:00", checkOut: "15:30" }));
    expect(day).toMatchObject({ workedMinutes: 510, employee: { employeeId: created.id, memberId: null } });
    await expectError(
      attendance.createAttendance(hr, createAttendanceSchema.parse({ employeeId: created.id, date: pastWorkingDay(1), status: "ABSENT" })),
      "CONFLICT",
    );

    const balances = await leave.getBalances(hr, created.id, year);
    expect(balances.find((row) => row.leaveType === "ANNUAL")?.tracked).toBe(true);
  });

  it("refuses the worker's leave to a self-scoped reader", async () => {
    const created = await newWorker("Mentor");
    await expectError(leave.getBalances(engineer, created.id, today().getUTCFullYear()), "NOT_FOUND");
    await expectError(
      attendance.createAttendance(engineer, createAttendanceSchema.parse({ employeeId: created.id, date: pastWorkingDay(2), status: "PRESENT" })),
      "NOT_FOUND",
    );
  });
});

describe("a login requested later joins the same employee (E-04 §88, §262)", () => {
  it("links the provisioned account to the employment, its leave and its attendance", async () => {
    const created = await newWorker("Nertil");
    await start(created.id);
    const record = await attendance.createAttendance(hr, createAttendanceSchema.parse({ employeeId: created.id, date: pastWorkingDay(3), status: "PRESENT" }));

    const department = await prisma.department.findFirstOrThrow({ where: { companyId: hr.companyId, status: "ACTIVE", groupDepartmentId: { not: null } }, select: { id: true } });
    const requested = await provisioning.createProvisioningRequest(
      hr,
      createProvisioningRequestSchema.parse({ employeeProfileId: created.id, companyDepartmentId: department.id, functionalRoleKey: "ENGINEER", submit: true }),
    );
    await provisioning.approveProvisioningRequest(await loginAs("OWNER"), requested.id);
    const result = await provisioning.provisionAccount(await loginAs("GROUP_IT"), requested.id, {});

    const employment = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: created.id }, include: { companyMember: true } });
    expect(employment.companyMember?.userId).toBe(result.userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.personProfileId).toBe(created.personId);
    // Still one employee: the same person, the same employment, the same records.
    expect(await prisma.employeeProfile.count({ where: { personProfileId: created.personId } })).toBe(1);
    const kept = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(kept.companyMemberId).toBe(employment.companyMemberId);

    const detail = await employees.getEmployee(hr, created.id);
    expect(detail).toMatchObject({ accountStatus: "HAS_ACCOUNT", memberId: employment.companyMemberId });
    expect(detail.capabilities.canRequestAccount).toBe(false);
  });
});
