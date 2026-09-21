"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TaskStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

/**
 * Server actions for the Tasks module (PRD #11 §102).
 *
 * They are a thin shell over the same service the API routes call — the
 * authorisation, validation and transaction logic exists once (PRD #11 §91).
 */

/**
 * Completing a task changes what /tasks/my-tasks, /tasks/overdue and
 * /tasks/completed each contain, the project's Tasks tab and the dashboard
 * counters — so the affected subtrees are revalidated rather than one path
 * (PRD #11 §247).
 */
function revalidateTasks(taskId?: string, projectId?: string | null) {
  revalidatePath("/tasks", "layout");
  if (taskId) revalidatePath(`/tasks/${taskId}`, "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/dashboard");
}

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function toResult(error: unknown): ActionResult {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  // Never surface a raw database error to a person (PRD #11 §249).
  console.error("[tasks] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = createTaskSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // The record the task is raised from, as `type:id`. Not trusted: the service
  // reads it through the record registry in this person's scope (PRD #38 §47).
  const parentValue = formData.get("parent");
  const parent =
    typeof parentValue === "string" && parentValue.includes(":")
      ? { parentType: parentValue.slice(0, parentValue.indexOf(":")), parentId: parentValue.slice(parentValue.indexOf(":") + 1) }
      : null;

  let taskId: string;
  let projectId: string | null;
  try {
    const task = parent
      ? await tasks.createTaskFromContext(context, { ...parsed.data, ...parent })
      : await tasks.createTask(context, parsed.data);
    taskId = task.id;
    projectId = task.project?.id ?? null;
  } catch (error) {
    return toResult(error);
  }

  revalidateTasks(taskId, projectId);
  redirect(`/tasks/${taskId}`);
}

export async function updateTaskAction(
  taskId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateTaskSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  let projectId: string | null = null;
  try {
    const task = await tasks.updateTask(context, taskId, parsed.data);
    projectId = task.project?.id ?? null;
  } catch (error) {
    return toResult(error);
  }

  revalidateTasks(taskId, projectId);
  redirect(`/tasks/${taskId}`);
}

/** The dedicated status actions (PRD #11 §159). */
export async function setTaskStatusAction(
  taskId: string,
  action: "start" | "block" | "complete" | "reopen",
  reopenTo: TaskStatus = "TODO",
  blockedReason = "",
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "start") await tasks.startTask(context, taskId);
    else if (action === "block") await tasks.blockTask(context, taskId, blockedReason);
    else if (action === "complete") await tasks.completeTask(context, taskId);
    else await tasks.reopenTask(context, taskId, reopenTo);
  } catch (error) {
    return toResult(error);
  }

  revalidateTasks(taskId);
  return { ok: true };
}

export async function archiveTaskAction(taskId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  try {
    await tasks.archiveTask(context, taskId);
  } catch (error) {
    return toResult(error);
  }
  revalidateTasks(taskId);
  return { ok: true };
}

export async function restoreTaskAction(taskId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  try {
    await tasks.restoreTask(context, taskId);
  } catch (error) {
    return toResult(error);
  }
  revalidateTasks(taskId);
  return { ok: true };
}
