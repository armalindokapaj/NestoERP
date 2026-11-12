import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/navigation/nav-link";
import { TriangleAlert } from "@/components/icons";

import { WhatIsThis } from "@/components/help/what-is-this";
import {
  ProjectActivity,
  ProjectDetails,
  ProjectFigures,
  ProjectMediaStrip,
  ProjectMyWork,
  ProjectQuickActions,
  ProjectTitleBlock,
  ProjectUpcoming,
  ProjectVisuals,
  type ProjectFact,
  type ProjectFigure,
  type ProjectQuickAction,
} from "@/components/projects/overview/project-overview";
import { ProjectActions } from "@/components/projects/project-actions";
import { PersonLink } from "@/components/people/person-link";
import { favoriteState, RecordOpened } from "@/components/productivity/record-favorite";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionBoundary } from "@/components/modules/page-section";
import { ListSectionSkeleton } from "@/components/modules/section-skeletons";
import { formatDate, numberText } from "@/lib/i18n/format";
import { getProject3DAvailability } from "@/lib/modules/project-3d/project-3d.viewer";
import { listProjectMedia } from "@/lib/modules/project-media/project-media.service";
import { projectPlanningSummary } from "@/lib/modules/project-planning/planning.reports";
import * as projects from "@/lib/modules/projects/project.service";
import { statusMovesFrom } from "@/lib/modules/projects/project.machine";
import { projectMobileSummary, projectMyWork, projectUpcoming, type ProjectUpcomingItem, type ProjectWorkItem } from "@/lib/modules/projects/project-workspace.service";
import type { ProjectActivityDTO } from "@/lib/modules/projects/project.types";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { orDash } from "@/lib/utils/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { projectTypeName } from "@/lib/i18n/stock-names";
import { localizeActivity } from "@/lib/i18n/system";
import { loadProject } from "./project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  try {
    const { project } = await loadProject(projectId);
    return { title: project.name };
  } catch {
    return { title: (await getTranslations("projects"))("meta.project") };
  }
}

function projectProgress(planning: Awaited<ReturnType<typeof projectPlanningSummary>>): number | null {
  if (!planning) return null;
  if (planning.phases.length) return Math.round(planning.phases.reduce((sum, phase) => sum + (phase.progress ?? 0), 0) / planning.phases.length);
  return planning.metrics.total ? Math.round((planning.metrics.completed / planning.metrics.total) * 100) : null;
}

/**
 * The canonical, role-aware Project home (NAV-03 STREAM-02, STREAM-06), drawn
 * in the drawing set (docs/ui/UI-07-unified-design.md §6,
 * components/projects/overview/project-overview.tsx).
 *
 * `loadProject` is the prerequisite: identity, the project's menu and the
 * details render from it at once. Everything optional — the picture, 3D and
 * media, planning progress, the figures, my work, upcoming dates and activity —
 * is read beside it and arrives in its own place, and a section that fails
 * says so rather than claiming there is nothing to show.
 */
