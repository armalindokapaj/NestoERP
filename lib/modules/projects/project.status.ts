import type { Project, ProjectStatus } from "@prisma/client";

/**
 * Project status rules (PRD #10 §61, §62, §196).
 *
 * The transition table lives here so the UI dropdown and the API validator read
 * the same rules. Archiving and restoring have their own endpoints and are
 * deliberately absent from the ordinary update path — `ARCHIVED → ACTIVE`
 * through PATCH must fail (PRD #10 §62).
 */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: ["ACTIVE", "ON_HOLD"],
  ACTIVE: ["ON_HOLD", "COMPLETED"],
  ON_HOLD: ["ACTIVE", "COMPLETED"],
  COMPLETED: ["ACTIVE"],
  ARCHIVED: [],
};

export const EDITABLE_STATUSES: ProjectStatus[] = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED"];

export function canTransitionProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ProjectStatus): ProjectStatus[] {
  return [from, ...TRANSITIONS[from]];
}

export function isProjectArchived(project: Pick<Project, "status" | "archivedAt">): boolean {
  return project.status === "ARCHIVED" || project.archivedAt !== null;
}

export type ScheduleStatus =
  | "NOT_SCHEDULED"
  | "UPCOMING"
  | "IN_PROGRESS"
  | "OVERDUE"
  | "COMPLETED"
  | "ON_HOLD";

/**
 * Derived from the dates and the status — never stored, so it cannot go stale
 * (PRD #10 §49, §50).
 */
export function getProjectScheduleStatus(
  project: Pick<Project, "status" | "startDate" | "endDate">,
  now: Date = new Date(),
): ScheduleStatus {
  if (project.status === "COMPLETED") return "COMPLETED";
  if (project.status === "ON_HOLD") return "ON_HOLD";
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
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
};
