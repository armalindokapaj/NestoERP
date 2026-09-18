import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { MeetingEmptyIcon, MeetingList } from "@/components/meetings/meeting-list";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { meetingTimezone } from "@/lib/modules/meetings/meeting.repository";
import { meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listMeetings } from "@/lib/modules/meetings/meeting.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project meetings" };

/**
 * A project's meetings (PRD #40 §7, §123): the meetings module, filtered to this
 * project — upcoming first, then the most recent held — through the same
 * visibility as everywhere else. Nothing is copied onto the project.
 */
export default async function ProjectMeetingsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewMeetings) redirect("/access-denied");

  const [upcoming, past, zone] = await Promise.all([
    listMeetings(context, meetingListQuerySchema.parse({ section: "upcoming", projectId: project.id, limit: 50 })),
    listMeetings(context, meetingListQuerySchema.parse({ section: "past", projectId: project.id, limit: 10 })),
    meetingTimezone(context.companyId),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const canCreate = can(context, "meeting.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Meetings")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href={`/meetings/new?projectId=${project.id}`}>
                <Plus aria-hidden="true" />
                New meeting
              </Link>
            </Button>
          ) : null
        }
      />
      <ProjectTabs
        projectId={project.id}
        active="meetings"
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
          workforce: actions.canViewWorkforce,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          unitFinance: actions.canViewUnitFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      <section aria-labelledby="project-meetings-upcoming" className="space-y-3">
        <h2 id="project-meetings-upcoming" className="text-section font-semibold text-fg">
          Upcoming
        </h2>
        {upcoming.data.length === 0 ? (
          <EmptyState
            icon={<MeetingEmptyIcon />}
            title="No meetings scheduled for this project."
            description="Coordination, site and design review meetings for the project appear here."
            action={canCreate ? { label: "Schedule a meeting", href: `/meetings/new?projectId=${project.id}` } : undefined}
          />
        ) : (
          <MeetingList meetings={upcoming.data} zone={zone} today={today} showProject={false} />
        )}
      </section>

      {past.data.length > 0 ? (
        <section aria-labelledby="project-meetings-past" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="project-meetings-past" className="text-section font-semibold text-fg">
              Recent
            </h2>
            <Link href={`/meetings/past?projectId=${project.id}`} className="text-table font-medium text-accent-strong">
              All past meetings
            </Link>
          </div>
          <MeetingList meetings={past.data} zone={zone} today={today} showProject={false} />
        </section>
      ) : null}
    </div>
  );
}
