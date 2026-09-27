import { cache } from "react";
import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import * as tasks from "@/lib/modules/tasks/task.service";
import type { TaskDetailDTO } from "@/lib/modules/tasks/task.types";

/**
 * Loads a task for every page under /tasks/[taskId] (PRD #11 §54).
 *
 * A task outside the caller's scope is a 404, not a 403, so the page itself
 * cannot be used to discover that it exists (PRD #11 §120).
 */
export const loadTask = cache(async function loadTask(
  taskId: string,
): Promise<{ context: UserContext; task: TaskDetailDTO }> {
  const context = await requireModule("tasks");

  try {
    return { context, task: await tasks.getTask(context, taskId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

/** Canonical breadcrumb trail: the task always lives under /tasks (PRD #11 §56, §172). */
export async function taskBreadcrumbs(task: TaskDetailDTO, trailing?: string): Promise<Crumb[]> {
  const t = await getTranslations("tasks");
  const crumbs: Crumb[] = [
    { label: t("common.tasks"), href: "/tasks" },
    trailing ? { label: task.title, href: `/tasks/${task.id}` } : { label: task.title },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
