"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FolderKanban, Star } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { statusActionFor, WORKING_STATUSES } from "@/lib/modules/projects/project.machine";
import { portfolioHref, type PortfolioUrlUpdate } from "@/lib/modules/projects/project.portfolio-url";
import type { PortfolioQuery } from "@/lib/modules/projects/project.schema";
import type { PortfolioFilterOptionsDTO, PortfolioListDTO, PortfolioProjectDTO } from "@/lib/modules/projects/project.types";
import { projectsViewCookie, type ProjectsView } from "@/lib/modules/projects/project.view-preference";
import { cn } from "@/lib/utils/cn";
import { ChangeProjectStatusDialog } from "./change-project-status-dialog";
import { GALLERY_GRID, ProjectCard, ProjectCardSkeleton } from "./project-card";
import { ProjectList } from "./project-list";
import { ProjectsToolbar } from "./projects-toolbar";

/**
 * The Projects page body (E-05A §4, §21-§23, §43, §45, §46, §58).
 *
 * The server renders the first page from the URL; this keeps what the person
 * does next — more pages, a star, a status, an archive — without reloading the
 * collection they are looking at. A new URL (a filter, a search, Back) brings a
 * new first page from the server, and the collection starts again from it.
 */
export function ProjectsPortfolio({
  initial,
  options,
  query,
  filterCount,
  initialView,
}: {
  initial: PortfolioListDTO;
  options: PortfolioFilterOptionsDTO;
  query: PortfolioQuery;
  filterCount: number;
  initialView: ProjectsView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [navigating, startNavigation] = React.useTransition();

  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.pageInfo.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [view, setView] = React.useState(initialView);
  const [pendingFavorites, setPendingFavorites] = React.useState<ReadonlySet<string>>(new Set());
  const [statusTarget, setStatusTarget] = React.useState<PortfolioProjectDTO | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<PortfolioProjectDTO | null>(null);
  const [archiving, setArchiving] = React.useState(false);

  React.useEffect(() => {
    setItems(initial.items);
    setCursor(initial.pageInfo.nextCursor);
    setLoadError(null);
  }, [initial]);

  const navigate = React.useCallback(
    (update: PortfolioUrlUpdate, mode: "push" | "replace" = "push") => {
      const href = portfolioHref(pathname, new URLSearchParams(searchParams.toString()), update);
      startNavigation(() => {
        if (mode === "replace") router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  function changeView(next: ProjectsView) {
    setView(next);
    document.cookie = projectsViewCookie(next);
  }

  const patch = (projectId: string, change: Partial<PortfolioProjectDTO>) =>
    setItems((current) => current.map((item) => (item.id === projectId ? { ...item, ...change } : item)));

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams(searchParams.toString());
      params.set("cursor", cursor);
      const page = await announcementApi<PortfolioListDTO>(`/api/projects?${params.toString()}`);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.pageInfo.nextCursor);
    } catch {
      setLoadError("Projects could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFavorite(project: PortfolioProjectDTO) {
    if (pendingFavorites.has(project.id)) return;
    const next = !project.isFavorite;
    patch(project.id, { isFavorite: next });
    setPendingFavorites((current) => new Set(current).add(project.id));
    try {
      await announcementApi(`/api/projects/${project.id}/favorite`, { method: next ? "POST" : "DELETE" });
    } catch (error) {
      patch(project.id, { isFavorite: !next });
      toast({ title: failureMessage(error, "Favorites could not be updated."), tone: "danger" });
    } finally {
      setPendingFavorites((current) => {
        const remaining = new Set(current);
        remaining.delete(project.id);
        return remaining;
      });
    }
  }

  function statusChanged(projectId: string, status: PortfolioProjectDTO["statusMoves"][number]) {
    patch(projectId, {
      status,
      statusMoves: WORKING_STATUSES.filter((to) => to !== status && statusActionFor(status, to) !== null),
    });
  }

  async function archive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await announcementApi(`/api/projects/${archiveTarget.id}/archive`, { method: "POST" });
      setItems((current) => current.filter((item) => item.id !== archiveTarget.id));
      toast({ title: `${archiveTarget.name} archived.` });
      setArchiveTarget(null);
    } catch (error) {
      toast({ title: failureMessage(error, "The project could not be archived."), tone: "danger" });
    } finally {
      setArchiving(false);
    }
  }

  if (initial.meta.visibleProjectCount === 0) {
    return (
      <EmptyState
        icon={<FolderKanban />}
        title="No projects available."
        description="You do not currently have access to any projects."
        action={options.creatableCompanies.length > 0 ? { label: "Create project", href: "/projects/new" } : undefined}
      />
    );
  }

  const onlyFavorites = query.favorites && filterCount === 1;
  const shown = items.length;

  return (
    <div className="space-y-6">
      <ProjectsToolbar
        query={query}
        options={options}
        view={view}
        filterCount={filterCount}
        matchingCount={initial.meta.matchingCount}
        onNavigate={navigate}
        onViewChange={changeView}
      />

      <p className="sr-only" aria-live="polite">
        {navigating ? "Loading projects" : `Showing ${shown} of ${initial.meta.matchingCount} projects`}
      </p>

      <div className={cn("transition-opacity", navigating && "pointer-events-none opacity-60")} aria-busy={navigating}>
        {shown === 0 ? (
          onlyFavorites ? (
            <EmptyState icon={<Star />} title="No favorite projects yet." description="Mark a project with the star to keep it at the top." />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center">
              <p className="text-card font-semibold text-fg">No projects match these filters.</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => navigate({ clear: true })}>
                Clear filters
              </Button>
            </div>
          )
        ) : view === "gallery" ? (
          <div className={GALLERY_GRID} data-testid="project-gallery">
            {items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                favoritePending={pendingFavorites.has(project.id)}
                onToggleFavorite={() => void toggleFavorite(project)}
                onChangeStatus={() => setStatusTarget(project)}
                onArchive={() => setArchiveTarget(project)}
              />
            ))}
            {loadingMore ? Array.from({ length: 4 }, (_, index) => <ProjectCardSkeleton key={`more-${index}`} />) : null}
          </div>
        ) : (
          <ProjectList
            projects={items}
            pendingFavorites={pendingFavorites}
            onToggleFavorite={(project) => void toggleFavorite(project)}
            onChangeStatus={setStatusTarget}
            onArchive={setArchiveTarget}
          />
        )}
      </div>

      {shown > 0 && (cursor || loadError) ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          {loadError ? (
            <p role="alert" className="text-table text-danger-strong">
              {loadError}
            </p>
          ) : (
            <p className="text-meta text-fg-subtle">
              Showing {shown} of {initial.meta.matchingCount}
            </p>
          )}
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore} data-testid="projects-load-more">
            {loadError ? "Retry" : loadingMore ? "Loading…" : "Load more projects"}
          </Button>
        </div>
      ) : null}

      <ChangeProjectStatusDialog
        project={statusTarget}
        open={statusTarget !== null}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        onChanged={statusChanged}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={archiveTarget ? `Archive ${archiveTarget.name}?` : "Archive project?"}
        description="The project leaves the Projects page. Its tasks, documents, team and history stay available as archived project data, and it can be restored."
        confirmLabel="Archive project"
        pending={archiving}
        onConfirm={() => void archive()}
      />
    </div>
  );
}

/** What the page shows while the first page is on its way (E-05A §46). */
export function ProjectsPortfolioSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading projects">
      <div className="space-y-3">
        <div className="h-10 w-full animate-pulse rounded-md bg-surface-muted md:max-w-md motion-reduce:animate-none" />
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-8 w-20 animate-pulse rounded-full bg-surface-muted motion-reduce:animate-none" />
          ))}
        </div>
      </div>
      <div className={GALLERY_GRID}>
        {Array.from({ length: 8 }, (_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
