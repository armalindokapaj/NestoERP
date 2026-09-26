"use server";

import type { TaskStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import { revalidateTaskViews } from "@/lib/modules/tasks/task.invalidate";
import type { TaskMutationMeta } from "@/lib/modules/tasks/task.mutation";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import type { TaskDetailDTO } from "@/lib/modules/tasks/task.types";

/**
 * Server actions for the Tasks module (PRD #11 §102).
 *
 * They are a thin shell over the same service the API routes call — the
 * authorisation, validation, version check and transaction exist once
 * (PRD #11 §91, AUD-02 §6) — and they refresh the same views the routes do.
 *
 * A refusal keeps its shape: `code` is the business code when there is one
 * (TASK_VERSION_CONFLICT, TASK_STATE_CONFLICT, TASK_VERSION_REQUIRED,
 * TASK_RETRYABLE_FAILURE) and the API code otherwise, so the page can offer
 * the right recovery instead of one message for everything.
 */

export type TaskActionFailure = {
  ok: false;
  code: string;
  error: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * `redirectTo` is where the page goes after a normal save (AUD-03 §6);
 * `lostAccess` says the save went through but took the task out of sight.
 */
export type ActionResult = { ok: true; meta?: TaskMutationMeta; redirectTo?: string; lostAccess?: boolean } | TaskActionFailure;

function toResult(error: unknown): TaskActionFailure {
  if (error instanceof AccessError) {
    const details = error.details as Record<string, unknown> | undefined;
    const code = typeof details?.code === "string" ? details.code : error.code;
    return { ok: false, code, error: error.message, ...(fieldErrorsOf(details) ? { fieldErrors: fieldErrorsOf(details) } : {}) };
  }
  // Never surface a raw database error to a person (PRD #11 §249).
  console.error("[tasks] action failed", error);
  return { ok: false, code: "INTERNAL_ERROR", error: "We couldn't save your changes. Please try again." };
}

/** A refusal's details are field errors when every value is a list of messages. */
function fieldErrorsOf(details: Record<string, unknown> | undefined): Record<string, string[]> | undefined {
  if (!details) return undefined;
  const entries = Object.entries(details).filter(([key]) => key !== "code");
  if (entries.length === 0 || !entries.every(([, value]) => Array.isArray(value) && value.every((item) => typeof item === "string"))) return undefined;
  return Object.fromEntries(entries) as Record<string, string[]>;
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
      code: "VALIDATION_ERROR",
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

  let task: TaskDetailDTO;
  try {
    task = parent
      ? await tasks.createTaskFromContext(context, { ...parsed.data, ...parent })
      : await tasks.createTask(context, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateTaskViews(task.id, { projectIds: task.project ? [task.project.id] : [] });
  // The form navigates on this answer, so it knows the task exists (AUD-03 §6).
  return { ok: true, redirectTo: `/tasks/${task.id}` };
}

/**
 * The edit form's save. Success answers the task to go to — or, when the save
 * took the task out of this person's sight, the list instead, so the page can
 * say the save happened (AUD-02 §6, TR-18). The form navigates; the action no
 * longer redirects, so the form knows the save committed (AUD-03 §6).
 */
export async function updateTaskAction(taskId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateTaskSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  let result: tasks.TaskMutationResponse;
  try {
    result = await tasks.updateTask(context, taskId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  if (result.meta.changed) revalidateTaskViews(taskId, result.effects);
  if (result.redirectTo) return { ok: true, meta: result.meta, redirectTo: result.redirectTo, lostAccess: true };
  return { ok: true, meta: result.meta, redirectTo: `/tasks/${taskId}` };
}

export type TaskCommandName = "start" | "block" | "complete" | "reopen" | "archive" | "restore";

/**
 * The dedicated commands (PRD #11 §159), each against the version the page
 * showed. Answers the committed metadata; the page refreshes itself.
 */
export async function taskCommandAction(
  taskId: string,
  command: TaskCommandName,
  input: { expectedVersion: number; reason?: string; reopenTo?: TaskStatus },
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  let result: tasks.TaskMutationResponse;
  try {
    const version = { expectedVersion: input.expectedVersion };
    if (command === "start") result = await tasks.startTask(context, taskId, version);
    else if (command === "block") result = await tasks.blockTask(context, taskId, { ...version, reason: input.reason });
    else if (command === "complete") result = await tasks.completeTask(context, taskId, version);
    else if (command === "reopen") result = await tasks.reopenTask(context, taskId, { ...version, status: input.reopenTo });
    else if (command === "archive") result = await tasks.archiveTask(context, taskId, version);
    else if (command === "restore") result = await tasks.restoreTask(context, taskId, version);
    else return { ok: false, code: "VALIDATION_ERROR", error: "That is not a task action." };
  } catch (error) {
    return toResult(error);
  }

  if (result.meta.changed) revalidateTaskViews(taskId, result.effects);
  return { ok: true, meta: result.meta, ...(result.redirectTo ? { redirectTo: result.redirectTo } : {}) };
}

/**
 * What the conflict review compares the person's draft against (AUD-02 §7): the
 * task's editable fields and version, read now, through this person's scope.
 * A task they can no longer read answers `access: "lost"` and nothing else.
 */
export type TaskReviewSnapshot =
  | { access: "lost" }
  | {
      access: "ok";
      task: {
        id: string;
        version: number;
        archived: boolean;
        canRestore: boolean;
        canEdit: boolean;
        values: {
          title: string;
          description: string;
          projectId: string;
          projectLabel: string;
          assigneeMemberId: string;
          assigneeLabel: string;
          status: string;
          priority: string;
          startDate: string;
          dueDate: string;
        };
      };
    };

export async function taskReviewSnapshotAction(taskId: string): Promise<TaskReviewSnapshot> {
  const context = await requireCompanyContext();
  let task: TaskDetailDTO;
  try {
    task = await tasks.getTask(context, taskId);
  } catch (error) {
    if (error instanceof AccessError && ["NOT_FOUND", "FORBIDDEN", "MODULE_UNAVAILABLE"].includes(error.code)) return { access: "lost" };
    throw error;
  }
  const archived = task.archivedAt !== null || task.status === "ARCHIVED";
  return {
    access: "ok",
    task: {
      id: task.id,
      version: task.version,
      archived,
      canRestore: task.capabilities.canRestore,
      canEdit: task.capabilities.canEdit,
      values: {
        title: task.title,
        description: task.description ?? "",
        projectId: task.project?.id ?? "",
        projectLabel: task.project ? `${task.project.name} (${task.project.code})` : "No project",
        assigneeMemberId: task.assignee?.memberId ?? "",
        assigneeLabel: task.assignee?.fullName ?? "Unassigned",
        status: task.status,
        priority: task.priority,
        startDate: task.schedule.startDate?.slice(0, 10) ?? "",
        dueDate: task.schedule.dueDate?.slice(0, 10) ?? "",
      },
    },
  };
}
