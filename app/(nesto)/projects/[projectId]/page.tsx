/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "@/components/navigation/nav-link";
import { Box, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, FileWarning, Film, Image as ImageIcon, MapPin, Play, TriangleAlert } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { ProjectActions } from "@/components/projects/project-actions";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionBoundary } from "@/components/modules/page-section";
import { ListSectionSkeleton } from "@/components/modules/section-skeletons";
import { WhatIsThis } from "@/components/help/what-is-this";
import { getProject3DAvailability } from "@/lib/modules/project-3d/project-3d.viewer";
import { listProjectMedia } from "@/lib/modules/project-media/project-media.service";
import { projectPlanningSummary } from "@/lib/modules/project-planning/planning.reports";
import { statusMovesFrom } from "@/lib/modules/projects/project.machine";
import * as projects from "@/lib/modules/projects/project.service";
import { projectMyWork, projectUpcoming, type ProjectUpcomingItem, type ProjectWorkItem } from "@/lib/modules/projects/project-workspace.service";
import type { ProjectActivityDTO } from "@/lib/modules/projects/project.types";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import { formatDate, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { loadProject, } from "./project-context";

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

const workIcons = { tasks: CheckCircle2, approvals: ClipboardCheck, meetings: CalendarDays, documents: FileWarning };

function projectProgress(planning: Awaited<ReturnType<typeof projectPlanningSummary>>): number | null {
  if (!planning) return null;
  if (planning.phases.length) return Math.round(planning.phases.reduce((sum, phase) => sum + (phase.progress ?? 0), 0) / planning.phases.length);
  return planning.metrics.total ? Math.round((planning.metrics.completed / planning.metrics.total) * 100) : null;
}

function ExperienceTile({ href, title, detail, icon, large = false, newTab = false }: { href: string; title: string; detail?: string; icon: ReactNode; large?: boolean; newTab?: boolean }) {
  return (
    <Link href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined} className={`group relative flex min-h-36 overflow-hidden bg-neutral-900 p-6 text-white outline-none transition hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${large ? "sm:col-span-2 lg:min-h-56" : ""}`}>
      <div className="absolute -right-10 -top-12 size-40 rounded-full bg-white/[0.06] transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
      <div className="relative mt-auto"><span className="mb-4 grid size-10 place-items-center rounded-full border border-white/15 bg-white/10">{icon}</span><span className="block text-lg font-semibold">{title}</span>{detail ? <span className="mt-1 block text-sm text-white/55">{detail}</span> : null}</div>
    </Link>
  );
}

/**
 * The canonical, role-aware Project home described by the workspace PRD
 * (NAV-03 STREAM-02, STREAM-06).
 *
 * `loadProject` is the prerequisite: identity, breadcrumbs, actions, tabs and
 * the summary render from it at once. Everything optional — the cover, 3D and
 * media, planning progress, my work, upcoming dates, activity and the Sales
 * source — is read beside it and arrives in its own place. The hero keeps its
 * height whatever arrives, media sits below the work cards so nothing above
 * moves, and a section that fails says so rather than claiming there is
 * nothing to show.
 */
