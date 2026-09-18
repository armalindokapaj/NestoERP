import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { writeSiteAttendance } from "@/lib/modules/hr/attendance/attendance.doors";
import { businessTimestamp, todayDay, type Day } from "@/lib/modules/hr/employment/employment.dates";
import { assertWorkforce, coversDay, readableCrewWhere, workforceProjectWhere } from "./workforce.permissions";
import type { SaveSheetInput, SheetScope } from "./workforce.schema";
import { personName } from "./workforce.shared";
import type { AttendanceSheetDTO, AttendanceSheetResult, AttendanceSheetRowDTO, ProjectRef, Ref, WorkerRef } from "./workforce.types";

/**
 * Attendance on site (E-04 §123, §124, §266): pick a day and a crew, or a
 * project and a site, and mark everybody at once. The sheet lists the people
 * working there that day — the crew's members, or the people assigned to the
 * project and site — with or without a login, and nobody else, so a sheet
 * cannot be used to write somebody else's day. The rows themselves are HR's and
 * are written through HR's door; a day HR or approved leave recorded stays as
 * they recorded it.
 */

type Resolved = { date: Day; project: ProjectRef | null; site: Ref | null; crew: Ref | null };
type SheetWorker = WorkerRef & { trade: string | null; crew: string | null };

async function resolveScope(context: UserContext, scope: SheetScope): Promise<Resolved> {
  const crew = scope.crewId
    ? await prisma.workforceCrew.findFirst({
        where: { AND: [readableCrewWhere(context), { id: scope.crewId }] },
        select: { id: true, name: true, project: { select: { id: true, name: true, code: true } }, site: { select: { id: true, name: true } } },
      })
    : null;
  if (scope.crewId && !crew) throw invalidRecordLink("crewId", "SCOPE_DENIED", "Choose one of your crews.");

  const projectId = scope.projectId ?? crew?.project?.id ?? null;
  const project = projectId ? await prisma.project.findFirst({ where: { AND: [workforceProjectWhere(context), { id: projectId }] }, select: { id: true, name: true, code: true } }) : null;
  if (projectId && !project) throw invalidRecordLink("projectId", "SCOPE_DENIED", "Choose one of your projects.");

  const siteId = scope.siteId ?? (scope.projectId && scope.projectId !== crew?.project?.id ? null : (crew?.site?.id ?? null));
  const site = siteId && project ? await prisma.projectSite.findFirst({ where: { id: siteId, projectId: project.id, companyId: context.companyId }, select: { id: true, name: true } }) : null;
  if (siteId && !site) throw invalidRecordLink("siteId", "CROSS_PROJECT_REFERENCE", "Choose one of this project's sites.");

  return { date: scope.date, project, site, crew: crew ? { id: crew.id, name: crew.name } : null };
}

/** Who is on the sheet: the crew's members that day, else the project's (and site's) assigned people. */
async function sheetWorkers(context: UserContext, scope: Resolved): Promise<Map<string, SheetWorker>> {
  const covering = coversDay(scope.date);
  const employee = { select: { id: true, personProfileId: true, employmentStatus: true, personProfile: { select: { firstName: true, lastName: true } }, trade: { select: { name: true } } } } as const;
  const workers = new Map<string, SheetWorker>();
  const add = (row: { id: string; personProfileId: string; employmentStatus: string; personProfile: { firstName: string; lastName: string }; trade: { name: string } | null }, crew: string | null) => {
    if (row.employmentStatus === "ENDED" || row.employmentStatus === "PLANNED" || workers.has(row.id)) return;
    workers.set(row.id, { employeeId: row.id, personId: row.personProfileId, name: personName(row.personProfile), trade: row.trade?.name ?? null, crew });
  };

  if (scope.crew) {
    const members = await prisma.workforceCrewMember.findMany({ where: { crewId: scope.crew.id, companyId: context.companyId, ...covering }, select: { employeeProfile: employee } });
    for (const member of members) add(member.employeeProfile, scope.crew.name);
    return workers;
  }
  if (!scope.project) return workers;
  const assigned = await prisma.employeeProjectAssignment.findMany({
    where: { companyId: context.companyId, projectId: scope.project.id, ...(scope.site ? { siteId: scope.site.id } : {}), ...covering },
    select: { employeeProfile: employee },
  });
  for (const row of assigned) add(row.employeeProfile, null);
  return workers;
}

