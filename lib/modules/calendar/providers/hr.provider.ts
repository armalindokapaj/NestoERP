import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { buildLeaveScopeWhere, hrScopeKind } from "@/lib/modules/hr/hr.scope";
import { personName, PERSON_NAME_SELECT, type PersonName } from "@/lib/modules/hr/hr.person";
import type { CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, onBusinessDate, SOURCE_LIMIT, sourceRows } from "./provider.helpers";

/**
 * Approved leave (PRD #39 §48, §55).
 *
 * The privacy transformation happens here, before a DTO exists:
 *
 *   own leave                        full: "Annual leave", linked
 *   HR who decide leave              full: "Ethan Cole — Parental leave"
 *   other HR readers (CEO, Admin)    "Ethan Cole — Unavailable"
 *   a project manager, for people
 *   on the projects they run         "Ethan Cole — Unavailable"
 *   everybody else                   nothing
 *
 * An "Unavailable" entry is busy-only: no leave type, no reason, no link, no
 * module colour (PRD #39 §47, §180).
 */
const LEAVE_LABEL: Record<string, string> = {
  ANNUAL: "Annual leave",
  SICK: "Sick leave",
  UNPAID: "Unpaid leave",
  PARENTAL: "Parental leave",
  OTHER: "Leave",
};

function memberName(row: { employeeProfile: { personProfile: PersonName } }): string {
  return personName(row.employeeProfile.personProfile);
}

function busyOnly(id: string, name: string): Omit<CalendarEventDTO, "startsAt" | "endsAt" | "allDay" | "editable" | "draggable" | "resizable"> {
  return {
    id: `availability:${id}`,
    sourceType: "busy",
    sourceId: id,
    providerKey: "availability",
    title: `${name} — Unavailable`,
    category: "PERSONAL",
    href: "",
    privacyMode: "BUSY_ONLY",
  };
}

export const hrProvider: CalendarProvider = {
  key: "hr",
  moduleKey: "hr",
  categories: ["HR"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => canAccessModule(context, "hr") && (can(context, "hr.leave.view") || can(context, "project.manage")),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const overlap = { status: "APPROVED" as const, startDate: { lt: window.lt }, endDate: { gte: window.gte } };
    const memberFilter = filters.myOnly
      ? { companyMemberId: context.membershipId }
      : filters.memberIds?.length
        ? { companyMemberId: { in: filters.memberIds } }
        : {};
    const select = {
      id: true,
      leaveType: true,
      startDate: true,
      endDate: true,
      companyMemberId: true,
      employeeProfile: { select: { personProfile: PERSON_NAME_SELECT } },
    } as const;

    const decidesLeave = can(context, "hr.leave.approve") && hrScopeKind(context) !== "SELF";
    const seen = new Set<string>();
    const events: Array<CalendarEventDTO | null> = [];

    if (can(context, "hr.leave.view")) {
      const rows = await sourceRows(input, prisma.leaveRequest.findMany({
        where: { AND: [buildLeaveScopeWhere(context), overlap, memberFilter] },
        take: SOURCE_LIMIT,
        select,
      }));
      for (const row of rows) {
        seen.add(row.id);
        const name = memberName(row);
        const own = row.companyMemberId === context.membershipId;
        if (own || decidesLeave) {
          events.push(
            onBusinessDate(
              input,
              row.startDate,
              {
                id: `hr:${row.id}`,
                sourceType: "leave_request",
                sourceId: row.id,
                providerKey: "hr",
                title: own ? LEAVE_LABEL[row.leaveType] : `${name} — ${LEAVE_LABEL[row.leaveType]}`,
                category: "HR",
                status: "APPROVED",
                href: `/hr/leave/${row.id}`,
                participants: row.companyMemberId ? [{ memberId: row.companyMemberId, name }] : [],
                privacyMode: "FULL",
                metadata: { sourceLabel: "Leave", moduleKey: "hr" },
              },
              row.endDate,
            ),
          );
        } else {
          events.push(onBusinessDate(input, row.startDate, busyOnly(row.id, name), row.endDate));
        }
      }
    }

    // A project manager plans around their team's absences without reading HR
    // files: who is away, never why.
    if (!filters.myOnly && can(context, "project.manage") && canAccessModule(context, "projects")) {
      const rows = await sourceRows(input, prisma.leaveRequest.findMany({
        where: {
          AND: [
            { companyId: context.companyId },
            overlap,
            memberFilter,
            { id: { notIn: [...seen] } },
            { companyMemberId: { not: context.membershipId } },
            { employeeProfile: { companyMember: { projectMemberships: { some: { project: buildProjectScopeWhere(context) } } } } },
          ],
        },
        take: SOURCE_LIMIT,
        select,
      }));
      for (const row of rows) {
        const name = memberName(row);
        events.push(onBusinessDate(input, row.startDate, busyOnly(row.id, name), row.endDate));
      }
    }

    return compact(events);
  },
};