export default async function ProjectOverviewPage({ params }: Params) {
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
  const lastChange = actions.canViewActivity ? await projects.lastProjectChange(context, project.id) : null;
  /*
   * The deal this project came from (PRD #17 §267, §385) — only for somebody who
   * may see Sales records, resolved through the Sales scope, so a project manager
   * without Sales access never sees the commercial value behind their job (§365, §416).
   */
  const sourceOpportunity = can(context, "sales.opportunity.view")
    ? prisma.opportunity.findFirst({ where: { AND: [buildOpportunityScopeWhere(context), { convertedProjectId: project.id }] }, select: { id: true, name: true } })
    : null;
  for (const promise of [threeD, media, planning, myWork, upcoming, activity, sourceOpportunity]) promise?.catch(() => undefined);
  const progress = planning.then(projectProgress, () => null);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1" />
        <div className="flex items-center gap-2"><RecordFavorite context={context} entityType="project" entityId={project.id} /><ProjectActions projectId={project.id} projectName={project.name} companyName={project.company.name} statusMoves={actions.canManageStatus && !archived ? statusMovesFrom(project.status) : []} archived={archived} canUpdate={actions.canUpdate} canArchive={actions.canArchive} canRestore={actions.canRestore} canManageMedia={actions.canManageMedia} canManageTeam={actions.canManageMembers} /></div>
      </div>


      {archived ? <p className="flex items-center gap-2 rounded-xl border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted"><TriangleAlert className="size-4" aria-hidden="true" />{t("overview.archivedNotice")}</p> : null}

      {/* How a project's records hang together is the relationship question of first use (AUD-05 §7, UX-13, UX-15). */}
      <WhatIsThis id="projects.detail.relationships" title={t("overview.relationshipsTitle")}>
        <p>{t("overview.relationshipsBody1", { company: project.company.name })}</p>
        <p>{t("overview.relationshipsBody2")}</p>
      </WhatIsThis>

      <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm lg:flex" aria-labelledby="project-title" data-section="primary">
        <div className="relative min-h-[430px] flex-1 overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-neutral-950 lg:min-h-[500px]">
          <Suspense fallback={null}>
            <HeroCover project={project} media={media} />
          </Suspense>
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/10" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/65"><span>{project.code}</span><span aria-hidden="true">·</span><span>{t(`status.${project.status}`)}</span></div>
            <h1 id="project-title" className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">{project.name}</h1>
            <p className="mt-2 text-sm font-medium text-white/70">{project.company.name}</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70"><span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" />{orDash([project.location.city, project.location.country].filter(Boolean).join(", "))}</span>{project.projectType ? <span>{project.projectType.name}</span> : null}<Suspense fallback={null}><ProgressText progress={progress} /></Suspense></div>
            <div className="mt-4 h-1.5 max-w-md">
              <Suspense fallback={null}>
                <ProgressBar progress={progress} />
              </Suspense>
            </div>
          </div>
        </div>
        <Suspense fallback={<div aria-hidden="true" className="hidden bg-neutral-900/95 lg:block lg:w-1/2" />}>
          <Experiences projectId={project.id} threeD={threeD} media={media} />
        </Suspense>
      </section>

      <section className="nesto-card p-5 sm:p-6" aria-labelledby="summary-title">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
          <div><p className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">{t("overview.project")}</p><h2 id="summary-title" className="mt-1 text-section font-semibold text-fg">{t("overview.summary")}</h2>{project.description ? <p className="mt-3 line-clamp-5 max-w-2xl text-body leading-6 text-fg-muted">{project.description}</p> : <p className="mt-3 text-body text-fg-subtle">{t("overview.noDescription")}</p>}</div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
            <Summary label={t("overview.projectManager")} value={project.projectManager ? <span className="flex flex-wrap items-center gap-2"><PersonLink memberId={project.projectManager.memberId} name={project.projectManager.fullName} />{!project.projectManager.membershipActive ? <Badge tone="warning">{t("overview.inactive")}</Badge> : null}</span> : t("overview.unassigned")} />
            <Summary label={t("overview.expectedCompletion")} value={project.schedule.endDate ? formatDate(project.schedule.endDate) : t("overview.notSet")} />
            <Summary label={t("overview.location")} value={orDash([project.location.city, project.location.country].filter(Boolean).join(", "))} />
            <Summary label={t("overview.projectType")} value={project.projectType?.name ?? t("overview.notSet")} />
            <Summary label={t("overview.totalArea")} value={project.builtArea === null ? t("overview.notSet") : `${project.builtArea.toLocaleString("en-US")} m²`} />
            <Summary label={t("overview.progress")} value={<Suspense fallback={<Skeleton className="h-4 w-12" />}><ProgressValue progress={progress} /></Suspense>} />
            {lastChange ? <Summary label={t("overview.lastEditedBy")} value={<span data-testid="project-last-edited"><PersonLink memberId={lastChange.actorMemberId} name={lastChange.actor} /> · {formatDate(lastChange.at)}</span>} /> : null}
            {sourceOpportunity ? (
              <Suspense fallback={null}>
                <SourceOpportunity opportunity={sourceOpportunity} />
              </Suspense>
            ) : null}
          </dl>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionBoundary className="nesto-card">
          <Suspense fallback={<ListSectionSkeleton title={t("overview.myWork")} rows={4} />}>
            <MyWork myWork={myWork} />
          </Suspense>
        </SectionBoundary>
        <SectionBoundary className="nesto-card">
          <Suspense fallback={<ListSectionSkeleton title={t("overview.upcoming")} rows={4} />}>
            <Upcoming upcoming={upcoming} />
          </Suspense>
        </SectionBoundary>
        {activity ? (
          <SectionBoundary className="nesto-card">
            <Suspense fallback={<ListSectionSkeleton title={t("overview.recentActivity")} rows={4} />}>
              <RecentActivity projectId={project.id} activity={activity} />
            </Suspense>
          </SectionBoundary>
        ) : (
          <section className="nesto-card p-5"><h2 className="text-card font-semibold text-fg">{t("overview.recentActivity")}</h2><p className="mt-4 text-table text-fg-subtle">{t("overview.noActivity")}</p></section>
        )}
      </div>

      <SectionBoundary>
        <Suspense fallback={null}>
          <MediaLibrary projectId={project.id} media={media} />
        </Suspense>
      </SectionBoundary>
    </div>
  );
}