export default async function ProjectOverviewPage({ params }: Params) {
  const locale = await getLocale();
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  const archived = project.archivedAt !== null || project.status === "ARCHIVED";

  // Started together, awaited in their sections.
  const threeD = getProject3DAvailability(context, project.id).then((result) => (result.available ? result : null));
  const media = listProjectMedia(context, project.id);
  const planning = actions.canViewPlanning ? projectPlanningSummary(context, project.id) : Promise.resolve(null);
  const myWork = projectMyWork(context, project.id);
  const upcoming = projectUpcoming(context, project);
  const activity = actions.canViewActivity ? projects.listActivity(context, project.id, { page: 1, limit: 5 }) : null;
  const [lastChange, favorite] = await Promise.all([actions.canViewActivity ? projects.lastProjectChange(context, project.id) : null, favoriteState(context, "project", project.id).catch(() => null)]);
  /*
   * The deal this project came from (PRD #17 §267, §385) — only for somebody who
   * may see Sales records, resolved through the Sales scope, so a project manager
   * without Sales access never sees the commercial value behind their job (§365, §416).
   */
  const sourceOpportunity = can(context, "sales.opportunity.view")
    ? prisma.opportunity.findFirst({
        where: {
          AND: [buildOpportunityScopeWhere(context), { convertedProjectId: project.id }],
        },
        select: { id: true, name: true },
      })
    : null;
  const progress = planning.then(projectProgress, () => null);
  const summary = projectMobileSummary(context, project.id, {
    canViewTasks: actions.canViewTasks,
    canViewUnits: actions.canViewUnits,
  });
  for (const promise of [threeD, media, planning, myWork, upcoming, activity, sourceOpportunity, summary]) promise?.catch(() => undefined);
  // A new record is offered on a live project only, and only to someone who may create it (MOB-05 §30, §31).
  const quickActions: ProjectQuickAction[] = archived
    ? []
    : [
        ...(actions.canViewTasks && can(context, "task.create")
          ? [
              {
                key: "task" as const,
                href: `/tasks/new?projectId=${project.id}`,
              },
            ]
          : []),
        ...(actions.canViewDocuments && can(context, "document.create")
          ? [
              {
                key: "document" as const,
                href: `/documents/new?projectId=${project.id}`,
              },
            ]
          : []),
        ...(actions.canViewDailyLogs && can(context, "daily_log.create")
          ? [
              {
                key: "siteDiary" as const,
                href: `/projects/${project.id}/daily-logs/new`,
              },
            ]
          : []),
        ...(actions.canViewMeetings && can(context, "meeting.create")
          ? [
              {
                key: "meeting" as const,
                href: `/meetings/new?projectId=${project.id}`,
              },
            ]
          : []),
      ];

  const place = [project.location.city, project.location.country].filter(Boolean).join(", ");
  const typeName = project.projectType ? projectTypeName(project.projectType.name, locale) : null;
  const area = project.builtArea === null ? null : `${numberText(project.builtArea, undefined, locale, "en-US")} m²`;
  const facts: ProjectFact[] = [
    {
      key: "manager",
      label: t("overview.projectManager"),
      value: project.projectManager ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          <PersonLink memberId={project.projectManager.memberId} name={project.projectManager.fullName} />
          {!project.projectManager.membershipActive ? <Badge tone="warning">{t("overview.inactive")}</Badge> : null}
        </span>
      ) : (
        t("overview.unassigned")
      ),
    },
    {
      key: "completion",
      label: t("overview.expectedCompletion"),
      value: project.schedule.endDate ? formatDate(project.schedule.endDate, locale) : t("overview.notSet"),
    },
    { key: "location", label: t("overview.location"), value: orDash(place) },
    {
      key: "type",
      label: t("overview.projectType"),
      value: typeName ?? t("overview.notSet"),
    },
    {
      key: "area",
      label: t("overview.totalArea"),
      value: area ?? t("overview.notSet"),
    },
    ...(lastChange
      ? [
          {
            key: "edited",
            label: t("overview.lastEditedBy"),
            value: (
              <span data-testid="project-last-edited">
                <PersonLink memberId={lastChange.actorMemberId} name={lastChange.actor} /> · {formatDate(lastChange.at, locale)}
              </span>
            ),
          },
        ]
      : []),
  ];
  const menu = (
    <ProjectActions
      at="lg"
      projectId={project.id}
      projectName={project.name}
      companyName={project.company.name}
      statusMoves={actions.canManageStatus && !archived ? statusMovesFrom(project.status) : []}
      archived={archived}
      canUpdate={actions.canUpdate}
      canArchive={actions.canArchive}
      canRestore={actions.canRestore}
      canManageMedia={actions.canManageMedia}
      canManageTeam={actions.canManageMembers}
      favorite={favorite === null ? undefined : { initial: favorite }}
      offline
    />
  );
  const visuals = (className?: string) => (
    <Suspense fallback={null}>
      <Visuals project={project} threeD={threeD} media={media} className={className} />
    </Suspense>
  );

  return (
    <div className="space-y-6 max-lg:space-y-4" data-testid="project-mobile-overview">
      {/* The star, "Available offline", the project's actions and "What is this?" are in the project's ⋯: after the status in the title block from lg, in the compact header below it (project-tabs.tsx). */}
      <RecordOpened context={context} entityType="project" entityId={project.id} />

      {/* How a project's records hang together (AUD-05 §7, UX-13): an item of the project's ⋯, drawn here only if nothing held it. */}
      <WhatIsThis id="projects.detail.relationships" title={t("overview.relationshipsTitle")}>
        <p>{t("overview.relationshipsBody1", { company: project.company.name })}</p>
        <p>{t("overview.relationshipsBody2")}</p>
      </WhatIsThis>

      {archived ? (
        <p className="flex items-center gap-2 border border-line-strong bg-surface-muted px-4 py-3 text-table text-fg-muted">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {t("overview.archivedNotice")}
        </p>
      ) : null}

      <ProjectTitleBlock
        name={project.name}
        description={project.description}
        code={project.code}
        company={project.company.name}
        status={t(`status.${project.status}`)}
        menu={menu}
        facts={[place, typeName, area].filter((fact): fact is string => Boolean(fact))}
        figures={
          <SectionBoundary>
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              <Figures projectId={project.id} progress={progress} summary={summary} className="border-b-0" />
            </Suspense>
          </SectionBoundary>
        }
        aside={visuals("lg:flex lg:h-full lg:flex-col lg:border-b-0")}
      />

      {/* Below lg the top bar and the compact header name the project: its figures, then what a person makes on site, flush under them. */}
      <div className="lg:hidden">
        <SectionBoundary>
          <Suspense fallback={<Skeleton className="h-20 w-full" />}>
            <Figures projectId={project.id} progress={progress} summary={summary} />
          </Suspense>
        </SectionBoundary>
        <ProjectQuickActions actions={quickActions} />
      </div>

      {/*
       * The sections as two columns that balance themselves: each section keeps
       * whole, and the next fills the shorter column, so neither runs on with
       * nothing beside it. Numbered in reading order.
       */}
      <div className="lg:columns-2 lg:gap-x-8 [&>*]:mb-4 [&>*]:break-inside-avoid lg:[&>*]:mb-6">
        <SectionBoundary>
          <Suspense fallback={<ListSectionSkeleton title={t("overview.myWork")} rows={3} />}>
            <MyWork myWork={myWork} />
          </Suspense>
        </SectionBoundary>
        {/* Below lg the picture and its 3D come after what needs you, before the dates. */}
        <div className="lg:hidden">{visuals()}</div>
        <SectionBoundary>
          <Suspense fallback={<ListSectionSkeleton title={t("overview.upcoming")} rows={3} />}>
            <Upcoming upcoming={upcoming} />
          </Suspense>
        </SectionBoundary>
        <SectionBoundary>
          <Suspense fallback={<ListSectionSkeleton title={t("overview.recentActivity")} rows={3} />}>
            <Activity projectId={project.id} activity={activity} />
          </Suspense>
        </SectionBoundary>
        <div>
          <Suspense fallback={<ProjectDetails number="04" facts={facts} description={project.description} />}>
            <Details facts={facts} description={project.description} opportunity={sourceOpportunity} />
          </Suspense>
        </div>
        <SectionBoundary>
          <Suspense fallback={null}>
            <MediaLibrary projectId={project.id} media={media} />
          </Suspense>
        </SectionBoundary>
      </div>
    </div>
  );
}

