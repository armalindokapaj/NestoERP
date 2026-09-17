import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { listProgress } from "@/lib/modules/hr/employees/progress.service";
import { listEmployeeActivity } from "@/lib/modules/hr/hr.activity";
import { businessDateString, today } from "@/lib/modules/hr/hr.calendar";
import {
  attendanceListQuerySchema,
  createAttendanceSchema,
  createEmployeeProfileSchema,
  createLeaveSchema,
  employeeListQuerySchema,
  employmentStatusSchema,
  leaveListQuerySchema,
  updateEmployeeProfileSchema,
  updateLeaveSchema,
} from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { getHrOverview } from "@/lib/modules/hr/overview/overview.service";
import * as reports from "@/lib/modules/hr/reports/reports.service";
import { permissionsForRole } from "@/config/role-defaults";
import { resolveContextForSession } from "@/lib/context/build-context";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * HR authorisation and lifecycle tests (PRD #16 §272–§295, §342).
 *
 * These call the same services the API routes and the pages call, so a passing
 * test is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 *
 * The three rules the module exists to hold:
 *   1. employment is not access,
 *   2. pay is never part of an employee DTO,
 *   3. nobody decides their own leave.
 */
const employeeQuery = employeeListQuerySchema.parse({ limit: 100 });
const leaveQuery = leaveListQuerySchema.parse({ limit: 100 });
const attendanceQuery = attendanceListQuerySchema.parse({ limit: 100 });

const createdLeave: string[] = [];
const createdAttendance: string[] = [];
const createdCompensation: string[] = [];
/** Balance rows a test topped up, restored exactly as they were found. */
const touchedBalances: {
  id: string;
  /** True when the fixture created the row, so cleanup removes it entirely. */
  invented: boolean;
  entitledDays: string;
  adjustmentDays: string;
  usedDays: string;
}[] = [];

afterEach(async () => {
  if (createdLeave.length > 0) {
    await prisma.attendanceRecord.deleteMany({ where: { sourceEntityId: { in: createdLeave } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdLeave } } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: createdLeave } } });
    createdLeave.length = 0;
  }
  if (createdAttendance.length > 0) {
    await prisma.attendanceRecord.deleteMany({ where: { id: { in: createdAttendance } } });
    createdAttendance.length = 0;
  }
  if (createdCompensation.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: createdCompensation } } });
    await prisma.compensation.deleteMany({ where: { id: { in: createdCompensation } } });
    // Reopen the record the deleted one had closed, so the employee is left
    // with exactly one current level again.
    await prisma.$executeRawUnsafe(
      `UPDATE "compensations" c SET "effectiveTo" = NULL
       WHERE c."effectiveTo" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "compensations" o
           WHERE o."employeeProfileId" = c."employeeProfileId" AND o."effectiveTo" IS NULL
         )`,
    );
    createdCompensation.length = 0;
  }
  // After the leave rows are gone, put the balances back exactly as found. A
  // row the fixture invented is deleted rather than left at zero: an empty
  // balance for next year is not something the seed describes, and it would
  // quietly change what the next reader sees.
  for (const balance of touchedBalances) {
    if (balance.invented) {
      await prisma.leaveBalance.delete({ where: { id: balance.id } });
      continue;
    }
    await prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        entitledDays: balance.entitledDays,
        adjustmentDays: balance.adjustmentDays,
        usedDays: balance.usedDays,
      },
    });
  }
  touchedBalances.length = 0;
});

/**
 * Gives an employee room to book leave in whatever year the test lands in.
 *
 * The seed only entitles the current leave year, and a test written in
 * September must still pass in December — so the fixture tops the year up and
 * afterEach restores exactly what it found.
 */
async function allowLeave(
  memberId: string,
  year: number,
  leaveType: "ANNUAL" | "SICK" = "ANNUAL",
  entitledDays = "60",
) {
  const profile = await prisma.employeeProfile.findUniqueOrThrow({
    where: { companyMemberId: memberId },
    select: { id: true, companyId: true },
  });

  const existing = await prisma.leaveBalance.findUnique({
    where: {
      employeeProfileId_leaveType_year: { employeeProfileId: profile.id, leaveType, year },
    },
    select: { id: true },
  });

  const balance = await prisma.leaveBalance.upsert({
    where: {
      employeeProfileId_leaveType_year: { employeeProfileId: profile.id, leaveType, year },
    },
    update: {},
    create: {
      companyId: profile.companyId,
      employeeProfileId: profile.id,
      companyMemberId: memberId,
      leaveType,
      year,
      entitledDays: "0",
      usedDays: "0",
      adjustmentDays: "0",
    },
    select: { id: true, entitledDays: true, adjustmentDays: true, usedDays: true },
  });

  if (!touchedBalances.some((row) => row.id === balance.id)) {
    touchedBalances.push({
    id: balance.id,
      invented: existing === null,
      entitledDays: balance.entitledDays.toString(),
      adjustmentDays: balance.adjustmentDays.toString(),
      usedDays: balance.usedDays.toString(),
    });
  }

  await prisma.leaveBalance.update({
    where: { id: balance.id },
    data: { entitledDays, adjustmentDays: "0" },
  });
}

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/** The person's membership in the company their session starts in: the oldest (E-06 §51). */
async function memberIdFor(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { memberships: { where: { status: { not: "INACTIVE" } }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } },
  });
  return user.memberships[0]!.id;
}

/** A future range that starts on a Monday, so it always contains working days. */
function futureRange(weeksAhead: number, workingDays = 3) {
  const start = today();
  start.setUTCDate(start.getUTCDate() + weeksAhead * 7);
  // Roll forward to the next Monday.
  while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + workingDays - 1);
  return { startDate: start, endDate: end, year: start.getUTCFullYear() };
}

