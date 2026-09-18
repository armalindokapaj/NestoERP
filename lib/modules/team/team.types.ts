import type { CompanyInviteStatus, DepartmentStatus, MembershipStatus } from "@prisma/client";

/**
 * Team DTOs (PRD #14 §43, §147, §331).
 *
 * Explicitly shaped, and deliberately narrow. The Team directory carries safe
 * membership information; salary, bank details, national identifiers, home
 * address and medical data belong to HR and never appear here (PRD #14 §44,
 * §174).
 */
export type TeamMemberSummaryDTO = {
  id: string;
  userId: string;
  name: { firstName: string; lastName: string; fullName: string };
  email: string | null;
  avatarUrl: string | null;
  role: { id: string; key: string; name: string };
  department: { id: string; name: string } | null;
  jobTitle: string | null;
  status: MembershipStatus;
  /** Projects *this reader* can see, never the company-wide total (PRD #14 §52). */
  projectCount: number;
  /** Only present with team.member.security_metadata.view (PRD #14 §49). */
  lastLoginAt: string | null;
  joinedAt: string | null;
};

export type TeamMemberDetailDTO = {
  id: string;
  userId: string;
  /** The person's group-wide profile (`/people/[personId]`); none before an invitation is accepted. */
  personId: string | null;
  /** Optimistic-concurrency stamp carried by the edit form (PRD #14 §159). */
  updatedAt: string;

  profile: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
  };

  membership: {
    role: { id: string; key: string; name: string };
    department: { id: string; name: string } | null;
    jobTitle: string | null;
    status: MembershipStatus;
    joinedAt: string | null;
    invitedAt: string | null;
    deactivatedAt: string | null;
  };

  counts: { visibleProjects: number };

  /** Absent unless the reader holds the security-metadata grant (PRD #14 §49). */
  securityMetadata?: { lastLoginAt: string | null };

  /**
   * Server-derived UX hints, never security: every mutation re-checks
   * authorisation (PRD #14 §148).
   */
  capabilities: {
    canEditMembership: boolean;
    canAssignRole: boolean;
    canAssignDepartment: boolean;
    canDeactivate: boolean;
    canReactivate: boolean;
    canSuspend: boolean;
    canUnsuspend: boolean;
    canViewActivity: boolean;
  };

  /**
   * Why an action is unavailable, when the reason is a rule rather than a
   * missing permission — the last active Owner, or an active project
   * managership (PRD #14 §93, §101, §102).
   */
  guards: { lastActiveOwner: boolean; managedActiveProjects: number; openAssignedTasks: number };
};

export type TeamMemberProjectDTO = {
  id: string;
  code: string;
  name: string;
  projectRole: string | null;
  status: string;
  isManager: boolean;
};

export type InvitationDTO = {
  id: string;
  email: string | null;
  name: string | null;
  role: { id: string; name: string };
  department: { id: string; name: string } | null;
  jobTitle: string | null;
  invitedBy: string | null;
  invitedAt: string;
  expiresAt: string;
  /** Derived, so an unswept row still reads as expired (PRD #14 §236). */
  status: CompanyInviteStatus;
  /** The latest message sent for it, so a failed email is visible (PRD #38 §21). */
  delivery: { status: "QUEUED" | "SENT" | "FAILED" | "SUPPRESSED"; errorCode: string | null; at: string } | null;
};

export type DepartmentSummaryDTO = {
  id: string;
  name: string;
  key: string | null;
  description: string | null;
  manager: { memberId: string; fullName: string; active: boolean } | null;
  activeMembers: number;
  status: DepartmentStatus;
  updatedAt: string;
};

export type TeamActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

/** The Team overview counters (PRD #14 §8, §9). */
export type TeamOverviewStats = {
  activeMembers: number;
  departments: number;
  pendingInvitations: number;
  inactiveMembers: number;
  suspendedMembers: number;
};
