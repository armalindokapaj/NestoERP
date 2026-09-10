import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { modules } from "@/config/modules";
import { can } from "@/config/permissions";
import { requirePermission } from "@/lib/auth/session";
import { demoProjects, statusLabels, statusTones, type DemoProject } from "@/lib/mock/demo-data";
import { formatDate } from "@/lib/utils/format";

const MODULE_KEY = "projects" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

function ProjectTable({ projects }: { projects: DemoProject[] }) {
  return (
    <div className="nesto-card overflow-hidden">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Project</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Client</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell className="hidden lg:table-cell">Progress</TableHeaderCell>
            <TableHeaderCell className="hidden xl:table-cell">Due</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {projects.map((project) => (
            <TableRow key={project.id}>
              <TableCell>
                <Link
                  href={`/projects/${project.id}`}
                  className="font-medium text-fg transition-colors hover:text-accent"
                >
                  {project.name}
                </Link>
                <p className="text-meta text-fg-subtle">{project.code}</p>
              </TableCell>
              <TableCell className="hidden text-fg-muted md:table-cell">{project.client}</TableCell>
              <TableCell>
                <Badge tone={statusTones[project.status]}>{statusLabels[project.status]}</Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-hover">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${project.progress}%` }} />
                  </div>
                  <span className="text-meta tabular-nums text-fg-muted">{project.progress}%</span>
                </div>
              </TableCell>
              <TableCell className="hidden text-fg-muted xl:table-cell">
                {formatDate(project.dueDate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const active = demoProjects.filter((project) => project.status !== "archived");
  const archived = demoProjects.filter((project) => project.status === "archived");
  // Archived work is reached through the Archived tab, not "My Projects".
  const mine = active.filter((project) => project.assignedTo.includes(user.email));

  const canCreate = can(user, "project.create");

  return (
    <ModuleShell
      moduleKey={MODULE_KEY}
      activeTab={activeTab}
      filters={
        <FilterBar
          searchPlaceholder="Search projects…"
          disabled
          filters={[
            { label: "Status", options: ["Planning", "In progress", "Handover", "Archived"] },
            { label: "Client", options: ["Meridian Group", "Portside Council", "Ashford Retail"] },
          ]}
        />
      }
      actions={
        canCreate ? (
          <Button asChild size="sm">
            <Link href="/projects/new">New project</Link>
          </Button>
        ) : null
      }
    >
      {activeTab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Active projects", value: String(active.length) },
              { label: "In progress", value: String(demoProjects.filter((p) => p.status === "in-progress").length) },
              { label: "Assigned to you", value: String(mine.length) },
              { label: "Archived", value: String(archived.length) },
            ].map((stat) => (
              <div key={stat.label} className="nesto-card p-4">
                <p className="text-table text-fg-muted">{stat.label}</p>
                <p className="mt-2 text-page font-semibold tabular-nums text-fg">{stat.value}</p>
              </div>
            ))}
          </div>
          <ProjectTable projects={active} />
        </div>
      ) : null}

      {activeTab === "all" ? <ProjectTable projects={demoProjects} /> : null}

      {activeTab === "mine" ? (
        mine.length > 0 ? (
          <ProjectTable projects={mine} />
        ) : (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects assigned to you."
            description="Projects you are assigned to will appear here."
            action={canCreate ? { label: "New project", href: "/projects/new" } : undefined}
          />
        )
      ) : null}

      {activeTab === "archived" ? (
        archived.length > 0 ? (
          <ProjectTable projects={archived} />
        ) : (
          <EmptyState
            icon={<FolderKanban />}
            title="No archived projects."
            description="Completed projects that are archived will appear here."
          />
        )
      ) : null}
    </ModuleShell>
  );
}
