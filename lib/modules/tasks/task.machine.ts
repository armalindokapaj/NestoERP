import type { TaskStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The task's states and the commands that move it (PRD #11 §65-§73,
 * PRD #38 §44, AUD-02 §5).
 *
 * The one transition table for tasks. The dedicated commands read it directly;
 * the edit form's status select and `canTransitionTaskStatus` are derived from
 * the non-archive rows (`task.status.ts`), so the form, the buttons and the
 * write cannot disagree.
 *
 * - `return_to_todo` is the one move only the edit form makes: an ordinary
 *   status edit may put started or blocked work back in the queue.
 * - Completing through the edit form still needs `task.complete`, and leaving
 *   COMPLETED needs `task.reopen`; the mutation checks those on top of the
 *   status permission (PRD #11 §61, §68).
 * - BLOCKED is reached only by `block`, which requires the reason.
 * - `restore` returns the task to the status captured when it was archived;
 *   the mutation computes which and names it (§62).
 */
export type TaskAction = "start" | "block" | "complete" | "reopen" | "return_to_todo" | "archive" | "restore";

export const taskMachine = defineStateMachine<TaskStatus, TaskAction>({
  key: "task",
  model: "task",
  field: "status",
  states: ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "start", from: ["TODO", "BLOCKED"], to: "IN_PROGRESS", permission: "task.status.update" },
    { action: "block", from: ["TODO", "IN_PROGRESS"], to: "BLOCKED", permission: "task.status.update", requiresReason: true },
    { action: "complete", from: ["TODO", "IN_PROGRESS", "BLOCKED"], to: "COMPLETED", permission: "task.complete" },
    { action: "reopen", from: ["COMPLETED"], to: ["TODO", "IN_PROGRESS"], permission: "task.reopen" },
    { action: "return_to_todo", from: ["IN_PROGRESS", "BLOCKED"], to: "TODO", permission: "task.status.update" },
    {
      action: "archive",
      from: ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"],
      to: "ARCHIVED",
      permission: "task.archive",
      freezes: "every field until it is restored",
    },
    { action: "restore", from: ["ARCHIVED"], to: ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"], permission: "task.restore" },
  ],
});

/** The commands an ordinary edit may make on the task's status. Archive and restore have their own. */
export const EDIT_STATUS_ACTIONS: readonly TaskAction[] = ["start", "block", "complete", "reopen", "return_to_todo"];
