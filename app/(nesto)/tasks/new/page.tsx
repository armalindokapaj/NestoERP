import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createTaskAction } from "@/lib/actions/tasks";
import { taskFormOptions } from "@/lib/modules/tasks/task.options";

export const metadata: Metadata = { title: "New Task" };

/**
 * Create a task (PRD #11 §41, §89).
 *
 * `?projectId=` preselects the project when the form is opened from a project's
 * Tasks tab. The service revalidates that project against the caller's scope,
 * so a hand-edited parameter cannot place work on a project they cannot see
 * (PRD #11 §90).
 */
export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("tasks");
  if (!can(context, "task.create")) notFound();

  const params = await searchParams;
  const requestedProjectId = typeof params.projectId === "string" ? params.projectId : "";

  const options = await taskFormOptions(context, requestedProjectId || null);
  // Only offer a project the picker itself can list, so the preselection can
  // never disagree with what the service will accept.
  const projectId = options.projects.some((option) => option.value === requestedProjectId)
    ? requestedProjectId
    : "";

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Tasks", href: "/tasks" },
          { label: "New task" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New task</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Track a piece of work, on a project or on its own.
        </p>
      </div>

      <TaskForm
        mode="create"
        cancelHref="/tasks/all"
        projects={options.projects}
        assignees={options.assignees}
        mayAssignOthers={options.mayAssignOthers}
        action={createTaskAction}
        initial={{
          title: "",
          description: "",
          projectId,
          assigneeMemberId: options.mayAssignOthers ? "" : context.membershipId,
          status: "TODO",
          priority: "MEDIUM",
          startDate: "",
          dueDate: "",
        }}
      />
    </div>
  );
}
