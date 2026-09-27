import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn, type TableSortConfig } from "@/components/data/data-table";
import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { ProjectSummaryDTO } from "@/lib/modules/projects/project.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The Projects list (PRD #10 §17, §144).
 *
 * Professional ERP density on desktop; record cards below the tablet
 * breakpoint. Clicking a row opens the project — individual cells are not
 * separately clickable (PRD #10 §18), except the manager's name, which leads to
 * their profile as every name does (E-08 §5).
 *
 * Column metadata (AUD-08 §5): the project name/code is the identity column
 * and status is mandatory. Header sorts only where the page passes `sort`.
 */
export async function ProjectTable({
  projects,
  listId = "projects.archived",
  sort,
}: {
  projects: ProjectSummaryDTO[];
  /** A nested use (a client's Projects tab) names its own list (AUD-08 §5). */
  listId?: string;
  /** Header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("projects");
  const sortable = Boolean(sort);
  const columns: TableColumn<ProjectSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      label: t("table.project"),
      primary: true,
      mandatory: true,
      sortKey: sortable ? "name" : undefined,
      render: (project) => (
        <>
          <span className="block truncate">{project.name}</span>
          <span className="block text-meta font-normal text-fg-subtle">{project.code}</span>
        </>
      ),
    },
    {
      key: "client",
      id: "client",
      label: t("table.client"),
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
      id: "manager",
      label: t("table.projectManager"),
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
      id: "status",
      mandatory: true,
      valueType: "status",
      sortKey: sortable ? "status" : undefined,
      label: t("table.status"),
      render: (project) => <StatusBadge status={project.status} />,
    },
    {
      key: "priority",
      id: "priority",
      valueType: "status",
      sortKey: sortable ? "priority" : undefined,
      label: t("table.priority"),
      hideBelow: "lg",
      render: (project) => <PriorityBadge priority={project.priority} />,
    },
    {
      key: "endDate",
      id: "end",
      valueType: "date",
      sortKey: sortable ? "end" : undefined,
      label: t("table.endDate"),
      hideBelow: "xl",
      render: (project) => (
        <span className="text-fg-muted">
          {project.endDate ? formatDate(project.endDate) : "—"}
        </span>
      ),
    },
    {
      key: "team",
      id: "team",
      valueType: "number",
      label: t("table.team"),
      hideBelow: "xl",
      align: "right",
      render: (project) => <span className="text-fg-muted">{project.teamSize}</span>,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("meta.projects")}
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
