import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskEditForm } from "@/components/tasks/task-edit-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { updateTaskAction } from "@/lib/actions/tasks";
import { taskFormOptions } from "@/lib/modules/tasks/task.options";
import { getTranslations } from "@/lib/i18n/server";
import { loadTask, taskBreadcrumbs } from "../task-context";

type Params = { params: Promise<{ taskId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.edit") };
}

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
  const t = await getTranslations("tasks");

  const options = await taskFormOptions(context, task.project?.id ?? null);
  // A task raised from another record stays on that record's project, so the
  // picker offers no other (PRD #47 §51); the service refuses a move regardless.
  const projects = task.context.entityId
    ? options.projects.filter((option) => option.value === task.project?.id)
    : options.projects;

  // The saved project and assignee when the pickers no longer offer them — an
  // archived project, an inactive member, or (without task.assign) somebody
  // else. Shown, not offered, so saving an untouched form cannot clear them
  // (AUD-09 §5, FV-10).
  const legacyProject =
    task.project && !projects.some((option) => option.value === task.project?.id)
      ? { value: task.project.id, label: `${task.project.name} (${task.project.code}) — ${t("editPage.notAvailable")}` }
      : undefined;
  const legacyAssignee =
    task.assignee && !options.assignees.some((option) => option.value === task.assignee?.memberId)
      ? { value: task.assignee.memberId, label: `${task.assignee.fullName} — ${t("editPage.currentAssignee")}` }
      : undefined;

  async function action(formData: FormData) {
    "use server";
    return updateTaskAction(taskId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={await taskBreadcrumbs(task, t("common.edit"))} />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("editPage.heading")}</h1>
        <p className="mt-1.5 text-body text-fg-muted [overflow-wrap:anywhere]">{task.title}</p>
      </div>

      <TaskEditForm
        taskId={task.id}
        cancelHref={`/tasks/${task.id}`}
        projects={projects}
        assignees={options.assignees}
        mayAssignOthers={options.mayAssignOthers}
        legacyProject={legacyProject}
        legacyAssignee={legacyAssignee}
        // The version this page shows; every save names it (AUD-02 §3).
        version={task.version}
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
