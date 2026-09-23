import { prisma } from "@/lib/database/prisma";
import type { CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { overlaps } from "@/lib/modules/calendar/calendar.time";
import { projectRef, SOURCE_LIMIT, wants } from "@/lib/modules/calendar/providers/provider.helpers";
import { announcementsOpen, reachWhere } from "./announcement.permissions";

/**
 * Announcement events on the calendar (PRD #45 §40-§43, §129, §284).
 *
 * Only an announcement with a real event date appears — publishing one is not
 * an event — and only for somebody in its audience, decided in the query.
 */
export const announcementCalendarProvider: CalendarProvider = {
  key: "announcements",
  moduleKey: "announcements",
  categories: ["COMPANY"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => announcementsOpen(context),
  async getEvents(input) {
    const { context, range, filters } = input;
    if (!wants(input, "COMPANY") || filters.myOnly || filters.memberIds?.length) return [];
    const rows = await prisma.announcement.findMany({
      where: {
        status: { in: ["PUBLISHED", "EXPIRED"] },
        eventStartsAt: { not: null, lt: range.to },
        OR: [{ eventEndsAt: { gte: range.from } }, { eventEndsAt: null, eventStartsAt: { gte: new Date(range.from.getTime() - 86_400_000) } }],
        AND: [reachWhere(context), filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {}],
      },
      orderBy: { eventStartsAt: "asc" },
      take: SOURCE_LIMIT,
      select: { id: true, title: true, priority: true, eventStartsAt: true, eventEndsAt: true, project: { select: { id: true, name: true, code: true } } },
    });
    return rows
      .map((row) => {
        const startsAt = row.eventStartsAt!;
        const endsAt = row.eventEndsAt ?? new Date(startsAt.getTime() + 60 * 60_000);
        if (!overlaps(startsAt, endsAt, range)) return null;
        return {
          id: `announcements:${row.id}`,
          sourceType: "announcement",
          sourceId: row.id,
          providerKey: "announcements",
          title: row.title,
          subtitle: "Announcement",
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          allDay: false,
          category: "COMPANY" as const,
          priority: row.priority === "CRITICAL" ? ("CRITICAL" as const) : row.priority === "IMPORTANT" ? ("HIGH" as const) : ("NORMAL" as const),
          project: projectRef(row.project),
          href: `/announcements/${row.id}`,
          editable: false,
          draggable: false,
          resizable: false,
          metadata: { sourceLabel: "Announcement", moduleKey: "announcements" },
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);
  },
};
