import { Prisma, type AttendanceStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import {
  businessDateString,
  today,
  toBusinessDate,
  workedMinutesBetween,
} from "../hr.date";
import { buildAttendanceScopeWhere, buildEmployeeScopeWhere, isSelf } from "../hr.scope";
import { acceptsTimes, isException, isPlannable } from "../hr.status";
import type {
  AttendanceListQuery,
  CreateAttendanceInput,
  UpdateAttendanceInput,
} from "../hr.schema";
import type { AttendanceDTO } from "../hr.types";
import { isSystemGenerated } from "./attendance.sync";

/**
 * Attendance (PRD #16 §97–§115).
 *
 * Daily attendance, not biometric timekeeping. Three rules:
 *
 *   1. **One row per person per day**, enforced by a unique constraint as well
 *      as here (PRD #16 §101).
 *   2. **Worked minutes are calculated, never accepted.** Check-in and
 *      check-out are the input; the duration is derived (PRD #16 §106).
 *   3. **A day written by approved leave belongs to that leave.** Only a reader
 *      with the update grant may override it, and it is marked as such so
 *      nobody wonders where it came from (PRD #16 §113).
 */

const MODULE = "hr" as const;
const ENTITY = "AttendanceRecord";

const SELECT = {
  id: true,
  employeeProfileId: true,
  companyMemberId: true,
  date: true,
  status: true,
  checkIn: true,
  checkOut: true,
  workedMinutes: true,
  notes: true,
  source: true,
  sourceEntityType: true,
  sourceEntityId: true,
  createdByMemberId: true,
  updatedByMemberId: true,
  updatedAt: true,
  projectId: true,
  siteId: true,
  crewId: true,
  employeeProfile: {
    select: {
      // Whose day it is for self-service is the employment's login now (E-04 §7).
      companyMemberId: true,
      personProfile: { select: { firstName: true, lastName: true, workEmail: true } },
      companyMember: { select: { user: { select: { email: true, avatarUrl: true } } } },
    },
  },
} satisfies Prisma.AttendanceRecordSelect;

type AttendanceRow = Prisma.AttendanceRecordGetPayload<{ select: typeof SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listAttendance(context: UserContext, query: AttendanceListQuery) {
  assertModule(context, MODULE);

  const canSeeOthers = can(context, "hr.attendance.view");
  if (!canSeeOthers) assertPermission(context, "hr.self.attendance");

  const filters: Prisma.AttendanceRecordWhereInput[] = [buildAttendanceScopeWhere(context)];

  if (!canSeeOthers || query.mine) {
    filters.push({ employeeProfile: { companyMemberId: context.membershipId } });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { employeeProfile: { personProfile: { firstName: { contains: term, mode: "insensitive" } } } },
        { employeeProfile: { personProfile: { lastName: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.employeeId) filters.push({ employeeProfileId: query.employeeId });
  if (query.from) filters.push({ date: { gte: toBusinessDate(query.from) } });
  if (query.to) filters.push({ date: { lte: toBusinessDate(query.to) } });

  // An exception is an absence, or a present day with no check-out. Expressed
  // as a query rather than filtered in memory, so paging stays honest
  // (PRD #16 §115).
  if (query.exceptionsOnly) {
    filters.push({
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
    });
  }

  const where: Prisma.AttendanceRecordWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      orderBy: query.sort === "date-asc" ? [{ date: "asc" }] : [{ date: "desc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SELECT,
    }),
    prisma.attendanceRecord.count({ where }),
  ]);

  return {
    data: rows.map((row) => toDTO(context, row)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getAttendance(
  context: UserContext,
  attendanceId: string,
): Promise<AttendanceDTO> {
  assertModule(context, MODULE);

  const row = await requireRecord(context, attendanceId);
  return toDTO(context, row);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createAttendance(
  context: UserContext,
  input: CreateAttendanceInput,
): Promise<AttendanceDTO> {
  assertModule(context, MODULE);

  // Your own day needs only self-service; anybody else's — including an
  // employee with no login, whose days are always recorded for them — needs
  // the grant (PRD #16 §100, E-04 §51).
  if (!can(context, "hr.attendance.create") && !can(context, "hr.self.attendance")) {
    assertPermission(context, "hr.self.attendance");
  }
  const profile = input.employeeId ? await requireProfile(context, input.employeeId) : await requireOwnProfile(context);
  const forSelf = isSelf(context, profile.companyMemberId);
  if (!forSelf) assertPermission(context, "hr.attendance.create");

  const date = toBusinessDate(input.date);
  assertDateAllowed(date, input.status);

  const times = resolveTimes(date, input);

  const attendanceId = await prisma.$transaction(async (tx) => {
    const clash = await tx.attendanceRecord.findUnique({
      where: { employeeProfileId_date: { employeeProfileId: profile.id, date } },
      select: { id: true },
    });
    if (clash) {
      throw new AccessError(
        "CONFLICT",
        `There is already an attendance record for ${businessDateString(date)}.`,
      );
    }

    const record = await tx.attendanceRecord.create({
      data: {
        companyId: context.companyId,
        employeeProfileId: profile.id,
        companyMemberId: profile.companyMemberId,
        date,
        status: input.status,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        workedMinutes: times.workedMinutes,
        notes: input.notes ?? null,
        // Somebody recording their own day is a different fact from HR
        // recording it for them, and the trail should say which (PRD #16 §100).
        source: forSelf && !can(context, "hr.attendance.create") ? "SELF" : "MANUAL",
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: record.id,
      action: "HR_ATTENDANCE_RECORDED",
      message: `recorded ${input.status.toLowerCase().replace("_", " ")} for ${businessDateString(date)}`,
      metadata: { employmentId: profile.id, memberId: profile.companyMemberId, date: businessDateString(date) } as Prisma.InputJsonValue,
    });

    return record.id;
  });

  return getAttendance(context, attendanceId);
}

export async function updateAttendance(
  context: UserContext,
  attendanceId: string,
  input: UpdateAttendanceInput,
): Promise<AttendanceDTO> {
  assertModule(context, MODULE);

  const existing = await requireRecord(context, attendanceId);
  const own = isSelf(context, existing.employeeProfile.companyMemberId);

  /*
   * A day written by approved leave is that leave's record. Only somebody with
   * the update grant may override it — otherwise an employee could quietly turn
   * an approved leave day into a working one, and the balance would say one
   * thing while attendance said another (PRD #16 §113).
   */
  if (isSystemGenerated(existing)) {
    assertPermission(context, "hr.attendance.update");
  } else if (!can(context, "hr.attendance.update")) {
    if (!(own && can(context, "hr.self.attendance") && isSelfEntered(context, existing))) {
      assertPermission(context, "hr.attendance.update");
    }
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This record was updated by another user. Refresh and review the latest changes.",
    );
  }

  const times = resolveTimes(existing.date, input);

  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.update({
      where: { id: attendanceId, companyId: context.companyId },
      data: {
        status: input.status,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        workedMinutes: times.workedMinutes,
        notes: input.notes ?? null,
        // An overridden leave day stops claiming the leave wrote it.
        ...(isSystemGenerated(existing)
          ? { source: "MANUAL" as const, sourceEntityType: null, sourceEntityId: null }
          : {}),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: attendanceId,
      action: "HR_ATTENDANCE_UPDATED",
      message: `updated attendance for ${businessDateString(existing.date)}`,
      metadata: {
        employmentId: existing.employeeProfileId,
        memberId: existing.employeeProfile.companyMemberId,
        date: businessDateString(existing.date),
      } as Prisma.InputJsonValue,
    });
  });

  return getAttendance(context, attendanceId);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A day the employee wrote and nobody else has since corrected (PRD #47 §85, §98).
 *
 * Self-service is for keeping your own entries right. A day HR recorded — or
 * a self-entered day HR has since corrected — is HR's record: letting the
 * employee rewrite it would leave a row that still reads as HR's word while
 * saying whatever the employee typed.
 */
function isSelfEntered(
  context: UserContext,
  row: { createdByMemberId: string; updatedByMemberId: string | null },
): boolean {
  return (
    row.createdByMemberId === context.membershipId &&
    (row.updatedByMemberId === null || row.updatedByMemberId === context.membershipId)
  );
}

async function requireRecord(
  context: UserContext,
  attendanceId: string,
): Promise<AttendanceRow> {
  const row = assertFound(
    await prisma.attendanceRecord.findFirst({
      where: { AND: [buildAttendanceScopeWhere(context), { id: attendanceId }] },
      select: SELECT,
    }),
  );

  if (!can(context, "hr.attendance.view") && !isSelf(context, row.employeeProfile.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }

  return row;
}

/** An employment in this reader's HR scope, with or without a login (E-04 §51). */
async function requireProfile(context: UserContext, employmentId: string) {
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { id: employmentId }] },
      select: { id: true, companyMemberId: true },
    }),
  );
}

/** The reader's own employment here, for self-service. */
async function requireOwnProfile(context: UserContext) {
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { companyId: context.companyId, companyMemberId: context.membershipId },
      select: { id: true, companyMemberId: true },
    }),
  );
}

/**
 * Attendance is a record of what happened (PRD #16 §104).
 *
 * A future date can only be planned, not attended: "present next Tuesday" is
 * not something anybody knows. Holidays and days off are the exception, because
 * those are decisions made in advance.
 */
function assertDateAllowed(date: Date, status: AttendanceStatus): void {
  if (date.getTime() <= today().getTime()) return;
  if (isPlannable(status)) return;

  throw new AccessError(
    "VALIDATION_ERROR",
    "Attendance cannot be recorded for a future date. Only holidays and days off can be planned ahead.",
  );
}

/**
 * Combines the date with `HH:MM` times and derives the duration.
 *
 * Times are dropped for statuses that cannot carry them, rather than stored and
 * ignored — an absent day with a check-in time is a contradiction
 * (PRD #16 §105, §107).
 */
export function resolveTimes(
  date: Date,
  input: { status: AttendanceStatus; checkIn?: string; checkOut?: string },
) {
  if (!acceptsTimes(input.status)) {
    return { checkIn: null, checkOut: null, workedMinutes: null };
  }

  const checkIn = combine(date, input.checkIn);
  const checkOut = combine(date, input.checkOut);

  if (checkIn && checkOut && checkOut.getTime() < checkIn.getTime()) {
    throw new AccessError("VALIDATION_ERROR", "Check-out cannot be before check-in.");
  }

  return { checkIn, checkOut, workedMinutes: workedMinutesBetween(checkIn, checkOut) };
}

function combine(date: Date, time: string | undefined): Date | null {
  if (!time) return null;
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes),
  );
}

function timeString(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(11, 16);
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function toDTO(context: UserContext, row: AttendanceRow): AttendanceDTO {
  const own = isSelf(context, row.employeeProfile.companyMemberId);
  const person = row.employeeProfile.personProfile;
  const user = row.employeeProfile.companyMember?.user ?? null;
  const fromLeave = isSystemGenerated(row);

  return {
    id: row.id,
    employee: {
      employeeId: row.employeeProfileId,
      memberId: row.employeeProfile.companyMemberId,
      fullName: `${person.firstName} ${person.lastName}`,
      email: person.workEmail ?? user?.email ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    },
    date: businessDateString(row.date),
    status: row.status,
    checkIn: timeString(row.checkIn),
    checkOut: timeString(row.checkOut),
    workedMinutes: row.workedMinutes,
    notes: row.notes,
    source: row.source,
    systemGenerated: fromLeave,
    isException: isException(row),
    updatedAt: row.updatedAt.toISOString(),

    capabilities: {
      canEdit: fromLeave
        ? can(context, "hr.attendance.update")
        : can(context, "hr.attendance.update") ||
          (own && can(context, "hr.self.attendance") && isSelfEntered(context, row)),
    },
  };
}
