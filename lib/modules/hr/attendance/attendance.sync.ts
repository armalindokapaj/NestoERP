import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { businessDateString, workingDaysBetween } from "../hr.date";
import { countsAsWorked } from "../hr.status";

/**
 * Attendance written by approved leave (PRD #16 §108–§110, §113).
 *
 * When leave is approved, the working days it covers become `ON_LEAVE`
 * attendance rows tagged with the request that created them. When that leave is
 * cancelled, exactly those rows come back out — identified by source, so a day
 * somebody entered by hand is never touched.
 *
 * A day that already has an attendance row is left as it is. Overwriting what
 * a person recorded about their own day would be the module deciding it knows
 * better than they did.
 *
 * There is one exception, and it is a refusal rather than an overwrite: a day
 * the person is recorded as having *worked* contradicts the leave outright, so
 * approval fails and the attendance has to be corrected first (PRD #16 §221).
 * Silently skipping it would leave two records of the same day disagreeing,
 * and the attendance report counting both.
 */

const SOURCE_TYPE = "leave_request";

export async function syncAttendanceForLeave(
  tx: Prisma.TransactionClient,
  context: UserContext,
  leave: {
    leaveRequestId: string;
    employeeProfileId: string;
    companyMemberId: string;
    startDate: Date;
    endDate: Date;
  },
): Promise<number> {
  const days = workingDaysBetween(leave.startDate, leave.endDate);
  if (days.length === 0) return 0;

  const existing = await tx.attendanceRecord.findMany({
    where: { companyMemberId: leave.companyMemberId, date: { in: days } },
    select: { date: true, status: true },
  });

  const worked = existing.filter((row) => countsAsWorked(row.status));
  if (worked.length > 0) {
    const dates = worked.map((row) => businessDateString(row.date)).join(", ");
    throw new AccessError(
      "CONFLICT",
      `Attendance already records this employee as working on ${dates}. Correct the attendance before approving the leave.`,
    );
  }

  const taken = new Set(existing.map((row) => row.date.getTime()));

  const toCreate = days.filter((date) => !taken.has(date.getTime()));
  if (toCreate.length === 0) return 0;

  await tx.attendanceRecord.createMany({
    data: toCreate.map((date) => ({
      companyId: context.companyId,
      employeeProfileId: leave.employeeProfileId,
      companyMemberId: leave.companyMemberId,
      date,
      status: "ON_LEAVE" as const,
      source: "SYSTEM" as const,
      sourceEntityType: SOURCE_TYPE,
      sourceEntityId: leave.leaveRequestId,
      createdByMemberId: context.membershipId,
    })),
  });

  return toCreate.length;
}

/**
 * Removes only the rows this leave request created.
 *
 * Scoped by `sourceEntityId`, not by date range: two requests could touch the
 * same week, and cancelling one must not erase the other's days.
 */
export async function removeAttendanceForLeave(
  tx: Prisma.TransactionClient,
  leaveRequestId: string,
): Promise<number> {
  const result = await tx.attendanceRecord.deleteMany({
    where: {
      sourceEntityType: SOURCE_TYPE,
      sourceEntityId: leaveRequestId,
      source: "SYSTEM",
    },
  });

  return result.count;
}

/** Whether a row was written by leave, and so is HR's to change (PRD #16 §113). */
export function isSystemGenerated(record: {
  source: string;
  sourceEntityType: string | null;
}): boolean {
  return record.source === "SYSTEM" && record.sourceEntityType === SOURCE_TYPE;
}

export { SOURCE_TYPE as LEAVE_SOURCE_TYPE };
