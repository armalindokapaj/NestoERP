import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabPages.meetingsTitle") };
}

/**
 * A project's meetings (PRD #40 §7, §123): the meetings module, filtered to this
 * project — upcoming first, then the most recent held — through the same
 * visibility as everywhere else. Nothing is copied onto the project.
 */
export default async function ProjectMeetingsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
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
        breadcrumbs={await projectBreadcrumbs(project, "Meetings")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href={`/meetings/new?projectId=${project.id}`}>
                <Plus aria-hidden="true" />
                {t("tabPages.newMeeting")}
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
          {t("tabPages.upcoming")}
        </h2>
        {upcoming.data.length === 0 ? (
          <EmptyState
            icon={<MeetingEmptyIcon />}
            title={t("tabPages.noMeetingsTitle")}
            description={t("tabPages.noMeetingsBody")}
            action={canCreate ? { label: t("tabPages.scheduleMeeting"), href: `/meetings/new?projectId=${project.id}` } : undefined}
          />
        ) : (
          <>
            <MeetingList meetings={upcoming.data} zone={zone} today={today} showProject={false} />
            {/* The tab shows the first 50; the rest are one link away, counted — never cut silently (AUD-08 §4). */}
            {upcoming.pagination.total > upcoming.data.length ? (
              <p className="text-table text-fg-muted" data-testid="project-meetings-upcoming-count">
                {t("tabPages.showing")} <span className="tabular-nums">{upcoming.data.length}</span> {t("tabPages.of")} <span className="tabular-nums">{upcoming.pagination.total}</span>.{" "}
                <Link href={`/meetings?projectId=${project.id}`} className="font-medium text-accent-strong">
                  {t("tabPages.allUpcomingMeetings")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>

      {past.data.length > 0 ? (
        <section aria-labelledby="project-meetings-past" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="project-meetings-past" className="text-section font-semibold text-fg">
              {t("tabPages.recent")}
            </h2>
            <Link href={`/meetings/past?projectId=${project.id}`} className="text-table font-medium text-accent-strong">
              {t("tabPages.allPastMeetings")} (<span className="tabular-nums">{past.pagination.total}</span>)
            </Link>
          </div>
          <MeetingList meetings={past.data} zone={zone} today={today} showProject={false} />
        </section>
      ) : null}
    </div>
  );
}
