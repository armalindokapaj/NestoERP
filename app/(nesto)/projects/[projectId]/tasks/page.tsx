import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { RecordContextHeader } from "@/components/modules/record-header";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as projects from "@/lib/modules/projects/project.service";
import { taskListQuerySchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Tasks" };

/**
 * Project tasks (PRD #10 §79, PRD #11 §88).
 *
 * The same canonical Task records as /tasks, filtered to this project and to
 * the tasks the user may see: the project tab narrows, it never widens
 * (PRD #10 §224). Rows open the canonical task URL rather than a project-local
 * copy of the detail page (PRD #11 §12, §172).
 */
export default async function ProjectTasksPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewTasks) redirect("/access-denied");

  const query = taskListQuerySchema.parse({ projectId, limit: 100, sort: "due-asc" });
  const result = await tasks.listTasks(context, query);

  // New work on an archived project is refused by the service, so the control
  // is not offered either (PRD #11 §173).
  const archived = project.archivedAt !== null || project.status === "ARCHIVED";
  const canCreate = !archived && can(context, "task.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Tasks")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href={`/tasks/new?projectId=${project.id}`}>New task</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="tasks"
        show={{
          tasks: actions.canViewTasks,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No tasks on this project."
          description="Tasks created against this project will appear here."
          action={
            canCreate
              ? { label: "New task", href: `/tasks/new?projectId=${project.id}` }
              : undefined
          }
        />
      ) : (
        <TaskTable tasks={result.data} />
      )}
    </div>
  );
}