/** Leave input, through the same schema the endpoint and the form use. */
function leaveInput(input: {
  leaveType: "ANNUAL" | "SICK" | "UNPAID" | "PARENTAL" | "OTHER";
  startDate: Date;
  endDate: Date;
  reason?: string;
  companyMemberId?: string;
}) {
  return createLeaveSchema.parse(input);
}

function employmentInput(input: { companyMemberId: string; employmentType: "FULL_TIME" }) {
  return createEmployeeProfileSchema.parse(input);
}

function employmentUpdate(input: {
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN" | "TEMPORARY" | "OTHER";
  managerMemberId?: string;
}) {
  return updateEmployeeProfileSchema.parse(input);
}

function statusInput(input: { status: "ENDED" | "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "PLANNED"; endDate?: Date }) {
  return employmentStatusSchema.parse(input);
}

function attendanceInput(input: {
  companyMemberId?: string;
  date: Date;
  status: "PRESENT" | "ABSENT" | "ON_LEAVE" | "REMOTE" | "HOLIDAY" | "OFF";
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}) {
  return createAttendanceSchema.parse(input);
}

function leaveUpdate(input: {
  leaveType: "ANNUAL" | "SICK" | "UNPAID" | "PARENTAL" | "OTHER";
  startDate: Date;
  endDate: Date;
  reason?: string;
}) {
  return updateLeaveSchema.parse(input);
}

/** Books a range and tops the balance up for whatever year it falls in. */
async function bookable(memberId: string, weeksAhead: number, workingDays = 3) {
  const range = futureRange(weeksAhead, workingDays);
  await allowLeave(memberId, range.year);
  return range;
}

/* -------------------------------------------------------------------------- */
/* Employee list scope (PRD #16 §273)                                          */
/* -------------------------------------------------------------------------- */

describe("employee list scope (PRD #16 §273)", () => {
  it("shows HR every employment record in the company", async () => {
    const context = await loginAs("HR");
    const result = await employees.listEmployees(context, employeeQuery);

    expect(result.data.length).toBeGreaterThanOrEqual(18);
    const emails = result.data.map((row) => row.email);
    expect(emails).toContain("engineer@nesto.test");
    expect(emails).toContain("owner@nesto.test");
  });

  it("shows a self-scoped reader their own record and nobody else's", async () => {
    // Engineer is VIEW/SELF on HR (PRD #16 §14).
    const context = await loginAs("ENGINEER");
    const result = await employees.listEmployees(context, employeeQuery);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.email).toBe("engineer@nesto.test");
  });

  it("folds PROJECT scope into SELF, so running a project is not HR access (PRD #16 §168)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await employees.listEmployees(context, employeeQuery);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.email).toBe("pm@nesto.test");
  });

  it("returns nothing to a role with no HR access at all", async () => {
    const context = await loginAs("SALES");
    expect(can(context, "hr.employee.view")).toBe(false);
    await expectError(employees.listEmployees(context, employeeQuery), "FORBIDDEN");
  });

  it("answers not found — never forbidden — for somebody out of scope (PRD #16 §202)", async () => {
    const context = await loginAs("ENGINEER");
    const ownerMember = await memberIdFor("owner@nesto.test");

    // 403 would confirm the Owner has an employment record. 404 says nothing.
    await expectError(employees.getEmployee(context, ownerMember), "NOT_FOUND");
  });

  it("lets a self-scoped reader open their own record through self-service (PRD #16 §16)", async () => {
    const context = await loginAs("ENGINEER");
    const employee = await employees.getEmployee(context, context.membershipId);

    expect(employee.email).toBe("engineer@nesto.test");
    expect(employee.capabilities.canEditEmployment).toBe(false);
  });

  it("never leaks another employee through search (PRD #16 §293)", async () => {
    const context = await loginAs("ARCHITECT");
    const result = await employees.listEmployees(
      context,
      employeeListQuerySchema.parse({ search: "Engineer", limit: 100 }),
    );

    expect(result.data.every((row) => row.email === "architect@nesto.test")).toBe(true);
  });

  it("builds filter options only from records the reader can already see (PRD #16 §294)", async () => {
    const { employeeFilterOptions } = await import(
      "@/lib/modules/hr/employees/employee.repository"
    );

    const hr = await loginAs("HR");
    const engineer = await loginAs("ENGINEER");

    const hrOptions = await employeeFilterOptions(hr);
    const engineerOptions = await employeeFilterOptions(engineer);

    expect(hrOptions.departments.length).toBeGreaterThan(engineerOptions.departments.length);
    expect(engineerOptions.managers.length).toBeLessThanOrEqual(1);
  });

  it("keeps companies apart (PRD #16 §272, §295)", async () => {
    const engineerMember = await memberIdFor("engineer@nesto.test");

    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectError(employees.getEmployee(tenant, engineerMember), "NOT_FOUND");

    // A sibling company in the same group is another company all the same.
    const sibling = await loginAsEmail(DEMO_EMAIL.ceoB);
    expect(can(sibling, "hr.employee.view")).toBe(true);
    await expectError(employees.getEmployee(sibling, engineerMember), "NOT_FOUND");
  });
});

/* -------------------------------------------------------------------------- */
/* Compensation confidentiality (PRD #16 §274)                                 */
/* -------------------------------------------------------------------------- */