type Project = Awaited<ReturnType<typeof loadProject>>["project"];
type Media = ReturnType<typeof listProjectMedia>;
type Summary = ReturnType<typeof projectMobileSummary>;


/** Progress, open and overdue tasks and units: each a figure that opens its list; a figure the person may not see is left out. */
async function Figures({ projectId, progress, summary, className }: { projectId: string; progress: Promise<number | null>; summary: Summary; className?: string }) {
  const [t, locale] = await Promise.all([getTranslations("projects"), getLocale()]);
  const [value, counts] = await Promise.all([progress, summary.catch(() => ({ openTasks: null, overdueTasks: null, units: null }))]);
  const figures: ProjectFigure[] = [];
  if (value !== null)
    figures.push({
      key: "progress",
      label: t("mobile.progress"),
      value: `${value}%`,
      href: `/projects/${projectId}/planning`,
      meter: value,
    });
  if (counts.openTasks !== null)
    figures.push({
      key: "openTasks",
      label: t("mobile.openTasks"),
      value: numberText(counts.openTasks, undefined, locale, "en-US"),
      href: `/projects/${projectId}/tasks`,
    });
  if (counts.overdueTasks !== null)
    figures.push({
      key: "overdue",
      label: t("overview.overdue"),
      value: numberText(counts.overdueTasks, undefined, locale, "en-US"),
      href: `/projects/${projectId}/tasks?due=overdue`,
      tone: counts.overdueTasks > 0 ? "danger" : "plain",
    });
  if (counts.units !== null)
    figures.push({
      key: "units",
      label: t("mobile.units"),
      value: numberText(counts.units, undefined, locale, "en-US"),
      href: `/projects/${projectId}/units`,
    });
  return <ProjectFigures figures={figures} label={t("mobile.metricsTitle")} className={className} />;
}

