import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { businessDateString, today } from "../hr.date";
import {
  buildAttendanceScopeWhere,
  buildEmployeeScopeWhere,
  buildLeaveScopeWhere,
} from "../hr.scope";
import type {
  AttendanceSummaryRow,
  CompensationReportRow,
  LeaveSummaryRow,
  UpcomingEndRow,
} from "../hr.types";

/**
 * Built-in HR reports (PRD #16 §139–§147).
 *
 * Every report runs through the same scope clauses the lists do, so a report is
 * never a way to read records the reader cannot open (PRD #16 §147, §258, §292).
 * The compensation report additionally requires the compensation grant — it is
 * not something the reports permission unlocks (PRD #16 §141).
 */

const MODULE = "hr" as const;

/* -------------------------------------------------------------------------- */
/* Headcount (PRD #16 §142)                                                    */
/* -------------------------------------------------------------------------- */

export type HeadcountRow = {
  department: string;
  departmentId: string | null;
  active: number;
  onLeave: number;
  planned: number;
  ended: number;
};

export async function headcountReport(context: UserContext): Promise<HeadcountRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.employee.view");

  const rows = await prisma.employeeProfile.findMany({
    where: buildEmployeeScopeWhere(context),
    select: {
      employmentStatus: true,
      companyMember: { select: { department: { select: { id: true, name: true } } } },
    },
  });

  const byDepartment = new Map<string, HeadcountRow>();

  for (const row of rows) {
    const department = row.companyMember.department;
    const key = department?.id ?? "";

    const entry =
      byDepartment.get(key) ??
      ({
        department: department?.name ?? "No department",
        departmentId: department?.id ?? null,
        active: 0,
        onLeave: 0,
        planned: 0,
        ended: 0,
      } satisfies HeadcountRow);

    if (row.employmentStatus === "ACTIVE") entry.active += 1;
    else if (row.employmentStatus === "ON_LEAVE") entry.onLeave += 1;
    else if (row.employmentStatus === "PLANNED") entry.planned += 1;
    else if (row.employmentStatus === "ENDED") entry.ended += 1;

    byDepartment.set(key, entry);
  }

  return [...byDepartment.values()].sort((a, b) => a.department.localeCompare(b.department));
}

/* -------------------------------------------------------------------------- */
/* Leave summary (PRD #16 §143)                                                */
/* -------------------------------------------------------------------------- */

export async function leaveSummary(
  context: UserContext,
  options: { year?: number } = {},
): Promise<LeaveSummaryRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.leave.view");

  const year = options.year ?? today().getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  const rows = await prisma.leaveRequest.groupBy({
    by: ["leaveType"],
    where: {
      AND: [
        buildLeaveScopeWhere(context),
        { status: "APPROVED", startDate: { gte: from, lte: to } },
      ],
    },
    _count: { _all: true },
    _sum: { days: true },
  });

  return rows
    .map((row) => ({
      leaveType: row.leaveType,
      requests: row._count._all,
      days: (row._sum.days ?? new Prisma.Decimal(0)).toFixed(2),
    }))
    .sort((a, b) => Number.parseFloat(b.days) - Number.parseFloat(a.days));
}

/* -------------------------------------------------------------------------- */
/* Attendance summary (PRD #16 §144)                                           */
/* -------------------------------------------------------------------------- */

