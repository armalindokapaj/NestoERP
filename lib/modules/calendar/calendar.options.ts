import type { CalendarEventType, CalendarVisibility } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canCreateEvent } from "./calendar.visibility";

/**
 * What the create drawer may offer this reader (PRD #39 §105, §147).
 * Only options the service would accept: types and visibilities they may
 * publish, projects in their scope, departments they may address.
 */

const TYPES: CalendarEventType[] = ["PERSONAL_EVENT", "TEAM_EVENT", "INTERNAL_DEADLINE", "TRAINING", "COMPANY_EVENT", "COMPANY_HOLIDAY", "OFFICE_CLOSURE"];
const VISIBILITIES: CalendarVisibility[] = ["PRIVATE", "SELECTED_MEMBERS", "PROJECT", "DEPARTMENT", "COMPANY"];

export type CalendarFormOptions = {
  eventTypes: CalendarEventType[];
  visibilities: CalendarVisibility[];
  projects: Array<{ id: string; name: string; code: string }>;
  departments: Array<{ id: string; name: string }>;
  myDepartmentId: string | null;
};

export async function calendarFormOptions(context: UserContext): Promise<CalendarFormOptions> {
  if (!canAccessModule(context, "calendar") || !can(context, "calendar.event.create")) throw new AccessError("FORBIDDEN");
  const manager = can(context, "calendar.company_event.manage");

  const [projects, departments] = await Promise.all([
    canAccessModule(context, "projects") && can(context, "project.view")
      ? prisma.project.findMany({
          where: { AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }] },
          orderBy: { name: "asc" },
          take: 200,
          select: { id: true, name: true, code: true },
        })
      : [],
    prisma.department.findMany({
      where: { companyId: context.companyId, archivedAt: null, ...(manager ? {} : { id: context.department?.id ?? "__none__" }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    eventTypes: TYPES.filter((eventType) =>
      VISIBILITIES.some((visibility) => canCreateEvent(context, { eventType, visibility, departmentId: context.department?.id }).ok),
    ),
    visibilities: VISIBILITIES.filter(
      (visibility) =>
        (visibility !== "PROJECT" || projects.length > 0) &&
        (visibility !== "DEPARTMENT" || departments.length > 0) &&
        TYPES.some((eventType) => canCreateEvent(context, { eventType, visibility, departmentId: context.department?.id }).ok),
    ),
    projects,
    departments,
    myDepartmentId: context.department?.id ?? null,
  };
}

/** People who can be invited: active members of this company, by name (PRD #39 §53). */
export async function searchInvitees(context: UserContext, query: string | undefined) {
  if (!canAccessModule(context, "calendar") || !can(context, "calendar.event.create")) throw new AccessError("FORBIDDEN");
  const term = query?.trim().slice(0, 80);
  const rows = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      id: { not: context.membershipId },
      user: {
        status: "ACTIVE",
        ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] } : {}),
      },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 20,
    select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ memberId: row.id, fullName: `${row.user.firstName} ${row.user.lastName}`, jobTitle: row.jobTitle }));
}
