"use client";

import Link from "next/link";

import type { PortfolioProjectDTO } from "@/lib/modules/projects/project.types";
import { formatDate } from "@/lib/utils/format";
import { locationLabel } from "./project-card";
import { ProjectCardMenu } from "./project-card-menu";
import { ProjectFavoriteButton } from "./project-favorite-button";
import { ProjectStatusBadge } from "./project-status-badge";

type RowHandlers = {
  pendingFavorites: ReadonlySet<string>;
  onToggleFavorite: (project: PortfolioProjectDTO) => void;
  onChangeStatus: (project: PortfolioProjectDTO) => void;
  onArchive: (project: PortfolioProjectDTO) => void;
};

/**
 * The same projects as the gallery, as rows (E-05A §22).
 *
 * The same query, permissions, filters and order — only the presentation
 * differs. On a narrow screen the less important columns step aside rather
 * than the table scrolling sideways.
 */
export function ProjectList({ projects, ...handlers }: { projects: PortfolioProjectDTO[] } & RowHandlers) {
  return (
    <div className="nesto-card overflow-hidden p-0">
      <table className="w-full text-left text-table sm:table-fixed" data-testid="project-list">
        <thead className="border-b border-line bg-surface-muted text-meta font-medium text-fg-muted">
          <tr>
            <th scope="col" className="w-[45%] px-4 py-2.5 sm:w-auto">Project</th>
            <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Company</th>
            <th scope="col" className="px-4 py-2.5 sm:w-32">Status</th>
            <th scope="col" className="hidden w-36 px-4 py-2.5 lg:table-cell">My role</th>
            <th scope="col" className="hidden w-40 px-4 py-2.5 lg:table-cell">Location</th>
            <th scope="col" className="hidden w-32 px-4 py-2.5 md:table-cell">Last activity</th>
            <th scope="col" className="w-20 px-2 py-2.5"><span className="sr-only">Favorite and actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {projects.map((project) => (
            <tr key={project.id} className="transition-colors hover:bg-row-hover" data-testid="project-row" data-project-id={project.id}>
              <td className="max-w-0 px-4 py-3">
                <Link href={project.href} prefetch={project.company.isCurrent ? undefined : false} className="block truncate font-medium text-fg hover:text-accent-strong focus-visible:underline focus-visible:outline-none">
                  {project.name}
                </Link>
                <span className="block truncate text-meta text-fg-subtle">
                  {project.code}
                  <span className="sm:hidden"> · {project.company.name}</span>
                </span>
              </td>
              <td className="hidden max-w-0 truncate px-4 py-3 text-fg-muted sm:table-cell">{project.company.name}</td>
              <td className="px-4 py-3"><ProjectStatusBadge status={project.status} className="shadow-none" /></td>
              <td className="hidden truncate px-4 py-3 text-fg-muted lg:table-cell">{project.myProjectRole?.name ?? "—"}</td>
              <td className="hidden truncate px-4 py-3 text-fg-muted lg:table-cell">{locationLabel(project.location) ?? "—"}</td>
              <td className="hidden whitespace-nowrap px-4 py-3 tabular-nums text-fg-muted md:table-cell">{formatDate(project.lastActivityAt)}</td>
              <td className="px-2 py-3">
                <div className="flex items-center justify-end gap-0.5">
                  {project.permissions.favorite ? (
                    <ProjectFavoriteButton variant="inline" projectName={project.name} isFavorite={project.isFavorite} pending={handlers.pendingFavorites.has(project.id)} onToggle={() => handlers.onToggleFavorite(project)} />
                  ) : null}
                  <ProjectCardMenu variant="inline" project={project} onToggleFavorite={() => handlers.onToggleFavorite(project)} onChangeStatus={() => handlers.onChangeStatus(project)} onArchive={() => handlers.onArchive(project)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