export async function attendanceSummary(
  context: UserContext,
  options: { from?: Date; to?: Date } = {},
): Promise<AttendanceSummaryRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.attendance.view");

  const to = options.to ?? today();
  const from = options.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1, 12));

  const rows = await prisma.attendanceRecord.findMany({
    where: {
      AND: [buildAttendanceScopeWhere(context), { date: { gte: from, lte: to } }],
    },
    select: {
      companyMemberId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      employeeProfile: {
        select: {
          companyMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });

  const byMember = new Map<string, AttendanceSummaryRow>();

  for (const row of rows) {
    const user = row.employeeProfile.companyMember.user;
    const entry =
      byMember.get(row.companyMemberId) ??
      ({
        memberId: row.companyMemberId,
        fullName: `${user.firstName} ${user.lastName}`,
        present: 0,
        remote: 0,
        absent: 0,
        onLeave: 0,
        exceptions: 0,
      } satisfies AttendanceSummaryRow);

    if (row.status === "PRESENT") entry.present += 1;
    else if (row.status === "REMOTE") entry.remote += 1;
    else if (row.status === "ABSENT") entry.absent += 1;
    else if (row.status === "ON_LEAVE") entry.onLeave += 1;

    const missingCheckOut =
      (row.status === "PRESENT" || row.status === "REMOTE") &&
      row.checkIn !== null &&
      row.checkOut === null;
    if (row.status === "ABSENT" || missingCheckOut) entry.exceptions += 1;

    byMember.set(row.companyMemberId, entry);
  }

  return [...byMember.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/* -------------------------------------------------------------------------- */
/* Compensation (PRD #16 §141)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Current pay across the company.
 *
 * Behind `hr.compensation.view` as well as the reports grant: a reports
 * permission must not be a way around the one permission HR guards hardest
 * (PRD #16 §141, §292).
 */
export async function compensationReport(
  context: UserContext,
): Promise<CompensationReportRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.compensation.view");

  const profiles = await prisma.employeeProfile.findMany({
    where: {
      AND: [buildEmployeeScopeWhere(context), { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }],
    },
    select: {
      id: true,
      companyMemberId: true,
      companyMember: {
        select: {
          user: { select: { firstName: true, lastName: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  if (profiles.length === 0) return [];

  // One query for every open record rather than one per employee
  // (PRD #16 §208, §258).
  const current = await prisma.compensation.findMany({
    where: { employeeProfileId: { in: profiles.map((row) => row.id) }, effectiveTo: null },
    select: {
      employeeProfileId: true,
      currency: true,
      payType: true,
      baseAmount: true,
      effectiveFrom: true,
    },
  });
  const byProfile = new Map(current.map((row) => [row.employeeProfileId, row]));

  return profiles
    .map((profile) => {
      const pay = byProfile.get(profile.id);
      if (!pay) return null;

      return {
        memberId: profile.companyMemberId,
        fullName: `${profile.companyMember.user.firstName} ${profile.companyMember.user.lastName}`,
        department: profile.companyMember.department?.name ?? null,
        payType: pay.payType,
        currency: pay.currency,
        baseAmount: toAmountString(pay.baseAmount),
        effectiveFrom: businessDateString(pay.effectiveFrom),
      };
    })
    .filter((row): row is CompensationReportRow => row !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/* -------------------------------------------------------------------------- */
/* Upcoming end dates (PRD #16 §145)                                           */
/* -------------------------------------------------------------------------- */

export async function upcomingEndDates(
  context: UserContext,
  options: { days?: number } = {},
): Promise<UpcomingEndRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.report.view");
  assertPermission(context, "hr.employee.view");

  const now = today();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + (options.days ?? 90));

  const rows = await prisma.employeeProfile.findMany({
    where: {
      AND: [
        buildEmployeeScopeWhere(context),
        {
          employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
          endDate: { gte: now, lte: horizon },
        },
      ],
    },
    orderBy: { endDate: "asc" },
    select: {
      companyMemberId: true,
      endDate: true,
      employmentType: true,
      companyMember: {
        select: {
          user: { select: { firstName: true, lastName: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    memberId: row.companyMemberId,
    fullName: `${row.companyMember.user.firstName} ${row.companyMember.user.lastName}`,
    department: row.companyMember.department?.name ?? null,
    endDate: businessDateString(row.endDate!),
    employmentType: row.employmentType,
  }));
}

/** Which reports this reader may open at all (PRD #16 §292). */
export function availableReports(context: UserContext) {
  return {
    headcount: can(context, "hr.report.view") && can(context, "hr.employee.view"),
    leave: can(context, "hr.report.view") && can(context, "hr.leave.view"),
    attendance: can(context, "hr.report.view") && can(context, "hr.attendance.view"),
    compensation: can(context, "hr.report.view") && can(context, "hr.compensation.view"),
    endingSoon: can(context, "hr.report.view") && can(context, "hr.employee.view"),
  };
}