type Project = Awaited<ReturnType<typeof loadProject>>["project"];
type Media = ReturnType<typeof listProjectMedia>;

async function HeroCover({ project, media }: { project: Project; media: Media }) {
  const value = await media.catch(() => null);
  const t = await getTranslations("projects");
  const coverUrl = value?.cover?.thumbnailUrl ?? (value?.capabilities.canView && project.coverImageDocumentId ? `/api/projects/${project.id}/cover` : null);
  return coverUrl ? <img src={coverUrl} alt={t("overview.coverAlt", { name: project.name })} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" sizes="(min-width: 1024px) 50vw, 100vw" /> : null;
}

async function ProgressText({ progress }: { progress: Promise<number | null> }) {
  const value = await progress;
  const t = await getTranslations("projects");
  return value !== null ? <span>{t("overview.percentComplete", { value })}</span> : null;
}

async function ProgressBar({ progress }: { progress: Promise<number | null> }) {
  const value = await progress;
  const t = await getTranslations("projects");
  return value !== null ? <div className="h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label={t("overview.progressLabel")} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-white" style={{ width: `${value}%` }} /></div> : null;
}

async function ProgressValue({ progress }: { progress: Promise<number | null> }) {
  const value = await progress;
  const t = await getTranslations("projects");
  return <>{value === null ? t("overview.notSet") : `${value}%`}</>;
}

async function SourceOpportunity({ opportunity }: { opportunity: Promise<{ id: string; name: string } | null> }) {
  const value = await opportunity.catch(() => null);
  const t = await getTranslations("projects");
  return value ? <Summary label={t("overview.fromOpportunity")} value={<Link href={`/sales/opportunities/${value.id}`} className="text-fg transition-colors hover:text-accent">{value.name}</Link>} /> : null;
}

/** 3D and media in the hero's reserved column; the column closes when there is nothing to offer. */
async function Experiences({ projectId, threeD, media }: { projectId: string; threeD: Promise<Awaited<ReturnType<typeof getProject3DAvailability>> | null>; media: Media }) {
  const [viewer, library] = await Promise.all([threeD.catch(() => null), media.catch(() => null)]);
  const renders = library?.counts.renders ?? 0;
  const animations = library?.counts.animations ?? 0;
  if (!viewer && !renders && !animations) return null;
  const t = await getTranslations("projects");
  return (
    <div className="grid sm:grid-cols-2 lg:w-1/2">
      {viewer?.viewerUrl ? <ExperienceTile href={viewer.viewerUrl} title={t("overview.viewIn3d")} detail={t("overview.publishedExplorer")} icon={<Box className="size-5" />} large newTab /> : null}
      {renders ? <ExperienceTile href={`/projects/${projectId}/media?type=renders`} title={t("overview.viewRenders")} detail={t("overview.renders", { count: renders })} icon={<ImageIcon className="size-5" />} large={!viewer && !animations} /> : null}
      {animations ? <ExperienceTile href={`/projects/${projectId}/media?type=animations`} title={t("overview.viewAnimations")} detail={t("overview.animations", { count: animations })} icon={<Film className="size-5" />} large={!viewer && !renders} /> : null}
    </div>
  );
}

