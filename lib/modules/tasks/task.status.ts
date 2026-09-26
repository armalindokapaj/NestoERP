import type { Task, TaskStatus } from "@prisma/client";

import { targetsOf } from "@/lib/core/state/machine";
import { EDIT_STATUS_ACTIONS, taskMachine } from "./task.machine";

/**
 * Task status rules (PRD #11 §65, §142, §191).
 *
 * One source of truth, so the dropdown in the edit form, the action buttons on
 * the detail page and the API validator cannot disagree (PRD #11 §160, §192).
 * The moves themselves are the task machine's (`task.machine.ts`, AUD-02 §5);
 * the status an edit may set is derived from its non-archive commands, never
 * kept in a second table.
 *
 * `ARCHIVED` is deliberately absent from the edit moves: archiving and
 * restoring have their own endpoints, and `COMPLETED → ARCHIVED` through a
 * PATCH must fail (PRD #11 §61, §71, §117).
 */
const EDIT_MOVES = taskMachine.transitions.filter((transition) => EDIT_STATUS_ACTIONS.includes(transition.action));

/** Statuses an ordinary create or edit form may set (PRD #11 §42). */
export const EDITABLE_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"];

/** Statuses a task can be reopened into (PRD #11 §70). */
export const REOPEN_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS"];

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return EDIT_MOVES.some((transition) => transition.from.includes(from) && targetsOf(transition).includes(to));
}

export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return taskMachine.states.filter((to) => canTransitionTaskStatus(from, to));
}

export function isTaskArchived(task: Pick<Task, "status" | "archivedAt">): boolean {
  return task.status === "ARCHIVED" || task.archivedAt !== null;
}

export function isTaskClosed(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "ARCHIVED";
}

/**
 * Overdue is derived, never stored, so it cannot go stale between the list, the
 * dashboard and the project tab (PRD #11 §142, §192).
 */
export function isTaskOverdue(
  task: Pick<Task, "status" | "dueDate">,
  now: Date = new Date(),
): boolean {
  if (!task.dueDate) return false;
  if (isTaskClosed(task.status)) return false;
  return task.dueDate.getTime() < now.getTime();
}

/** Same-calendar-day comparison, used by the "Due today" counters. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isDueToday(
  task: Pick<Task, "status" | "dueDate">,
  now: Date = new Date(),
): boolean {
  if (!task.dueDate) return false;
  if (isTaskClosed(task.status)) return false;
  return isSameDay(task.dueDate, now);
}

/** Midnight-to-midnight bounds for a day, used to build date-range filters. */
export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Start of the current week (Monday), used by "Completed this week". */
export function startOfWeek(date: Date = new Date()): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. Shift so Monday is the first day.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};