describe("compensation confidentiality (PRD #16 §15, §274)", () => {
  it("lets HR read pay", async () => {
    const context = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");
    const records = await compensation.listCompensation(context, memberId);

    expect(records.length).toBeGreaterThan(0);
    expect(records.some((record) => record.isCurrent)).toBe(true);
  });

  it("lets the Owner read pay, because it is granted explicitly (PRD #16 §17)", async () => {
    const context = await loginAs("OWNER");
    expect(can(context, "hr.compensation.view")).toBe(true);
  });

  it.each(["CEO", "GROUP_IT", "PROJECT_MANAGER"] as const)(
    "denies %s, who never had the compensation grant",
    async (role) => {
      const context = await loginAs(role);
      const memberId = await memberIdFor("engineer@nesto.test");

      expect(can(context, "hr.compensation.view")).toBe(false);
      await expectError(compensation.listCompensation(context, memberId), "FORBIDDEN");
    },
  );

  it("denies somebody their own salary by default (PRD #16 §67)", async () => {
    // Seeing your own pay in NESTO is a company decision, not an assumption the
    // module makes: there is deliberately no self-service door here.
    const context = await loginAs("ENGINEER");
    await expectError(
      compensation.listCompensation(context, context.membershipId),
      "FORBIDDEN",
    );
  });

  it("keeps pay out of the employee DTO entirely (PRD #16 §169)", async () => {
    const context = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");
    const employee = await employees.getEmployee(context, memberId);

    const serialised = JSON.stringify(employee);
    expect(serialised).not.toContain("baseAmount");
    expect(serialised).not.toContain("payType");
    expect(serialised).not.toContain("3400");
  });

  it("closes the open record when a new one starts, leaving exactly one current (PRD #16 §65)", async () => {
    const context = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");

    const effectiveFrom = new Date(Date.UTC(today().getUTCFullYear() + 1, 0, 15, 12));
    await compensation.recordCompensation(context, memberId, {
      currency: "EUR",
      payType: "SALARY",
      baseAmount: "3650.00",
      effectiveFrom,
      notes: "Annual review.",
    });

    const history = await compensation.listCompensation(context, memberId);
    const open = history.filter((record) => record.effectiveTo === null);
    createdCompensation.push(open[0]!.id);

    expect(open).toHaveLength(1);
    expect(open[0]!.baseAmount).toBe("3650.00");

    // The record it replaced was closed the day before, not deleted.
    const previous = history.find((record) => record.id !== open[0]!.id);
    expect(previous?.effectiveTo).toBe(
      businessDateString(new Date(effectiveFrom.getTime() - 86_400_000)),
    );
    expect(history.length).toBeGreaterThan(1);
  });

  it("never writes the amount into the activity trail (PRD #16 §270)", async () => {
    const context = await loginAs("HR");
    const memberId = await memberIdFor("architect@nesto.test");

    await compensation.recordCompensation(context, memberId, {
      currency: "EUR",
      payType: "SALARY",
      baseAmount: "4123.45",
      effectiveFrom: new Date(Date.UTC(today().getUTCFullYear() + 1, 1, 1, 12)),
      notes: "Sensitive note that must not be copied.",
    });

    const history = await compensation.listCompensation(context, memberId);
    const created = history.find((record) => record.effectiveTo === null)!;
    createdCompensation.push(created.id);

    // The trail is filed against the employee, never the pay record itself.
    const entries = await prisma.activity.findMany({
      where: { module: "hr", entityId: memberId, action: "HR_COMPENSATION_RECORDED" },
      select: { message: true, metadata: true },
    });

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const serialised = JSON.stringify(entry);
      expect(serialised).not.toContain("4123.45");
      expect(serialised).not.toContain("Sensitive note");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Leave self-service (PRD #16 §275)                                           */
/* -------------------------------------------------------------------------- */

describe("leave self-service (PRD #16 §74, §275)", () => {
  it("lets somebody request, edit, submit and cancel their own leave", async () => {
    const context = await loginAs("ENGINEER");
    const range = await bookable(context.membershipId, 30);

    const created = await leave.createLeave(
      context,
      leaveInput({ leaveType: "ANNUAL", ...range, reason: "Family holiday." }),
    );
    createdLeave.push(created.id);

    expect(created.status).toBe("DRAFT");
    expect(created.capabilities.canEdit).toBe(true);
    expect(created.capabilities.canApprove).toBe(false);

    const edited = await leave.updateLeave(
      context,
      created.id,
      leaveUpdate({
        leaveType: "ANNUAL",
        startDate: range.startDate,
        endDate: range.endDate,
        reason: "Family holiday, extended.",
      }),
    );
    expect(edited.reason).toBe("Family holiday, extended.");

    await leave.submitLeave(context, created.id);
    const submitted = await leave.getLeave(context, created.id);
    expect(submitted.status).toBe("PENDING");
    expect(submitted.capabilities.canEdit).toBe(false);

    await leave.cancelLeave(context, created.id);
    expect((await leave.getLeave(context, created.id)).status).toBe("CANCELLED");
  });

  it("never lets somebody approve their own request (PRD #16 §194)", async () => {
    const hr = await loginAs("HR");
    const range = await bookable(hr.membershipId, 31);

    const created = await leave.createLeave(hr, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(hr, created.id);

    // HR holds hr.leave.approve over the whole company — and still cannot
    // decide their own.
    expect(can(hr, "hr.leave.approve")).toBe(true);
    const own = await leave.getLeave(hr, created.id);
    expect(own.capabilities.canApprove).toBe(false);

    await expectError(leave.approveLeave(hr, created.id, null), "FORBIDDEN");
  });

  it("shows a self-service reader their own requests only", async () => {
    const context = await loginAs("ENGINEER");
    const result = await leave.listLeave(context, leaveQuery);

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.employee.memberId === context.membershipId)).toBe(true);
  });

  it("lets somebody see their own balance without the company grant", async () => {
    const context = await loginAs("ENGINEER");
    const balances = await leave.getBalances(context, context.membershipId, today().getUTCFullYear());

    expect(balances.length).toBeGreaterThan(0);
    expect(balances.find((row) => row.leaveType === "ANNUAL")?.tracked).toBe(true);
  });

  it("answers not found for somebody else's balance, whatever the permission says", async () => {
    // A self-scoped reader does hold `hr.leave.balance.view` — the ladder gives
    // it at VIEW. Scope is what stops them, and it answers 404 rather than 403
    // so the response cannot confirm that person has a balance (PRD #16 §203).
    const context = await loginAs("ENGINEER");
    const other = await memberIdFor("architect@nesto.test");

    expect(can(context, "hr.leave.balance.view")).toBe(true);
    await expectError(
      leave.getBalances(context, other, today().getUTCFullYear()),
      "NOT_FOUND",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Leave reason confidentiality (PRD #16 §95)                                  */
/* -------------------------------------------------------------------------- */

describe("leave reason confidentiality (PRD #16 §95, §290)", () => {
  it("gives the reason to the person who wrote it", async () => {
    const context = await loginAs("ENGINEER");
    const request = await prisma.leaveRequest.findFirstOrThrow({
      where: { companyMemberId: context.membershipId, reason: { not: null } },
      select: { id: true },
    });

    const dto = await leave.getLeave(context, request.id);
    expect(dto.reason).toBeTruthy();
  });

  it("gives the reason to a reader who holds the reason grant", async () => {
    const context = await loginAs("HR");
    const dto = await leave.getLeave(context, "leave_002");

    expect(can(context, "hr.leave.reason.view")).toBe(true);
    expect(dto.reason).toContain("Flu");
  });

  it("omits the reason entirely for everybody else", async () => {
    // A reason may be medical. Absent from the DTO beats null in the DTO:
    // there is nothing to leak through a log, a cache or a serialiser.
    const context = await loginAs("CEO");
    const dto = await leave.getLeave(context, "leave_002");

    expect(can(context, "hr.leave.reason.view")).toBe(false);
    expect("reason" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("Flu");
  });
});

/* -------------------------------------------------------------------------- */
/* Leave approval, overlap and balance (PRD #16 §276–§279)                     */
/* -------------------------------------------------------------------------- */

describe("leave approval and balance (PRD #16 §277, §279)", () => {
  it("lets HR approve company leave, and moves the balance when it does", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");

    const range = await bookable(engineer.membershipId, 32, 2);
    const year = range.year;
    const before = await leave.getBalances(hr, engineer.membershipId, year);
    const annualBefore = before.find((row) => row.leaveType === "ANNUAL")!;

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);

    await leave.approveLeave(hr, created.id, "Enjoy it.");
    const approved = await leave.getLeave(hr, created.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedBy).toBeTruthy();

    const after = await leave.getBalances(hr, engineer.membershipId, year);
    const annualAfter = after.find((row) => row.leaveType === "ANNUAL")!;

    expect(Number(annualAfter.usedDays) - Number(annualBefore.usedDays)).toBe(2);
    expect(Number(annualBefore.availableDays) - Number(annualAfter.availableDays)).toBe(2);
  });

  it("gives the days back when approved leave is cancelled (PRD #16 §93)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");

    const range = await bookable(engineer.membershipId, 33, 3);
    const year = range.year;
    const before = await leave.getBalances(hr, engineer.membershipId, year);
    const annualBefore = Number(
      before.find((row) => row.leaveType === "ANNUAL")!.availableDays,
    );

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.approveLeave(hr, created.id, null);
    await leave.cancelLeave(hr, created.id);

    const after = await leave.getBalances(hr, engineer.membershipId, year);
    expect(Number(after.find((row) => row.leaveType === "ANNUAL")!.availableDays)).toBe(
      annualBefore,
    );
  });

  it("does not move a balance for a rejected request (PRD #16 §279)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");

    const range = await bookable(engineer.membershipId, 34, 4);
    const year = range.year;
    const before = await leave.getBalances(hr, engineer.membershipId, year);
    const usedBefore = Number(before.find((row) => row.leaveType === "ANNUAL")!.usedDays);

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.rejectLeave(hr, created.id, "Clashes with the handover week.");

    const after = await leave.getBalances(hr, engineer.membershipId, year);
    expect(Number(after.find((row) => row.leaveType === "ANNUAL")!.usedDays)).toBe(usedBefore);

    const rejected = await leave.getLeave(hr, created.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionNote).toContain("handover");
  });

  it("refuses a rejection with no reason (PRD #16 §88)", async () => {
    const { leaveRejectionSchema } = await import("@/lib/modules/hr/hr.schema");
    expect(() => leaveRejectionSchema.parse({ note: "" })).toThrowError();
  });

  it("does not cap sick leave, which has no entitlement to run out of (PRD #16 §85)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");

    const range = await bookable(engineer.membershipId, 35, 5);
    await allowLeave(engineer.membershipId, range.year, "SICK");

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "SICK", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.approveLeave(hr, created.id, null);

    const balances = await leave.getBalances(hr, engineer.membershipId, range.year);
    expect(balances.find((row) => row.leaveType === "SICK")?.tracked).toBe(false);
  });

  it("cannot be overspent by two approvals landing at once (PRD #16 §196, §280)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");

    // Two separate weeks, three days each, against an entitlement of four.
    const first = futureRange(44, 3);
    const second = futureRange(45, 3);
    await allowLeave(engineer.membershipId, first.year, "ANNUAL", "4");
    if (second.year !== first.year) await allowLeave(engineer.membershipId, second.year, "ANNUAL", "4");

    const a = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...first }));
    const b = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...second }));
    createdLeave.push(a.id, b.id);

    await leave.submitLeave(engineer, a.id);
    await leave.submitLeave(engineer, b.id);

    // The balance is re-read inside the approval transaction, not before it, so
    // two approvers signing off at the same moment cannot both be told there is
    // room (PRD #16 §91, §196).
    const results = await Promise.allSettled([
      leave.approveLeave(hr, a.id, null),
      leave.approveLeave(hr, b.id, null),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const balance = (await leave.getBalances(hr, engineer.membershipId, first.year)).find(
      (row) => row.leaveType === "ANNUAL",
    )!;
    expect(Number(balance.usedDays)).toBeLessThanOrEqual(Number(balance.entitledDays));
    expect(Number(balance.availableDays)).toBeGreaterThanOrEqual(0);
  });

  it("refuses an overlapping request (PRD #16 §83, §278)", async () => {
    const engineer = await loginAs("ENGINEER");
    const range = await bookable(engineer.membershipId, 36, 5);

    const first = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(first.id);
    await leave.submitLeave(engineer, first.id);

    // A pending request holds its dates, or two overlapping requests could both
    // be approved by two different people.
    await expectError(
      leave.createLeave(
        engineer,
        leaveInput({
          leaveType: "ANNUAL",
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      ),
      "CONFLICT",
    );
  });

  it("allows a new request over dates that were cancelled (PRD #16 §278)", async () => {
    const engineer = await loginAs("ENGINEER");
    const range = await bookable(engineer.membershipId, 37, 3);

    const first = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(first.id);
    await leave.cancelLeave(engineer, first.id);

    const second = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(second.id);
    expect(second.status).toBe("DRAFT");
  });

  it("refuses a range with no working days in it (PRD #16 §77)", async () => {
    const engineer = await loginAs("ENGINEER");
    const saturday = today();
    saturday.setUTCDate(saturday.getUTCDate() + 14);
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    const sunday = new Date(saturday);
    sunday.setUTCDate(sunday.getUTCDate() + 1);

    await expectError(
      leave.createLeave(
        engineer,
        leaveInput({ leaveType: "ANNUAL", startDate: saturday, endDate: sunday }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("cannot decide leave in another company (PRD #16 §277)", async () => {
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectError(leave.getLeave(tenant, "leave_008"), "NOT_FOUND");
  });

  it("never lets a client set the fields that decide authority (PRD #16 §183)", async () => {
    const { createLeaveSchema } = await import("@/lib/modules/hr/hr.schema");
    const range = futureRange(38);

    const parsed = createLeaveSchema.parse({
      leaveType: "ANNUAL",
      startDate: range.startDate,
      endDate: range.endDate,
      status: "APPROVED",
      days: "99",
      decidedByMemberId: "somebody-else",
      companyId: "another-company",
    });

    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("days");
    expect(parsed).not.toHaveProperty("decidedByMemberId");
    expect(parsed).not.toHaveProperty("companyId");
  });
});

/* -------------------------------------------------------------------------- */
/* Leave to attendance (PRD #16 §283, §284)                                    */
/* -------------------------------------------------------------------------- */

describe("leave writes attendance (PRD #16 §108, §283)", () => {
  it("writes an ON_LEAVE day per working day, tagged with the request", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");
    const range = await bookable(engineer.membershipId, 40, 3);

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.approveLeave(hr, created.id, null);

    const rows = await prisma.attendanceRecord.findMany({
      where: { sourceEntityId: created.id },
      select: { status: true, source: true, companyMemberId: true },
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "ON_LEAVE")).toBe(true);
    expect(rows.every((row) => row.source === "SYSTEM")).toBe(true);
    expect(rows.every((row) => row.companyMemberId === engineer.membershipId)).toBe(true);
  });

  it("takes exactly those days back out when the leave is cancelled (PRD #16 §109)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");
    const range = await bookable(engineer.membershipId, 41, 2);

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.approveLeave(hr, created.id, null);
    await leave.cancelLeave(hr, created.id);

    const rows = await prisma.attendanceRecord.count({ where: { sourceEntityId: created.id } });
    expect(rows).toBe(0);
  });

  it("refuses approval when the employee is already recorded as present (PRD #16 §284)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");
    const range = await bookable(engineer.membershipId, 42, 2);

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);

    // A present day inside the range: approving would have to overwrite a fact.
    const clash = await attendance.createAttendance(hr, attendanceInput({
      companyMemberId: engineer.membershipId,
      date: range.startDate,
      status: "HOLIDAY",
    }));
    createdAttendance.push(clash.id);
    await prisma.attendanceRecord.update({
      where: { id: clash.id },
      data: { status: "PRESENT", source: "MANUAL" },
    });

    await expectError(leave.approveLeave(hr, created.id, null), "CONFLICT");
  });
});

