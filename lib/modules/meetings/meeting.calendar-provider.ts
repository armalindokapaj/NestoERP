import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { SOURCE_LIMIT, sourceRows } from "@/lib/modules/calendar/providers/provider.helpers";
import type { CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { meetingsOpen, readableMeetingWhere } from "./meeting.permissions";

/**
 * MeetingCalendarProvider (PRD #40 §9-§11, §291).
 *
 * The meeting stays the source of truth: the calendar receives a read of the
 * meetings this reader can already open — through the same visibility clause
 * as the meetings list — and cannot move one (`draggable: false`). Drafts show
 * only to their organizer, because only their organizer can read them; a
 * cancelled meeting is not on anyone's calendar.
 */
export const meetingCalendarProvider: CalendarProvider = {
  key: "meetings",
  moduleKey: "meetings",
  categories: ["MEETING"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => meetingsOpen(context),
  async getEvents(input) {
    const { context, range, filters } = input;
    const where: Prisma.MeetingWhereInput = {
      AND: [
        readableMeetingWhere(context),
        { archivedAt: null, status: { not: "CANCELLED" }, startsAt: { lt: range.to }, endsAt: { gt: range.from } },
        filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {},
        filters.myOnly ? { participants: { some: { memberId: context.membershipId } } } : {},
        filters.memberIds?.length ? { participants: { some: { memberId: { in: filters.memberIds }, response: { not: "DECLINED" } } } } : {},
      ],
    };
    const rows = await sourceRows(input, prisma.meeting.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: SOURCE_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        locationText: true,
        locationType: true,
        seriesId: true,
        project: { select: { id: true, name: true, code: true } },
        participants: {
          orderBy: { createdAt: "asc" },
          take: 6,
          select: { memberId: true, member: { select: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } } },
        },
      },
    }));

    // A project the reader cannot open is not named, even on a meeting they attend (PRD #39 §46).
    const projectIds = [...new Set(rows.map((row) => row.project?.id).filter((id): id is string => Boolean(id)))];
    const openProjects =
      projectIds.length && canAccessModule(context, "projects") && can(context, "project.view")
        ? new Set((await prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), { id: { in: projectIds } }] }, select: { id: true } })).map((row) => row.id))
        : new Set<string>();

    return rows.map((row) => {
      const project = row.project && openProjects.has(row.project.id) ? row.project : null;
      return {
        id: `meetings:${row.id}`,
        sourceType: "meeting",
        sourceId: row.id,
        providerKey: "meetings",
        title: row.title,
        subtitle: project?.name,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        allDay: false,
        category: "MEETING" as const,
        status: row.status,
        project: project ? { id: project.id, name: project.name, code: project.code } : undefined,
        participants: row.participants.map((participant) => ({
          memberId: participant.memberId,
          name: `${participant.member.user.firstName} ${participant.member.user.lastName}`,
          avatarUrl: participant.member.user.avatarUrl ?? undefined,
        })),
        location: row.locationText ?? (row.locationType === "ONLINE" ? "Online" : undefined),
        href: `/meetings/${row.id}`,
        editable: false,
        draggable: false,
        resizable: false,
        metadata: { sourceLabel: row.status === "DRAFT" ? "Draft meeting" : "Meeting", moduleKey: "meetings" },
        ...(row.seriesId ? { occurrence: { seriesId: row.seriesId, recurring: true } } : {}),
      };
    });
  },
};
