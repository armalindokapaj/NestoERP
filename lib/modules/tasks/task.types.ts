import type { TaskPriority, TaskStatus } from "@prisma/client";

/**
 * Task DTOs (PRD #11 §111, §112).
 *
 * Responses are shaped explicitly rather than handing back a Prisma model, so a
 * field added to the table cannot leak through an API by accident.
 */
export type TaskPersonDTO = {
  memberId: string;
  fullName: string;
  avatarUrl: string | null;
  /** Surfaced so an inactive assignee is never silently hidden (PRD #11 §174). */
  membershipActive: boolean;
};

export type TaskSummaryDTO = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: { id: string; code: string; name: string } | null;
  assignee: TaskPersonDTO | null;
  dueDate: string | null;
  completedAt: string | null;
  /** Derived, never stored (PRD #11 §142). */
  isOverdue: boolean;
  updatedAt: string;
  /** The version a command launched from this row names (AUD-02 §3). */
  version: number;
  /** Present only in the Group workspace, where a row must say which company it is (Workspace Context §32, §45). */
  company?: { id: string; name: string };
};

export type TaskDetailDTO = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  preArchiveStatus: TaskStatus | null;
  priority: TaskPriority;
  project: { id: string; code: string; name: string } | null;
  assignee: (TaskPersonDTO & { userId: string }) | null;
  creator: { memberId: string; fullName: string } | null;
  schedule: {
    startDate: string | null;
    dueDate: string | null;
    completedAt: string | null;
    isOverdue: boolean;
  };
  /** Generic parent context for module-linked work (PRD #11 §171). */
  context: { module: string | null; entityType: string | null; entityId: string | null };
  /**
   * The record the task was raised from, as this reader sees it (PRD #38 §45).
   * Null when there is none, or when the reader cannot open it — the task does
   * not become a way to learn a record's name.
   */
  parent: { type: string; noun: string; label: string; href: string } | null;
  /** Why the task cannot move, while it is BLOCKED (PRD #38 §44). */
  blocked: { reason: string | null; since: string | null; byMemberId: string | null } | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The concurrency authority (AUD-02 §3): every change this page launches
   * names it, and is refused if the task has moved on since.
   */
  version: number;
  archivedAt: string | null;
  /**
   * Server-derived UX hints. The frontend must not treat these as security —
   * every mutation re-checks authorisation (PRD #11 §148 pattern).
   */
  capabilities: {
    canEdit: boolean;
    canAssign: boolean;
    canChangeStatus: boolean;
    canComplete: boolean;
    canReopen: boolean;
    canArchive: boolean;
    canRestore: boolean;
  };
};

export type TaskActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  actorMemberId: string | null;
  createdAt: string;
};

/** The Tasks overview counters (PRD #11 §7, §8). */
export type TaskOverviewStats = {
  open: number;
  dueToday: number;
  overdue: number;
  blocked: number;
  completedThisWeek: number;
  mine: number;
};
