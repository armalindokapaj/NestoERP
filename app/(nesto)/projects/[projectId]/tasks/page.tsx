import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PriorityBadge, StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import * as projects from "@/lib/modules/projects/project.service";
import { formatDate, orDash } from "@/lib/utils/format";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Tasks" };

type Row = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  assignee: { user: { firstName: string; lastName: string } } | null;
};

/**
 * Project tasks (PRD #10 §79, §80).
 *
 * Filtered to this project *and* to the tasks the user may see: the project tab
 * narrows, it never widens (PRD #10 §224).
 */
export default async function ProjectTasksPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewTasks) redirect("/access-denied");

  const tasks: Row[] = await prisma.task.findMany({
    where: { AND: [buildTaskScopeWhere(context), { projectId, archivedAt: null }] },
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  const columns: TableColumn<Row>[] = [
    { key: "title", label: "Task", primary: true, render: (task) => task.title },
    {
      key: "assignee",
      label: "Assignee",
      hideBelow: "lg",
      render: (task) =>
        orDash(
          task.assignee ? `${task.assignee.user.firstName} ${task.assignee.user.lastName}` : null,
        ),
    },
    { key: "status", label: "Status", render: (task) => <StatusBadge status={task.status} /> },
    {
      key: "priority",
      label: "Priority",
      hideBelow: "lg",
      render: (task) => <PriorityBadge priority={task.priority} />,
    },
    {
      key: "due",
      label: "Due",
      hideBelow: "xl",
      render: (task) => (task.dueDate ? formatDate(task.dueDate) : "—"),
    },
  ];

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Tasks")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
      />

      <ProjectTabs
        projectId={project.id}
        active="tasks"
        show={{
          tasks: actions.canViewTasks,
          team: actions.canViewMembers,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No tasks on this project."
          description="Tasks created against this project will appear here."
        />
      ) : (
        <DataTable
          caption={`${project.name} tasks`}
          columns={columns}
          records={tasks}
          rowKey={(task) => task.id}
        />
      )}
    </div>
  );
}
