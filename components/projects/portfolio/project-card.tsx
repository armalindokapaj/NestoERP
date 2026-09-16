"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";

import type { PortfolioProjectDTO } from "@/lib/modules/projects/project.types";
import { ProjectCardMenu } from "./project-card-menu";
import { ProjectCover } from "./project-cover";
import { ProjectFavoriteButton } from "./project-favorite-button";
import { ProjectStatusBadge } from "./project-status-badge";

/** Cover `sizes` matching the gallery's columns, so the browser picks the right bytes. */
const COVER_SIZES = "(min-width: 1600px) 20vw, (min-width: 1280px) 22vw, (min-width: 768px) 30vw, (min-width: 340px) 48vw, 92vw";

export function locationLabel(location: PortfolioProjectDTO["location"]): string | null {
  return [location.city, location.country].filter(Boolean).join(", ") || null;
}

/**
 * One project in the gallery (E-05A §7, §9, §25, §47).
 *
 * The render leads; the words underneath are the ones a person scanning a
 * portfolio needs — which project, which company, where, and what they are on
 * it. The whole card opens the project through one real link stretched over
 * it, so it is one tab stop, opens on Enter, and the star and the menu sit on
 * top of it as their own buttons rather than inside it.
 */
export function ProjectCard({
  project,
  favoritePending,
  onToggleFavorite,
  onChangeStatus,
  onArchive,
}: {
  project: PortfolioProjectDTO;
  favoritePending: boolean;
  onToggleFavorite: () => void;
  onChangeStatus: () => void;
  onArchive: () => void;
}) {
  const location = locationLabel(project.location);
  const detail = [location, project.myProjectRole?.name].filter(Boolean).join(" · ");

  return (
    <article className="group relative min-w-0" data-testid="project-card" data-project-id={project.id}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-line bg-surface-muted shadow-card transition-[box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-menu group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-ring group-has-[a:focus-visible]:ring-offset-2 group-has-[a:focus-visible]:ring-offset-canvas motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <ProjectCover project={project} sizes={COVER_SIZES} className="transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
        {project.cover ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/30 to-transparent" /> : null}
        <div className="absolute bottom-3 left-3">
          <ProjectStatusBadge status={project.status} />
        </div>
      </div>

      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        {project.permissions.favorite ? (
          <ProjectFavoriteButton projectName={project.name} isFavorite={project.isFavorite} pending={favoritePending} onToggle={onToggleFavorite} />
        ) : null}
        <ProjectCardMenu project={project} onToggleFavorite={onToggleFavorite} onChangeStatus={onChangeStatus} onArchive={onArchive} />
      </div>

      <div className="mt-3 min-w-0 px-0.5">
        <h3 className="truncate text-card font-semibold text-fg">
          <Link
            href={project.href}
            // A project in another company opens by moving the session there;
            // prefetching it would only fetch the page that asks to.
            prefetch={project.company.isCurrent ? undefined : false}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
            data-testid="project-card-link"
          >
            {project.name}
          </Link>
        </h3>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-table text-fg-muted" data-testid="project-company">
          <Building2 aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate">{project.company.name}</span>
        </p>
        {detail ? <p className="mt-0.5 truncate text-meta text-fg-subtle">{detail}</p> : null}
      </div>
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0">
      <div className="aspect-[3/4] animate-pulse rounded-xl border border-line bg-surface-muted motion-reduce:animate-none" />
      <div className="mt-3 space-y-2 px-0.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

/**
 * Wide desktop 5, laptop 4, tablet 3, phone 2 (E-05A §21, §24). Only the
 * narrowest screens fall back to one card a row, where two would squeeze the
 * name and company below readable.
 */
export const GALLERY_GRID = "grid grid-cols-1 gap-x-3 gap-y-6 min-[340px]:grid-cols-2 sm:gap-x-5 sm:gap-y-8 md:grid-cols-3 xl:grid-cols-4 min-[1600px]:grid-cols-5";
