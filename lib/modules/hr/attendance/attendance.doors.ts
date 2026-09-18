import type { AttendanceStatus, Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { businessTimestamp, todayDay, type Day } from "../employment/employment.dates";
import { resolveTimes } from "./attendance.service";

/**
 * HR's door for attendance recorded on site (E-04 §48, §52, §123, §124).
 *
 * The row is HR's — one per employment per day, whether or not the person has a
 * login (§51, §53) — and the site sheet is one way of writing it. Who may use
 * the sheet, and for which people, is the caller's rule: the workforce
 * decides that from its own permissions and the project's crew and assignments.
 * What this door keeps is the row's own rules:
 *
 *   - a day is recorded, not predicted: nothing after today;
 *   - the source says it came from site, with the project, site and crew;
 *   - a day HR recorded, one the employee entered, or one approved leave wrote
 *     is not the sheet's to change — HR's word and the leave's stand (§48,
 *     PRD #16 §113);
 *   - a day recorded on one project's sheet is not rewritten from another's.
 */

export type SiteAttendanceRow = { employeeId: string; status: Extract<AttendanceStatus, "PRESENT" | "ABSENT" | "OFF">; checkIn?: string; checkOut?: string; notes?: string | null };

export type SiteAttendanceResult = { created: number; updated: number; unchanged: number };

const ENTITY = "AttendanceRecord";

export async function writeSiteAttendance(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: { date: Day; projectId: string | null; siteId: string | null; crewId: string | null; rows: SiteAttendanceRow[] },
): Promise<SiteAttendanceResult> {
  if (input.date > todayDay()) throw new AccessError("VALIDATION_ERROR", "Attendance is recorded for today or earlier.", { date: ["Attendance is recorded for today or earlier."] });
  const date = businessTimestamp(input.date);
  const ids = input.rows.map((row) => row.employeeId);

  const [employments, existing] = await Promise.all([
    tx.employeeProfile.findMany({
      where: { id: { in: ids }, companyId: context.companyId },
      select: { id: true, companyMemberId: true, employmentStatus: true, personProfile: { select: { firstName: true, lastName: true } } },
    }),
    tx.attendanceRecord.findMany({
      where: { employeeProfileId: { in: ids }, companyId: context.companyId, date },
      select: { id: true, employeeProfileId: true, status: true, checkIn: true, checkOut: true, notes: true, source: true, projectId: true, siteId: true, crewId: true },
    }),
  ]);
  const employmentOf = new Map(employments.map((row) => [row.id, row]));
  const recorded = new Map(existing.map((row) => [row.employeeProfileId, row]));
  const result: SiteAttendanceResult = { created: 0, updated: 0, unchanged: 0 };

  for (const row of input.rows) {
    const employment = employmentOf.get(row.employeeId);
    if (!employment) throw new AccessError("NOT_FOUND");
    const name = `${employment.personProfile.firstName} ${employment.personProfile.lastName}`;
    if (employment.employmentStatus === "ENDED" || employment.employmentStatus === "PLANNED") {
      throw new AccessError("CONFLICT", `${name} is not working here now.`, { code: "NOT_WORKING" });
    }
    const times = resolveTimes(date, row);
    const facts = {
      status: row.status,
      checkIn: times.checkIn,
      checkOut: times.checkOut,
      workedMinutes: times.workedMinutes,
      notes: row.notes ?? null,
      projectId: input.projectId,
      siteId: input.siteId,
      crewId: input.crewId,
    };
    const before = recorded.get(row.employeeId);

    if (!before) {
      const created = await tx.attendanceRecord.create({
        data: { companyId: context.companyId, employeeProfileId: employment.id, companyMemberId: employment.companyMemberId, date, source: "SITE", createdByMemberId: context.membershipId, ...facts },
        select: { id: true },
      });
      await recordActivity(tx, context, {
        module: "hr",
        entityType: ENTITY,
        entityId: created.id,
        action: "HR_ATTENDANCE_RECORDED",
        message: `recorded ${row.status.toLowerCase()} on site for ${input.date}`,
        metadata: { employmentId: employment.id, memberId: employment.companyMemberId, date: input.date, source: "SITE", projectId: input.projectId, siteId: input.siteId, crewId: input.crewId },
      });
      result.created += 1;
      continue;
    }

    if (before.source !== "SITE") {
      const whose = before.source === "SYSTEM" ? "approved leave" : "HR";
      throw new AccessError("CONFLICT", `${name}'s day was recorded by ${whose}. Change it in HR.`, { code: "RECORDED_ELSEWHERE" });
    }
    if (before.projectId && before.projectId !== input.projectId) {
      throw new AccessError("CONFLICT", `${name}'s day was recorded on another project's sheet.`, { code: "RECORDED_ELSEWHERE" });
    }
    const same =
      before.status === facts.status &&
      (before.checkIn?.getTime() ?? null) === (facts.checkIn?.getTime() ?? null) &&
      (before.checkOut?.getTime() ?? null) === (facts.checkOut?.getTime() ?? null) &&
      (before.notes ?? null) === facts.notes &&
      before.siteId === facts.siteId &&
      before.crewId === facts.crewId;
    if (same) {
      result.unchanged += 1;
      continue;
    }
    await tx.attendanceRecord.update({
      // As it was read: a day changed meanwhile is not overwritten blind.
      where: { companyId: context.companyId, id: before.id, status: before.status, source: "SITE" },
      data: {
        status: facts.status,
        checkIn: facts.checkIn,
        checkOut: facts.checkOut,
        workedMinutes: facts.workedMinutes,
        notes: facts.notes,
        projectId: facts.projectId,
        siteId: facts.siteId,
        crewId: facts.crewId,
        updatedByMemberId: context.membershipId,
      },
    });
    await recordActivity(tx, context, {
      module: "hr",
      entityType: ENTITY,
      entityId: before.id,
      action: "HR_ATTENDANCE_UPDATED",
      message: `corrected attendance on site for ${input.date}`,
      metadata: { employmentId: employment.id, memberId: employment.companyMemberId, date: input.date, source: "SITE", from: before.status, to: row.status },
    });
    result.updated += 1;
  }
  return result;
}
