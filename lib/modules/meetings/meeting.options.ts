import type { MeetingType, MeetingVisibility } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canCreateMeeting, meetingsOpen, visibilityProblem } from "./meeting.permissions";
import { meetingTimezone } from "./meeting.repository";
import { AGENDA_TEMPLATES, MEETING_TYPES } from "./meeting.types";

/**
 * What the meeting form may offer this reader (PRD #40 §87, §88): only what the
 * service would accept — projects in their scope, departments they may hold a
 * meeting for, the visibilities that leaves.
 */

const VISIBILITIES: MeetingVisibility[] = ["PARTICIPANTS", "PROJECT", "DEPARTMENT", "COMPANY"];

export type MeetingFormOptions = {
  meetingTypes: MeetingType[];
  visibilities: MeetingVisibility[];
  projects: Array<{ id: string; name: string; code: string }>;
  departments: Array<{ id: string; name: string }>;
  myDepartmentId: string | null;
  templates: Array<{ key: string; label: string; count: number }>;
  timezone: string;
  me: { memberId: string; fullName: string };
};

export async function meetingFormOptions(context: UserContext): Promise<MeetingFormOptions> {
  if (!canCreateMeeting(context)) throw new AccessError("FORBIDDEN");
  const manager = can(context, "meeting.manage");
  const [projects, departments, timezone] = await Promise.all([
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
    meetingTimezone(context.companyId),
  ]);
  return {
    meetingTypes: MEETING_TYPES,
    visibilities: VISIBILITIES.filter(
      (visibility) =>
        (visibility !== "PROJECT" || projects.length > 0) &&
        (visibility !== "DEPARTMENT" || (departments.length > 0 && !visibilityProblem(context, { visibility, departmentId: departments[0]?.id }))),
    ),
    projects,
    departments,
    myDepartmentId: context.department?.id ?? null,
    templates: AGENDA_TEMPLATES.map((template) => ({ key: template.key, label: template.label, count: template.items.length })),
    timezone,
    me: { memberId: context.membershipId, fullName: context.fullName },
  };
}

/** People who can be invited or given an action: active members of this company, by name (PRD #40 §25). */
export async function searchMeetingPeople(context: UserContext, query: string | undefined, options: { includeSelf?: boolean } = {}) {
  if (!meetingsOpen(context)) throw new AccessError("FORBIDDEN");
  const term = query?.trim().slice(0, 80);
  const rows = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      ...(options.includeSelf ? {} : { id: { not: context.membershipId } }),
      user: {
        status: "ACTIVE",
        ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] } : {}),
      },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 20,
    select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  });
  return rows.map((row) => ({
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    jobTitle: row.jobTitle,
    avatarUrl: row.user.avatarUrl,
  }));
}