function lockOf(row: { source: string; projectId: string | null }, projectId: string | null): string | null {
  if (row.source === "SYSTEM") return "On approved leave";
  if (row.source !== "SITE") return "Recorded in HR";
  if (row.projectId && row.projectId !== projectId) return "Recorded on another project";
  return null;
}

const time = (value: Date | null) => (value ? value.toISOString().slice(11, 16) : null);

export async function getAttendanceSheet(context: UserContext, input: SheetScope): Promise<AttendanceSheetDTO> {
  assertWorkforce(context, "workforce.attendance.view");
  const scope = await resolveScope(context, input);
  const workers = await sheetWorkers(context, scope);
  const existing = workers.size
    ? await prisma.attendanceRecord.findMany({
        where: { companyId: context.companyId, employeeProfileId: { in: [...workers.keys()] }, date: businessTimestamp(scope.date) },
        select: { id: true, employeeProfileId: true, status: true, checkIn: true, checkOut: true, notes: true, source: true, projectId: true, project: { select: { name: true } } },
      })
    : [];
  const recorded = new Map(existing.map((row) => [row.employeeProfileId, row]));
  const canRecord = can(context, "workforce.attendance.manage") && scope.date <= todayDay();

  const rows = [...workers.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((worker): AttendanceSheetRowDTO => {
      const row = recorded.get(worker.employeeId);
      return {
        ...worker,
        attendance: row
          ? {
              id: row.id,
              status: row.status,
              checkIn: time(row.checkIn),
              checkOut: time(row.checkOut),
              notes: row.notes,
              source: row.source,
              elsewhere: row.projectId && row.projectId !== scope.project?.id ? (row.project?.name ?? null) : null,
            }
          : null,
        locked: row ? lockOf(row, scope.project?.id ?? null) : null,
      };
    });
  return { date: scope.date, project: scope.project, site: scope.site, crew: scope.crew, rows, canRecord };
}

export async function saveAttendanceSheet(context: UserContext, input: SaveSheetInput): Promise<AttendanceSheetResult> {
  assertWorkforce(context, "workforce.attendance.manage");
  if (!input.projectId && !input.crewId) throw new AccessError("VALIDATION_ERROR", "Choose a project or a crew.", { projectId: ["Choose a project or a crew."] });
  const scope = await resolveScope(context, { date: input.date, projectId: input.projectId ?? null, siteId: input.siteId ?? null, crewId: input.crewId ?? null });
  const workers = await sheetWorkers(context, scope);

  const seen = new Set<string>();
  for (const row of input.rows) {
    if (seen.has(row.employeeId)) throw new AccessError("VALIDATION_ERROR", "Each person appears on the sheet once.");
    seen.add(row.employeeId);
    // Only the people working there that day: the sheet is not a door to anybody else's attendance (§150).
    if (!workers.has(row.employeeId)) throw new AccessError("VALIDATION_ERROR", "Somebody on the sheet is not working here that day. Reload the sheet.", { code: "NOT_ON_SHEET" });
  }

  const result = await prisma
    .$transaction(async (tx) => {
      const written = await writeSiteAttendance(tx, context, {
        date: scope.date,
        projectId: scope.project?.id ?? null,
        siteId: scope.site?.id ?? null,
        crewId: scope.crew?.id ?? null,
        rows: input.rows.map((row) => ({ employeeId: row.employeeId, status: row.status, checkIn: row.checkIn, checkOut: row.checkOut, notes: row.notes ?? null })),
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKFORCE_ATTENDANCE_RECORDED,
          entity: { type: "AttendanceSheet", id: `${scope.date}:${scope.crew?.id ?? scope.site?.id ?? scope.project?.id}`, label: `${scope.crew?.name ?? scope.site?.name ?? scope.project?.name} · ${scope.date}` },
          projectId: scope.project?.id ?? null,
          after: { date: scope.date, projectId: scope.project?.id ?? null, siteId: scope.site?.id ?? null, crewId: scope.crew?.id ?? null, ...written },
        },
        { tx },
      );
      return written;
    })
    .catch((error: unknown) => {
      // Somebody else recorded one of these days at the same moment (§101).
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2025")) {
        throw new AccessError("CONFLICT", "Somebody recorded one of these days at the same moment. Reload the sheet.", { code: "SHEET_RACED" });
      }
      throw error;
    });
  return result;
}
