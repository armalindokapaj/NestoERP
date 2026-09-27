import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import type { CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { compact, dateWindow, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, sourceRows, todayIn, wants } from "@/lib/modules/calendar/providers/provider.helpers";
import { dateOf, displayDateOf, isDelayed } from "./planning.dates";
import { planningOpen, readableMilestoneWhere } from "./planning.permissions";

/**
 * Milestones on the calendar (PRD #44 §65-§69, §211-§214, §281, §288).
 *
 * One all-day event per milestone on the date that matters: the actual date
 * once achieved, else the forecast, planned or baseline date. Read through the
 * planning door and each project's scope, so a milestone on a project somebody
 * cannot open never reaches their calendar. Not draggable: dates change in the
 * planning drawer, never by accident on a grid. The event opens the plan with
 * the milestone's drawer.
 */
export const milestoneCalendarProvider: CalendarProvider = {
  key: "milestones",
  moduleKey: "projects",
  categories: ["MILESTONE"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => planningOpen(context),
  async getEvents(input) {
    const { context, filters } = input;
    if (!wants(input, "MILESTONE")) return [];
    const window = dateWindow(input);
    const onDate: Prisma.ProjectMilestoneWhereInput[] = [
      { actualDate: window },
      { actualDate: null, forecastDate: window },
      { actualDate: null, forecastDate: null, plannedDate: window },
      { actualDate: null, forecastDate: null, plannedDate: null, baselineDate: window },
    ];
    const rows = await sourceRows(input, prisma.projectMilestone.findMany({
      where: {
        AND: [
          readableMilestoneWhere(context),
          { archivedAt: null, OR: onDate },
          projectFilter(input),
          filters.myOnly ? { ownerMemberId: context.membershipId } : {},
          filters.memberIds?.length ? { ownerMemberId: { in: filters.memberIds } } : {},
        ],
      },
      take: SOURCE_LIMIT,
      orderBy: [{ forecastDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        critical: true,
        baselineDate: true,
        plannedDate: true,
        forecastDate: true,
        actualDate: true,
        projectId: true,
        project: PROJECT_SELECT,
        ownerMemberId: true,
      },
    }));
    const ownerIds = [...new Set(rows.map((row) => row.ownerMemberId).filter((id): id is string => Boolean(id)))];
    const owners = ownerIds.length ? await prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: ownerIds } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [];
    const ownerName = new Map(owners.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
    const today = todayIn(input.timezone);

    return compact(
      rows.map((row) => {
        const dates = { status: row.status, baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate), actualDate: dateOf(row.actualDate) };
        const date = displayDateOf(dates);
        if (!date) return null;
        const delayed = isDelayed(dates, today);
        const owner = row.ownerMemberId ? ownerName.get(row.ownerMemberId) : undefined;
        return onBusinessDate(input, new Date(`${date}T12:00:00.000Z`), {
          id: `milestones:${row.id}`,
          sourceType: "project_milestone",
          sourceId: row.id,
          providerKey: "milestones",
          title: row.name,
          subtitle: row.project.name,
          category: "MILESTONE",
          status: delayed ? "DELAYED" : row.status,
          priority: row.critical ? "HIGH" : "NORMAL",
          severity: delayed ? "warning" : undefined,
          project: projectRef(row.project),
          participants: row.ownerMemberId && owner ? [{ memberId: row.ownerMemberId, name: owner }] : undefined,
          href: `/projects/${row.projectId}/planning?milestone=${row.id}`,
          metadata: { sourceLabel: row.critical ? "Critical milestone" : "Milestone", moduleKey: "projects", ownerName: owner },
        });
      }),
    );
  },
};
