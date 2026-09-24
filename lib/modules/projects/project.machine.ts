import type { ProjectStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The project lifecycle (E-05A §10-§12; PRD #10 §61-§68; PRD #49 §54).
 *
 * Pending, Active and Finished are the working states, and moving between them
 * is `project.status.manage` — deliberately not `project.update`, so the people
 * who keep a project's details right are not thereby the people who declare it
 * started or handed over (E-05A §11).
 *
 * The four moves E-05A §12 names are `activate`, `finish` (from Pending or
 * Active) and `reopen`. `return_to_pending` is the correction §12 allows an
 * authorised administrator — a project marked started too early — and it asks
 * for a reason, because undoing a declared start is worth explaining.
 *
 * Archiving takes a project out of daily discovery and has its own permissions.
 * Restoring returns it to whatever it held before, so `restore` declares all
 * three working states and the service names the one on the record.
 */
export type ProjectAction = "activate" | "finish" | "reopen" | "return_to_pending" | "archive" | "restore";

export const projectMachine = defineStateMachine<ProjectStatus, ProjectAction>({
  key: "project",
  model: "project",
  field: "status",
  states: ["PENDING", "ACTIVE", "FINISHED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "activate", from: ["PENDING"], to: "ACTIVE", permission: "project.status.manage" },
    { action: "finish", from: ["PENDING", "ACTIVE"], to: "FINISHED", permission: "project.status.manage" },
    { action: "reopen", from: ["FINISHED"], to: "ACTIVE", permission: "project.status.manage" },
    { action: "return_to_pending", from: ["ACTIVE", "FINISHED"], to: "PENDING", permission: "project.status.manage", requiresReason: true },
    { action: "archive", from: ["PENDING", "ACTIVE", "FINISHED"], to: "ARCHIVED", permission: "project.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ["PENDING", "ACTIVE", "FINISHED"], permission: "project.restore" },
  ],
});

/** The working states a person chooses between (E-05A §10). Archived is not one of them. */
export const WORKING_STATUSES = ["PENDING", "ACTIVE", "FINISHED"] as const satisfies readonly ProjectStatus[];
export type WorkingStatus = (typeof WORKING_STATUSES)[number];

/** The status action that moves a project from one working state to another, if any does. */
export function statusActionFor(from: ProjectStatus, to: ProjectStatus): ProjectAction | null {
  const transition = projectMachine.transitions.find(
    (candidate) =>
      candidate.action !== "archive" &&
      candidate.action !== "restore" &&
      candidate.from.includes(from) &&
      candidate.to === to,
  );
  return transition?.action ?? null;
}

/** The working states a project can be moved to from where it is (E-05A §12). */
export function statusMovesFrom(from: ProjectStatus): WorkingStatus[] {
  return WORKING_STATUSES.filter((to) => to !== from && statusActionFor(from, to) !== null);
}
