"use client";

import Link from "@/components/navigation/nav-link";
import { Building2, MapPin } from "lucide-react";

import type { ProjectCardDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";
import { COVER_ASPECT } from "./gallery";
import { ProjectCardMenu } from "./project-card-menu";
import { ProjectCover } from "./project-cover";
import { ProjectFavoriteButton } from "./project-favorite-button";
import { ProjectStatusBadge } from "./project-status-badge";

/** Cover `sizes` matching the grid's columns, so the browser picks the right bytes (§46). */
const COVER_SIZES = "(min-width: 1440px) 22vw, (min-width: 1024px) 28vw, (min-width: 640px) 46vw, 92vw";

/** "Tiranë, Albania", or null when the project records no place (§61, §62). */
export function locationLabel(location: ProjectCardDTO["location"]): string | null {
  if (!location) return null;
  return [location.city, location.country].filter(Boolean).join(", ") || null;
}

/**
 * One project in the gallery (Projects Workspace Grid §42, §48-§55, §161-§169).
 *
 * The render leads, with the status on it; underneath, which project, which
 * company and where — each on its own line, so a narrow card truncates one
 * without losing another. The name is a real link stretched over the whole
 * card: one tab stop that opens on Enter, in a new tab on Cmd/Ctrl or middle
 * click. The star and the menu sit on top of it as their own buttons, after the
 * link in the tab order, never inside it.
 */
export function ProjectCard({
  project,
  favoritePending,
  onToggleFavorite,
}: {
  project: ProjectCardDTO;
  favoritePending: boolean;
  onToggleFavorite: () => void;
}) {
  const location = locationLabel(project.location);

  return (
    <article className="group relative min-w-0" data-testid="project-card" data-project-id={project.id}>
      <div
        className={cn(
          COVER_ASPECT,
          "relative overflow-hidden rounded-xl border border-line bg-surface-muted shadow-card transition-[border-color,box-shadow,transform] duration-200",
          "group-hover:-translate-y-0.5 group-hover:border-accent/40 group-hover:shadow-menu",
          "group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-ring group-has-[a:focus-visible]:ring-offset-2 group-has-[a:focus-visible]:ring-offset-canvas",
          "motion-reduce:transition-none motion-reduce:group-hover:translate-y-0",
        )}
        data-testid="project-cover"
      >
        <ProjectCover
          project={project}
          sizes={COVER_SIZES}
          className="transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {project.cover ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/30 to-transparent" /> : null}
        <div className="absolute bottom-3 left-3">
          <ProjectStatusBadge status={project.status} />
        </div>
      </div>

      <div className="mt-3 min-w-0 px-0.5">
        <h2 className="truncate text-card font-semibold text-fg" title={project.name}>
          <Link
            href={project.href}
            // A project in another company opens by entering that company;
            // prefetching it would only fetch the page that asks to.
            prefetch={project.company.isCurrent ? undefined : false}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
            data-testid="project-card-link"
          >
            {project.name}
          </Link>
        </h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-table text-fg-muted" data-testid="project-company">
          <Building2 aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate">{project.company.name}</span>
        </p>
        {location ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-fg-subtle" data-testid="project-location">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}
      </div>

      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        {project.canFavorite ? (
          <ProjectFavoriteButton projectName={project.name} isFavorite={project.isFavorite} pending={favoritePending} onToggle={onToggleFavorite} />
        ) : null}
        <ProjectCardMenu project={project} onToggleFavorite={onToggleFavorite} />
      </div>
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0">
      <div className={cn(COVER_ASPECT, "animate-pulse rounded-xl border border-line bg-surface-muted motion-reduce:animate-none")} />
      <div className="mt-3 space-y-2 px-0.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}
