import type { Project, ProjectStatus } from "@prisma/client";

import { canMove } from "@/lib/core/state/machine";
import { projectMachine, statusActionFor, WORKING_STATUSES } from "./project.machine";

/**
 * Project status rules (E-05A §10, §12; PRD #10 §61, §62, §196).
 *
 * The moves themselves are declared once, on `projectMachine`; these helpers
 * answer the questions the form and the menus ask from that declaration, so
 * the UI dropdown and the API validator cannot disagree. Archiving and
 * restoring have their own endpoints and are absent from the working moves —
 * `ARCHIVED → ACTIVE` through the status endpoint must fail (PRD #10 §62).
 */

export const EDITABLE_STATUSES: ProjectStatus[] = [...WORKING_STATUSES];

export const projectStatusLabels: Record<ProjectStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  FINISHED: "Finished",
  ARCHIVED: "Archived",
};

export function canTransitionProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true;
  return statusActionFor(from, to) !== null && canMove(projectMachine, from, to);
}

/** The status a project may be set to from where it is, including staying put. */
export function allowedTransitions(from: ProjectStatus): ProjectStatus[] {
  return [from, ...EDITABLE_STATUSES.filter((to) => to !== from && statusActionFor(from, to) !== null)];
}

export function isProjectArchived(project: Pick<Project, "status" | "archivedAt">): boolean {
  return project.status === "ARCHIVED" || project.archivedAt !== null;
}

export type ScheduleStatus =
  | "NOT_SCHEDULED"
  | "UPCOMING"
  | "IN_PROGRESS"
  | "OVERDUE"
  | "FINISHED";

/**
 * Derived from the dates and the status — never stored, so it cannot go stale
 * (PRD #10 §49, §50).
 */
export function getProjectScheduleStatus(
  project: Pick<Project, "status" | "startDate" | "endDate">,
  now: Date = new Date(),
): ScheduleStatus {
  if (project.status === "FINISHED") return "FINISHED";
  if (!project.startDate && !project.endDate) return "NOT_SCHEDULED";

  if (project.endDate && project.endDate.getTime() < now.getTime()) return "OVERDUE";
  if (project.startDate && project.startDate.getTime() > now.getTime()) return "UPCOMING";

  return "IN_PROGRESS";
}

/** Whole days between now and the end date. Negative means overdue. */
export function daysRemaining(endDate: Date | null, now: Date = new Date()): number | null {
  if (!endDate) return null;
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((endDate.getTime() - now.getTime()) / millisecondsPerDay);
}

export function formatDaysRemaining(days: number | null): string {
  if (days === null) return "No end date";
  if (days === 0) return "Due today";
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
}

export const scheduleStatusLabels: Record<ScheduleStatus, string> = {
  NOT_SCHEDULED: "Not scheduled",
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  OVERDUE: "Overdue",
  FINISHED: "Finished",
};
