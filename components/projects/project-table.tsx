import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { ProjectSummaryDTO } from "@/lib/modules/projects/project.types";
import { formatDate } from "@/lib/utils/format";

/**
 * The Projects list (PRD #10 §17, §144).
 *
 * Professional ERP density on desktop; record cards below the tablet
 * breakpoint. Clicking a row opens the project — individual cells are not
 * separately clickable (PRD #10 §18), except the manager's name, which leads to
 * their profile as every name does (E-08 §5).
 */
export function ProjectTable({ projects }: { projects: ProjectSummaryDTO[] }) {
  const columns: TableColumn<ProjectSummaryDTO>[] = [
    {
      key: "name",
      label: "Project",
      primary: true,
      render: (project) => (
        <>
          <span className="block truncate">{project.name}</span>
          <span className="block text-meta font-normal text-fg-subtle">{project.code}</span>
        </>
      ),
    },
    {
      key: "client",
      label: "Client",
      hideBelow: "lg",
      render: (project) =>
        project.client ? (
          <span className="text-fg-muted">{project.client.name}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "manager",
      label: "Project Manager",
      hideBelow: "xl",
      render: (project) =>
        project.projectManager ? (
          <PersonLink memberId={project.projectManager.memberId} name={project.projectManager.fullName} />
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      render: (project) => <StatusBadge status={project.status} />,
    },
    {
      key: "priority",
      label: "Priority",
      hideBelow: "lg",
      render: (project) => <PriorityBadge priority={project.priority} />,
    },
    {
      key: "endDate",
      label: "End date",
      hideBelow: "xl",
      render: (project) => (
        <span className="text-fg-muted">
          {project.endDate ? formatDate(project.endDate) : "—"}
        </span>
      ),
    },
    {
      key: "team",
      label: "Team",
      hideBelow: "xl",
      align: "right",
      render: (project) => <span className="text-fg-muted">{project.teamSize}</span>,
    },
  ];

  return (
    <DataTable
      caption="Projects"
      columns={columns}
      records={projects}
      rowKey={(project) => project.id}
      rowHref={(project) => `/projects/${project.id}`}
    />
  );
}

/** A compact project reference used inside other modules. */
export function ProjectLink({
  project,
}: {
  project: { id: string; name: string; code: string } | null;
}) {
  if (!project) return <span className="text-fg-subtle">—</span>;
  return (
    <Link href={`/projects/${project.id}`} className="text-fg transition-colors hover:text-accent">
      {project.name}
    </Link>
  );
}