/* -------------------------------------------------------------------------- */
/* Attendance (PRD #16 §281, §282)                                             */
/* -------------------------------------------------------------------------- */

describe("attendance (PRD #16 §281, §282)", () => {
  it("shows HR the company and a self-service reader only their own", async () => {
    const hr = await loginAs("HR");
    const engineer = await loginAs("ENGINEER");

    const companyView = await attendance.listAttendance(hr, attendanceQuery);
    const ownView = await attendance.listAttendance(engineer, attendanceQuery);

    expect(new Set(companyView.data.map((row) => row.employee.memberId)).size).toBeGreaterThan(1);
    expect(ownView.data.every((row) => row.employee.memberId === engineer.membershipId)).toBe(
      true,
    );
  });

  it("derives worked minutes rather than accepting them (PRD #16 §106, §198)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");
    const date = pastWorkingDay(3);

    const record = await attendance.createAttendance(hr, attendanceInput({
      companyMemberId: memberId,
      date,
      status: "PRESENT",
      checkIn: "08:15",
      checkOut: "16:45",
    }));
    createdAttendance.push(record.id);

    expect(record.workedMinutes).toBe(510);
    expect(record.checkIn).toBe("08:15");
  });

  it("drops times a status cannot carry (PRD #16 §105, §107)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");

    const record = await attendance.createAttendance(hr, attendanceInput({
      companyMemberId: memberId,
      date: pastWorkingDay(4),
      status: "ABSENT",
      checkIn: "09:00",
      checkOut: "17:00",
    }));
    createdAttendance.push(record.id);

    // An absent day with a check-in time is a contradiction, not a record.
    expect(record.checkIn).toBeNull();
    expect(record.checkOut).toBeNull();
    expect(record.workedMinutes).toBeNull();
  });

  it("refuses a check-out before the check-in", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");

    await expectError(
      attendance.createAttendance(hr, attendanceInput({
        companyMemberId: memberId,
        date: pastWorkingDay(5),
        status: "PRESENT",
        checkIn: "17:00",
        checkOut: "09:00",
      })),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a second record for the same person on the same day (PRD #16 §101, §199)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");
    const date = pastWorkingDay(6);

    const first = await attendance.createAttendance(hr, attendanceInput({
      companyMemberId: memberId,
      date,
      status: "PRESENT",
    }));
    createdAttendance.push(first.id);

    await expectError(
      attendance.createAttendance(hr, attendanceInput({ companyMemberId: memberId, date, status: "REMOTE" })),
      "CONFLICT",
    );
  });

  it("refuses a future day that nobody could know about yet (PRD #16 §104)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");
    const future = today();
    future.setUTCDate(future.getUTCDate() + 10);

    await expectError(
      attendance.createAttendance(hr, attendanceInput({ companyMemberId: memberId, date: future, status: "PRESENT" })),
      "VALIDATION_ERROR",
    );

    // A holiday is a decision made in advance, so it is allowed.
    const planned = await attendance.createAttendance(hr, attendanceInput({
      companyMemberId: memberId,
      date: future,
      status: "HOLIDAY",
    }));
    createdAttendance.push(planned.id);
    expect(planned.status).toBe("HOLIDAY");
  });

  it("refuses to record a day for somebody in another company (PRD #16 §161)", async () => {
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const engineerMember = await memberIdFor("engineer@nesto.test");

    await expectError(
      attendance.createAttendance(tenant, attendanceInput({
        companyMemberId: engineerMember,
        date: pastWorkingDay(7),
        status: "PRESENT",
      })),
      "NOT_FOUND",
    );
  });

  it("lets only an attendance manager override a row written by approved leave (PRD #16 §110)", async () => {
    const engineer = await loginAs("ENGINEER");
    const hr = await loginAs("HR");
    const range = await bookable(engineer.membershipId, 43, 1);

    const created = await leave.createLeave(engineer, leaveInput({ leaveType: "ANNUAL", ...range }));
    createdLeave.push(created.id);
    await leave.submitLeave(engineer, created.id);
    await leave.approveLeave(hr, created.id, null);

    const row = await prisma.attendanceRecord.findFirstOrThrow({
      where: { sourceEntityId: created.id },
      select: { id: true },
    });

    const asEmployee = await attendance.getAttendance(engineer, row.id);
    expect(asEmployee.systemGenerated).toBe(true);
    expect(asEmployee.capabilities.canEdit).toBe(false);

    const asHr = await attendance.getAttendance(hr, row.id);
    expect(asHr.capabilities.canEdit).toBe(true);
  });

  it("finds exceptions with a query, so paging stays honest (PRD #16 §115)", async () => {
    const hr = await loginAs("HR");
    const result = await attendance.listAttendance(
      hr,
      attendanceListQuerySchema.parse({ exceptionsOnly: true, limit: 100 }),
    );

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.isException)).toBe(true);
  });
});

