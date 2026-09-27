import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { expandRecurrence, parseRecurrence } from "../calendar.recurrence";
import type { CalendarCategory, CalendarEventDTO, CalendarProvider } from "../calendar.types";
import { canEditEvent, readableEventWhere } from "../calendar.visibility";
import { SOURCE_LIMIT, sourceRows } from "./provider.helpers";

/**
 * Calendar-owned events: company events, holidays, trainings, team and
 * personal events (PRD #39 §9, §36). Expanded occurrence by occurrence inside
 * the range; nothing future is stored (PRD #39 §78).
 */
const TYPE_LABEL: Record<string, string> = {
  COMPANY_EVENT: "Company event",
  COMPANY_HOLIDAY: "Company holiday",
  OFFICE_CLOSURE: "Office closure",
  TRAINING: "Training",
  INTERNAL_DEADLINE: "Internal deadline",
  PERSONAL_EVENT: "Personal event",
  TEAM_EVENT: "Team event",
};

export const calendarOwnedProvider: CalendarProvider = {
  key: "calendar",
  moduleKey: "calendar",
  categories: ["COMPANY", "PERSONAL", "PROJECT"],
  capabilities: { draggable: true, resizable: true, quickEdit: true },
  enabled: (context) => canAccessModule(context, "calendar") && can(context, "calendar.view"),
  async getEvents(input) {
    const { context, range, filters } = input;
    const where: Prisma.CalendarEventWhereInput = {
      AND: [
        readableEventWhere(context),
        { archivedAt: null, startsAt: { lt: range.to } },
        {
          OR: [
            { recurrenceRule: null, OR: [{ endsAt: { gt: range.from } }, { endsAt: null, startsAt: { gte: range.from } }] },
            { recurrenceRule: { not: null }, OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: range.from } }] },
          ],
        },
        filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {},
        filters.myOnly
          ? { OR: [{ createdByMemberId: context.membershipId }, { participants: { some: { memberId: context.membershipId } } }] }
          : {},
        filters.includeAllDay === false ? { allDay: false } : {},
      ],
    };

    const rows = await sourceRows(input, prisma.calendarEvent.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: SOURCE_LIMIT,
      select: {
        id: true,
        title: true,
        location: true,
        eventType: true,
        visibility: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        timezone: true,
        recurrenceRule: true,
        archivedAt: true,
        createdByMemberId: true,
        projectId: true,
        project: { select: { id: true, name: true, code: true } },
        createdBy: { select: { user: { select: { firstName: true, lastName: true } } } },
        participants: {
          take: 6,
          orderBy: [{ createdAt: "asc" }, { memberId: "asc" }],
          select: { memberId: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
    }));

    // A project the reader cannot open is never named on an event they see
    // through an invitation (PRD #39 §46).
    const projectIds = [...new Set(rows.map((row) => row.projectId).filter((id): id is string => Boolean(id)))];
    const readableProjects = new Set<string>();
    if (projectIds.length > 0 && canAccessModule(context, "projects") && can(context, "project.view")) {
      const allowed = await prisma.project.findMany({
        where: { AND: [buildProjectScopeWhere(context), { id: { in: projectIds } }] },
        select: { id: true },
      });
      for (const row of allowed) readableProjects.add(row.id);
    }

    const events: CalendarEventDTO[] = [];
    for (const row of rows) {
      const category: CalendarCategory =
        row.eventType === "PERSONAL_EVENT" || row.visibility === "PRIVATE" ? "PERSONAL" : row.visibility === "PROJECT" ? "PROJECT" : "COMPANY";
      const editable = canEditEvent(context, row);
      const recurring = Boolean(row.recurrenceRule);
      const occurrences = recurring
        ? expandRecurrence(row, parseRecurrence(row.recurrenceRule!), range, 200)
        : [{ startsAt: row.startsAt, endsAt: row.endsAt ?? row.startsAt }];
      const project = row.project && readableProjects.has(row.project.id) ? row.project : undefined;

      for (const occurrence of occurrences) {
        events.push({
          id: `calendar:${row.id}:${occurrence.startsAt.toISOString()}`,
          sourceType: "calendar_event",
          sourceId: row.id,
          providerKey: "calendar",
          title: row.title,
          subtitle: project ? project.name : TYPE_LABEL[row.eventType],
          startsAt: occurrence.startsAt.toISOString(),
          endsAt: occurrence.endsAt.toISOString(),
          allDay: row.allDay,
          category,
          status: row.eventType,
          project: project ? { id: project.id, name: project.name, code: project.code } : undefined,
          participants: row.participants.map((participant) => ({
            memberId: participant.memberId,
            name: `${participant.member.user.firstName} ${participant.member.user.lastName}`,
          })),
          location: row.location ?? undefined,
          href: `/calendar?event=${row.id}`,
          editable,
          // One occurrence of a series is not dragged: it would move them all.
          draggable: editable && !recurring && !row.allDay,
          resizable: editable && !recurring && !row.allDay,
          privacyMode: "FULL",
          metadata: {
            sourceLabel: TYPE_LABEL[row.eventType],
            ownerName: `${row.createdBy.user.firstName} ${row.createdBy.user.lastName}`,
            moduleKey: "calendar",
          },
          occurrence: { seriesId: row.id, recurring },
        });
      }
    }
    return events;
  },
};