async function MyWork({ myWork }: { myWork: Promise<ProjectWorkItem[]> }) {
  return <ProjectMyWork number="01" items={await myWork} />;
}

async function Upcoming({ upcoming }: { upcoming: Promise<ProjectUpcomingItem[]> }) {
  return <ProjectUpcoming number="02" items={await upcoming} />;
}

async function Activity({ projectId, activity }: { projectId: string; activity: Promise<{ data: ProjectActivityDTO[] }> | null }) {
  const locale = await getLocale();
  const entries = activity
    ? (await activity).data.map((entry) => ({
        id: entry.id,
        actor: entry.actor ?? "NESTO",
        text: localizeActivity(locale, entry) ?? "",
        at: String(entry.createdAt),
      }))
    : null;
  return <ProjectActivity number="03" entries={entries} href={`/projects/${projectId}/activity`} />;
}

/** The details, with the deal the project came from once it is read. */
async function Details({ facts, description, opportunity }: { facts: ProjectFact[]; description: string | null; opportunity: Promise<{ id: string; name: string } | null> | null }) {
  const [t, value] = await Promise.all([getTranslations("projects"), opportunity?.catch(() => null) ?? null]);
  const all = value
    ? [
        ...facts,
        {
          key: "opportunity",
          label: t("overview.fromOpportunity"),
          value: (
            <Link href={`/sales/opportunities/${value.id}`} className="text-fg transition-colors hover:text-accent-strong">
              {value.name}
            </Link>
          ),
        },
      ]
    : facts;
  return <ProjectDetails number="04" facts={all} description={description} />;
}

/** The picture and the ways into 3D, renders and animations; nothing when there is none of them. */
async function Visuals({ project, threeD, media, className }: { project: Project; threeD: Promise<Awaited<ReturnType<typeof getProject3DAvailability>> | null>; media: Media; className?: string }) {
  const [viewer, library] = await Promise.all([threeD.catch(() => null), media.catch(() => null)]);
  const coverUrl = library?.cover?.thumbnailUrl ?? (library?.capabilities.canView && project.coverImageDocumentId ? `/api/projects/${project.id}/cover` : null);
  return (
    <ProjectVisuals
      projectId={project.id}
      name={project.name}
      className={className}
      visuals={{
        coverUrl,
        threeDUrl: viewer?.viewerUrl ?? null,
        renders: library?.counts.renders ?? 0,
        animations: library?.counts.animations ?? 0,
      }}
    />
  );
}

async function MediaLibrary({ projectId, media }: { projectId: string; media: Media }) {
  const library = await media;
  return <ProjectMediaStrip number="05" projectId={projectId} renders={library.renders} renderCount={library.renders.length} animations={library.animations} />;
}