async function MyWork({ myWork }: { myWork: Promise<ProjectWorkItem[]> }) {
  const items = await myWork;
  const t = await getTranslations("projects");
  return <section className="nesto-card p-5" aria-labelledby="my-work-title"><h2 id="my-work-title" className="text-card font-semibold text-fg">{t("overview.myWork")}</h2>{items.length ? <ul className="mt-4 space-y-2">{items.map((item) => { const Icon = workIcons[item.key]; return <li key={item.key}><Link href={item.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-hover"><span className="grid size-9 place-items-center rounded-lg bg-surface-muted text-fg-muted"><Icon className="size-4" /></span><span className="min-w-0 flex-1 text-table text-fg">{t(`overview.workKind.${item.key}`)}</span><span className="text-card font-semibold tabular-nums text-fg" title={item.partial ? t("overview.approvalsPartial") : undefined}>{item.partial ? (item.count ? `${item.count}+` : "—") : item.count}</span></Link></li>; })}</ul> : <p className="mt-4 text-table text-fg-subtle">{t("overview.nothingNeedsYou")}</p>}</section>;
}

async function Upcoming({ upcoming }: { upcoming: Promise<ProjectUpcomingItem[]> }) {
  const items = await upcoming;
  const t = await getTranslations("projects");
  return <section className="nesto-card p-5" aria-labelledby="upcoming-title"><h2 id="upcoming-title" className="text-card font-semibold text-fg">{t("overview.upcoming")}</h2>{items.length ? <ul className="mt-4 divide-y divide-line">{items.map((item) => <li key={item.id}><Link href={item.href} className="flex gap-3 py-3 first:pt-0 hover:text-accent-strong"><Clock3 className="mt-0.5 size-4 shrink-0 text-fg-subtle" /><span className="min-w-0"><span className="block truncate text-table font-medium text-fg">{item.title}</span><span className="mt-0.5 block text-meta text-fg-subtle">{t(`overview.upcomingKind.${item.kind}`)} · {formatDate(item.at)}</span></span></Link></li>)}</ul> : <p className="mt-4 text-table text-fg-subtle">{t("overview.noUpcoming")}</p>}</section>;
}

async function RecentActivity({ projectId, activity }: { projectId: string; activity: Promise<{ data: ProjectActivityDTO[] }> }) {
  const entries = (await activity).data;
  const t = await getTranslations("projects");
  return <section className="nesto-card p-5" aria-labelledby="activity-title"><div className="flex items-center justify-between gap-3"><h2 id="activity-title" className="text-card font-semibold text-fg">{t("overview.recentActivity")}</h2>{entries.length ? <Link href={`/projects/${projectId}/activity`} className="text-meta font-medium text-accent-strong">{t("overview.viewAll")}</Link> : null}</div>{entries.length ? <ul className="mt-4 space-y-4">{entries.map((entry) => <li key={entry.id} className="flex gap-3"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" /><p className="min-w-0 text-table text-fg"><span className="font-medium">{entry.actor ?? "NESTO"}</span> {entry.message}<span className="mt-0.5 block text-meta text-fg-subtle">{formatDate(entry.createdAt)}</span></p></li>)}</ul> : <p className="mt-4 text-table text-fg-subtle">{t("overview.noActivity")}</p>}</section>;
}

async function MediaLibrary({ projectId, media }: { projectId: string; media: Media }) {
  const library = await media;
  if (!library.renders.length && !library.animations.length) return null;
  const t = await getTranslations("projects");
  return (
    <section className="space-y-4" aria-labelledby="media-title">
      <div className="flex items-end justify-between gap-3"><div><p className="text-meta font-semibold uppercase tracking-[0.14em] text-fg-subtle">{t("overview.visualLibrary")}</p><h2 id="media-title" className="mt-1 text-section font-semibold text-fg">{t("overview.projectMedia")}</h2></div><Link href={`/projects/${projectId}/media`} className="text-table font-medium text-accent-strong hover:underline">{t("overview.viewAllMedia")}</Link></div>
      {library.renders.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{library.renders.slice(0, 4).map((item, index) => <Link key={item.id} href={`/projects/${projectId}/media?type=renders`} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-accent">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}{index === 3 && library.renders.length > 4 ? <span className="absolute inset-0 grid place-items-center bg-black/55 text-lg font-semibold text-white">+{library.renders.length - 4}</span> : null}<span className="sr-only">{t("overview.open", { title: item.title })}</span></Link>)}</div> : null}
      {library.animations.length ? <div className="grid gap-3 sm:grid-cols-2">{library.animations.slice(0, 2).map((item) => <Link key={item.id} href={`/projects/${projectId}/media?type=animations`} className="group flex items-center gap-4 overflow-hidden rounded-xl border border-line bg-surface p-3 outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent"><span className="relative grid aspect-video w-32 shrink-0 place-items-center overflow-hidden rounded-lg bg-neutral-900">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-80" /> : null}<span className="relative grid size-9 place-items-center rounded-full bg-black/60 text-white"><Play className="ml-0.5 size-4 fill-current" /></span></span><span className="min-w-0"><span className="block truncate font-medium text-fg">{item.title}</span><span className="mt-1 block text-meta text-fg-muted">{t("overview.animation")}{item.durationSeconds ? ` · ${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : ""}</span></span></Link>)}</div> : null}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="mt-1 text-table font-medium text-fg">{value}</dd></div>;
}
