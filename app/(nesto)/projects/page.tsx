import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  projectOverviewStats,
  recentProjects,
  upcomingDeadlines,
} from "@/lib/modules/projects/project.repository";
import { formatDate } from "@/lib/utils/format";

/**
 * Projects module overview (PRD #10 §13).
 *
 * This is the module's own dashboard, not the personal one at /dashboard: it
 * describes the portfolio, scoped to what this user may see (PRD #7 §16).
 */
export default async function ProjectsOverviewPage() {
  const context = await requireModule("projects");
  const experience = resolveModuleExperience(context, "projects");

  const [stats, recent, deadlines] = await Promise.all([
    projectOverviewStats(context),
    recentProjects(context, 6),
    upcomingDeadlines(context, 5),
  ]);

  const cards = [
    { label: "Active", value: stats.active, href: "/projects/all?status=ACTIVE" },
    { label: "On hold", value: stats.onHold, href: "/projects/all?status=ON_HOLD" },
    { label: "At risk", value: stats.atRisk, href: "/projects/all" },
    { label: "Completed", value: stats.completed, href: "/projects/all?status=COMPLETED" },
  ];

  const hasAnything = recent.length > 0;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "project.create") ? (
          <Button asChild size="sm">
            <Link href="/projects/new">New project</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link key={card.label} href={card.href} className="nesto-card p-4 transition-colors hover:border-line-strong">
              <p className="text-table text-fg-muted">{card.label}</p>
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">{card.value}</p>
            </Link>
          ))}
        </div>

        {!hasAnything ? (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet."
            description="Projects created by your company will appear here."
            action={
              can(context, "project.create")
                ? { label: "New project", href: "/projects/new" }
                : undefined
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Recently updated</h2>
                <Link
                  href="/projects/all"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  All projects
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {recent.map((project) => (
                  <li key={project.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${project.id}`}
                        className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                      >
                        {project.name}
                      </Link>
                      <p className="truncate text-meta text-fg-subtle">
                        {project.client?.name ?? project.code}
                      </p>
                    </div>
                    <StatusBadge status={project.status} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Upcoming deadlines</h2>
              {deadlines.length === 0 ? (
                <p className="mt-4 text-table text-fg-subtle">
                  No project end dates are coming up.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {deadlines.map((project) => (
                    <li key={project.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${project.id}`}
                          className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                        >
                          {project.name}
                        </Link>
                        <p className="truncate text-meta text-fg-subtle">{project.code}</p>
                      </div>
                      <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                        {project.endDate ? formatDate(project.endDate) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </ModulePage>
  );
}
