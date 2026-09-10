import type { ProjectPriority, ProjectStatus } from "@prisma/client";

/**
 * Project DTOs (PRD #10 §103, §104).
 *
 * Responses are shaped explicitly rather than handing back a Prisma model, so a
 * field added to the table cannot leak through an API by accident
 * (PRD #8 §118).
 */
export type ProjectSummaryDTO = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  priority: ProjectPriority | null;
  client: { id: string; name: string } | null;
  projectManager: { memberId: string; fullName: string } | null;
  startDate: string | null;
  endDate: string | null;
  teamSize: number;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProjectDetailDTO = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  preArchiveStatus: ProjectStatus | null;
  priority: ProjectPriority | null;
  client: { id: string; name: string } | null;
  projectManager: {
    memberId: string;
    userId: string;
    fullName: string;
    avatarUrl: string | null;
    /** Surfaced so an inactive manager is never silently hidden (PRD #10 §171). */
    membershipActive: boolean;
  } | null;
  schedule: { startDate: string | null; endDate: string | null };
  location: { address: string | null; city: string | null; country: string | null };
  counts: { members: number; openTasks: number; documents: number };
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProjectMemberDTO = {
  id: string;
  companyMemberId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
  department: string | null;
  jobTitle: string | null;
  projectRole: string | null;
  isPrimary: boolean;
  status: "ACTIVE" | "INACTIVE";
  membershipActive: boolean;
};

export type ProjectActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

export type ProjectTaskSummary = {
  open: number;
  inProgress: number;
  blocked: number;
  completed: number;
  overdue: number;
};

export type ProjectOverviewStats = {
  active: number;
  onHold: number;
  atRisk: number;
  completed: number;
  draft: number;
};
