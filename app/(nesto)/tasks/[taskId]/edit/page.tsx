import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { updateTaskAction } from "@/lib/actions/tasks";
import { taskFormOptions } from "@/lib/modules/tasks/task.options";
import { loadTask, taskBreadcrumbs } from "../task-context";

type Params = { params: Promise<{ taskId: string }> };

export const metadata: Metadata = { title: "Edit Task" };

/**
 * Edit a task (PRD #11 §60, §61).
 *
 * An archived task is read-only and has no edit page: it must be restored
 * first (PRD #11 §72).
 */
export default async function EditTaskPage({ params }: Params) {
  const { taskId } = await params;
  const { context, task } = await loadTask(taskId);

  if (!task.capabilities.canEdit) notFound();

  const options = await taskFormOptions(context, task.project?.id ?? null);

  async function action(formData: FormData) {
    "use server";
    return updateTaskAction(taskId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={taskBreadcrumbs(task, "Edit")} />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit task</h1>
        <p className="mt-1.5 text-body text-fg-muted">{task.title}</p>
      </div>

      <TaskForm
        mode="edit"
        cancelHref={`/tasks/${task.id}`}
        projects={options.projects}
        assignees={options.assignees}
        mayAssignOthers={options.mayAssignOthers}
        versionUpdatedAt={task.updatedAt}
        action={action}
        initial={{
          title: task.title,
          description: task.description ?? "",
          projectId: task.project?.id ?? "",
          assigneeMemberId: task.assignee?.memberId ?? "",
          status: task.status,
          priority: task.priority,
          startDate: dateInput(task.schedule.startDate),
          dueDate: dateInput(task.schedule.dueDate),
        }}
      />
    </div>
  );
}

/** `<input type="date">` wants YYYY-MM-DD, not an ISO timestamp. */
function dateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}
