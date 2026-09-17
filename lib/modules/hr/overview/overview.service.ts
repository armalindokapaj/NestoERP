import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { today } from "../hr.date";
import { memberAddressed } from "../hr.person";
import {
  buildAttendanceScopeWhere,
  buildEmployeeScopeWhere,
  buildLeaveScopeWhere,
  hrScopeKind,
} from "../hr.scope";
import type { HrOverviewDTO } from "../hr.types";

/**
 * The HR overview (PRD #16 §21–§24, §236).
 *
 * Every figure is a scoped aggregate, and each panel is gated by its own
 * permission — so a self-scoped reader sees their own leave and attendance
 * rather than a company dashboard with holes in it (PRD #16 §22, §23).
 */

const MODULE = "hr" as const;

/** Where "soon" ends, for the starting/ending counters (PRD #16 §253, §254). */
const HORIZON_DAYS = 30;

export async function getHrOverview(context: UserContext): Promise<HrOverviewDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.dashboard.view");

  const selfOnly = hrScopeKind(context) === "SELF" && !can(context, "hr.employee.view");

  const visible = {
    employees: can(context, "hr.employee.view"),
    leave: can(context, "hr.leave.view") || can(context, "hr.self.leave"),
    attendance: can(context, "hr.attendance.view") || can(context, "hr.self.attendance"),
    onboarding: can(context, "hr.onboarding.view"),
    selfOnly,
  };

  const now = today();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + HORIZON_DAYS);

  const employeeScope = buildEmployeeScopeWhere(context);
  const leaveScope = buildLeaveScopeWhere(context);
  const attendanceScope = buildAttendanceScopeWhere(context);

  const [
    headcount,
    byType,
    pendingLeave,
    onLeaveToday,
    startingSoon,
    endingSoon,
    onboardingInProgress,
    offboardingInProgress,
    attendanceExceptions,
  ] = await Promise.all([
    // Headcount is people whose employment is running, whether or not they are
    // in today (PRD #16 §142).
    visible.employees
      ? prisma.employeeProfile.count({
          where: { AND: [employeeScope, { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }] },
        })
      : Promise.resolve(0),

    visible.employees
      ? prisma.employeeProfile.groupBy({
          by: ["employmentType"],
          where: { AND: [employeeScope, { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }] },
          _count: { _all: true },
        })
      : Promise.resolve([]),

    visible.leave
      ? prisma.leaveRequest.count({ where: { AND: [leaveScope, { status: "PENDING" }] } })
      : Promise.resolve(0),

    visible.leave
      ? prisma.leaveRequest.count({
          where: {
            AND: [
              leaveScope,
              { status: "APPROVED", startDate: { lte: now }, endDate: { gte: now } },
            ],
          },
        })
      : Promise.resolve(0),

    visible.employees
      ? prisma.employeeProfile.count({
          where: {
            AND: [
              employeeScope,
              { employmentStatus: "PLANNED", startDate: { gte: now, lte: horizon } },
            ],
          },
        })
      : Promise.resolve(0),

    visible.employees
      ? prisma.employeeProfile.count({
          where: {
            AND: [
              employeeScope,
              {
                employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
                endDate: { gte: now, lte: horizon },
              },
            ],
          },
        })
      : Promise.resolve(0),

    visible.onboarding
      ? prisma.employeeProfile.count({
          where: {
            AND: [employeeScope, { onboardingStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] } }],
          },
        })
      : Promise.resolve(0),

    visible.onboarding
      ? prisma.employeeProfile.count({
          where: {
            AND: [employeeScope, { offboardingStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] } }],
          },
        })
      : Promise.resolve(0),

    visible.attendance
      ? prisma.attendanceRecord.count({
          where: {
            AND: [
              attendanceScope,
              {
                OR: [
                  { status: "ABSENT" },
                  {
                    AND: [
                      { status: { in: ["PRESENT", "REMOTE"] } },
                      { checkIn: { not: null } },
                      { checkOut: null },
                    ],
                  },
                ],
              },
              // The last month, so a two-year-old absence is not still shouting.
              { date: { gte: monthAgo(now) } },
            ],
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    headcount,
    byEmploymentType: byType
      .map((row) => ({ type: row.employmentType, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    pendingLeave,
    onLeaveToday,
    startingSoon,
    endingSoon,
    onboardingInProgress,
    offboardingInProgress,
    attendanceExceptions,
    visible,
  };
}

function monthAgo(from: Date): Date {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() - 30);
  return date;
}

/** Employment records starting or ending inside the horizon (PRD #16 §252–§255). */
export async function attentionList(context: UserContext) {
  assertModule(context, MODULE);
  if (!can(context, "hr.employee.view")) return { starting: [], ending: [], probation: [] };

  const now = today();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + HORIZON_DAYS);

  const scope = buildEmployeeScopeWhere(context);
  const select = {
    companyMemberId: true,
    startDate: true,
    endDate: true,
    probationEndDate: true,
    companyMember: {
      select: { user: { select: { firstName: true, lastName: true } } },
    },
  } satisfies Prisma.EmployeeProfileSelect;

  const [starting, ending, probation] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: {
        AND: [scope, { employmentStatus: "PLANNED", startDate: { gte: now, lte: horizon } }],
      },
      orderBy: { startDate: "asc" },
      take: 10,
      select,
    }),
    prisma.employeeProfile.findMany({
      where: {
        AND: [
          scope,
          {
            employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
            endDate: { gte: now, lte: horizon },
          },
        ],
      },
      orderBy: { endDate: "asc" },
      take: 10,
      select,
    }),
    prisma.employeeProfile.findMany({
      where: {
        AND: [
          scope,
          { employmentStatus: "ACTIVE", probationEndDate: { gte: now, lte: horizon } },
        ],
      },
      orderBy: { probationEndDate: "asc" },
      take: 10,
      select,
    }),
  ]);

  const shape = (rows: typeof starting, dateKey: "startDate" | "endDate" | "probationEndDate") =>
    rows.map(memberAddressed).map((row) => ({
      memberId: row.companyMemberId,
      fullName: `${row.companyMember.user.firstName} ${row.companyMember.user.lastName}`,
      date: row[dateKey] ? row[dateKey]!.toISOString().slice(0, 10) : null,
    }));

  return {
    starting: shape(starting, "startDate"),
    ending: shape(ending, "endDate"),
    probation: shape(probation, "probationEndDate"),
  };
}
