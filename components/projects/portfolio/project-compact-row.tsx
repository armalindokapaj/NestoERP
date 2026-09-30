"use client";

import Link from "@/components/navigation/nav-link";
import { Building2, ChevronRight } from "lucide-react";

import type { ProjectCardDTO } from "@/lib/modules/projects/project.types";
import { ProjectStatusBadge } from "./project-status-badge";

/**
 * The Projects list's compact alternative to the card (MOB-05 §15): name,
 * managing company and status on two lines, the whole row one link. The company
 * is never left out (§10) — two projects may share a name.
 */
export function ProjectCompactRow({ project }: { project: ProjectCardDTO }) {
  return (
    <article className="relative flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-hover" data-testid="project-card" data-project-id={project.id}>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-table font-semibold text-fg" title={project.name}>
          <Link href={project.href} prefetch={project.company.isCurrent ? undefined : false} className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring" data-testid="project-card-link">
            {project.name}
          </Link>
        </h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-fg-muted" data-testid="project-company">
          <Building2 aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate">{project.company.name}</span>
        </p>
      </div>
      <ProjectStatusBadge status={project.status} />
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
    </article>
  );
}