/** A weekday in the recent past, so attendance is allowed to exist for it. */
function pastWorkingDay(weeksBack: number): Date {
  const date = today();
  date.setUTCDate(date.getUTCDate() - weeksBack * 7);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

/* -------------------------------------------------------------------------- */
/* Employment lifecycle (PRD #16 §285–§287)                                    */
/* -------------------------------------------------------------------------- */

describe("employment lifecycle (PRD #16 §285–§287)", () => {
  it("refuses a second employment record for the same member (PRD #16 §25)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");

    await expectError(
      employees.createEmployeeProfile(
        hr,
        employmentInput({ companyMemberId: memberId, employmentType: "FULL_TIME" }),
      ),
      "CONFLICT",
    );
  });

  it("refuses to make somebody their own manager (PRD #16 §32, §287)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");

    // A manager loop would make the department approval chain infinite.
    await expectError(
      employees.updateEmployeeProfile(
        hr,
        memberId,
        employmentUpdate({ employmentType: "FULL_TIME", managerMemberId: memberId }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a manager from another company (PRD #16 §159)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("engineer@nesto.test");

    // Another group's company, and a sibling company HR also works in.
    for (const email of [DEMO_EMAIL.tenantOwner, DEMO_EMAIL.pmB]) {
      const foreignManager = await memberIdFor(email);
      await expectError(
        employees.updateEmployeeProfile(
          hr,
          memberId,
          employmentUpdate({ employmentType: "FULL_TIME", managerMemberId: foreignManager }),
        ),
        "VALIDATION_ERROR",
      );
    }
  });

  it("refuses an end date before the start date", async () => {
    const { updateEmployeeProfileSchema } = await import("@/lib/modules/hr/hr.schema");
    const result = updateEmployeeProfileSchema.safeParse({
      employmentType: "FULL_TIME",
      startDate: "2026-06-01",
      endDate: "2026-05-01",
    });

    expect(result.success).toBe(false);
  });

  it("refuses a week longer than a week", async () => {
    const { updateEmployeeProfileSchema } = await import("@/lib/modules/hr/hr.schema");
    expect(
      updateEmployeeProfileSchema.safeParse({ employmentType: "FULL_TIME", weeklyHours: "200" })
        .success,
    ).toBe(false);
    expect(
      updateEmployeeProfileSchema.safeParse({ employmentType: "FULL_TIME", weeklyHours: "37.50" })
        .success,
    ).toBe(true);
  });

  it("requires an end date to end employment (PRD #16 §286)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");

    await expectError(
      employees.changeEmploymentStatus(hr, memberId, statusInput({ status: "ENDED" })),
      "VALIDATION_ERROR",
    );
  });

  it("never reopens ended employment with a status change (PRD #16 §56)", async () => {
    // Ended employment is a Fixture Works record (E-06 §45), decided there by its Owner.
    const owner = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    const endedMember = await prisma.employeeProfile.findFirstOrThrow({
      where: { companyId: COMPANY.works, employmentStatus: "ENDED", companyMemberId: { not: null } },
      select: { companyMemberId: true },
    });

    expect(can(owner, "hr.employee.status.update")).toBe(true);
    await expectError(
      employees.changeEmploymentStatus(
        owner,
        endedMember.companyMemberId!,
        statusInput({ status: "ACTIVE" }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("leaves company access exactly as it was when employment ends (PRD #16 §230)", async () => {
    const hr = await loginAs("HR");
    const memberId = await memberIdFor("sales@nesto.test");

    const before = await prisma.companyMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { status: true, roleId: true, departmentId: true },
    });

    const endDate = today();
    await employees.changeEmploymentStatus(hr, memberId, statusInput({ status: "ENDED", endDate }));

    const after = await prisma.companyMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { status: true, roleId: true, departmentId: true },
    });

    // Employment is not access: ending one never touches the other.
    expect(after).toEqual(before);

    const profile = await prisma.employeeProfile.findUniqueOrThrow({
      where: { companyMemberId: memberId },
      select: { offboardingStatus: true },
    });
    expect(profile.offboardingStatus).toBe("NOT_STARTED");

    // Put the fixture back the way the seed left it.
    await prisma.employeeProfile.update({
      where: { companyMemberId: memberId },
      data: {
        employmentStatus: "ACTIVE",
        endDate: null,
        offboardingStatus: "NOT_REQUIRED",
      },
    });
    await prisma.activity.deleteMany({
      where: { module: "hr", entityId: memberId, action: "HR_EMPLOYMENT_ENDED" },
    });
  });

  it("denies a self-scoped reader any employment write at all", async () => {
    const context = await loginAs("ENGINEER");

    await expectError(
      employees.updateEmployeeProfile(
        context,
        context.membershipId,
        employmentUpdate({ employmentType: "CONTRACTOR" }),
      ),
      "FORBIDDEN",
    );
    await expectError(
      employees.changeEmploymentStatus(
        context,
        context.membershipId,
        statusInput({ status: "ON_LEAVE" }),
      ),
      "FORBIDDEN",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Dashboard, reports and activity (PRD #16 §291, §292, §290)                  */
/* -------------------------------------------------------------------------- */

describe("overview and reports (PRD #16 §291, §292)", () => {
  it("counts the company for HR and only the reader for self scope (PRD #16 §291)", async () => {
    const hr = await getHrOverview(await loginAs("HR"));
    const engineer = await getHrOverview(await loginAs("ENGINEER"));

    expect(hr.headcount).toBeGreaterThan(10);
    expect(hr.visible.employees).toBe(true);

    // Same panels, scoped figures: a self-scoped reader is their own headcount.
    expect(engineer.headcount).toBe(1);
    expect(engineer.pendingLeave).toBeLessThanOrEqual(hr.pendingLeave);
  });

  it("drops the employee panels for a reader with no directory access (PRD #16 §19)", async () => {
    const overview = await getHrOverview(await loginAs("GROUP_IT"));

    expect(overview.visible.employees).toBe(false);
    expect(overview.visible.selfOnly).toBe(true);
    expect(overview.headcount).toBe(0);
    expect(overview.visible.leave).toBe(true);
  });

  it("gives the CEO company HR figures without any pay in them (PRD #16 §20, §22)", async () => {
    const context = await loginAs("CEO");
    const overview = await getHrOverview(context);

    expect(overview.headcount).toBeGreaterThan(10);
    expect(JSON.stringify(overview)).not.toContain("Amount");
    expect(reports.availableReports(context).compensation).toBe(false);
  });

  it("offers the compensation report only with the compensation grant (PRD #16 §141)", async () => {
    const hr = await loginAs("HR");
    const ceo = await loginAs("CEO");

    expect(reports.availableReports(hr).compensation).toBe(true);
    expect(reports.availableReports(ceo).compensation).toBe(false);

    await expectError(reports.compensationReport(ceo), "FORBIDDEN");
    expect((await reports.compensationReport(hr)).length).toBeGreaterThan(0);
  });

  it("counts headcount as employment that is running (PRD #16 §142)", async () => {
    const hr = await loginAs("HR");
    const rows = await reports.headcountReport(hr);
    const overview = await getHrOverview(hr);

    const active = rows.reduce((sum, row) => sum + row.active + row.onLeave, 0);
    expect(active).toBe(overview.headcount);
  });

  it("scopes a report rather than widening it (PRD #16 §258, §292)", async () => {
    // A self-scoped reader keeps report access; what changes is the population.
    const engineer = await loginAs("ENGINEER");
    const rows = await reports.headcountReport(engineer);

    const total = rows.reduce(
      (sum, row) => sum + row.active + row.onLeave + row.planned + row.ended,
      0,
    );
    expect(total).toBe(1);
  });

  it("refuses every report to a role denied report access (PRD #16 §292)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const available = reports.availableReports(pm);

    expect(Object.values(available).every((value) => value === false)).toBe(true);
    await expectError(reports.headcountReport(pm), "FORBIDDEN");
    await expectError(reports.leaveSummary(pm), "FORBIDDEN");
  });

  it("keeps HR activity behind the permission and the scope (PRD #16 §137)", async () => {
    const hr = await loginAs("HR");
    const engineerMember = await memberIdFor("engineer@nesto.test");
    const ownerMember = await memberIdFor("owner@nesto.test");

    const trail = await listEmployeeActivity(hr, engineerMember);
    expect(trail.data.length).toBeGreaterThanOrEqual(0);

    // A self-scoped reader holds hr.activity.view, so the permission alone is
    // not what stops them reading the Owner's employment and pay events.
    const engineer = await loginAs("ENGINEER");
    expect(can(engineer, "hr.activity.view")).toBe(true);
    await expectError(listEmployeeActivity(engineer, ownerMember), "NOT_FOUND");
    await expect(listEmployeeActivity(engineer, engineerMember)).resolves.toBeTruthy();

    // No HR access at all: refused before the scope is even consulted.
    const sales = await loginAs("SALES");
    await expectError(listEmployeeActivity(sales, engineerMember), "FORBIDDEN");
  });

  it("lists onboarding and offboarding behind their own permissions (PRD #16 §121)", async () => {
    const hr = await loginAs("HR");
    const onboarding = await listProgress(hr, "onboarding");
    const offboarding = await listProgress(hr, "offboarding");

    expect(onboarding.length).toBeGreaterThan(0);
    expect(offboarding.length).toBeGreaterThan(0);

    const sales = await loginAs("SALES");
    await expectError(listProgress(sales, "onboarding"), "FORBIDDEN");
  });
});

/* -------------------------------------------------------------------------- */
/* Role rules (PRD #16 §18, §19)                                               */
/* -------------------------------------------------------------------------- */

describe("role rules (PRD #16 §18, §19)", () => {
  it("keeps the Platform Admin out of every company's HR, directory included (PRD #16 §18, E-06 §19)", async () => {
    expect(permissionsForRole("PLATFORM_ADMIN").filter((permission) => permission.startsWith("hr."))).toEqual([]);

    // No membership, so no company context for any HR service to be called with.
    const platform = await loginAsPlatformAdmin();
    const result = await resolveContextForSession(platform.sessionId, { expectedUserId: platform.userId });
    expect(result).toMatchObject({ ok: false, reason: "PLATFORM_SESSION" });
  });

  it("leaves Group IT with self-service and no HR business data (PRD #16 §19)", async () => {
    const context = await loginAs("GROUP_IT");

    expect(can(context, "hr.employee.view")).toBe(false);
    expect(can(context, "hr.document.view")).toBe(false);
    expect(can(context, "hr.report.view")).toBe(false);

    expect(can(context, "hr.self.employment")).toBe(true);
    expect(can(context, "hr.self.leave")).toBe(true);

    const own = await employees.getEmployee(context, context.membershipId);
    expect(own.email).toBe("it@nesto.test");
  });

  it("keeps a project manager out of HR confidential surface (PRD #16 §168)", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    expect(can(context, "hr.leave.view")).toBe(false);
    expect(can(context, "hr.document.view")).toBe(false);
    expect(can(context, "hr.attendance.view")).toBe(false);
    expect(can(context, "hr.report.view")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Export (PRD #16 §146, §147)                                                 */
/* -------------------------------------------------------------------------- */

describe("export (PRD #16 §146, §147)", () => {
  it("exports exactly the list the reader can see", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    const hr = await loginAs("HR");
    const file = await exportHr(hr, "employees", new URLSearchParams());
    const lines = file.csv.split("\r\n");

    expect(file.filename).toBe("hr-employees.csv");
    expect(lines[0]).toContain("Employee number");
    // One header plus every employment record HR can see.
    const visible = await employees.listEmployees(hr, employeeQuery);
    expect(lines).toHaveLength(visible.data.length + 1);
  });

  it("carries the same filters as the screen", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    const hr = await loginAs("HR");
    const file = await exportHr(hr, "employees", new URLSearchParams({ status: "PLANNED" }));
    const rows = file.csv.split("\r\n").slice(1);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.includes("Planned"))).toBe(true);
  });

  it("narrows to the reader's own records when their scope is SELF (PRD #16 §147)", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    // Engineer holds hr.export only if the ladder gives it; what matters here
    // is that scope reaches the export, so it is checked against the service.
    const engineer = await loginAs("ENGINEER");
    if (!can(engineer, "hr.export")) {
      await expectError(exportHr(engineer, "employees", new URLSearchParams()), "FORBIDDEN");
      return;
    }

    const file = await exportHr(engineer, "employees", new URLSearchParams());
    expect(file.csv.split("\r\n")).toHaveLength(2);
  });

  it("never exports a leave reason (PRD #16 §95)", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    const hr = await loginAs("HR");
    const file = await exportHr(hr, "leave", new URLSearchParams());

    expect(file.csv).not.toContain("Reason");
    expect(file.csv).not.toContain("Flu");
  });

  it("refuses an export to a role without the grant", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    const ceo = await loginAs("CEO");
    expect(can(ceo, "hr.export")).toBe(false);
    await expectError(exportHr(ceo, "employees", new URLSearchParams()), "FORBIDDEN");
  });

  it("quotes every field, so a comma in a name cannot split a row", async () => {
    const { exportHr } = await import("@/lib/modules/hr/hr.export");

    const hr = await loginAs("HR");
    const file = await exportHr(hr, "attendance", new URLSearchParams({ limit: "5" }));

    for (const line of file.csv.split("\r\n")) {
      expect(line.startsWith('"')).toBe(true);
      expect(line.endsWith('"')).toBe(true);
    }
  });
});
