import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { ProjectSchedule } from "@/components/calendar/project-schedule";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { addLocalDays, instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import { todayIn } from "@/components/calendar/calendar-model";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { calendarSettings } from "@/lib/modules/calendar/calendar.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project calendar" };

/**
 * A project's schedule (PRD #39 §103, §159): the calendar service with a project
 * filter — tasks, inspections, permits, deliveries, contract dates and project
 * events — each still read through the reader's own module access. No project
 * schedule is stored anywhere.
 */
export default async function ProjectCalendarPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewCalendar) redirect("/access-denied");

  const settings = await calendarSettings(context.companyId);
  const today = todayIn(settings.timezone);
  const from = instantFromLocal(addLocalDays(today, -7), "00:00", settings.timezone);
  const to = instantFromLocal(addLocalDays(today, 56), "00:00", settings.timezone);
  const calendar = await getCalendar(context, { from, to }, { projectIds: [project.id] });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Calendar")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/calendar?view=month">
              <CalendarDays aria-hidden="true" />
              Open calendar
            </Link>
          </Button>
        }
      />
      <ProjectTabs
        projectId={project.id}
        active="calendar"
        show={{
          planning: actions.canViewPlanning,
          units: actions.canViewUnits,
          sales: actions.canViewUnitSales,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />
      <ProjectSchedule calendar={calendar} startDate={addLocalDays(today, -7)} />
    </div>
  );
}
